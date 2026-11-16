import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {bindCreationForm} from '../apps/desktop/creation-form.js';
import {attachDirectoryPicker} from '../apps/desktop/directory-picker.js';
import {sessionLocation} from '../apps/desktop/session-location.js';
const markup=await readFile(new URL('../apps/desktop/index.html',import.meta.url),'utf8');
function fixture(id='channelDialog'){
 const dom=new JSDOM(markup),dialog=dom.window.document.getElementById(id);dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');return {dom,dialog,form:dialog.querySelector('form'),input:dialog.querySelector('input[required]')};
}
for(const id of ['channelDialog','roomDialog']){
 test(`${id}: empty cancellation closes without required validation or mutation`,()=>{
  const {dom,dialog,form}=fixture(id);let calls=0,invalid=0;bindCreationForm({dialog,onSubmit:()=>{calls++}});form.addEventListener('invalid',()=>invalid++,true);
  form.querySelector('[data-dialog-cancel]').click();assert.equal(dialog.open,false);assert.equal(calls,0);assert.equal(invalid,0);dom.window.close();
 });
 test(`${id}: a form submission stays open until completion and rapid submissions create once`,async()=>{
  const {dom,dialog,form,input}=fixture(id);input.value='Created';let calls=0,resolve;const pending=new Promise(done=>resolve=done);bindCreationForm({dialog,onSubmit:()=>{calls++;return pending}});
  const first=form.onsubmit(new dom.window.Event('submit',{cancelable:true}));const second=form.onsubmit(new dom.window.Event('submit',{cancelable:true}));assert.equal(calls,1);assert.equal(dialog.open,true);assert.equal(form.querySelector('[type="submit"]').disabled,true);
  resolve({id:'created'});await Promise.all([first,second]);assert.equal(dialog.open,false);assert.equal(input.value,'');dom.window.close();
 });
 test(`${id}: failed creation preserves draft and whitespace cannot submit`,async()=>{
  const {dom,dialog,form,input}=fixture(id);let calls=0;bindCreationForm({dialog,onSubmit:()=>{calls++;throw Error('Create failed')}});input.value='Draft';await form.onsubmit(new dom.window.Event('submit',{cancelable:true}));assert.equal(dialog.open,true);assert.equal(input.value,'Draft');assert.match(form.textContent,/Create failed/);
  input.value=' ';await form.onsubmit(new dom.window.Event('submit',{cancelable:true}));assert.equal(calls,1);input.value='Valid';input.dispatchEvent(new dom.window.Event('input'));assert.equal(input.checkValidity(),true);dom.window.close();
 });
}
test('IME composition does not submit an unfinished name',async()=>{const {dom,dialog,form,input}=fixture();input.value='한';let calls=0;bindCreationForm({dialog,onSubmit:()=>{calls++}});input.dispatchEvent(new dom.window.CompositionEvent('compositionstart',{bubbles:true}));await form.onsubmit(new dom.window.Event('submit',{cancelable:true}));assert.equal(calls,0);assert.equal(dialog.open,true);dom.window.close();});
test('folder choice preserves cancelled input, applies selected absolute path and reports failure',async()=>{
 const dom=new JSDOM('<label>폴더<input value="C:/old"></label>'),input=dom.window.document.querySelector('input');let changes=0,result={cancelled:true,path:null};input.addEventListener('change',()=>changes++);
 const button=attachDirectoryPicker(input,{getBridge:()=>({chooseDirectory:async options=>{assert.equal(options.defaultPath,input.value);if(result instanceof Error)throw result;return result}})});
 await button.onclick();assert.equal(input.value,'C:/old');assert.equal(changes,0);result={cancelled:false,path:'C:/new folder'};await button.onclick();assert.equal(input.value,'C:/new folder');assert.equal(changes,1);result=Error('picker unavailable');await button.onclick();assert.equal(input.value,'C:/new folder');assert.match(input.closest('label').textContent,/picker unavailable/);assert.equal(button.disabled,false);dom.window.close();
});
test('web fallback keeps manual path editing enabled',()=>{const dom=new JSDOM('<label><input></label>'),input=dom.window.document.querySelector('input'),button=attachDirectoryPicker(input,{getBridge:()=>null});assert.equal(button.disabled,true);assert.equal(input.disabled,false);assert.match(button.title,/직접 입력/);dom.window.close();});
test('project labels handle Windows, UNC, POSIX and unknown paths',()=>{assert.equal(sessionLocation({cwd:'C:\\work\\My Project\\'}).label,'프로젝트 · My Project');assert.equal(sessionLocation({cwd:'\\\\server\\share\\Study'}).label,'프로젝트 · Study');assert.equal(sessionLocation({cwd:'/work/project/'}).label,'프로젝트 · project');assert.equal(sessionLocation({projectName:'Known Project'}).label,'프로젝트 · Known Project');assert.equal(sessionLocation({}).label,'작업 폴더 미확인');assert.equal(sessionLocation({cwd:'C:/complete/path'}).path,'C:/complete/path');});
