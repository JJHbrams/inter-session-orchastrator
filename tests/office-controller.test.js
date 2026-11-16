import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createOfficeController} from '../apps/desktop/office-controller.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
test('late room observations cannot paint another room or reopen a closed room',async()=>{const dom=new JSDOM('',{pretendToBeVisual:true}),pending=[],painted=[],connections=[];const office={setRoom(){},setSnapshot:s=>painted.push(s.roomId),setConnection:s=>connections.push(s)},c=createOfficeController({document:dom.window.document,office,request:(_p,o)=>new Promise(resolve=>pending.push({resolve,signal:o.signal})),intervalMs:99999});c.setRoom('a');c.setRoom('b');assert.ok(pending[0].signal.aborted);pending[0].resolve({roomId:'a'});pending[1].resolve({roomId:'b'});await tick();assert.deepEqual(painted,['b']);c.refresh();c.setRoom(null);pending[2].resolve({roomId:'b'});await tick();assert.deepEqual(painted,['b']);c.destroy();dom.window.close()});
test('failed observations mark disconnected and destroy aborts reads',async()=>{const dom=new JSDOM('',{pretendToBeVisual:true}),seen=[],office={setRoom(){},setSnapshot(){},setConnection:s=>seen.push(s)},c=createOfficeController({document:dom.window.document,office,request:async()=>{throw Error('offline')},intervalMs:99999});c.setRoom('a');await tick();assert.deepEqual(seen,[false]);c.destroy();dom.window.close()});
