import {createHash, randomUUID} from 'node:crypto';
import {open, readFile, readdir, stat, mkdir, writeFile, rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve, isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {ClaudeSessionLease, createProcessInspector} from './session-lease.js';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = value => String(value || '').replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
const nativeId = value => value?.nativeId || value?.native_id;
const fail = (reasonCode, reason = reasonCode, extra = {}) => ({ok:false, reasonCode, reason, ...extra});
const reasons = {
  native_session_busy:'원래 Claude 세션이 다른 프로세스에서 열려 있어. 기존 실행이 끝나면 같은 대화로 이어갈게.',
  native_owner_unverified:'Claude 세션 소유권을 확인하지 못해. 기존 작업을 보호하려고 새 실행을 보류했어.',
  session_lease_held:'같은 Claude 세션의 실행 또는 미확인 요청이 있어. 중복 실행 없이 결과를 기다리고 있어.',
  identity_changed:'원래 Claude 세션 ID와 작업 폴더를 확인하지 못했어.',
  journal_result_unknown:'이 Claude 요청의 실행 결과가 아직 확인되지 않았어. 같은 작업을 다시 보내지 않아.'
};
const refusal = (code, extra={}) => fail(code, reasons[code] || code, extra);
const predatesProcess = (info, actual) => {
  if (!info || !actual) return false;
  let started = actual.startMs;
  if (started == null && process.platform === 'win32' && /^[0-9]{17,20}$/.test(String(actual.start || ''))) {
    started = Number((BigInt(actual.start) - 116444736000000000n) / 10000n);
  }
  return Number.isFinite(started) && info.mtimeMs + 2000 < started;
};
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
async function atomicJson(path, value) {
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value), {flag:'wx', mode:0o600});
  await rename(temp, path);
}
const delay = ms => new Promise(done => setTimeout(done, ms));
const core = ['transport','requestId','operationId','nativeId','cwd','payloadFingerprint','leaseToken'];
const matchesReceipt = (left,right) => core.every(key => typeof left?.[key] === 'string' && left[key] === right?.[key]);

/** Only reads existing transcripts. A directory name or a caller-supplied UUID is not verification. */
export async function verifyClaudeTranscript(input, configDirectory) {
  const projects = join(configDirectory, 'projects');
  let directories;
  try { directories = await readdir(projects, {withFileTypes:true}); } catch { return false; }
  let found = 0;
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const path = join(projects, directory.name, input.nativeId + '.jsonl');
    let file;
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      file = await open(path, 'r');
      const buffer = Buffer.alloc(Math.min(info.size, 2_000_000));
      const read = await file.read(buffer, 0, buffer.length, 0);
      const lines = buffer.subarray(0,read.bytesRead).toString('utf8').split('\n');
      if (info.size > buffer.length) lines.pop();
      let verified = false;
      for (const line of lines) {
        let row; try { row = JSON.parse(line); } catch { continue; }
        const id = row.sessionId || row.session_id;
        if (id === input.nativeId && typeof row.cwd === 'string' && normalize(row.cwd) === normalize(input.cwd)) {
          verified = true; break;
        }
      }
      if (verified) found++;
    } catch (error) {
      if (error.code !== 'ENOENT') return false;
    } finally { await file?.close(); }
  }
  return found === 1;
}

/** Native Claude metadata only; never reads peer .key files or calls an Orca service. */
export function createClaudeOwnershipGuard({configDirectory, processInspector}) {
  const registryDirectory = join(configDirectory, 'sessions');
  async function rows() {
    const entries = await readdir(registryDirectory, {withFileTypes:true});
    return entries.filter(entry => entry.isFile() && /^\d+\.json$/.test(entry.name));
  }
  async function ownRegistration(pid) {
    try {
      const row = await readJson(join(registryDirectory, Number(pid) + '.json'));
      if (Number(row.pid) !== Number(pid)) return null;
      return row;
    } catch { return null; }
  }
  async function check(input, own=null) {
    let entries;
    try { entries = await rows(); } catch { return refusal('native_owner_unverified'); }
    for (const entry of entries) {
      const pid = Number(entry.name.slice(0,-5));
      let row, info;
      try {
        info = await stat(join(registryDirectory,entry.name));
        if (info.size > 131072) throw Error('registry record too large');
        row = await readJson(join(registryDirectory,entry.name));
      } catch {
        try { const actual = await processInspector.inspect(pid); if (actual && !predatesProcess(info,actual)) return refusal('native_owner_unverified'); }
        catch { return refusal('native_owner_unverified'); }
        continue;
      }
      if (!row || Number(row.pid) !== pid || typeof row.sessionId !== 'string') {
        try { const actual = await processInspector.inspect(pid); if (actual && !predatesProcess(info,actual)) return refusal('native_owner_unverified'); }
        catch { return refusal('native_owner_unverified'); }
        continue;
      }
      if (row.sessionId.toLowerCase() !== input.nativeId.toLowerCase()) continue;
      let actual;
      try { actual = await processInspector.inspect(pid); } catch { return refusal('native_owner_unverified'); }
      if (!actual) continue;
      if (!row.procStart || !actual.start) return refusal('native_owner_unverified');
      // Stale PID reuse is not the recorded owner. Never decide this from process name.
      if (String(row.procStart) !== String(actual.start)) continue;
      if (own && own.pid === pid && String(own.start) === String(actual.start) &&
          normalize(row.cwd) === normalize(input.cwd)) continue;
      return refusal('native_session_busy', {owner:{pid, status:row.status || 'unknown'}});
    }
    return {ok:true};
  }
  return {check, ownRegistration};
}

export function createClaudeSessionAdapter({
  command = process.env.CLAUDE_SESSION_COMMAND || (process.platform === 'win32' ? join(homedir(),'.local','bin','claude.exe') : 'claude'),
  configDirectory = process.env.CLAUDE_CONFIG_DIR || join(homedir(),'.claude'),
  spawnProcess = spawn,
  processInspector = createProcessInspector(),
  lease = null,
  journalRoot = null,
  catalog = null,
  ownershipGuard = null,
  environment = process.env,
  startupTimeoutMs = 20000,
  pollIntervalMs = 100,
  maxLineBytes = 4_000_000,
  maxReplyBytes = 2_000_000
} = {}) {
  configDirectory = resolve(configDirectory);
  journalRoot = resolve(journalRoot || join(configDirectory,'session-rooms-journal'));
  const leases = lease || new ClaudeSessionLease({configDirectory,processInspector});
  const guard = ownershipGuard || createClaudeOwnershipGuard({configDirectory,processInspector});
  const jobs = new Map();
  const journalPath = operation => {
    if (!uuid.test(operation || '')) throw Error('invalid direct operation ID');
    return join(journalRoot,operation + '.json');
  };
  const bindingFor = input => ({
    provider:'claude', nativeId:input.nativeId, cwd:input.cwd,
    host:input.host || 'claude/local', profile:input.profile || 'default',
    mode:'resume', ownership:'borrowed', handle:input.nativeId,
    incarnation:'claude-direct:' + hash(input.nativeId.toLowerCase() + '\0' + normalize(input.cwd) + '\0' + configDirectory),
    verified:true,
    capabilities:{transport:'claude-direct',automaticInput:true,followup:true,steer:false,rawInspect:false,mcpPull:false}
  });
  const identity = (binding, session) => binding?.provider === 'claude' && session?.provider === 'claude' &&
    nativeId(binding) === nativeId(session) && normalize(binding.cwd) === normalize(session.cwd);
  async function verify(input) {
    const id = nativeId(input);
    if (input?.provider !== 'claude' || !uuid.test(id || '') || typeof input.cwd !== 'string' ||
        !isAbsolute(input.cwd) || (input.profile && input.profile !== 'default')) return refusal('identity_changed');
    const value = {...input,nativeId:id};
    let valid;
    try {
      valid = catalog ? await catalog(value) : await verifyClaudeTranscript(value,configDirectory);
      if (!catalog && !(await stat(value.cwd)).isDirectory()) valid = false;
    } catch { valid = false; }
    return valid ? bindingFor(value) : refusal('identity_changed');
  }
  async function preflight(binding, session) {
    if (!identity(binding,session)) return refusal('identity_changed');
    const verified = await verify({...binding,nativeId:nativeId(binding)});
    if (!verified.verified || binding.handle !== verified.handle || binding.incarnation !== verified.incarnation)
      return refusal('identity_changed');
    try { return await guard.check(verified); } catch { return refusal('native_owner_unverified'); }
  }
  async function readJournal(receipt, requestId, prompt, binding, session) {
    if (!identity(binding,session) || receipt?.transport !== 'claude-direct' ||
        receipt.requestId !== requestId || receipt.nativeId !== nativeId(session) ||
        normalize(receipt.cwd) !== normalize(session.cwd) || receipt.payloadFingerprint !== hash(prompt))
      return fail('direct_receipt_incomplete','원래 Claude 요청의 전송 근거를 확인하지 못했어.');
    let journal;
    try { journal = await readJson(journalPath(receipt.operationId)); }
    catch { return refusal('journal_result_unknown',{receipt}); }
    if (!matchesReceipt(receipt,journal.receipt)) return fail('direct_receipt_changed','Claude 전송 근거가 원래 요청과 달라.',{receipt});
    if (journal.status === 'completed' && journal.closeCode === 0 && journal.confirmedSessionId === nativeId(session) &&
        journal.reply?.body?.trim()) return {ok:true,stage:'reply',receipt:journal.receipt,reply:journal.reply};
    if (journal.status === 'not_recorded') return {ok:false,notRecorded:true,receipt:journal.receipt,reason:journal.reason || 'Claude 입력 전에 실행이 중단됐어.'};
    if (['accepted','running'].includes(journal.status)) {
      let actual;
      try { actual = await processInspector.inspect(journal.child?.pid); } catch {}
      if (actual && String(actual.start) === String(journal.child?.start))
        return {ok:true,stage:journal.status === 'running' ? 'turn_started' : 'input_accepted',receipt:journal.receipt};
    }
    return refusal('journal_result_unknown',{receipt:journal.receipt,stage:'unknown'});
  }
  async function send(binding,session,prompt,requestId,{observeOnly=false,receipt=null,onPrepared=null}={}) {
    if (observeOnly) return readJournal(receipt,requestId,prompt,binding,session);
    // A durable receipt can only be observed, never used as permission to create another process.
    if (receipt) return readJournal(receipt,requestId,prompt,binding,session);
    const ready = await preflight(binding,session);
    if (!ready.ok) return ready;
    let held;
    try { held = await leases.acquire(nativeId(binding).toLowerCase()); }
    catch { return refusal('native_owner_unverified'); }
    if (held.ok === false) return refusal('session_lease_held');
    const releaseBeforeSpawn = async () => {
      held = await leases.update(held,{phase:'closed'});
      await leases.release(held);
    };
    const checked = await guard.check({...binding,nativeId:nativeId(binding)});
    if (!checked.ok) { await releaseBeforeSpawn(); return checked; }
    const operationId = randomUUID();
    const prepared = {
      transport:'claude-direct',requestId,operationId,nativeId:nativeId(binding),cwd:binding.cwd,
      payloadFingerprint:hash(prompt),leaseToken:held.token
    };
    let journal = {version:1,status:'prepared',receipt:prepared,createdAt:new Date().toISOString()};
    let queue = Promise.resolve();
    const persist = patch => {
      journal = {...journal,...patch,updatedAt:new Date().toISOString()};
      const snapshot = structuredClone(journal);
      queue = queue.then(() => atomicJson(journalPath(operationId),snapshot));
      return queue;
    };
    let child, childIdentity, closed = false, closeCode = null, inputSent = false;
    let buffer = '', protocolError = null, finalResult = null, lastAssistant = '';
    let failedBeforeInput = null;
    let finishResolve;
    const finished = new Promise(done => { finishResolve = done; });
    let finalizing = false;
    const finalize = async () => {
      if (finalizing) return;
      finalizing = true;
      try {
        if (inputSent && closeCode === 0 && !protocolError && finalResult?.session_id === nativeId(binding) &&
            finalResult.subtype === 'success' && !finalResult.is_error) {
          const body = typeof finalResult.result === 'string' && finalResult.result.trim() ? finalResult.result.trim() : lastAssistant.trim();
          if (!body || Buffer.byteLength(body) > maxReplyBytes) throw Error('Claude 결과 본문을 확인하지 못했어.');
          const reply = {body,turnId:operationId,itemIds:[finalResult.uuid || operationId]};
          await persist({status:'completed',reply,closeCode,confirmedSessionId:finalResult.session_id});
        } else if (!inputSent) {
          await persist({status:'not_recorded',closeCode,reason:failedBeforeInput || protocolError || 'Claude 입력 전에 종료됐어.'});
        } else {
          await persist({status:'unknown',closeCode,reason:protocolError || 'Claude 결과 또는 정상 종료를 확인하지 못했어.'});
        }
        // An unknown result keeps its lease as a durable no-resend marker.
        if (journal.status !== 'unknown') {
          held = await leases.update(held,{phase:'closed'});
          await leases.release(held);
        }
      } catch {
        // Journal write failures cannot become permission to resend.
        try { await leases.update(held,{phase:'unknown'}); } catch {}
      } finally { jobs.delete(operationId); finishResolve(); }
    };
    const consume = line => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { protocolError ||= 'Claude stdout JSON을 확인하지 못했어.'; return; }
      if (event.session_id && event.session_id !== nativeId(binding)) {
        protocolError ||= 'Claude 응답의 세션 ID가 원래 대화와 달라.'; return;
      }
      if (event.type === 'assistant') {
        lastAssistant = (event.message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
        if (inputSent) persist({status:'running'}).catch(() => { protocolError ||= 'Claude 실행 상태 저장 실패'; });
      }
      if (event.type === 'result') finalResult = event;
    };
    try {
      await mkdir(journalRoot,{recursive:true});
      await persist({});
      await onPrepared?.(prepared);
      // This intent is durable BEFORE spawn. A coordinator crash here is conservative unknown.
      held = await leases.update(held,{phase:'launching',operationId});
      await persist({status:'launching'});
      const env = {...environment,CLAUDE_CONFIG_DIR:configDirectory};
      delete env.CLAUDECODE;
      child = spawnProcess(command,[
        '--resume',nativeId(binding),'--print','--input-format','stream-json',
        '--output-format','stream-json','--verbose','--permission-prompts','none'
      ],{cwd:binding.cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
      jobs.set(operationId,{child,finished});
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0,end)); buffer = buffer.slice(end+1); }
        if (Buffer.byteLength(buffer) > maxLineBytes) { buffer=''; protocolError ||= 'Claude stdout 줄 크기 한도 초과'; }
      });
      // Do not retain tool output, paths or credentials from stderr.
      child.stderr.on('data',() => {});
      child.stdin.on('error',() => { protocolError ||= 'Claude 입력 스트림이 끊겼어.'; });
      child.once('error',error => {
        failedBeforeInput = error.code || 'Claude 프로세스 시작 실패';
        protocolError ||= 'Claude 프로세스를 시작하지 못했어.';
      });
      child.once('close',code => {
        closed=true; closeCode=code; consume(buffer); buffer='';
        // Before-input close is finalized after the startup loop has recorded its outcome.
        if (inputSent) finalize();
      });
      const deadline = Date.now()+startupTimeoutMs;
      while (!closed && Date.now()<deadline) {
        if (!child.pid) { await delay(pollIntervalMs); continue; }
        let row;
        try { row = await guard.ownRegistration(child.pid); } catch {}
        if (row) {
          if (row.sessionId !== nativeId(binding) || normalize(row.cwd)!==normalize(binding.cwd)) {
            failedBeforeInput='Claude 시작 세션 ID 또는 폴더가 원래 대화와 달라.'; break;
          }
          try { childIdentity = await processInspector.inspect(child.pid); } catch {}
          if (childIdentity?.start && String(childIdentity.start) === String(row.procStart)) break;
          childIdentity=null;
        }
        await delay(pollIntervalMs);
      }
      if (!childIdentity || closed || failedBeforeInput) {
        failedBeforeInput ||= 'Claude 시작 신원 확인이 끝나지 않아 작업을 보내지 않았어.';
        child.stdin.end(); // EOF only; never kill an external or pre-existing process.
        if (closed) await finalize();
        else {
          child.once('close',() => finalize());
          await persist({status:'not_recorded',reason:failedBeforeInput});
        }
        return {ok:false,notRecorded:true,reason:failedBeforeInput,receipt:prepared};
      }
      held = await leases.update(held,{phase:'running',childPid:childIdentity.pid,childStart:childIdentity.start});
      await persist({child:childIdentity});
      const again = await guard.check({...binding,nativeId:nativeId(binding)},childIdentity);
      if (!again.ok) {
        failedBeforeInput=again.reason; child.stdin.end();
        if (closed) await finalize(); else child.once('close',() => finalize());
        await persist({status:'not_recorded',reason:failedBeforeInput});
        return {...again,notRecorded:true,receipt:prepared};
      }
      // Persist potential submission before writing: crash after this point is NEVER retried.
      await persist({status:'accepted'});
      inputSent=true;
      child.stdin.end(JSON.stringify({
        type:'user',session_id:nativeId(binding),uuid:requestId,parent_tool_use_id:null,
        message:{role:'user',content:[{type:'text',text:prompt}]}
      })+'\n');
      if (closed) await finalize();
      return {ok:true,stage:'input_accepted',receipt:prepared};
    } catch (error) {
      if (!child) {
        failedBeforeInput=error.code || 'Claude 입력 전 준비 실패'; closeCode=null; closed=true;
        await finalize();
        return {ok:false,notRecorded:true,reason:failedBeforeInput,receipt:prepared};
      }
      if (!inputSent) {
        failedBeforeInput=error.code || 'Claude 입력 전 준비 실패';
        child.stdin.end();
        if (closed) await finalize(); else child.once('close',() => finalize());
        return {ok:false,notRecorded:true,reason:failedBeforeInput,receipt:prepared};
      }
      await persist({status:'unknown',reason:'Claude 입력 결과를 확인하지 못했어.'}).catch(()=>{});
      return {ok:false,stage:'unknown',receipt:prepared,reason:'Claude 입력 결과를 확인하지 못했어.'};
    }
  }
  return {verify,preflight,send,observe:(binding,session,prompt,requestId,options={})=>send(binding,session,prompt,requestId,{...options,observeOnly:true})};
}
