import {sessionLocation} from '../apps/desktop/session-location.js';
import {sessionMembers,memberKey,sessionPresentation} from '../apps/desktop/session-inspector.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

test('unchanged polling preserves working card DOM and new state removes the working effect',()=>{
 const document=new JSDOM('<div id="participants"></div><div id="chairProfile"></div>').window.document,source=readFileSync('apps/desktop/app.js','utf8'),start=source.indexOf("let participantRenderSignature="),end=source.indexOf('let decisionSignature;',start);
 const text=(tag,value='',className='')=>{const el=document.createElement(tag);el.textContent=value;el.className=className;return el;},current={id:'room',members:[{id:'member',session_id:'session',alias:'지수',provider:'codex',mode:'read_only',cwd:'C:\\workspace\\Render Project'}],chair:null,chair_runs:[],deliveries:[{id:'delivery',membership_id:'member',kind:'followup',state:'running'}]};
 const context=vm.createContext({document,current,sessionMembers,memberKey,sessionPresentation,sessionLocation,$:selector=>document.querySelector(selector),text,memberName:m=>m.alias,providerName:m=>m.provider,applySessionColor:()=>{},avatar:()=>text('span','지'),modelCaption:()=>'',deliveryPresentation:d=>({state:d.state,label:d.state}),memberButton:(label,click)=>{const b=text('button',label);b.onclick=click;return b;},actionIcon:()=>text('span'),active:()=>true,chairSettingsDialog:()=>{}});
 vm.runInContext(source.slice(start,end),context);vm.runInContext('renderParticipants()',context);
 assert.equal(document.querySelector('#chairProfile .chair-onboarding')?.dataset.state,'missing');assert.match(document.querySelector('#chairProfile .chair-onboarding').textContent,/좌장 미설정/);
 assert.equal(document.querySelector('.participant-settings-trigger'),null);assert.equal(document.querySelector('.chair-model-settings'),null);
 assert.equal(document.querySelector('.participant-project').textContent,'프로젝트 · Render Project');assert.equal(document.querySelector('.participant-project').title,'C:\\workspace\\Render Project');
 const first=document.querySelector('.participant');assert.ok(first.classList.contains('generating'));assert.equal(first.dataset.activity,'response');assert.ok(first.classList.contains('activity-active'));
 current.messages=[{id:'new message unrelated to card'}];vm.runInContext('renderParticipants()',context);assert.equal(document.querySelector('.participant'),first,'polling must not recreate the animated element');
 current.deliveries[0].state='queued';vm.runInContext('renderParticipants()',context);assert.notEqual(document.querySelector('.participant'),first);assert.equal(document.querySelector('.participant.generating'),null,'queued does not imply a running provider');assert.equal(document.querySelector('.participant').dataset.activity,'queued');assert.equal(document.querySelector('.participant').classList.contains('activity-active'),true);
 current.deliveries[0].state='running';current.deliveries[0].message_id='purpose';current.messages=[{id:'purpose',body:JSON.stringify({type:'agenda_relevance'})}];vm.runInContext('renderParticipants()',context);assert.equal(document.querySelector('.participant').dataset.activity,'analysis');
 current.messages[0].body=JSON.stringify({type:'agenda_review'});vm.runInContext('renderParticipants()',context);assert.equal(document.querySelector('.participant').dataset.activity,'review','late request metadata must update the effect without a delivery state change');
});
