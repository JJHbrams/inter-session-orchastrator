import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,win32} from 'node:path';
const OWNER='inter-session-rooms-knowledge/v1',ok=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(v)&&v!=='.'&&v!=='..';
const inside=(r,f)=>{const x=relative(r,f);return x!==''&&!x.startsWith('..')&&!isAbsolute(x)&&!win32.isAbsolute(x);};
const safeStat=(r,f)=>{r=resolve(r);f=resolve(f);if(!inside(r,f)||!existsSync(f))return null;try{for(let p=f;;p=resolve(p,'..')){const stat=lstatSync(p);if(stat.isSymbolicLink())return null;if(p===r)break;if(resolve(p,'..')===p)return null;}return lstatSync(f);}catch{return null;}};
const read=(r,f)=>safeStat(r,f)?.isFile()?readFileSync(f,'utf8'):null;
const base=(root,room)=>room.channel_id?join(root,'channels',room.channel_id,'rooms',room.id):join(root,'rooms',room.id);
export function createReferenceService({store,knowledge,debates}){return {get(q){
 const bad=(q.channelId&& !ok(q.channelId))||(q.roomId&&!ok(q.roomId))||(q.agendaId&&!ok(q.agendaId))||(!q.channelId&&!q.roomId);if(bad)return {available:false,warning:'참조 ID 형식이 올바르지 않습니다.'};
 const channel=q.channelId&&store.channels().find(x=>x.id===q.channelId);if(q.channelId&&!channel)return {available:false,warning:'채널을 찾을 수 없습니다.'};let room;if(q.roomId){try{room=store.room(q.roomId);}catch{return {available:false,warning:'토론장을 찾을 수 없습니다.'};}if(q.channelId&&room.channel_id!==q.channelId)return {available:false,warning:'채널과 토론장 연결을 확인할 수 없습니다.'};}
 const c=channel||(room?.channel_id&&store.channels().find(x=>x.id===room.channel_id)),out={available:false,observedAt:new Date().toISOString(),channel:c&&{id:c.id,name:c.name},room:room&&{id:room.id,name:room.name},agenda:null};
 if(q.agendaId){if(!room)return {...out,warning:'안건에는 토론장 ID가 필요합니다.'};const a=(debates.list(room.id).agendas||[]).find(x=>x.id===q.agendaId);if(!a)return {...out,warning:'이 토론장에 해당 안건이 없습니다.'};out.agenda={id:a.id,title:a.title,phase:a.phase,outcome:a.outcome||'진행 중',revision:a.revision};}
 let root;try{root=knowledge.validateRoot(knowledge.getSettings().storageRoot,false);}catch{return {...out,warning:'지식 내보내기 루트를 읽을 수 없습니다.'};}if(!existsSync(root)||lstatSync(root).isSymbolicLink())return {...out,warning:'지식 내보내기가 아직 없습니다.'};
 if(!room){const index=join(root,'channels',c.id,'index.md');out.channel.index=safeStat(root,index)?.isFile()?index:null;return {...out,available:!!out.channel.index,warning:out.channel.index?null:'채널 목차가 없습니다. room export 전에는 정상일 수 있습니다.'};}
 const b=base(root,room),mf=join(b,'manifest.json');let manifest;try{manifest=JSON.parse(read(root,mf)||'');}catch{}if(!manifest||manifest.owner!==OWNER||manifest.roomId!==room.id||manifest.channelId!==(room.channel_id||null))return {...out,warning:'내보내기 manifest가 없거나 다른 토론장의 것입니다.'};
 const manifestStat=safeStat(root,mf);if(!manifestStat?.isFile())return {...out,warning:'내보내기 manifest를 안전하게 읽을 수 없습니다.'};out.exportMtime=manifestStat.mtime.toISOString();
 const roomIndex=join(b,'index.md'),history=join(b,'history','index.md'),transcript=join(b,'transcript.md');if(![roomIndex,history,transcript].every(file=>safeStat(root,file)?.isFile()))return {...out,warning:'토론장 내보내기 파일이 없거나 안전하게 읽을 수 없습니다.'};out.room.index=roomIndex;out.paths={history,transcript};
 let channelWarning=null;if(c){const index=join(root,'channels',c.id,'index.md');if(safeStat(root,index)?.isFile())out.channel.index=index;else channelWarning='채널 목차는 아직 없지만 토론장 참조는 사용할 수 있습니다.';}
 if(out.agenda){const file=join(b,'agendas',q.agendaId+'.md'),text=read(root,file),escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(!text||!new RegExp(`^\\s*-\\s*id:\\s*${escape(q.agendaId)}\\s*$`,'m').test(text)||!new RegExp(`^\\s*-\\s*결론 revision:\\s*${escape(out.agenda.revision)}\\s*$`,'m').test(text))return {...out,warning:'안건 내보내기가 없거나 현재 revision과 맞지 않습니다.'};out.agenda.file=file;}
 return {...out,available:true,warning:channelWarning};
}};}
