import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttachmentComposer,MAX_ATTACHMENT_BYTES} from '../apps/desktop/attachments.js';

test('attachment drafts remain room scoped and retry keeps request key',async()=>{
 const calls=[];let fail=true;const composer=createAttachmentComposer({upload:async(room,file,key)=>{calls.push({room,key});if(fail)throw Error('offline');return {id:'a'};}});
 composer.setRoom('one');composer.add([{name:'x.png',type:'image/png',size:10}]);await new Promise(resolve=>setTimeout(resolve));
 const item=composer.items()[0],requestKey=item.requestKey;assert.equal(item.status,'failed');composer.setRoom('two');assert.equal(composer.items().length,0);composer.setRoom('one');fail=false;composer.retry(item);await new Promise(resolve=>setTimeout(resolve));assert.equal(composer.items()[0].status,'ready');assert.equal(calls[1].key,requestKey);
});
test('attachment cap rejects oversized files',()=>{const composer=createAttachmentComposer({upload:async()=>({id:'x'})});composer.setRoom('one');composer.add([{name:'huge',type:'application/octet-stream',size:MAX_ATTACHMENT_BYTES+1}]);assert.equal(composer.items()[0].status,'failed');});
