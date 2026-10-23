import test from 'node:test';
import assert from 'node:assert/strict';
import {chairInput} from '../adapters/claude/chair.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';

test('chair stdin carries real image content blocks with exact native session identity',()=>{
 const image={id:'image-id',filename:'clipboard.png',mime:'image/png',base64:Buffer.from('sample bytes').toString('base64')};
 const frame=JSON.parse(chairInput('exact-id','prompt',[image]));
 assert.equal(frame.type,'user');assert.equal(frame.session_id,'exact-id');assert.equal(frame.message.role,'user');
 assert.equal(frame.message.content[0].text,'prompt');
 assert.deepEqual(frame.message.content.at(-1),{type:'image',source:{type:'base64',media_type:'image/png',data:image.base64}});
 assert.match(frame.message.content[1].text,/image-id/);
 assert.throws(()=>chairInput('id','p',[{...image,mime:'image/svg+xml'}]),/지원/);
 assert.throws(()=>chairInput('id','p',Array(6).fill(image)),/한도/);
});

test('chair sees linked image bytes, bounded UTF-8 excerpts and explicit binary notices',()=>{
 const files=[
  {id:'image',filename:'image.png',mime:'image/png',data:Buffer.from('image bytes')},
  {id:'text',filename:'notes.txt',mime:'application/octet-stream',data:Buffer.from('TEXT_MARKER '+('한글'.repeat(20000)))},
  {id:'binary',filename:'binary.bin',mime:'application/octet-stream',data:Buffer.from([0,1,2,3])}
 ];
 const room={id:'room',messages:[{id:'request',attachments:files.map(({data,...m})=>({...m,size:data.length}))}]};
 const coordinator=new ChairCoordinator({readAttachment(roomId,id,session){assert.equal(roomId,'room');assert.equal(session,'chair');return {base64:files.find(f=>f.id===id).data.toString('base64')};}});
 const media=coordinator.attachmentContext(room,{session_id:'chair'},{message_id:'request'});
 assert.equal(media.images.length,1);assert.equal(Buffer.from(media.images[0].base64,'base64').toString(),'image bytes');
 assert.match(media.entries[1].text,/TEXT_MARKER/);assert.equal(media.entries[1].text.length,16000);assert.equal(media.entries[1].truncated,true);
 assert.match(media.entries[2].input,/metadata only/);assert.equal(media.entries[2].text,undefined);
});

test('chair image budget reports exclusions and missing attachments without pretending to read them',()=>{
 const metas=Array.from({length:7},(_,i)=>({id:String(i),filename:'file'+i,mime:'image/png',size:6*1024*1024}));
 const coordinator=new ChairCoordinator({readAttachment(room,id){if(id==='0')throw Error('denied');return {base64:Buffer.alloc(6*1024*1024).toString('base64')};}});
 const media=coordinator.attachmentContext({id:'room',messages:[{id:'request',attachments:metas}]},{session_id:'chair'},{message_id:'request'});
 assert.equal(media.images.length,0);assert.equal(media.entries.length,5);assert.equal(media.omitted,2);
 assert.match(media.entries[0].input,/unavailable/);assert.match(media.entries[1].input,/size limit/);
});
