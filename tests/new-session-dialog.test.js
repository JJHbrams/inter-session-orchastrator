import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {showNewSessionDialog} from '../apps/desktop/new-session-dialog.js';
function fixture(){const dom=new JSDOM('<body></body>');dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};return dom;}
test('new session uses one request key and reconciles pending creation rather than creating twice',async()=>{
 const dom=fixture(),calls=[];const request=async(path,options)=>{calls.push({path,payload:JSON.parse(options.body)});return {id:'operation',requestKey:'stable-key',status:calls.length===1?'pending':'ready',cwd:'C:/work',provider:'claude'}};
 const d=showNewSessionDialog({document:dom.window.document,room:{id:'room',cwd:'C:/work'},request,autoPoll:false,makeRequestKey:()=> 'stable-key'}),f=d.querySelector('form');
 await f.onsubmit(new dom.window.Event('submit',{cancelable:true}));assert.equal(calls[0].path,'/api/rooms/room/sessions/create');assert.equal(calls[0].payload.requestKey,'stable-key');assert.match(d.textContent,/연결을 준비/);assert.equal(d.querySelector('[name=cwd]').disabled,true);
 await f.onsubmit(new dom.window.Event('submit',{cancelable:true}));assert.equal(calls[1].path,'/api/rooms/room/session-creations/operation/reconcile');assert.equal(calls.filter(c=>c.path.endsWith('sessions/create')).length,1);assert.equal(d.isConnected,false);dom.window.close();
});
test('new session empty cancellation skips required fields and IME composition cannot create',async()=>{
 const dom=fixture();let calls=0;const d=showNewSessionDialog({document:dom.window.document,room:{id:'r'},request:async()=>{calls++;return {}},autoPoll:false,makeRequestKey:()=> 'key'}),f=d.querySelector('form'),cwd=f.querySelector('[name=cwd]');cwd.value='C:/한';cwd.dispatchEvent(new dom.window.CompositionEvent('compositionstart',{bubbles:true}));await f.onsubmit(new dom.window.Event('submit',{cancelable:true}));assert.equal(calls,0);f.querySelector('button[type=button]:not(.directory-picker-button)').click();assert.equal(d.isConnected,false);assert.equal(calls,0);dom.window.close();
});
test('failed new session request preserves editable directory and reports the error',async()=>{const dom=fixture();const d=showNewSessionDialog({document:dom.window.document,room:{id:'r',cwd:'C:/input'},request:async()=>{throw Error('directory rejected')},autoPoll:false,makeRequestKey:()=> 'key'});await d.querySelector('form').onsubmit(new dom.window.Event('submit',{cancelable:true}));assert.equal(d.querySelector('[name=cwd]').value,'C:/input');assert.equal(d.querySelector('[name=cwd]').disabled,false);assert.match(d.textContent,/directory rejected/);d.close();dom.window.close();});
