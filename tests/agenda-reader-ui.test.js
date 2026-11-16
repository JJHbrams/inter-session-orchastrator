import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAgendaUI,agendaProse} from '../apps/desktop/agenda-ui.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};};
function fixture(request){
 const dom=new JSDOM('<body><div id="agendaCard"></div></body>'),document=dom.window.document,calls=[],errors=[];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};
 const room={members:[{id:'p',session_id:'s',alias:'지수'}],messages:[{id:'source',sender_session_id:'s'}]};
 const ui=createAgendaUI({document,request:async(path,options)=>{calls.push({path,options});return request(path,options)},renderMarkdown:text=>document.createTextNode(text),error:text=>errors.push(text),getRoom:()=>room});
 return {dom,document,ui,calls,errors};
}
const agenda={id:'active',title:'현재 안건',phase:'collecting',revision:2,goal:'현행 정책',targetMembershipIds:['p'],rounds:[],reviews:[]};
const old={...agenda,id:'old',title:'이전 저장 정책',phase:'completed',outcome:'qualified',current_conclusion:'최종 결론',rounds:[{ordinal:1,stage:'review',targetSnapshot:['p'],conclusion_revision:2}],reviews:[{membership_id:'p',conclusion_revision:1,stance:'disagree',body:'예전 반대'},{membership_id:'p',conclusion_revision:2,stance:'agree',body:'현재 동의',sourceIds:['source']}],arguments:[{id:'source',author:'s',body:'원문 논거'}]};

test('history searches and filters every agenda, opening an old result without changing the current agenda or posting',async()=>{
 const cancelled={...agenda,id:'cancelled',title:'취소 안건',phase:'cancelled'};
 const f=fixture(path=>path.endsWith('/agendas')?{agendas:[agenda,old,cancelled]}:old);await f.ui.setRoom('room');
 [...f.document.querySelectorAll('button')].find(b=>b.textContent==='안건 이력 · 3').click();await settle();
 const history=f.document.querySelector('.agenda-history-dialog');assert.equal(history.querySelectorAll('.agenda-history-row').length,3);
 const filter=history.querySelector('select');filter.value='completed';filter.dispatchEvent(new f.dom.window.Event('change'));assert.equal(history.querySelectorAll('.agenda-history-row').length,1);
 const query=history.querySelector('input');query.value='저장';query.dispatchEvent(new f.dom.window.Event('input'));history.querySelector('.agenda-history-row').click();await settle();
 const result=f.document.querySelector('.agenda-detail-dialog');assert.equal(result.querySelector('h2').textContent,'이전 저장 정책');assert.equal(result.querySelector('.agenda-outcome').textContent,'조건부 결론');assert.equal(result.querySelector('.agenda-result-body').textContent,'최종 결론');assert.match(result.textContent,/이전 결론 검토/);assert.match(result.textContent,/현재 결론 검토/);assert.doesNotMatch(result.textContent,/현재 결론 미응답/);assert.equal(result.querySelector('a').getAttribute('href'),'#message-source');
 const tabs=result.querySelectorAll('.reader-tabs button');tabs[1].click();await settle();assert.equal(result.querySelector('[data-section=summary]').hidden,true);assert.equal(result.querySelector('[data-section=evidence]').hidden,false);assert.equal(tabs[1].getAttribute('aria-pressed'),'true');
 assert.equal(f.document.querySelector('#agendaCard strong').textContent,'현재 안건');await f.ui.refresh();assert.equal(f.document.querySelector('#agendaCard strong').textContent,'현재 안건');
 query.value='없는 안건';query.dispatchEvent(new f.dom.window.Event('input'));assert.match(history.textContent,/조건에 맞는 안건이 없어요/);
 assert.equal(f.calls.some(c=>c.options?.method==='POST'),false);assert.deepEqual(f.errors,[]);f.dom.window.close();
});

test('knowledge auto-selects and highlights a row; a stale detail response cannot replace a newer selection',async()=>{
 const slow=deferred();let slowA=false;
 const f=fixture(path=>path.endsWith('/agendas')?{agendas:[]}:path.includes('/knowledge?')?{items:[{id:'a',title:'짧은 자료'},{id:'b',title:'긴 자료'}]}:path.endsWith('/a')&&slowA?slow.promise:{item:{id:path.endsWith('/b')?'b':'a',title:path.endsWith('/b')?'긴 자료':'짧은 자료',body:path.endsWith('/b')?'본문\n'.repeat(300):'짧은 본문'}});
 await f.ui.setRoom('room');await f.ui.knowledge();const d=f.document.querySelector('.knowledge-dialog'),rows=d.querySelectorAll('.knowledge-row');
 assert.equal(rows[0].getAttribute('aria-pressed'),'true');assert.equal(rows[0].classList.contains('selected'),true);slowA=true;rows[0].click();rows[1].click();await settle();assert.equal(rows[1].getAttribute('aria-pressed'),'true');assert.equal(rows[0].getAttribute('aria-pressed'),'false');assert.match(d.querySelector('.knowledge-detail').textContent,/긴 자료/);
 slow.resolve({item:{id:'a',title:'遅い古い結果',body:'stale'}});await settle();assert.match(d.querySelector('.knowledge-detail').textContent,/긴 자료/);assert.doesNotMatch(d.querySelector('.knowledge-detail').textContent,/stale/);assert.equal(d.querySelector('.knowledge-detail').getAttribute('aria-busy'),'false');assert.equal(f.calls.some(c=>c.options?.method==='POST'),false);f.dom.window.close();
});

test('knowledge filtering selects a visible replacement and clears stale details on empty lists',async()=>{
 let items=[{id:'a',title:'A'},{id:'b',title:'B'}];const f=fixture(path=>path.endsWith('/agendas')?{agendas:[]}:path.includes('/knowledge?')?{items}:{item:{title:path.split('/').at(-1),body:'本文'}});
 await f.ui.setRoom('room');await f.ui.knowledge('b');let selected=f.document.querySelector('.knowledge-row.selected');assert.equal(selected.dataset.knowledgeId,'b');
 const select=f.document.querySelector('[aria-label="자료 종류"]');items=[{id:'a',title:'A'}];select.value='source';select.dispatchEvent(new f.dom.window.Event('change'));await settle();assert.equal(f.document.querySelector('.knowledge-row.selected').dataset.knowledgeId,'a');
 items=[];select.value='argument';select.dispatchEvent(new f.dom.window.Event('change'));await settle();assert.equal(f.document.querySelector('.knowledge-row.selected'),null);assert.match(f.document.querySelector('.knowledge-detail').textContent,/목록에서 자료/);assert.deepEqual(f.errors,[]);f.dom.window.close();
});

test('late history and knowledge responses from a previous room cannot populate the next room',async()=>{
 const delayed=deferred();const f=fixture(path=>path.endsWith('/agendas')?{agendas:[old]}:delayed.promise);await f.ui.setRoom('room');
 const showing=f.ui.knowledge();await f.ui.setRoom('other');delayed.resolve({items:[{id:'secret',title:'이전 방'}]});await showing;
 assert.equal(f.document.querySelectorAll('.knowledge-row').length,0);assert.equal(f.calls.some(c=>c.path.includes('/other/knowledge/secret')),false);f.dom.window.close();
});

test('review presentation extracts only recognized structured prose and preserves literal text',()=>{
 assert.equal(agendaProse(JSON.stringify({agendaId:'a',stance:'agree',body:'근거를 확인했어'})),'근거를 확인했어');assert.equal(agendaProse('일반 본문'),'일반 본문');assert.equal(agendaProse('{"body":"JSON 자료"}'),'{"body":"JSON 자료"}');
});

test('a directly linked material outside the current filter is still reachable and visibly selected',async()=>{
 const f=fixture(path=>path.endsWith('/agendas')?{agendas:[]}:path.includes('/knowledge?')?{items:[]}:{item:{id:'linked',title:'연결된 원자료',body:'권한이 확인된 원문',links:['next']}});
 await f.ui.setRoom('room');await f.ui.knowledge('linked');assert.equal(f.document.querySelector('.knowledge-row.selected').dataset.knowledgeId,'linked');assert.match(f.document.querySelector('.knowledge-detail').textContent,/권한이 확인된 원문/);assert.match(f.document.querySelector('.reader-footer').textContent,/연결 자료 포함/);assert.deepEqual(f.errors,[]);assert.equal(f.calls.some(c=>c.options?.method==='POST'),false);f.dom.window.close();
});
