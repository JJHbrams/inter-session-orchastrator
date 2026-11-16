import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAgendaUI,renderReactiveDetails,agendaMessagePresentation} from '../apps/desktop/agenda-ui.js';

async function fixture(){
 const dom=new JSDOM('<body><div id="agendaCard"></div></body>'),document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};
 const calls=[],errors=[],room={id:'room',members:[{id:'peer-1',session_id:'session-1',alias:'민수'},{id:'peer-2',session_id:'session-2',alias:'지수'},{id:'chair',session_id:'chair-session',role:'chair'}],chair:{session_id:'chair-session'}};
 const request=async(path,options)=>{calls.push({path,options});if(options?.method==='POST')return {id:'agenda'};if(path.endsWith('/knowledge'))return {items:[]};return {agendas:[]}};
 const ui=createAgendaUI({document,request,getRoom:()=>room,error:text=>errors.push(text),renderMarkdown:text=>document.createTextNode(text)});await ui.setRoom('room');await ui.start();
 return {dom,document,ui,calls,errors};
}

test('new agenda selects reactive discussion and sends scoped call limits and exact reviewers',async()=>{
 const f=await fixture(),form=f.document.querySelector('.agenda-dialog form');
 form.querySelector('[name=title]').value='원문 보관 정책';form.querySelector('[name=body]').value='자료 보존과 검색 비용을 논의하자';form.querySelector('[value=peer-2]').checked=true;
 assert.equal(form.querySelector('[name=discussionMode]').value,'reactive');assert.equal(form.querySelectorAll('[name=participants]').length,2);
 form.dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));
 const payload=JSON.parse(f.calls.find(call=>call.options?.method==='POST').options.body);
 assert.equal(payload.discussionMode,'reactive');assert.equal(payload.timeoutSeconds,1800);assert.equal(payload.relevanceBudget,36);assert.equal(payload.chairBudget,12);assert.equal(payload.requestBudget,18);assert.deepEqual(payload.targetMembershipIds,['peer-2']);assert.deepEqual(f.errors,[]);f.dom.window.close();
});

test('legacy chair mode omits reactive limits and hides their controls',async()=>{
 const f=await fixture(),form=f.document.querySelector('.agenda-dialog form'),mode=form.querySelector('[name=discussionMode]');mode.value='chair';mode.dispatchEvent(new f.dom.window.Event('change'));
 assert.equal(form.querySelector('.dialogue-advanced').hidden,true);form.querySelector('[name=title]').value='기존 회의';form.querySelector('[name=body]').value='좌장이 대상을 정해줘';form.dispatchEvent(new f.dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));
 const payload=JSON.parse(f.calls.find(call=>call.options?.method==='POST').options.body);assert.equal(payload.discussionMode,'chair');assert.equal(Object.hasOwn(payload,'relevanceBudget'),false);assert.equal(Object.hasOwn(payload,'chairBudget'),false);f.dom.window.close();
});

test('private decisions and unconfirmed stops remain explicit and rendered as text',()=>{
 const dom=new JSDOM('<body></body>'),members=new Map([['p1',{alias:'민수'}],['p2',{alias:'<img onerror=alert(1)>'}]]);
 const agenda={reactive:{calls:{public:2,relevance:3,chair:1},budgets:{public:18,relevance:36,chair:12},interruptCapability:{hardInterrupt:false},intents:[{membershipId:'p1',status:'abstained',reason:'추가 근거 없음'},{membershipId:'p2',targetMembershipIds:['p1'],status:'speaking',replyTo:'source'}],interventions:[{membershipId:'p1',status:'unknown',reason:'종료 확인 안 됨'}]}};
 const section=renderReactiveDetails(dom.window.document,agenda,members);assert.match(section.textContent,/참여자 2\/18.*참여 판단 3\/36/);assert.match(section.textContent,/이번 발언은 참여하지 않음/);assert.match(section.textContent,/실행 결과 미확인/);assert.match(section.textContent,/즉시 강제 중단은 지원하지 않아요/);assert.equal(section.querySelector('img'),null);assert.equal(section.querySelector('a').getAttribute('href'),'#message-source');dom.window.close();
});

test('relevance notifications render as private routing activity rather than another speaker',()=>{
 const presentation=agendaMessagePresentation({body:JSON.stringify({type:'agenda_relevance',sourceIds:['s']}),provenance:'coordinator',request_key:'agenda:a:reactive:x'},{});
 assert.equal(presentation.internal,true);assert.equal(presentation.authorSessionId,undefined);assert.match(presentation.title,/관련 발언/);
});
test('direct dialogue, speak, abstain and evidence-backed termination are visibly distinct',()=>{
 const dom=new JSDOM('<body></body>'),agenda={reactive:{calls:{},budgets:{},intents:[{kind:'peer_request',membershipId:'p',targetMembershipIds:['q'],status:'completed',sourceIds:['source-1'],replyMessageId:'answer'},{kind:'relevance',membershipId:'q',decision:'speak',status:'speaking'},{kind:'relevance',membershipId:'p',decision:'abstain',status:'abstained'}],interventions:[{action:'mediate',status:'queued',reason:'논점 분리'},{action:'yield',status:'yield_requested'},{action:'interrupt',status:'stopped'},{action:'interrupt',status:'stopped',deliveryId:'exact-delivery',fence:2,proof:{terminated:true,closed:true}}]}};
 const section=renderReactiveDetails(dom.window.document,agenda,new Map([['p',{alias:'민수'}],['q',{alias:'지수'}]]));assert.match(section.textContent,/동료 질문/);assert.match(section.textContent,/참여 판단 · 발언/);assert.match(section.textContent,/참여 판단 · 침묵/);assert.match(section.textContent,/좌장 중재/);assert.match(section.textContent,/마무리 요청됨/);assert.match(section.textContent,/종료 증거 미확인/);assert.match(section.textContent,/종료 확인 · 실행 exact-delivery · fence 2/);assert.ok(section.querySelector('a[href="#message-answer"]'));assert.ok(section.querySelector('a[href="#message-source-1"]'));dom.window.close();
});
test('user mediation requests are scoped to the selected agenda without interrupting a native session',async()=>{
 const dom=new JSDOM('<body><div id="agendaCard"></div></body>'),document=dom.window.document,calls=[];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};
 const agenda={id:'a',title:'정책',phase:'collecting',discussionMode:'reactive',targetMembershipIds:['p'],reactive:{calls:{},budgets:{},intents:[],interventions:[],interruptCapability:{hardInterrupt:false}}};
 const ui=createAgendaUI({document,getRoom:()=>({members:[{id:'p',alias:'민수'}]}),renderMarkdown:text=>document.createTextNode(text),error:error=>assert.fail(error),request:async(path,options)=>{calls.push({path,options});return path.endsWith('/agendas')?{agendas:[agenda]}:agenda;}});await ui.setRoom('r');
 document.querySelector('#agendaCard .agenda-actions button:last-child').click();await new Promise(r=>setImmediate(r));
 [...document.querySelectorAll('button')].find(button=>button.textContent==='좌장에게 중재 요청').click();const form=document.querySelector('dialog:last-of-type form');form.querySelector('[name=reason]').value='원문 보관과 청크 보관 쟁점을 분리해줘';form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));
 const sent=calls.find(call=>call.options?.method==='POST');assert.equal(sent.path,'/api/rooms/r/agendas/a/intervene');assert.deepEqual(JSON.parse(sent.options.body),{targetMembershipIds:[],reason:'원문 보관과 청크 보관 쟁점을 분리해줘'});assert.equal(calls.some(call=>call.path.includes('interrupt')),false);dom.window.close();
});
