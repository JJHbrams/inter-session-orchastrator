import {statSync,realpathSync,lstatSync,mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export function validateWorkspace(cwd){
  if(typeof cwd!=='string'||!cwd.trim()||!isAbsolute(cwd)||cwd.includes('\0'))throw Error('작업공간은 실제 폴더의 절대 경로로 지정해줘.');
  const path=realpathSync(cwd.trim());if(!statSync(path).isDirectory())throw Error('작업공간 폴더를 찾을 수 없어.');return path;
}
function safeDirectory(path){if(existsSync(path)){if(lstatSync(path).isSymbolicLink()||!statSync(path).isDirectory())throw Error('자료 경로가 폴더가 아니거나 외부 링크야.');}else mkdirSync(path);}
function artifactDirectory(room){if(!room.cwd)throw Error('토론장 작업공간을 먼저 지정해줘.');const cwd=validateWorkspace(room.cwd),base=join(cwd,'.session-rooms');safeDirectory(base);const dir=join(base,room.id);safeDirectory(dir);return dir;}
function safeFile(dir,name){const path=join(dir,name);if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw Error('자료 파일이 일반 파일이 아니야.');return path;}
function writeOwned(dir,name,data){const path=safeFile(dir,name),bytes=Buffer.isBuffer(data)?data:Buffer.from(data);if(existsSync(path)&&readFileSync(path).equals(bytes))return;const temporary=safeFile(dir,'.write-'+randomUUID());try{writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});renameSync(temporary,path);}catch(e){throw Error('작업공간 자료 저장 실패: '+e.message);}}
export function workspaceInfo(store,roomId){const room=store.room(roomId);if(!room.cwd)return {cwd:null,artifactDir:null,files:[]};const dir=artifactDirectory(room);return {cwd:room.cwd,artifactDir:dir,files:readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()&&!x.name.startsWith('.')).slice(0,200).map(x=>{const s=lstatSync(join(dir,x.name));return {name:x.name,size:s.size,kind:x.name==='consensus.md'?'consensus':x.name==='transcript.md'?'conversation':'material'};})};}
export function exportWorkspace(store,roomId){
  const room=store.room(roomId),dir=artifactDirectory(room),marker=safeFile(dir,'.room-owner.json');
  if(existsSync(marker)){if(JSON.parse(readFileSync(marker,'utf8')).roomId!==room.id)throw Error('다른 토론장의 자료 폴더야.');}
  else {if(readdirSync(dir).length)throw Error('자료 폴더에 기존 파일이 있어. 덮어쓰지 않았어.');writeFileSync(marker,JSON.stringify({roomId:room.id}),{flag:'wx',mode:0o600});}
  const speaker=id=>room.members.find(m=>m.session_id===id)?.alias||'사용자';
  const conversation='# '+room.name+'\n\n'+room.messages.map(m=>`## ${speaker(m.sender_session_id)} · ${m.created_at}\n\n${m.body}\n\n<!-- message:${m.id} -->`).join('\n\n');
  const consensus='# '+room.name+' — 결정과 합의\n\n'+(room.decisions.map(d=>`## ${d.status==='confirmed'?'사용자 확정':'제안'} · ${d.created_at}\n\n${d.body}\n\n근거: ${d.source_ids||'없음'}\n<!-- decision:${d.id} -->`).join('\n\n')||'아직 등록된 결정이 없습니다.');
  const allAttachments=[...new Map(room.messages.flatMap(m=>m.attachments||[]).map(a=>[a.id,a])).values()];
  const manifest={roomId:room.id,name:room.name,cwd:room.cwd,decisions:room.decisions.map(d=>({id:d.id,status:d.status,sourceIds:d.source_ids?.split(',')||[]})),materials:allAttachments.map(a=>({id:a.id,name:a.filename,mime:a.mime,size:a.size,file:'material-'+a.id+'-'+a.filename.replace(/[^\p{L}\p{N}._-]/gu,'_').slice(0,80)}))};
  writeOwned(dir,'transcript.md',conversation);writeOwned(dir,'consensus.md',consensus);
  for(const material of manifest.materials){const file=store.readAttachment(roomId,material.id);writeOwned(dir,material.file,Buffer.from(file.base64,'base64'));}
  writeOwned(dir,'manifest.json',JSON.stringify(manifest,null,2));return workspaceInfo(store,roomId);
}
export function workspaceSignature(room){return createHash('sha256').update(JSON.stringify([room.cwd,room.name,room.messages.map(m=>[m.id,m.attachments]),room.decisions])).digest('hex');}
