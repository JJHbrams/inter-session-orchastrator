import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {agentReferenceText,referenceUrl,showReferenceDialog} from '../apps/desktop/reference-links.js';
import {parseReferenceHash} from '../apps/desktop/channel-nav.js';

const descriptor={available:true,channel:{id:'channel-1',name:'Renamed channel',index:'D:/knowledge/channels/channel-1/index.md'},room:{id:'room-1',name:'Renamed room',index:'D:/knowledge/channels/channel-1/rooms/room-1/index.md'},agenda:{id:'agenda-old',title:'Historical result',phase:'completed',outcome:'qualified',revision:3,file:'D:/knowledge/channels/channel-1/rooms/room-1/agendas/agenda-old.md'},paths:{history:'D:/knowledge/channels/channel-1/rooms/room-1/history/index.md',transcript:'D:/knowledge/channels/channel-1/rooms/room-1/transcript.md'}};

test('reference URLs use the current origin and stable hierarchy IDs',()=>{
 const url=referenceUrl({href:'http://127.0.0.1:4321/#message-keep'},descriptor);
 assert.equal(url,'http://127.0.0.1:4321/#channel=channel-1&room=room-1&agenda=agenda-old');
 assert.deepEqual(parseReferenceHash('#channel=channel-1&room=room-1&agenda=agenda-old'),{channelId:'channel-1',roomId:'room-1',agendaId:'agenda-old'});
 assert.equal(parseReferenceHash('#message-keep'),null);
 assert.deepEqual(parseReferenceHash('#channel=channel-1&room=room-1'),{channelId:'channel-1',roomId:'room-1',agendaId:null});
 assert.ok(parseReferenceHash('#channel=../x&room=room-1&agenda=agenda-old').error);
});

test('agent reference is file-first and excludes credentials and session identifiers',()=>{
 const text=agentReferenceText(descriptor);
 assert.match(text,/Renamed channel > Renamed room > Historical result/);
 assert.match(text,/agenda-old/);assert.match(text,/revision=3/);assert.match(text,/안건 파일을 먼저 읽고/);
 assert.match(text,/history\/index\.md/);assert.match(text,/transcript\.md/);
 assert.doesNotMatch(text,/token|nativeId|profile/i);
});

test('scope parsing rejects empty and duplicate selectors, preserving legacy anchors',()=>{
 for(const hash of ['#room=','#channel=channel-1&room=','#room=a&room=b','#agenda=agenda-only'])assert.ok(parseReferenceHash(hash).error,hash);
 assert.deepEqual(parseReferenceHash('#channel=channel-1'),{channelId:'channel-1',roomId:null,agendaId:null});
 assert.deepEqual(parseReferenceHash('#room=unassigned'),{channelId:null,roomId:'unassigned',agendaId:null});
 assert.equal(parseReferenceHash('#knowledge-old'),null);
 assert.equal(new URL(referenceUrl({href:'http://127.0.0.1:4321/?token=never-copy'},descriptor)).search,'');
});

function dialogFixture(){
 const dom=new JSDOM('<body></body>',{url:'http://127.0.0.1:4321/'});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 return dom;
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('the actual shared dialog copies correct file-first text for channel, room and historical agenda',async()=>{
 for(const data of [{available:true,channel:descriptor.channel},{...descriptor,agenda:null},descriptor]){
  const dom=dialogFixture(),copied=[],calls=[];
  const view=await showReferenceDialog({document:dom.window.document,location:dom.window.location,target:data,request:async path=>{calls.push(path);return data;},clipboard:{writeText:async text=>copied.push(text)}});
  const areas=[...view.dialog.querySelectorAll('textarea')],buttons=[...view.dialog.querySelectorAll('button')];
  assert.equal(areas.length,2);assert.equal(areas[1].parentElement.tagName,'LABEL');assert.equal(areas[1].readOnly,true);
  buttons[0].click();await settle();assert.equal(copied[0],view.url);assert.match(view.dialog.textContent,/복사됨/);
  buttons[1].click();await settle();assert.equal(copied[1],agentReferenceText(data));assert.match(copied[1],/index\.md/);
  if(data.agenda)assert.match(copied[1],/agenda-old/);else assert.doesNotMatch(copied[1],/agenda-old/);
  assert.equal(calls.length,1);assert.match(calls[0],/^\/api\/references\?/);buttons[2].click();assert.equal(dom.window.document.querySelector('dialog'),null);dom.window.close();
 }
});

test('clipboard denial selects the requested text and shows an explicit fallback',async()=>{
 const dom=dialogFixture(),view=await showReferenceDialog({document:dom.window.document,location:dom.window.location,target:descriptor,request:async()=>descriptor,clipboard:{writeText:async()=>{throw Error('denied');}}});
 view.dialog.querySelectorAll('button')[1].click();await settle();const area=view.dialog.querySelectorAll('textarea')[1];
 assert.equal(dom.window.document.activeElement,area);assert.equal(area.selectionStart,0);assert.equal(area.selectionEnd,area.value.length);assert.match(view.dialog.textContent,/선택해서 복사/);dom.window.close();
});

test('missing export keeps a usable browser link and reports unavailability honestly',async()=>{
 const dom=dialogFixture(),view=await showReferenceDialog({document:dom.window.document,location:dom.window.location,target:descriptor,request:async()=>({available:false,warning:'자료 없음'})});
 const area=view.dialog.querySelectorAll('textarea')[1];assert.match(area.value,/자료 없음/);assert.match(area.value,/#channel=/);assert.doesNotMatch(area.value,/D:\/knowledge/);assert.ok(view.dialog.querySelectorAll('button')[0]);dom.window.close();
});
