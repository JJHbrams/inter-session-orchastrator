import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {modelCaption,participantSettingsDialog} from '../apps/desktop/participant-settings-ui.js';
test('participant dialog uses observed options, fixed provider, and sends exact chosen session values',async()=>{
 const dom=new JSDOM('<body></body>'),doc=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};
 const calls=[],observation={model:'a',modelLabel:'Model A',effort:'medium',models:[{id:'a',label:'Model A'},{id:'b',label:'Model B'}],efforts:['medium','high'],observedAt:'2026-10-26T00:00:00Z'};
 const dialog=await participantSettingsDialog({document:doc,member:{alias:'민수',provider:'codex',native_id:'n'},request:async(action,input)=>{calls.push({action,input});return {...observation,...input}}});
 assert.equal(calls[0].action,'inspect');assert.equal(doc.querySelector('[name=provider]'),null);const model=doc.querySelector('[name=model]'),effort=doc.querySelector('[name=effort]');model.value='b';effort.value='high';dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));assert.deepEqual(calls[1],{action:'apply',input:{provider:'codex',model:'b',effort:'high'}});
 assert.match(dialog.textContent,/Model A|Model B/);assert.equal(modelCaption({}), '모델 · effort 조회 필요');assert.equal(modelCaption({modelSettings:{control:{status:'unknown'}}}),'설정 결과 확인 필요');dom.window.close();
});
test('failed refresh preserves dated cache but cannot apply it as a current observation',async()=>{
 const dom=new JSDOM('<body></body>'),doc=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 const observed={model:'a',effort:'medium',models:[{id:'a',label:'Old Model'}],efforts:['medium'],observedAt:'2026-10-26T00:00:00Z'};let fail=true;
 const dialog=await participantSettingsDialog({document:doc,member:{alias:'민수',provider:'codex',modelSettings:{observed}},request:async()=>{if(fail)throw Error('draft detected');return observed;}});
 assert.match(dialog.querySelector('.settings-application').textContent,/현재값 조회 실패.*마지막 확인값/);assert.match(dialog.querySelector('.form-error').textContent,/draft/);assert.equal(dialog.querySelector('[type=submit]').disabled,true);assert.equal(dialog.querySelector('[name=model]').disabled,true);
 fail=false;dialog.querySelector('menu button').click();await new Promise(r=>setImmediate(r));assert.equal(dialog.querySelector('[type=submit]').disabled,false);assert.equal(dialog.querySelector('.form-error').textContent,'');dom.window.close();
});
test('busy rejection is not presented as a successful setting or an ambiguous transmission',async()=>{
 const dom=new JSDOM('<body></body>'),doc=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};const dialog=await participantSettingsDialog({document:doc,member:{alias:'민수',provider:'claude',native_id:'n'},request:async()=>{throw Error('현재 응답 중')}});assert.match(dialog.querySelector('.form-error').textContent,/현재 응답 중/);assert.equal(dialog.querySelector('[type=submit]').disabled,true);assert.match(dialog.textContent,/현재값 다시 확인/);dom.window.close();
});
