import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import vm from 'node:vm';

async function render(chair){
 const source=(await readFile(new URL('../apps/desktop/app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
 const implementation=source.match(/function chairOnboarding\(chair,onConfigure\)\{([\s\S]*?)\n\}\nfunction renderParticipants/)?.[0].replace(/\nfunction renderParticipants$/, '');
 assert.ok(implementation,'chair onboarding renderer must be present');
 const dom=new JSDOM(),factory=Function('document','text','active',`return (${implementation})`)(dom.window.document,(tag,value,cls)=>{const node=dom.window.document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;},()=>true);
 return factory(chair,()=>{});
}

test('deferred chair state stays visible with its limits and setup action',async()=>{
 const notice=await render(null);
 assert.equal(notice.dataset.state,'missing');assert.match(notice.textContent,/좌장 미설정/);assert.match(notice.textContent,/직접 게시/);assert.match(notice.textContent,/자동 조율/);assert.equal(notice.querySelector('button').textContent,'좌장 설정');assert.equal(notice.querySelector('button').type,'button');
});

test('chair lifecycle notices are distinct and ready removes the missing state',async()=>{
 assert.equal(await render({status:'ready'}),null);
 assert.match((await render({status:'initializing'})).textContent,/생성 중/);
 assert.match((await render({status:'failed'})).textContent,/연결 실패/);
 assert.match((await render({status:'unknown'})).textContent,/실행 확인 필요/);
});

test('delayed chair options cannot open a stale room or duplicate onboarding dialogs',async()=>{
 const source=await readFile(new URL('../apps/desktop/app.js',import.meta.url),'utf8'),start=source.indexOf('let chairSettingsOpening='),end=source.indexOf('const createChairButton',start),dom=new JSDOM(),document=dom.window.document;
 let resolveOptions,optionCalls=0,shown=0;const pending=new Promise(resolve=>{resolveOptions=resolve;});
 const context=vm.createContext({document,current:{id:'created',chair:null},active:()=>true,req:async path=>{if(path==='/api/chair/options'){optionCalls++;return optionCalls===1?pending:{defaults:{provider:'claude'}};}throw new Error('unexpected request');},dialog:()=>{const d=document.createElement('dialog'),f=document.createElement('form');d.close=()=>d.dispatchEvent(new dom.window.Event('close'));d.showModal=()=>{shown++;};return {d,f};},text:(tag,value='',cls)=>{const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;},chairSettingsFields:()=>{const input=document.createElement('input');return {element:document.createElement('div'),providerInput:input,customInput:input,modelInput:{value:'model'},effortInput:{options:[1],disabled:false},value:()=>({})};},actions:form=>{const menu=document.createElement('menu'),cancel=document.createElement('button');cancel.type='button';menu.append(cancel);form.append(menu);},error:()=>{},renderParticipants:()=>{},openRoom:async()=>{},showDiscovery:()=>{},renderChairControl:()=>{},renderToolbar:()=>{}});
 vm.runInContext(source.slice(start,end),context);
 const first=vm.runInContext('chairSettingsDialog({onboarding:true})',context),second=vm.runInContext('chairSettingsDialog({onboarding:true})',context);assert.equal(optionCalls,1);await second;
 context.current={id:'other',chair:null};resolveOptions({defaults:{provider:'claude'}});await first;assert.equal(shown,0);
 context.current={id:'created',chair:null};await vm.runInContext('chairSettingsDialog({onboarding:true})',context);assert.equal(optionCalls,2);assert.equal(shown,1);await vm.runInContext('chairSettingsDialog({onboarding:true})',context);assert.equal(optionCalls,2);
});
