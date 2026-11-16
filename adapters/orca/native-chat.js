import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {randomUUID} from 'node:crypto';

const exec = promisify(execFile), require = createRequire(import.meta.url), timeoutMs = 15_000;
const fail = (reasonCode, reason = reasonCode) => ({ ok: false, reasonCode, reason });
const unwrap = response => { if (response?.ok === false) throw Object.assign(Error(response?.error?.message || 'Orca RPC failed'), { code: response?.error?.code }); return response?.result ?? response; };
const providerOf = value => /^(claude|codex)(?:$|[-_])/i.exec(value || '')?.[1]?.toLowerCase() || null;
const idOf = item => item?.id || item?.itemId || item?.turnItemId || null;
const textOf = item => (item?.body?.blocks || []).filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
const nativeOf = value => value?.nativeId || value?.native_id || null;
const cwdOf = value => value?.cwd || null;
const operationOf = requestId => String(requestId);
const validOperation = value => /^\d{13}-[0-9a-f]{32}$/.test(value||'');
const messageIdFor = (receipt,requestId) => receipt?.submissionClientMessageId||receipt?.clientOperationId||operationOf(requestId);
const nativeRuntimeFor=binding=>{let caps=binding?.capabilities;try{if(typeof caps==='string')caps=JSON.parse(caps);}catch{}return caps?.nativeChat?.runtimeId||String(binding?.incarnation||'').slice(0,String(binding?.incarnation||'').lastIndexOf(':'));};
const nativeBindingSnapshot=binding=>String(binding?.incarnation||'').startsWith(nativeRuntimeFor(binding)+':')&&/:\d+$/.test(binding?.incarnation||'');
const historyOrder=(a,b)=>{if(Number.isFinite(a.sequence)&&Number.isFinite(b.sequence))return a.sequence-b.sequence;const stamp=x=>typeof x.observedAt==='number'?x.observedAt:Date.parse(x.observedAt)||0;return stamp(a)-stamp(b)||String(idOf(a)).localeCompare(String(idOf(b)));};
const normalizedCwd = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const snapshotCwd = snapshot => String(snapshot?.worktree || '').split('::').slice(1).join('::');
const userKeys = (receipt, requestId, submission) => [submission?.providerItemId, `orca:${encodeURIComponent(messageIdFor(receipt,requestId))}`].filter(Boolean);
const requiredCapabilities = ['agent-session.structured.v1', 'agent-session.accepted-send.v1', 'agent-session.pending-send-result.v1', 'agent-session.queued-messages.v2'];
const supportsNativeChat = status => typeof status?.runtimeId === 'string' && status.runtimeId.length > 0 && Array.isArray(status.capabilities) && requiredCapabilities.every(capability => status.capabilities.includes(capability));
const optionString=value=>typeof value==='string'&&value.trim()?value.trim():null;
const readMetadata=options=>{
  const current=options?.current;
  if(!current||typeof current!=='object')return {model:null,effort:null,reasonCode:'options_unavailable'};
  const model=optionString(current.model),effort=optionString(current.effort);
  return {model,effort,reasonCode:model||effort?null:'model_effort_not_reported'};
};

async function executable() {
  if (process.env.ORCA_CLI_COMMAND) return process.env.ORCA_CLI_COMMAND;
  const finder = process.platform === 'win32' ? 'where.exe' : 'which', name = process.platform === 'win32' ? 'orca.exe' : 'orca';
  const { stdout } = await exec(finder, [name], { windowsHide: true, timeout: timeoutMs });
  const found = stdout.trim().split(/\r?\n/)[0]; if (!found) throw Error('orca executable not found on PATH'); return found;
}
function installedModule(bin, parts) {
  const resources = dirname(dirname(resolve(bin)));
  if (!/[\\/]resources$/i.test(resources)) throw Error('Orca CLI is not installed under resources/bin; native chat is unavailable');
  return join(resources, 'app.asar.unpacked', 'out', ...parts);
}
async function defaultCallFactory({ clientFactory, resolveExecutable }) {
  const bin=await resolveExecutable();let RuntimeClient=clientFactory;
  if(!RuntimeClient){let missing;for(const parts of [['cli','runtime-client.js'],['cli','runtime','client.js']])try{RuntimeClient=require(installedModule(bin,parts)).RuntimeClient;break;}catch(error){missing=error;}if(!RuntimeClient)throw missing;}
  const client = new RuntimeClient(undefined, timeoutMs, null, null); return (method, params, options) => client.call(method, params, options);
}
async function defaultMutationFactory(resolveExecutable,moduleLoader=require) {
  const bin=await resolveExecutable(),official=moduleLoader(installedModule(bin,['shared','agent-session','requests','structured-agent-session-send-mutation.js'])).structuredAgentSessionMessageSendMutation;
  const {createStructuredAgentSessionOperationId}=moduleLoader(installedModule(bin,['shared','agent-session','lifecycle','structured-agent-session-mutation.js']));
  const builder=input=>official(input);builder.createOperationId=()=>createStructuredAgentSessionOperationId(randomUUID);return builder;
}
function findTab(snapshots, provider, cwd, handle = null) {
  const matches = [];
  for (const snapshot of snapshots || []) if (normalizedCwd(snapshotCwd(snapshot)) === normalizedCwd(cwd)) for (const tab of snapshot.tabs || []) if (tab?.type === 'agent-session' && providerOf(tab.agent) === provider && (!handle || tab.sessionId === handle)) matches.push({ snapshot, tab });
  return matches;
}
function receiptFor(binding, runtimeId, fence, requestId, payloadFingerprint = null,clientOperationId=null) { return { sessionId: binding.handle, nativeId: nativeOf(binding), runtimeId, fence,requestId,clientOperationId,...(payloadFingerprint ? { payloadFingerprint } : {}) }; }
function correlated(page, requestId, receipt, incomplete = false) {
  const clientMessageId = messageIdFor(receipt,requestId);
  const submissions = (page?.submissions || []).filter(row => row?.clientMessageId === clientMessageId);
  if (submissions.length !== 1) return { ok: false, stage: 'unknown', receipt: { ...receipt, correlation: 'submission_not_observed' } };
  const submission = submissions[0], userIds = userKeys(receipt,requestId,submission);
  if (!Number.isInteger(submission.fence)||submission.fence<receipt.fence||submission.fence>page.fence||(receipt.bodyPayloadFingerprint && submission.payloadFingerprint !== receipt.bodyPayloadFingerprint)) return { ok: false, stage: 'unknown', receipt: { ...receipt, correlation: 'submission_fence_or_body_mismatch' } };
  const user = (page.items || []).find(item => userIds.includes(idOf(item)) && item?.body?.kind === 'message' && item?.body?.role === 'user');
  if (!user) return { ok: false, stage: 'unknown', receipt: { ...receipt, correlation: 'user_item_not_observed' } };
  const turns=new Map((page.items||[]).filter(item=>item.body?.kind==='turn'||item.body?.turnLifecycle).map(item=>[idOf(item),item]));
  if(page.latestTurn?.itemId&&page.latestTurn.turn)turns.set(page.latestTurn.itemId,{itemId:page.latestTurn.itemId,body:page.latestTurn.turn});
  const exactTurnId=submission?.answeredInTurn?.turnItemId;
  const matches=[...turns.values()].filter(item=>exactTurnId?idOf(item)===exactTurnId:userIds.includes((item.body?.turnLifecycle||item.body)?.userItemId));
  if(matches.length>1)return {ok:false,stage:'unknown',reason:'multiple native turns match this submission',receipt:{...receipt,correlation:'ambiguous_turn'}};
  if(!matches.length)return {ok:true,stage:'input_accepted',receipt:{...receipt,userItemId:idOf(user)}};
  const turn=matches[0],turnId=idOf(turn);
  if (!turn) return { ok: false, stage: 'unknown', receipt: { ...receipt, userItemId: idOf(user), turnId, correlation: 'answered_turn_not_observed' } };
  const body=turn?.body?.kind==='status'?turn.body.turnLifecycle:turn?.body;
  if(body?.userItemId&&!userIds.includes(body.userItemId))return {ok:false,stage:'unknown',reason:'submission was merged into another user turn',receipt:{...receipt,correlation:'turn_user_mismatch'}};
  if(body?.state==='running')return { ok: true, stage: 'turn_started', receipt: { ...receipt, userItemId: idOf(user), turnId } };
  if(body?.state!=='completed'||body.outcome!=='success')return {ok:false,stage:'unknown',reason:`native turn outcome is ${body?.outcome||'unverified'}`,receipt:{...receipt,turnId,correlation:'turn_not_successful'}};
  const assistants = (page.items || []).filter(item => item?.body?.kind === 'message' && item?.body?.role === 'assistant' && item?.turnScope?.kind === 'turn' && item?.turnScope?.turnItemId === turnId);
  if (!assistants.length || incomplete) return { ok: false, stage: 'unknown', receipt: { ...receipt, userItemId: idOf(user), turnId, correlation: incomplete ? 'history_window_incomplete' : 'completed_turn_has_no_assistant_message' } };
  return { ok: true, stage: 'reply', receipt: { ...receipt, userItemId: idOf(user), turnId,observedFence:page.fence }, reply: { body: assistants.map(textOf).join('\n\n'),finalBody:textOf(assistants.at(-1)), turnId:body.turnId||turnId, turnItemId: turnId, userItemId: idOf(user), itemIds: assistants.map(idOf) } };
}

export function createOrcaNativeChatAdapter({ call: givenCall = null, mutation: givenMutation = null,operationIdFactory=null,moduleLoader=require, clientFactory = null, resolveExecutable = executable,metadataTimeoutMs=750 } = {}) {
  let callPromise = givenCall ? Promise.resolve(givenCall) : null, mutationPromise = givenMutation ? Promise.resolve(givenMutation) : null, executablePromise = null;
  const resolvedExecutable = () => executablePromise ||= resolveExecutable();
  const metadataCallOptions={timeoutMs:Math.min(750,Math.max(1,Number(metadataTimeoutMs)||750))};
  const rpc = async (method, params, options) => unwrap(await (callPromise ||= defaultCallFactory({ clientFactory, resolveExecutable: resolvedExecutable })).then(call => call(method, params, options)));
  const history = (sessionId,cursor=null,limit=200,options) => rpc('agentSession.history',{sessionId,direction:cursor?'before':'tail',limit,...(cursor?{cursor}:{})},options);
  async function allHistory(sessionId,requestId,receipt) {
    const first=await history(sessionId),items=new Map(),submissions=new Map(),seen=new Set();let current=first,covered=false,incomplete=false;
    for(let count=0;count<8;count++){
      if(current?.ok!==true||current.page?.sessionId!==sessionId||current.page?.epoch!==first.page?.epoch||current.page?.fence!==first.page?.fence)throw Error('native history identity or epoch changed');
      for(const item of current.page.items||[])if(!items.has(idOf(item))||(item.revision||0)>(items.get(idOf(item)).revision||0))items.set(idOf(item),item);
      for(const submission of current.page.submissions||[])if(!submissions.has(submission.clientMessageId))submissions.set(submission.clientMessageId,submission);
      const submission=submissions.get(messageIdFor(receipt,requestId)),keys=userKeys(receipt,requestId,submission);
      covered=[...items.values()].some(item=>keys.includes(idOf(item))&&item.body?.role==='user');
      if(covered||current.page.hasOlder===false)break;
      const cursor=current.page.window?.nextCursor,key=JSON.stringify(cursor);
      if(!cursor||seen.has(key)||count===7){incomplete=true;break;}seen.add(key);
      current=await history(sessionId,cursor);
    }
    return {...first,page:{...first.page,items:[...items.values()].sort(historyOrder),submissions:[...submissions.values()]},incomplete:incomplete||!covered};
  }
  async function lookup(provider, nativeId, cwd, handle = null, options) {
    const [status, listed] = await Promise.all([rpc('status.get',undefined,options), rpc('session.tabs.listAll',undefined,options)]);
    if (!supportsNativeChat(status)) return null;
    const matches = [];for(const found of findTab(listed.snapshots,provider,cwd)){const detail=await history(found.tab.sessionId,null,1,options);if(detail?.ok===true&&detail.page?.sessionId===found.tab.sessionId&&Number.isInteger(detail.page.fence)&&detail.page.fence>=0&&detail.providerSession?.id===nativeId)matches.push({status,found,detail});}
    if(handle&&matches[0]?.found.tab.sessionId!==handle)return null;
    return matches.length === 1 ? matches[0] : null;
  }
  function binding(state) {
    const cwd = snapshotCwd(state.found.snapshot), page = state.detail.page;
    return { provider: providerOf(state.found.tab.agent), host: 'orca/local', nativeId: state.detail.providerSession.id, cwd, profile: 'default', mode: 'live_attach', ownership: 'borrowed', handle: state.found.tab.sessionId, incarnation: `${state.status.runtimeId}:${page.fence}`, verified: true, capabilities: { transport: 'orca-native-chat', automaticInput: true, followup: true, steer: false, rawInspect: false, mcpPull: false, nativeChat: { runtimeId: state.status.runtimeId, fence: page.fence, workspace: state.found.snapshot.worktree, epoch: state.found.snapshot.publicationEpoch, providerSessionId: state.detail.providerSession.id } } };
  }
  async function verify(providerOrBinding, suppliedNativeId, suppliedCwd, options = {}) {
    const input = typeof providerOrBinding === 'object' ? providerOrBinding : { provider: providerOrBinding, nativeId: suppliedNativeId, cwd: suppliedCwd, ...options }, provider = input?.provider, nativeId = nativeOf(input), cwd = cwdOf(input);
    if (!['claude', 'codex'].includes(provider) || !nativeId || !cwd || (input.profile && input.profile !== 'default') || (input.host && input.host !== 'orca/local')) return fail('identity_invalid');
    const state = await lookup(provider, nativeId, cwd, input.handle, options.rpcOptions); if (!state) return fail('identity_changed');
    const found = binding(state);
    if ((input.handle && input.handle !== found.handle) || (input.incarnation && input.incarnation !== found.incarnation)) return fail('identity_changed');
    return found;
  }
  async function preflight(bindingInput, session) {
    if(!nativeBindingSnapshot(bindingInput))return fail('identity_changed');
    if (!bindingInput || bindingInput.provider !== session?.provider || nativeOf(bindingInput) !== nativeOf(session) || cwdOf(bindingInput) !== cwdOf(session)) return fail('identity_changed');
    const checked = await verify({...bindingInput,incarnation:null}); if (!checked.verified) return checked;
    if(checked.capabilities.nativeChat.runtimeId!==nativeRuntimeFor(bindingInput))return fail('identity_changed');
    const detail = await history(bindingInput.handle,null,1), page = detail?.page, status = await rpc('status.get');
    if (!page || page.sessionId !== bindingInput.handle || !Number.isInteger(page.fence) || page.fence < 0 || !supportsNativeChat(status) || status.runtimeId!==nativeRuntimeFor(bindingInput)) return fail('identity_changed');
    if (page.working !== false) return fail('busy_idle_unverified');
    if (!Array.isArray(page.queuedMessages) || page.queuedMessages.length) return fail('queue_not_empty');
    if (!Array.isArray(page.actionablePromptIds) || page.actionablePromptIds.length) return fail('action_required');
    if ((page.submissions || []).some(submission => ['pending', 'unknown'].includes(submission?.dispatchState) || (submission?.dispatchState === 'accepted' && !submission?.answeredInTurn && submission?.resolvedAt == null))) return fail('prior_submission_unresolved');
    return { ok: true, binding: checked, page, runtimeId: status.runtimeId };
  }
  async function observe(bindingInput, session, requestId, previousReceipt = null) {
    if(!nativeBindingSnapshot(bindingInput))return fail('identity_changed');
    const checked = await verify({...bindingInput,incarnation:null}); if (!checked.verified || checked.provider !== session?.provider||checked.capabilities.nativeChat.runtimeId!==nativeRuntimeFor(bindingInput)) return checked.verified ? fail('identity_changed') : checked;
    // The legacy adapter sent the room UUID as the native operation ID. Orca's
    // admission ledger rejects this exact shape before any write (verified against
    // the installed ledger and its actual operationIdInvalid refusal).
    if(previousReceipt?.clientOperationId===requestId&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId))return {ok:false,notRecorded:true,legacyInvalidId:true,reason:'Orca rejected the legacy UUID operation before admission',receipt:{...previousReceipt,requestId,refusal:{code:'agent_session_operation_invalid',details:{reason:'operationIdInvalid'}},dispatchOutcome:'not-recorded'}};
    const receipt=previousReceipt||receiptFor(bindingInput,checked.capabilities.nativeChat.runtimeId,checked.capabilities.nativeChat.fence,requestId);
    const detail = await allHistory(bindingInput.handle,requestId,receipt);
    if(detail.providerSession?.id!==nativeOf(bindingInput)||detail.page.sessionId!==bindingInput.handle)return fail('identity_changed');
    return correlated(detail?.page, requestId, receipt, detail.incomplete);
  }
  return {
    async discover({ provider = null, cwd = null, handle = null, timeoutMs: discoveryTimeoutMs = null } = {}) {
      const readOptions=discoveryTimeoutMs?{timeoutMs:Math.min(750,Math.max(1,discoveryTimeoutMs))}:undefined;const [status, listed] = await Promise.all([rpc('status.get',undefined,readOptions), rpc('session.tabs.listAll',undefined,readOptions)]), sessions = [];
      const candidates = []; for (const snapshot of listed.snapshots || []) for (const tab of snapshot.tabs || []) { const name = providerOf(tab?.agent), tabCwd = snapshotCwd(snapshot); if (tab?.type === 'agent-session' && name && (!provider || provider === name) && (!cwd || normalizedCwd(cwd) === normalizedCwd(tabCwd)) && (!handle || tab.sessionId===handle)) candidates.push({ snapshot, tab }); }
      if(!supportsNativeChat(status))return {runtimeId:status?.runtimeId||null,sessions:[],errors:['Orca native Chat capabilities unavailable']};
      for (let start = 0; start < candidates.length; start += 4) { const rows = await Promise.all(candidates.slice(start, start + 4).map(async found => ({ found, detail: await history(found.tab.sessionId,null,1,readOptions) }))); for (const { found, detail } of rows) if (detail?.ok === true && detail.page?.sessionId===found.tab.sessionId && detail?.providerSession?.id && Number.isInteger(detail.page.fence)&&detail.page.fence>=0) sessions.push({...binding({ status, found, detail }),title:found.tab.title||null}); }
      return { runtimeId: status.runtimeId, sessions };
    }, verify, preflight, observe,
    async readMetadata(bindingInput,session){
      if(!nativeBindingSnapshot(bindingInput)||bindingInput.provider!==session?.provider||nativeOf(bindingInput)!==nativeOf(session)||cwdOf(bindingInput)!==cwdOf(session))return fail('identity_changed');
      const before=await verify({...bindingInput,incarnation:null},null,null,{rpcOptions:metadataCallOptions});
      if(!before.verified||before.capabilities.nativeChat.runtimeId!==nativeRuntimeFor(bindingInput))return before.verified?fail('identity_changed'):before;
      if(before.incarnation!==bindingInput.incarnation)return fail('identity_changed');
      const options=await rpc('agentSession.options',{sessionId:before.handle},metadataCallOptions);
      const after=await verify({...bindingInput,incarnation:null},null,null,{rpcOptions:metadataCallOptions});
      if(!after.verified||after.handle!==before.handle||after.incarnation!==before.incarnation)return after.verified?fail('identity_changed'):after;
      return {ok:true,binding:after,metadata:{...readMetadata(options),source:'orca agentSession.options'}};
    },
    async reconnect(bindingInput,session){
      if(!nativeBindingSnapshot(bindingInput)||bindingInput.provider!==session?.provider||nativeOf(bindingInput)!==nativeOf(session)||cwdOf(bindingInput)!==cwdOf(session))return fail('identity_changed');
      // A new host runtime/actor may own the same original conversation after restart.
      // This only verifies identity; Store decides whether any unsent work may move.
      return verify({provider:session.provider,nativeId:nativeOf(session),cwd:cwdOf(session),host:'orca/local',profile:'default'});
    },
    async send(bindingInput, session, prompt, requestId, { observeOnly = false, receipt = null, onPrepared = null } = {}) {
      if (observeOnly) return observe(bindingInput, session, requestId, receipt);
      const ready = await preflight(bindingInput, session); if (!ready.ok) return ready;
      const makeMutation=await (mutationPromise ||= defaultMutationFactory(resolvedExecutable,moduleLoader));
      const operationId=receipt?.clientOperationId||(operationIdFactory?operationIdFactory(requestId):makeMutation.createOperationId?.());
      if(!validOperation(operationId))return fail('native_operation_id_invalid','Native operation ID must be timestamp plus UUID hex');
      const payload = makeMutation({ sessionId: bindingInput.handle, clientOperationId: operationId, expectedRuntimeFence: ready.page.fence, body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: prompt }] }, delivery: 'queue-if-active' });
      const bodyPayloadFingerprint=makeMutation({sessionId:bindingInput.handle,clientOperationId:operationId,expectedRuntimeFence:ready.page.fence,body:payload.body}).envelope.payloadFingerprint;
      const prepared = { ...receiptFor(bindingInput, ready.runtimeId, ready.page.fence, requestId, payload?.envelope?.payloadFingerprint,operationId), bodyPayloadFingerprint,...receipt,requestId,clientOperationId:operationId };
      if (onPrepared) await onPrepared(prepared);
      try {
        const sent=await rpc('agentSession.send',payload);
        prepared.sendResult=sent;
        if(sent?.ok===false){const notRecorded=!!sent.refusal?.code&&sent.refusal.code!=='agent_session_operation_unknown';return {ok:false,notRecorded,reason:sent.refusal?.message||sent.refusal?.code||'Native send refused',receipt:{...prepared,correlation:'send_refused',dispatchOutcome:notRecorded?'not-recorded':'unknown'}};}
        prepared.submissionClientMessageId=sent?.value?.submission?.clientMessageId||sent?.value?.clientMessageId||sent?.submission?.clientMessageId||operationId;
        if(onPrepared)await onPrepared(prepared);
      }catch(error){return {ok:false,stage:'unknown',reason:error.message,receipt:{...prepared,correlation:'send_outcome_unknown',rpcError:{code:error.code||null,message:error.message}}};}
      try { const detail = await allHistory(bindingInput.handle,requestId,prepared); return correlated(detail.page, requestId, prepared, detail.incomplete); } catch(error) { return { ok: false, stage: 'unknown',reason:error.message,receipt: { ...prepared, correlation: 'history_unavailable_after_send' } }; }
    }
  };
}
