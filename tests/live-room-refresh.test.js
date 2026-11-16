import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseReferenceHash} from '../apps/desktop/channel-nav.js';

const source=readFileSync('apps/desktop/app.js','utf8');
const start=source.indexOf('let polling=false;');
const end=source.indexOf('\npollRoom();',start);

function fixture(hash){
 const calls={refresh:0,open:[],ensure:0,agendaRefresh:0,agendaOpen:0,dialogs:0};
 const channel={id:'channel',name:'검토'},room={id:'room',channel_id:'channel',messages:[]};
 const serverMessages=[];
 const context=vm.createContext({
  location:{hash},parseReferenceHash,rooms:[room],channels:[channel],current:undefined,showArchived:false,
  refresh:async()=>{calls.refresh++;},error:()=>{},channelNav:{expand:()=>{}},renderNav:()=>{},
  openRoom:async(id,...args)=>{calls.open.push([id,...args]);context.current={...room,messages:[...serverMessages]};},
  req:async path=>path.endsWith('/agendas')?{agendas:[{id:'agenda'}]}:{},
  agendaUI:{refresh:async()=>{calls.agendaRefresh++;},open:async()=>{calls.agendaOpen++;}},
  ensureVisibleSelection:async()=>{calls.ensure++;await context.openRoom(context.current.id,false);},
  dialog:()=>({d:{showModal:()=>{calls.dialogs++;},close:()=>{}},f:{append:()=>{}}}),text:()=>({}),memberButton:()=>({}),
  $:()=>({setAttribute:()=>{}})
 });
 vm.runInContext(source.slice(start,end),context);
 return {calls,context,serverMessages,run:()=>vm.runInContext('pollRoom()',context)};
}

test('a handled room reference still refreshes its visible room and incoming messages on the next poll',async()=>{
 const view=fixture('#room=room');
 await view.run();
 assert.deepEqual(view.calls.open,[['room',true,true]]);
 view.serverMessages.push({id:'incoming',body:'새 발언'});
 await view.run();
 assert.equal(view.calls.refresh,2);assert.equal(view.calls.ensure,1);
 assert.deepEqual(view.calls.open,[['room',true,true],['room',false]]);
 assert.deepEqual(view.context.current.messages,view.serverMessages);
});

test('a handled agenda reference does not reopen its agenda, and a channel reference does not reopen its dialog',async()=>{
 const agenda=fixture('#room=room&agenda=agenda');
 await agenda.run();await agenda.run();
 assert.equal(agenda.calls.agendaRefresh,1);assert.equal(agenda.calls.agendaOpen,1);
 assert.deepEqual(agenda.calls.open,[['room',true,true],['room',false]]);
 const channel=fixture('#channel=channel');
 await channel.run();await channel.run();
 assert.equal(channel.calls.dialogs,1);assert.equal(channel.calls.ensure,0);
});
