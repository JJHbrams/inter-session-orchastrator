import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrcaNativeChatAdapter } from '../adapters/orca/native-chat.js';

const cwd = 'C:/work/project', nativeId = 'claude-original-1', handle = 'actor-session-1';
const nativeOperation='1793860000000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function page(overrides = {}) { return { sessionId: handle, fence: 7, working: false, queuedMessages: [], actionablePromptIds: [], items: [], submissions: [], ...overrides }; }
function rpcFactory({ pages = [page()], send = null, tab = true } = {}) {
  const calls = [], queue = [...pages];
  return { calls, call: async (method, params) => {
    calls.push({ method, params });
    if (method === 'status.get') return { ok: true, result: { runtimeId: 'runtime-1', capabilities: ['agent-session.structured.v1', 'agent-session.accepted-send.v1', 'agent-session.pending-send-result.v1', 'agent-session.queued-messages.v2'] } };
    if (method === 'session.tabs.listAll') return { ok: true, result: { snapshots: tab ? [{ worktree: `ws::${cwd}`, publicationEpoch: 2, tabs: [{ type: 'agent-session', sessionId: handle, agent: 'claude', title: 'x', chatStatus: 'idle' }] }] : [] } };
    if (method === 'agentSession.history') {assert.deepEqual(Object.keys(params).sort(),(params.cursor?['cursor','direction','limit','sessionId']:['direction','limit','sessionId']).sort());return { ok: true, result: { ok: true, providerSession: { key: 'session_id', id: nativeId }, page: queue.length > 1 ? queue.shift() : queue[0] } };}
    if (method === 'agentSession.send') return send ? send(params) : { ok: true, result: {} };
    throw Error(`unexpected ${method}`);
  } };
}
const mutation = input => ({envelope:{sessionId:input.sessionId,clientOperationId:input.clientOperationId,expectedRuntimeFence:input.expectedRuntimeFence,payloadFingerprint:`fp:${input.clientOperationId}`},body:input.body,...(input.delivery?{delivery:input.delivery}:{})});
async function verified(adapter) { return adapter.verify('claude', nativeId, cwd); }

test('discovers and verifies an exact native session without creating one', async () => {
  const mock = rpcFactory(), adapter = createOrcaNativeChatAdapter({ call: mock.call, mutation });
  const list = await adapter.discover({ provider: 'claude', cwd }); assert.equal(list.sessions.length, 1);
  const binding = await verified(adapter); assert.equal(binding.handle, handle); assert.equal(binding.incarnation, 'runtime-1:7');
  assert.equal(mock.calls.some(call => /create|resume|fork|terminal|gui/i.test(call.method)), false);
});

test('reads only the current native model metadata and rejects a changed incarnation', async () => {
 const mock=rpcFactory(),calls=[],call=async(method,params,options)=>{calls.push({method,options});return method==='agentSession.options'?{ok:true,result:{current:{model:'gpt-5.6-terra',effort:'high'}}}:mock.call(method,params);};
 const adapter=createOrcaNativeChatAdapter({call,mutation,metadataTimeoutMs:700}),binding=await verified(adapter),result=await adapter.readMetadata(binding,binding);
 assert.deepEqual(result.metadata,{model:'gpt-5.6-terra',effort:'high',reasonCode:null,source:'orca agentSession.options'});
 assert.equal(mock.calls.some(call=>call.method==='agentSession.send'),false);
 const metadataCalls=calls.slice(3);assert.equal(metadataCalls.length,7);assert.ok(metadataCalls.every(call=>call.options?.timeoutMs===700));
 const changing=rpcFactory();let checks=0;const changed=async(method,params)=>{
  if(method==='session.tabs.listAll'&&++checks===2)return {ok:true,result:{snapshots:[{worktree:`ws::${cwd}`,publicationEpoch:2,tabs:[{type:'agent-session',sessionId:handle,agent:'claude'}]}]}};
  if(method==='agentSession.history'&&checks>=2)return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:page({fence:8})}};
  if(method==='agentSession.options')return {ok:true,result:{current:{model:'must-not-save',effort:'high'}}};
  return changing.call(method,params);
 };
 const stale=createOrcaNativeChatAdapter({call:changed,mutation});const start=await verified(stale);assert.equal((await stale.readMetadata(start,start)).reasonCode,'identity_changed');
});

test('preflight fails closed for identity, fence, busy, queue, and actionable prompts', async () => {
  for (const candidate of [page({ working: true }), page({ queuedMessages: [{}] }), page({ actionablePromptIds: ['approval'] })]) {
    const mock = rpcFactory({ pages: [page(), page(), candidate] }), adapter = createOrcaNativeChatAdapter({ call: mock.call, mutation }), binding = await verified(adapter);
    const result = await adapter.preflight(binding, binding); assert.equal(result.ok, false);
  }
  const mock = rpcFactory(), adapter = createOrcaNativeChatAdapter({ call: mock.call, mutation }), binding = await verified(adapter);
  assert.equal((await adapter.preflight({ ...binding, cwd: 'C:/wrong' }, binding)).reasonCode, 'identity_changed');
  assert.equal((await adapter.preflight({ ...binding, incarnation: 'runtime-1:other' }, { ...binding, incarnation: 'runtime-1:other' })).reasonCode, 'identity_changed');
});

test('restart reconnect verifies the exact original conversation without trusting stale runtime or sending input',async()=>{
  const mock=rpcFactory(),adapter=createOrcaNativeChatAdapter({call:mock.call,mutation});
  const prior={provider:'claude',nativeId,cwd,handle:'old-actor',incarnation:'old-runtime:2'};
  assert.equal((await adapter.preflight(prior,prior)).reasonCode,'identity_changed');
  const result=await adapter.reconnect(prior,prior);
  assert.equal(result.verified,true);assert.equal(result.nativeId,nativeId);assert.equal(result.handle,handle);assert.equal(result.incarnation,'runtime-1:7');
  assert.equal((await adapter.reconnect({...prior,nativeId:'other'},prior)).verified,undefined);
  assert.equal(mock.calls.some(c=>/send|create|resume|fork|terminal/i.test(c.method)),false);
});

test('send persists the official operation before dispatch and returns only same-turn assistant text', async () => {
  const completed = page({
    submissions: [{ clientMessageId:nativeOperation, providerItemId: 'u1', fence: 7,payloadFingerprint:'fp:'+nativeOperation, answeredInTurn: { turnItemId: 'turn-1', via: 'native' } }],
    latestTurn: { itemId: 'turn-1', turn: { state: 'completed', outcome:'success',userItemId:'u1' } },
    items: [
      { id: 'u1', body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'mine' }] } },
      { id: 'other-turn', body: { kind: 'turn', userItemId: 'other', state: 'completed', outcome: { kind: 'completed' } } },
      { id: 'other-answer', body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'wrong' }] }, turnScope: { kind: 'turn', turnItemId: 'other-turn' } },
      { id: 'answer-1', body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'right' }] }, turnScope: { kind: 'turn', turnItemId: 'turn-1' } }
    ]
  });
  const mock = rpcFactory({ pages: [page(), page(), page(), completed] }), adapter = createOrcaNativeChatAdapter({ call: mock.call, mutation,operationIdFactory:()=>nativeOperation }), binding = await verified(adapter);
  let prepared; const result = await adapter.send(binding, binding, 'hello', 'request-1', { onPrepared: value => {if(!prepared)assert.equal(mock.calls.some(call => call.method === 'agentSession.send'), false);prepared=value;} });
  assert.equal(prepared.clientOperationId,nativeOperation);assert.equal(prepared.requestId,'request-1'); assert.equal(prepared.sessionId, handle); assert.equal(prepared.payloadFingerprint,'fp:'+nativeOperation);
  assert.equal(result.stage, 'reply'); assert.equal(result.reply.body, 'right'); assert.deepEqual(result.reply.itemIds, ['answer-1']);
});

test('observe-only never sends and uncertain dispatch keeps the original operation receipt', async () => {
  const mock = rpcFactory({ send: () => { throw Error('transport dropped'); } }), adapter = createOrcaNativeChatAdapter({ call: mock.call, mutation,operationIdFactory:()=>nativeOperation }), binding = await verified(adapter);
  const unknown = await adapter.send(binding, binding, 'hello', 'stable-id'); assert.equal(unknown.stage, 'unknown'); assert.equal(unknown.receipt.clientOperationId,nativeOperation);
  const before = mock.calls.length; const observed = await adapter.send(binding, binding, 'ignored', 'stable-id', { observeOnly: true, receipt: unknown.receipt });
  assert.equal(mock.calls.slice(before).some(call => call.method === 'agentSession.send'), false); assert.equal(observed.receipt.clientOperationId,nativeOperation);
});

test('history uses the real cursor contract and collects an entire turn across pages in order',async()=>{
  const mock=rpcFactory(),operation='long-request',userId='orca:'+operation,receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,clientOperationId:operation,payloadFingerprint:'operation-hash',bodyPayloadFingerprint:'body-hash'};
  const cursor={epoch:'epoch',sequence:20};
  const submission={clientMessageId:operation,providerItemId:null,fence:7,payloadFingerprint:'body-hash',answeredInTurn:{turnItemId:'legacy:turn',via:'provider'}};
  const assistant=(id,text,sequence)=>({itemId:id,sequence,observedAt:`2026-11-05T00:00:${String(sequence).padStart(2,'0')}Z`,body:{kind:'message',role:'assistant',blocks:[{type:'text',text}]},turnScope:{kind:'turn',turnItemId:'legacy:turn'}});
  let older=0;
  const call=async(method,params)=>{
    if(method!=='agentSession.history')return mock.call(method,params);
    assert.equal(Object.hasOwn(params,'before'),false);
    let value=page({epoch:'epoch'});
    if(params.limit!==1){
      if(!params.cursor)value=page({epoch:'epoch',hasOlder:true,window:{nextCursor:cursor},submissions:[submission],items:[assistant('a2','last',30)],latestTurn:{itemId:'legacy:turn',turn:{turnId:'native-turn',state:'completed',outcome:'success',userItemId:userId}}});
      else {older++;assert.equal(params.direction,'before');assert.deepEqual(params.cursor,cursor);value=page({epoch:'epoch',hasOlder:true,window:{nextCursor:{epoch:'epoch',sequence:1}},items:[{itemId:userId,sequence:5,body:{kind:'message',role:'user'}},assistant('a1','first',10)]});}
    }
    return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:value}};
  };
  const adapter=createOrcaNativeChatAdapter({call,mutation}),binding=await verified(adapter),result=await adapter.send(binding,binding,'unused',operation,{observeOnly:true,receipt});
  assert.equal(result.stage,'reply');assert.equal(result.reply.body,'first\n\nlast');assert.equal(older,1);
});

test('nested send result preserves a host client-message ID distinct from the operation',async()=>{
  const mock=rpcFactory(),operation='operation-1',clientId='host-message-1';let sent=false;
  const call=async(method,params)=>{
    if(method==='agentSession.send'){sent=true;return {ok:true,result:{ok:true,value:{submission:{clientMessageId:clientId}}}};}
    if(method==='agentSession.history'&&sent)return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:page({hasOlder:false,submissions:[{clientMessageId:clientId,fence:7,payloadFingerprint:'fp:'+nativeOperation,answeredInTurn:{turnItemId:'turn',via:'provider'}}],latestTurn:{itemId:'turn',turn:{state:'completed',outcome:'success',userItemId:'orca:'+clientId}},items:[{itemId:'orca:'+clientId,sequence:1,body:{kind:'message',role:'user'}},{itemId:'answer',sequence:2,body:{kind:'message',role:'assistant',blocks:[{type:'text',text:'matched'}]},turnScope:{kind:'turn',turnItemId:'turn'}}]})}};
    return mock.call(method,params);
  };
  const adapter=createOrcaNativeChatAdapter({call,mutation,operationIdFactory:()=>nativeOperation}),binding=await verified(adapter),result=await adapter.send(binding,binding,'hello',operation);
  assert.equal(result.stage,'reply');assert.equal(result.receipt.requestId,operation);assert.equal(result.receipt.clientOperationId,nativeOperation);assert.equal(result.receipt.submissionClientMessageId,clientId);
});

test('duplicate native actors, unsupported capabilities and malformed identity pages fail closed',async()=>{
  for(const condition of ['duplicate','capability','session','fence']){
    const mock=rpcFactory(),call=async(method,params)=>{
      const result=await mock.call(method,params);
      if(condition==='duplicate'&&method==='session.tabs.listAll')result.result.snapshots[0].tabs.push({...result.result.snapshots[0].tabs[0],sessionId:'second-actor'});
      if(condition==='capability'&&method==='status.get')result.result.capabilities=[];
      if(method==='agentSession.history'){
        result.result.page={...result.result.page,sessionId:condition==='session'?'wrong':params.sessionId,fence:condition==='fence'?null:7};
      }
      return result;
    };
    const adapter=createOrcaNativeChatAdapter({call,mutation});assert.equal((await verified(adapter)).verified,undefined,condition);
  }
});

test('a failed turn or mismatched native submission never becomes a room reply',async()=>{
  for(const condition of ['failure','wrong-fence','wrong-body']){
    const mock=rpcFactory(),operation='request',receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,clientOperationId:operation,payloadFingerprint:'op',bodyPayloadFingerprint:'body'};
    const call=async(method,params)=>{
      if(method!=='agentSession.history'||params.limit===1)return mock.call(method,params);
      return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:page({submissions:[{clientMessageId:operation,fence:condition==='wrong-fence'?6:7,payloadFingerprint:condition==='wrong-body'?'wrong':'body',answeredInTurn:{turnItemId:'turn'}}],latestTurn:{itemId:'turn',turn:{state:'completed',outcome:condition==='failure'?'failure':'success'}},items:[{itemId:'orca:'+operation,body:{kind:'message',role:'user'}},{itemId:'answer',body:{kind:'message',role:'assistant',blocks:[{type:'text',text:'must not publish'}]},turnScope:{kind:'turn',turnItemId:'turn'}}]})}};
    };
    const adapter=createOrcaNativeChatAdapter({call,mutation}),binding=await verified(adapter),result=await adapter.send(binding,binding,'unused',operation,{observeOnly:true,receipt});assert.equal(result.ok,false);assert.equal(result.reply,undefined);
  }
});

test('an explicitly recorded answered turn that is absent from history remains unknown',async()=>{
  const mock=rpcFactory(),operation='request',receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,clientOperationId:operation,payloadFingerprint:'op',bodyPayloadFingerprint:'body'};
  const call=async(method,params)=>{
    if(method!=='agentSession.history'||params.limit===1)return mock.call(method,params);
    return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:page({hasOlder:false,submissions:[{clientMessageId:operation,fence:7,payloadFingerprint:'body',answeredInTurn:{turnItemId:'missing-turn'}}],items:[{itemId:'orca:'+operation,body:{kind:'message',role:'user'}}]})}};
  };
  const adapter=createOrcaNativeChatAdapter({call,mutation}),binding=await verified(adapter),result=await adapter.send(binding,binding,'unused',operation,{observeOnly:true,receipt});
  assert.equal(result.ok,false);assert.equal(result.stage,'unknown');assert.equal(result.receipt.correlation,'answered_turn_not_observed');
});

test('history searches beyond eight pages and fails closed on a provider identity change',async()=>{
 const receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,clientOperationId:'request',payloadFingerprint:'op',bodyPayloadFingerprint:'body'};
 for(const bad of [false,true]){let pageNo=0;const mock=rpcFactory();const call=async(method,params)=>{
  if(method!=='agentSession.history'||params.limit===1)return mock.call(method,params);
  pageNo++;const last=pageNo===10;return {ok:true,result:{ok:true,providerSession:{id:bad&&pageNo===2?'other':nativeId},page:page({epoch:'many',hasOlder:!last,window:last?undefined:{nextCursor:{n:pageNo}},submissions:pageNo===1?[{clientMessageId:'request',fence:7,payloadFingerprint:'body',answeredInTurn:{turnItemId:'turn'}}]:[],latestTurn:last?{itemId:'turn',turn:{state:'completed',outcome:'success',userItemId:'orca:request'}}:undefined,items:last?[{itemId:'orca:request',body:{kind:'message',role:'user'}},{itemId:'answer',body:{kind:'message',role:'assistant',blocks:[{type:'text',text:'recovered'}]},turnScope:{kind:'turn',turnItemId:'turn'}}]:[]})}};
 };const adapter=createOrcaNativeChatAdapter({call,mutation}),binding=await verified(adapter);if(bad)await assert.rejects(()=>adapter.send(binding,binding,'x','request',{observeOnly:true,receipt}),/identity or epoch changed/);else {const result=await adapter.send(binding,binding,'x','request',{observeOnly:true,receipt});assert.equal(result.ok,true);assert.equal(result.stage,'reply');assert.equal(result.reply.body,'recovered');assert.equal(pageNo,10);}}
});

test('native operation IDs follow admission format and a definite refusal retains its original result',async()=>{
  const refusal={code:'agent_session_conflict',message:'owner not ready',details:{reason:'ownerUnproven'}};
  const mock=rpcFactory({send:params=>{assert.match(params.envelope.clientOperationId,/^\d{13}-[0-9a-f]{32}$/);return {ok:true,result:{ok:false,refusal}};}});
  const adapter=createOrcaNativeChatAdapter({call:mock.call,mutation,operationIdFactory:()=>nativeOperation}),binding=await verified(adapter);
  const result=await adapter.send(binding,binding,'question','external-room-request');
  assert.equal(result.notRecorded,true);assert.equal(result.reason,'owner not ready');assert.deepEqual(result.receipt.sendResult,{ok:false,refusal});assert.equal(result.receipt.requestId,'external-room-request');
  const invalid=createOrcaNativeChatAdapter({call:mock.call,mutation,operationIdFactory:()=> 'bare-room-uuid'}),before=mock.calls.filter(x=>x.method==='agentSession.send').length;
  assert.equal((await invalid.send(binding,binding,'question','room')).reasonCode,'native_operation_id_invalid');assert.equal(mock.calls.filter(x=>x.method==='agentSession.send').length,before);
});

test('a legacy UUID refused by admission is reconciled as unrecorded without replaying a valid send',async()=>{
  const mock=rpcFactory(),adapter=createOrcaNativeChatAdapter({call:mock.call,mutation}),binding=await verified(adapter),requestId='8fffc1f7-5660-4349-bfe9-c0995674d83b';
  const receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,clientOperationId:requestId,payloadFingerprint:'old'};
  const result=await adapter.send(binding,binding,'old prompt',requestId,{observeOnly:true,receipt});
  assert.equal(result.notRecorded,true);assert.equal(result.legacyInvalidId,true);assert.equal(result.receipt.requestId,requestId);assert.equal(mock.calls.some(x=>x.method==='agentSession.send'),false);
});

test('an incomplete legacy receipt remains unknown without reading or sending',async()=>{
  const mock=rpcFactory(),adapter=createOrcaNativeChatAdapter({call:mock.call,mutation}),binding=await verified(adapter);
  const receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,requestId:'legacy',clientOperationId:null};
  const before=mock.calls.length,result=await adapter.send(binding,binding,'never send','legacy',{observeOnly:true,receipt});
  assert.equal(result.ok,false);assert.equal(result.reasonCode,'native_receipt_incomplete');assert.equal(result.receipt.correlation,'native_receipt_incomplete');
  assert.equal(mock.calls.slice(before).some(call=>call.method==='agentSession.send'),false);
});

test('observe recovers an old receipt after a same-actor host restart while preflight remains strict',async()=>{
  const oldRuntime='old-runtime',newRuntime='new-runtime',receipt={sessionId:handle,nativeId,runtimeId:oldRuntime,fence:7,requestId:'old',clientOperationId:'old-op',payloadFingerprint:'op',bodyPayloadFingerprint:'body'};let sends=0;
  const mock=rpcFactory(),call=async(method,params)=>{if(method==='status.get')return {ok:true,result:{runtimeId:newRuntime,capabilities:['agent-session.structured.v1','agent-session.accepted-send.v1','agent-session.pending-send-result.v1','agent-session.queued-messages.v2']}};if(method==='agentSession.send'){sends++;throw Error('must not send');}if(method==='agentSession.history'&&params.limit!==1)return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:page({fence:8,hasOlder:false,submissions:[{clientMessageId:'old-op',fence:7,payloadFingerprint:'body',answeredInTurn:{turnItemId:'turn'}}],latestTurn:{itemId:'turn',turn:{state:'completed',outcome:'success',userItemId:'orca:old-op'}},items:[{itemId:'orca:old-op',body:{kind:'message',role:'user'}},{itemId:'answer',body:{kind:'message',role:'assistant',blocks:[{type:'text',text:'recovered'}]},turnScope:{kind:'turn',turnItemId:'turn'}}]})}};return mock.call(method,params);};
  const adapter=createOrcaNativeChatAdapter({call,mutation}),current=await verified(adapter),old={...current,incarnation:`${oldRuntime}:7`,capabilities:{...current.capabilities,nativeChat:{...current.capabilities.nativeChat,runtimeId:oldRuntime}}};
  assert.equal((await adapter.preflight(old,old)).reasonCode,'identity_changed');const result=await adapter.send(old,old,'never','old',{observeOnly:true,receipt});assert.equal(result.stage,'reply');assert.equal(result.reply.body,'recovered');assert.equal(result.receipt.runtimeId,oldRuntime);assert.equal(result.receipt.observedRuntimeId,newRuntime);assert.equal(sends,0);
});

test('observe fails closed when the host runtime changes during history',async()=>{
  let statuses=0,sends=0;const mock=rpcFactory(),receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,requestId:'r',clientOperationId:'op',payloadFingerprint:'op',bodyPayloadFingerprint:'body'};
  const call=async(method,params)=>{if(method==='status.get'){statuses++;return {ok:true,result:{runtimeId:statuses>2?'runtime-2':'runtime-1',capabilities:['agent-session.structured.v1','agent-session.accepted-send.v1','agent-session.pending-send-result.v1','agent-session.queued-messages.v2']}};}if(method==='agentSession.send'){sends++;throw Error('must not send');}if(method==='agentSession.history'&&params.limit!==1)return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:page({hasOlder:false})}};return mock.call(method,params);};
  const adapter=createOrcaNativeChatAdapter({call,mutation}),binding=await verified(adapter),result=await adapter.send(binding,binding,'never','r',{observeOnly:true,receipt});assert.equal(result.ok,false);assert.equal(result.reasonCode,'identity_changed');assert.equal(sends,0);
});

test('the default protocol bridge passes the UUID factory to the installed operation generator',async()=>{
  let generated=false,resolutions=0,prepared=false;
  const mock=rpcFactory({send:params=>{assert.equal(generated,true);assert.equal(prepared,true);assert.match(params.envelope.clientOperationId,/^\d{13}-[0-9a-f]{32}$/);return {ok:true,result:{ok:false,refusal:{code:'test_refusal'}}};}});
  const moduleLoader=path=>path.includes('requests')?{structuredAgentSessionMessageSendMutation:mutation}:{createStructuredAgentSessionOperationId(uuidFactory){assert.equal(typeof uuidFactory,'function');generated=true;return Date.now()+'-'+uuidFactory().replaceAll('-','');}};
  const adapter=createOrcaNativeChatAdapter({call:mock.call,moduleLoader,resolveExecutable:async()=>{resolutions++;return 'C:/Orca/resources/bin/orca.exe';}}),binding=await verified(adapter);
  const result=await adapter.send(binding,binding,'prompt','room-uuid',{onPrepared(){prepared=true;}});
  assert.equal(result.receipt.requestId,'room-uuid');assert.equal(result.notRecorded,true);assert.equal(resolutions,1);
});

test('the default protocol bridge supports the relocated official operation generator',async()=>{
  let generated=false;const mock=rpcFactory({send:()=>({ok:true,result:{ok:false,refusal:{code:'test_refusal'}}})});
  const moduleLoader=path=>{if(path.includes('requests'))return {structuredAgentSessionMessageSendMutation:mutation};if(/lifecycle[\\/]structured-/.test(path)){const error=Error(`Cannot find module ${path}`);error.code='MODULE_NOT_FOUND';throw error;}return {createStructuredAgentSessionOperationId(uuid){generated=true;return Date.now()+'-'+uuid().replaceAll('-','');}};};
  const adapter=createOrcaNativeChatAdapter({call:mock.call,moduleLoader,resolveExecutable:async()=> 'C:/Orca/resources/bin/orca.exe'}),binding=await verified(adapter);
  const result=await adapter.send(binding,binding,'prompt','room');assert.equal(generated,true);assert.equal(result.notRecorded,true);
});

test('native handover may advance the lease fence while provider-item linkage still identifies the exact completed turn',async()=>{
  const mock=rpcFactory(),requestId='room-request',clientId=nativeOperation;let fence=7;
  const call=async(method,params)=>{
    if(method!=='agentSession.history')return mock.call(method,params);
    let p=page({fence,hasOlder:false});
    if(params.limit!==1)p=page({fence,hasOlder:false,submissions:[{clientMessageId:clientId,fence,payloadFingerprint:'body-hash',providerItemId:'provider-user'}],latestTurn:{itemId:'legacy:current-turn',turn:{turnId:'provider-turn',userItemId:'provider-user',state:'completed',outcome:'success'}},items:[
      {itemId:'orca:'+clientId,sequence:1,body:{kind:'message',role:'user'}},
      {itemId:'preface',sequence:2,turnScope:{kind:'turn',turnItemId:'legacy:current-turn'},body:{kind:'message',role:'assistant',blocks:[{type:'text',text:'Reading the evidence'}]}},
      {itemId:'final',sequence:3,turnScope:{kind:'turn',turnItemId:'legacy:current-turn'},body:{kind:'message',role:'assistant',blocks:[{type:'text',text:'{"stance":"agree"}'}]}}
    ]});
    return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:p}};
  };
  const adapter=createOrcaNativeChatAdapter({call,mutation}),binding=await verified(adapter);fence=8;
  assert.equal((await adapter.preflight(binding,binding)).ok,true);
  const result=await adapter.send(binding,binding,'not resent',requestId,{observeOnly:true,receipt:{sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,requestId,clientOperationId:clientId,payloadFingerprint:'operation',bodyPayloadFingerprint:'body-hash'}});
  assert.equal(result.stage,'reply');assert.equal(result.reply.turnId,'provider-turn');assert.equal(result.reply.finalBody,'{"stance":"agree"}');assert.equal(result.receipt.fence,7);assert.equal(result.receipt.observedFence,8);
  assert.equal(mock.calls.some(x=>x.method==='agentSession.send'),false);
});


test('history cursor cycles and page exhaustion remain bounded and never replay native input',async()=>{
  for(const mode of ['cycle','limit']){
    const mock=rpcFactory();let reads=0,writes=0;
    const receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,clientOperationId:'request',payloadFingerprint:'op',bodyPayloadFingerprint:'body'};
    const call=async(method,params)=>{
      if(method==='agentSession.send'){writes++;throw Error('unexpected replay');}
      if(method!=='agentSession.history'||params.limit===1)return mock.call(method,params);
      reads++;
      return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:page({epoch:'bounded',hasOlder:true,window:{nextCursor:{n:mode==='cycle'?1:reads}},submissions:[],items:[]})}};
    };
    const adapter=createOrcaNativeChatAdapter({call,mutation}),binding=await verified(adapter);
    const result=await adapter.send(binding,binding,'never send','request',{observeOnly:true,receipt});
    assert.equal(result.ok,false);assert.equal(result.stage,'unknown');assert.equal(writes,0);
    assert.equal(result.receipt.correlation,mode==='cycle'?'history_cursor_cycle':'history_page_limit');
    assert.equal(reads,mode==='cycle'?2:64);
  }
});

test('conflicting duplicate native submissions are not collapsed into one result',async()=>{
  const mock=rpcFactory();let writes=0;
  const receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,clientOperationId:'request',payloadFingerprint:'op',bodyPayloadFingerprint:'body'};
  const call=async(method,params)=>{
    if(method==='agentSession.send'){writes++;throw Error('unexpected replay');}
    if(method!=='agentSession.history'||params.limit===1)return mock.call(method,params);
    return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:page({hasOlder:false,submissions:[{clientMessageId:'request',fence:7,payloadFingerprint:'body'},{clientMessageId:'request',fence:7,payloadFingerprint:'conflict'}],items:[]})}};
  };
  const adapter=createOrcaNativeChatAdapter({call,mutation}),binding=await verified(adapter);
  await assert.rejects(()=>adapter.send(binding,binding,'never send','request',{observeOnly:true,receipt}),/ambiguous native submission evidence/);
  assert.equal(writes,0);
});


test('a later history page does not discard an earlier exact turn snapshot',async()=>{
  const mock=rpcFactory();let reads=0;
  const receipt={sessionId:handle,nativeId,runtimeId:'runtime-1',fence:7,clientOperationId:'request',payloadFingerprint:'op',bodyPayloadFingerprint:'body'};
  const call=async(method,params)=>{
    if(method!=='agentSession.history'||params.limit===1)return mock.call(method,params);
    reads++;const first=reads===1;
    return {ok:true,result:{ok:true,providerSession:{id:nativeId},page:page({epoch:'turn-snapshots',hasOlder:first,window:first?{nextCursor:{n:1}}:undefined,submissions:first?[{clientMessageId:'request',fence:7,payloadFingerprint:'body',answeredInTurn:{turnItemId:'original-turn'}}]:[],latestTurn:{itemId:first?'original-turn':'other-turn',turn:{state:'completed',outcome:'success',userItemId:first?'orca:request':'other-user'}},items:first?[]:[{itemId:'orca:request',body:{kind:'message',role:'user'}},{itemId:'answer',body:{kind:'message',role:'assistant',blocks:[{type:'text',text:'original reply'}]},turnScope:{kind:'turn',turnItemId:'original-turn'}}]})}};
  };
  const adapter=createOrcaNativeChatAdapter({call,mutation}),binding=await verified(adapter);
  const result=await adapter.send(binding,binding,'never send','request',{observeOnly:true,receipt});
  assert.equal(result.stage,'reply');assert.equal(result.reply.body,'original reply');
});


test('an unrelated missing dependency inside the official generator is not hidden by layout fallback',async()=>{
  const mock=rpcFactory();let fallbackLoads=0;
  const moduleLoader=path=>{if(path.includes('requests'))return {structuredAgentSessionMessageSendMutation:mutation};if(/lifecycle[\\/]structured-/.test(path)){const error=Error(`Cannot find module 'broken-dependency'\nRequire stack:\n- ${path}`);error.code='MODULE_NOT_FOUND';throw error;}fallbackLoads++;return {createStructuredAgentSessionOperationId:()=>nativeOperation};};
  const adapter=createOrcaNativeChatAdapter({call:mock.call,moduleLoader,resolveExecutable:async()=> 'C:/Orca/resources/bin/orca.exe'}),binding=await verified(adapter);
  await assert.rejects(()=>adapter.send(binding,binding,'prompt','room'),/broken-dependency/);
  assert.equal(fallbackLoads,0);assert.equal(mock.calls.some(call=>call.method==='agentSession.send'),false);
});
