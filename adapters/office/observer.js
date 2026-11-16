import {open,readdir,lstat,realpath} from 'node:fs/promises';
import {basename,dirname,join,relative,resolve,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {officeAgent} from '../../packages/contracts/office-state.js';
import {roomOfficeFallback} from '../../services/coordinator/office.js';

const HEAD=32768,TAIL=262144,MAX_LINE=65536;
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
const norm=v=>String(v||'').replaceAll('\\','/').replace(/^\/\/\?\//,'').replace(/\/+$/,'').toLowerCase();
const timestamp=v=>Number.isFinite(Date.parse(v||''))?new Date(v).toISOString():null;
const inside=(root,path)=>{const r=relative(root,path);return r!==''&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\')&&!isAbsolute(r)};
const zone=a=>({reading:'library',research:'library',coding:'development',terminal:'server'})[a]||'table';
function activity(name){const n=String(name||'').toLowerCase();if(/web|browser|fetch/.test(n))return'research';if(/read|grep|glob|find|file_search/.test(n))return'reading';if(/write|edit|patch/.test(n))return'coding';if(/bash|shell|exec|terminal|command/.test(n))return'terminal';if(/spawn|task|agent|delegate/.test(n))return'delegating';return'responding'}
const descriptions={reading:'파일 읽기·검색',research:'웹 자료 조회',coding:'파일 편집',terminal:'명령 실행',delegating:'작업 위임',responding:'응답 생성',none:'대기'};
async function noLinks(path){for(let p=resolve(path);;p=dirname(p)){const s=await lstat(p);if(s.isSymbolicLink())throw Error('linked transcript path');if(dirname(p)===p)break}}
function lines(text){return text.split(/\r?\n/).filter(x=>x.length>0&&x.length<=MAX_LINE).flatMap(x=>{try{return[JSON.parse(x)]}catch{return[]}})}
export function parseOfficeTranscript(records,provider){
 let turn=false,completed=false,failed=false,updated=null;const pending=new Map();
 for(const r of records){if(r.type==='office_gap'){turn=false;completed=false;failed=false;pending.clear();continue}const p=provider==='codex'?(r.payload||{}):(r.message||{});updated=timestamp(r.timestamp||p.timestamp)||updated;
  if(provider==='codex'){
   if(r.type==='event_msg'){
    if(['task_started','turn_started'].includes(p.type)){turn=true;completed=false;failed=false;pending.clear()}
    if(['task_complete','turn_completed'].includes(p.type)){turn=false;completed=true;pending.clear()}
    if(['error','task_failed','turn_failed','turn_aborted','task_cancelled'].includes(p.type)){turn=false;failed=true;completed=false;pending.clear()}
   }
   if(r.type==='response_item'){
    const id=String(p.call_id||p.id||'');
    if(['function_call','custom_tool_call'].includes(p.type)){pending.set(id,p.name||p.tool_name||p.namespace||'tool');turn=true;completed=false;failed=false}
    if(['function_call_output','custom_tool_call_output'].includes(p.type))pending.delete(id);
   }
  }else{
   const blocks=Array.isArray(p.content)?p.content:[];
   if(r.type==='user'&&!blocks.some(b=>b.type==='tool_result')){turn=false;completed=false;failed=false;pending.clear()}
   if(r.type==='assistant')turn=true;
   for(const b of blocks){if(b.type==='tool_use'){pending.set(String(b.id),b.name||'tool');completed=false;failed=false;turn=true}if(b.type==='tool_result')pending.delete(String(b.tool_use_id))}
   if(['end_turn','stop_sequence'].includes(p.stop_reason||r.stop_reason||r.stopReason)){turn=false;completed=true;pending.clear()}
   if(r.type==='error'){failed=true;turn=false;completed=false;pending.clear()}
  }
 }
 const tool=[...pending.values()].at(-1),waiting=!!tool&&/askuserquestion|request_user_input/i.test(tool);
 const state=failed?'failed':completed?'completed':waiting?'waiting':turn?'running':'unknown';
 const a=state==='running'?(tool?activity(tool):'responding'):'none';
 return {state,activity:a,zone:zone(a),updatedAt:updated,detail:state==='completed'?'응답 완료':state==='waiting'?'사용자 입력 대기':state==='failed'?'실행 오류':descriptions[a]||'상태 확인'};
}

/** Read-only observations scoped to registered identities. No provider tools or writes. */
export class OfficeObserver{
 constructor({officeRoots,clock=()=>Date.now(),maxFiles=2048,staleMs=120000}={}){
  const h=homedir();this.roots=officeRoots===undefined?{codex:join(h,'.codex','sessions'),claude:join(h,'.claude','projects')}:{...officeRoots};
  this.dbPath=officeRoots===undefined?join(h,'.codex','state_5.sqlite'):officeRoots.codexDbPath;
  this.clock=clock;this.maxFiles=Math.max(1,Math.min(4096,maxFiles));this.staleMs=staleMs;this.index=new Map();this.cache=new Map();this.known=new Map();this.childCandidates=new Map();this.db=null;this.closed=false;this.inFlight=new Map();
 }
 async safe(provider,path){const root=this.roots[provider];if(!root||!inside(resolve(root),resolve(path)))return null;try{await noLinks(path);const full=await realpath(path),base=await realpath(root);return inside(base,full)?full:null}catch{return null}}
 async read(provider,path,headOnly=false){const safe=await this.safe(provider,path);if(!safe)return null;try{const s=await lstat(safe);if(!s.isFile())return null;const key=safe+':'+headOnly,cached=this.cache.get(key);if(cached&&cached.size===s.size&&cached.mtime===s.mtimeMs)return cached.value;
   const f=await open(safe,'r');let text=[];try{const part=async(offset,length)=>{const b=Buffer.alloc(length);const got=await f.read(b,0,length,offset);return b.subarray(0,got.bytesRead).toString('utf8')};text.push(await part(0,Math.min(HEAD,s.size)));if(!headOnly&&s.size>HEAD){const start=Math.max(HEAD,s.size-TAIL);text.push(await part(start,Math.min(TAIL,s.size-start)))}}finally{await f.close()}
   const value=text.length===2?[...lines(text[0]),{type:'office_gap'},...lines(text[1])]:lines(text[0]);if(this.cache.size>=160)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{size:s.size,mtime:s.mtimeMs,value});return value;
  }catch{return null}}
 async files(provider){const cached=this.index.get(provider);if(cached&&Date.now()-cached.at<10000)return cached.paths;const root=this.roots[provider];if(!root)return[];try{await noLinks(root)}catch{return[]}
  const result=[],queue=[resolve(root)],started=Date.now();let dirs=0;
  while(queue.length&&result.length<this.maxFiles&&dirs++<512&&Date.now()-started<1500){const dir=queue.shift();let entries;try{entries=await readdir(dir,{withFileTypes:true})}catch{continue}
   entries.sort((a,b)=>b.name.localeCompare(a.name));const next=[];for(const e of entries){if(result.length>=this.maxFiles)break;if(e.isSymbolicLink())continue;const p=join(dir,e.name);if(e.isFile()&&e.name.endsWith('.jsonl'))result.push(p);else if(e.isDirectory()&&queue.length+next.length<512)next.push(p)}queue.unshift(...next);
  }
  this.index.set(provider,{at:Date.now(),paths:result});return result;
 }
 async databasePaths(id,children=false){if(!this.dbPath||!validId(id))return[];try{if(!this.db){await noLinks(this.dbPath);this.db=new DatabaseSync(this.dbPath,{readOnly:true})}const rows=children?this.db.prepare('SELECT rollout_path FROM threads WHERE instr(source,?)>0 LIMIT 24').all(id):this.db.prepare('SELECT rollout_path FROM threads WHERE id=? LIMIT 1').all(id);return rows.map(x=>x.rollout_path).filter(x=>typeof x==='string')}catch{return[]}}
 identity(records,provider){if(provider==='codex'){const m=records.find(r=>r.type==='session_meta')?.payload;return m?{id:m.id||m.session_id,cwd:m.cwd,parent:m.source?.subagent?.thread_spawn?.parent_thread_id}:null}const r=records.find(x=>(x.sessionId||x.session_id)&&(x.cwd||x.projectPath));return r?{id:r.sessionId||r.session_id,cwd:r.cwd||r.projectPath}:null}
 async find(member){const {provider,native_id:id,cwd}=member;if(!['codex','claude'].includes(provider)||!validId(id)||!cwd)return null;const key=provider+':'+id+':'+norm(cwd),paths=[];if(this.known.has(key))paths.push(this.known.get(key));
  if(provider==='codex')paths.push(...await this.databasePaths(id));else if(this.roots.claude)paths.push(join(this.roots.claude,String(cwd).replace(/[^a-zA-Z0-9]/g,'-'),id+'.jsonl'));
  const probe=async candidates=>{for(const path of new Set(candidates)){const head=await this.read(provider,path,true);if(!head)continue;const meta=this.identity(head,provider);if(meta&&String(meta.id)===id&&norm(meta.cwd)===norm(cwd)&&!(provider==='claude'&&head.some(r=>r.isSidechain))){this.known.set(key,path);return{path,meta,records:await this.read(provider,path)||head}}}return null};
  const direct=await probe(paths);if(direct)return direct;const listed=await this.files(provider);return probe([...listed.filter(p=>basename(p).includes(id)),...listed.filter(p=>!basename(p).includes(id)).slice(0,96)]);
 }
 async children(member,parent){const provider=member.provider,candidates=[],cacheKey=provider+':'+member.native_id+':'+norm(member.cwd),cached=this.childCandidates.get(cacheKey),fresh=cached&&Date.now()-cached.at<5000,proven=[];if(fresh)candidates.push(...cached.paths);else{
  if(provider==='claude'){const dir=join(dirname(parent.path),member.native_id,'subagents');try{await noLinks(dir);for(const e of(await readdir(dir,{withFileTypes:true})).slice(0,24))if(e.isFile()&&!e.isSymbolicLink()&&/^agent-[a-zA-Z0-9_-]+\.jsonl$/.test(e.name))candidates.push(join(dir,e.name))}catch{}}
  else {const dbPaths=await this.databasePaths(member.native_id,true);candidates.push(...(dbPaths.length?dbPaths:await this.files(provider)))}}
  const found=[];let reads=0;
  for(const path of new Set(candidates)){if(found.length>=12||reads++>256)break;if(path===parent.path)continue;const head=await this.read(provider,path,true);if(!head)continue;let id,valid=false;
   if(provider==='codex'){const meta=this.identity(head,provider);id=meta?.id;valid=validId(id)&&String(meta.parent)===member.native_id&&norm(meta.cwd)===norm(member.cwd)}
   else {const r=head.find(r=>r.isSidechain&&r.agentId);id=r?.agentId;valid=validId(id)&&basename(path)==='agent-'+id+'.jsonl'&&(!r.cwd||norm(r.cwd)===norm(member.cwd))}
   if(!valid)continue;proven.push(path);const records=await this.read(provider,path)||head,state=this.observation(records,provider);if(state.state==='completed'&&this.clock()-Date.parse(state.updatedAt||0)>300000)continue;
   found.push(officeAgent({id:provider+':'+id,parentId:member.session_id,label:provider==='claude'?'Claude 보조':'Codex 보조',provider,kind:'subagent',...state,zone:state.state==='completed'?'door':state.zone,source:'transcript'}));
  }if(!fresh){if(this.childCandidates.size>=64)this.childCandidates.delete(this.childCandidates.keys().next().value);this.childCandidates.set(cacheKey,{at:Date.now(),paths:proven})}return found;
 }
 observation(records,provider){const value=parseOfficeTranscript(records,provider);if(['running','waiting','unknown'].includes(value.state)&&(!value.updatedAt||this.clock()-Date.parse(value.updatedAt)>this.staleMs))return{...value,state:'unknown',activity:'none',zone:'table',detail:'최근 상태를 확인할 수 없어요'};return value}
 async snapshot(room){let unavailable=0;const agents=[],active=new Set();for(const member of(room.members||[]).slice(0,32)){if(this.closed)break;active.add(member.provider+':'+member.native_id+':'+norm(member.cwd));if(member.left_at)continue;const found=await this.find(member),fallback=roomOfficeFallback(room,member);if(!found){unavailable++;agents.push(officeAgent({id:member.session_id,sessionId:member.session_id,membershipId:member.id,label:member.alias||member.display_name||'세션',provider:member.provider,...fallback}));continue}
   const value=this.observation(found.records,member.provider);agents.push(officeAgent({id:member.session_id,sessionId:member.session_id,membershipId:member.id,label:member.alias||member.display_name||'세션',provider:member.provider,...value,source:'transcript'}));agents.push(...await this.children(member,found));
  }for(const key of this.known.keys())if(!active.has(key))this.known.delete(key);for(const key of this.childCandidates.keys())if(!active.has(key))this.childCandidates.delete(key);return {roomId:room.id,observedAt:new Date(this.clock()).toISOString(),agents,diagnostics:{unavailable}}}
 observe(room){if(this.closed)return Promise.resolve({roomId:room.id,agents:[],observedAt:new Date(this.clock()).toISOString(),diagnostics:{unavailable:0}});if(this.inFlight.has(room.id))return this.inFlight.get(room.id);const p=this.snapshot(room).finally(()=>this.inFlight.delete(room.id));this.inFlight.set(room.id,p);return p}
 async close(){this.closed=true;await Promise.allSettled([...this.inFlight.values()]);this.cache.clear();this.known.clear();this.childCandidates.clear();this.index.clear();try{this.db?.close()}catch{}this.db=null}
}
