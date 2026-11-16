import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';

export const CHUNK_SIZE=2000;
const hash=text=>createHash('sha256').update(text).digest('hex');
const integer=(value,fallback,max)=>{if(value==null)return fallback;if(!Number.isInteger(value)||value<0||value>max)throw Error('invalid history offset or limit');return value;};
// UTF-16 offsets match JS slicing. Never split a surrogate pair; preserve every byte on reassembly.
export function chunks(text,id){
 const result=[];let start=0;
 while(start<text.length){let end=Math.min(start+CHUNK_SIZE,text.length);if(end<text.length){const paragraph=text.lastIndexOf('\n\n',end-2);if(paragraph>start+CHUNK_SIZE/2)end=paragraph+2;if(/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;}
  const body=text.slice(start,end),digest=hash(body);result.push({id:`${id}--${start}--${digest.slice(0,12)}`,sourceId:id,start,end,hash:digest,body});start=end;
 }
 return result.map((chunk,i)=>({...chunk,previous:result[i-1]?.id||null,next:result[i+1]?.id||null}));
}
export class RoomHistory {
 constructor(store,knowledge){this.store=store;this.db=store.db;this.knowledge=knowledge;this.db.exec(`CREATE TABLE IF NOT EXISTS context_reads(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,run_id TEXT,session_id TEXT,kind TEXT NOT NULL,source_id TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,hash TEXT NOT NULL,chars INTEGER NOT NULL,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS context_reads_room ON context_reads(room_id,created_at);`);}
 authorize(roomId,registration){this.store.room(roomId);if(registration)this.knowledge.registrationFor(roomId,registration);}
 metadata(room,message){const member=room.members.find(m=>m.session_id===message.sender_session_id);return {messageId:message.id,alias:member?.alias|| (message.provenance==='coordinator'?'진행 기록':'사용자'),sessionId:message.sender_session_id,createdAt:message.created_at,replyTo:message.reply_to,kind:message.kind,chars:message.body.length,chunkCount:chunks(message.body,message.id).length,preview:message.body.slice(0,140),attachments:message.attachments||[],reactions:room.reactions.filter(r=>r.message_id===message.id)};}
 index(roomId,input={},registration){this.authorize(roomId,registration);const room=this.store.room(roomId),offset=integer(input.offset,0,Number.MAX_SAFE_INTEGER),limit=Math.max(1,integer(input.limit,12,24)),messages=[...room.messages].reverse();return {roomId,total:messages.length,offset,next:offset+limit<messages.length?offset+limit:null,items:messages.slice(offset,offset+limit).map(m=>this.metadata(room,m)),note:'Previews and references are not full reads. Read exact IDs and follow next chunks before citing.'};}
 search(roomId,input={},registration){this.authorize(roomId,registration);if(typeof input.query!=='string'||!input.query.trim()||input.query.length>160)throw Error('history query must be 1..160 characters');const query=input.query.toLocaleLowerCase(),room=this.store.room(roomId),offset=integer(input.offset,0,Number.MAX_SAFE_INTEGER),matches=[];for(const message of room.messages){let from=0;for(let i=0;i<20;i++){const at=message.body.toLocaleLowerCase().indexOf(query,from);if(at<0)break;matches.push({...this.metadata(room,message),matchOffset:at,excerpt:message.body.slice(Math.max(0,at-60),at+query.length+100)});from=at+query.length;}}return {roomId,query:input.query,total:matches.length,next:offset+10<matches.length?offset+10:null,items:matches.slice(offset,offset+10),note:'Search excerpts are references, not full reads.'};}
 read(roomId,input={},registration,audit={}){
  this.authorize(roomId,registration);if(typeof input.id!=='string'||input.id.length>180)throw Error('history source ID required');const room=this.store.room(roomId),message=room.messages.find(m=>m.id===input.id||input.id.startsWith(m.id+'--'));if(!message)throw Error('history source outside current room');const parts=chunks(message.body,message.id),offset=integer(input.offset,0,Number.MAX_SAFE_INTEGER),chunk=input.id===message.id?parts.find(p=>p.end>offset):parts.find(p=>p.id===input.id);if(!chunk)throw Error('history chunk or offset not found');const value={...this.metadata(room,message),...chunk,totalChars:message.body.length,sourceHash:hash(message.body),dataOnly:true};this.audit(roomId,'history_read',chunk,registration,audit);return value;
 }
 audit(roomId,kind,chunk,registration,audit={}){this.db.prepare('INSERT INTO context_reads VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),roomId,audit.runId||null,registration?.session_id||audit.sessionId||null,kind,chunk.sourceId,chunk.start,chunk.end,chunk.hash,chunk.body.length,new Date().toISOString());}
 source(roomId,kind,input,registration,audit={}){
  this.authorize(roomId,registration);const offset=integer(input.offset,0,Number.MAX_SAFE_INTEGER);let text,revision=null,meta={};
  if(kind==='knowledge_read'){const item=this.knowledge.read(roomId,input.id,null,null);text=item.body;revision=item.revision;meta={title:item.title,messageReference:item.messageReference};}
  else if(kind==='agenda_read'){const item=this.db.prepare('SELECT * FROM agendas WHERE id=? AND room_id=?').get(input.id,roomId);if(!item)throw Error('agenda outside current room');text=JSON.stringify({body:item.body,conclusion:item.current_conclusion});revision=item.revision;meta={phase:item.phase};}
  else if(kind==='attachment_read'){
   const file=this.store.readAttachment(roomId,input.id,registration?.session_id||audit.sessionId);
   if(audit.runId&&['image/png','image/jpeg','image/gif','image/webp'].includes(file.mime)){
    if(file.size>5*1024*1024)throw Error('chair image exceeds 5 MiB limit');
    this.audit(roomId,'attachment_image_read',{sourceId:file.id,start:0,end:file.size,hash:file.sha256,body:''},registration,audit);
    return {id:file.id,sourceId:file.id,filename:file.filename,mime:file.mime,bytes:file.size,hash:file.sha256,rangeUnit:'bytes',input:'image content block included',dataOnly:true,_image:file};
   }
   if(file.size>1024*1024)throw Error('text attachment exceeds selective read limit (1 MiB); use original attachment tool');text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(file.base64,'base64'));if(text.includes('\0'))throw Error('binary attachment: use original attachment tool');meta={filename:file.filename};
  }
  else throw Error('unsupported context read');
  const chunk=chunks(text,input.id).find(p=>p.end>offset);if(!chunk)throw Error('source offset not found');this.audit(roomId,kind,chunk,registration,audit);return {...chunk,...meta,revision,totalChars:text.length,sourceHash:hash(text),dataOnly:true};
 }
 resolve(roomId,input,registration,audit){if(input.kind==='history_index')return this.index(roomId,input,registration);if(input.kind==='history_search')return this.search(roomId,input,registration);if(input.kind==='history_read')return this.read(roomId,input,registration,audit);return this.source(roomId,input.kind,input,registration,audit);}
 exportRoom(roomId,{base,ensureDirectory,atomicWrite}){
  const room=this.store.room(roomId),folder=ensureDirectory(base,['history']),files=[],links=[];
  for(const message of room.messages){const metadata=this.metadata(room,message),parts=chunks(message.body,message.id);links.push(`- [${metadata.alias} · ${metadata.createdAt}](${parts[0]?.id}.md) · ${message.id} · ${parts.length}조각 · ${message.body.length}자`);
   for(const part of parts){const file=part.id+'.md';atomicWrite(join(folder,file),`---\nid: ${part.id}\nsource_id: ${message.id}\nstart: ${part.start}\nend: ${part.end}\nsha256: ${part.hash}\n---\n\n# ${metadata.alias} · ${metadata.createdAt}\n\n[목차](index.md) · [원문](../transcript.md#message-${message.id})${part.previous?` · [이전](${part.previous}.md)`:''}${part.next?` · [다음](${part.next}.md)`:''}${message.reply_to?` · [답장 대상](../transcript.md#message-${message.reply_to})`:''}\n\n${part.body}\n\n## 첨부·리액션 참조\n\n\`\`\`json\n${JSON.stringify({attachments:metadata.attachments,reactions:metadata.reactions},null,2)}\n\`\`\`\n`);files.push({id:part.id,sourceId:message.id,start:part.start,end:part.end,hash:part.hash,file:'history/'+file});}
  }
  atomicWrite(join(folder,'index.md'),`# ${room.name} · 대화 히스토리\n\n원문은 DB가 기준이다. 조각은 최대 ${CHUNK_SIZE} UTF-16문자이며 읽은 범위만 근거로 인용한다.\n\n${links.join('\n')}\n`);return files;
 }
}
