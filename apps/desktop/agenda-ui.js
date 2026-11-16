import {createReferenceMap} from './rich-text.js';
import {showReferenceDialog} from './reference-links.js';
export function agendaMessagePresentation(message,chair){
 let receipt;try{receipt=JSON.parse(message.body)}catch{}if(receipt?.noticeId&&receipt.acknowledged===true)return {title:'결과 수신 확인',body:`승인된 결론 v${receipt.revision}과 근거를 확인했어. 후속 작업은 시작하지 않았어.`};
 const key=message.request_key||'';
 let reactive;try{reactive=JSON.parse(message.body)}catch{}
 if(reactive?.type==='agenda_relevance'||reactive?.type==='agenda_participation')return {internal:true,title:'관련 발언 검토 요청',body:'새 발언·자료를 확인하고 필요한 경우에만 참여해요. 침묵 판단은 공개 발언으로 올리지 않아요.'};
 if(message.provenance!=='coordinator'||!key.startsWith('agenda'))return null;
 if(key.includes(':chair:')){const stage=key.split(':chair:')[1].split(':')[0];return {internal:true,title:({discussion:'새 발언·리액션을 좌장에게 전달',plan:'좌장에게 토론 계획 요청',synthesize:'좌장에게 조사 결과 취합 요청',refine:'좌장에게 이견 조율 요청',final:'좌장에게 최종 정리 요청'})[stage]||'토론 진행',body:message.body};}
 let data;try{data=JSON.parse(message.body)}catch{}
 if(data?.type==='agenda_review')return {authorSessionId:chair?.session_id,title:`상호 검토 · 결론 v${data.conclusionRevision}`,body:`현재 제안을 다른 참여자의 논거와 비교해 검토해줘. 동의·조건부 동의·반대·근거 부족 중 입장과 이유를 남겨줘.\n\n${data.candidate||'결론 원문은 안건의 결과에서 확인할 수 있어.'}`,details:(data.arguments||[]).map(x=>`근거 ${x.id}\n${x.body||'토론장 문맥의 원문 참조'}`).join('\n\n')||'논거와 첨부 원문은 토론장 문맥에서 확인할 수 있어.'};
 if(data?.type==='agenda_approval_receipt')return {internal:true,title:`사용자가 결과 v${data.revision} 승인 · 참여 세션에 공유`,body:data.currentConclusion};
 return {authorSessionId:chair?.session_id,title:'좌장 요청 전달',body:message.body};
}
const value=(object,...names)=>names.map(name=>object?.[name]).find(item=>item!==undefined&&item!==null);
export const normalizeAgenda=agenda=>({
  ...agenda,id:value(agenda,'id','agendaId','agenda_id'),title:value(agenda,'title')||'제목 없는 안건',phase:value(agenda,'phase','status')||'planning',
  outcome:value(agenda,'outcome','result'),revision:value(agenda,'revision','currentRevision','current_revision'),round:value(agenda,'round','currentRound','current_round'),
  summary:value(agenda,'summary','current_conclusion','currentConclusion','resultSummary','result_summary')||agenda.conclusion?.body||agenda.proposal?.body||agenda.body,arguments:value(agenda,'arguments','claims')||[],rounds:value(agenda,'rounds')||[],reviews:value(agenda,'reviews')||[],notices:value(agenda,'notices','deliveries')||[],
  goal:value(agenda,'goal'),completionCriteria:value(agenda,'completionCriteria','completion_criteria'),participants:value(agenda,'participants','targetMembershipIds','target_membership_ids','participantIds','participant_ids')||[]
});
export const safeUrl=url=>{try{const parsed=new URL(url);return /^https?:$/.test(parsed.protocol)?parsed.href:null;}catch{return null;}};
const node=(doc,tag,content,cls)=>{const el=doc.createElement(tag);if(content!==undefined)el.textContent=content;if(cls)el.className=cls;return el;};
const phaseLabel=phase=>({planning:'계획',collecting:'자료 수집',reviewing:'상호 검토',refining:'보완',blocked:'차단됨',paused:'중지됨',finalizing:'종합 중',completed:'완료',cancelled:'취소됨'}[phase]||phase);
const noticeLabel=state=>({queued:'대기',delivered:'전달됨',acknowledged:'확인됨',blocked:'차단됨',revoked:'철회됨',pending:'대기',sent:'전달됨',ack:'확인됨'}[state]||state||'상태 미확인');
const outcomeLabel=state=>({consensus:'합의',qualified:'조건부 결론',disputed:'이견 남음',insufficient_evidence:'근거 부족',limit_reached:'한도 도달',cancelled:'취소됨'}[state]||'논의 중');
const stanceLabel=state=>({agree:'동의',qualified:'조건부 동의',disagree:'반대',insufficient_evidence:'근거 부족'}[state]||state||'입장 미확인');
const dateLabel=date=>{const parsed=new Date(date);return date&&!Number.isNaN(parsed.valueOf())?new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(parsed):'날짜 미기록';};
// A review may also be stored as its original structured reply. Show its prose, not its transport envelope.
export function agendaProse(body){if(typeof body!=='string')return '';try{const parsed=JSON.parse(body);if(parsed&&typeof parsed.body==='string'&&(parsed.agendaId||parsed.stance))return parsed.body;}catch{}return body;}
export const reactiveStateLabel=state=>({queued:'참여 검토 대기',evaluating:'관련성 검토 중',abstained:'이번 발언은 참여하지 않음',speaking:'발언 중',completed:'응답 완료',yield_requested:'마무리 요청됨',yielded:'새 발언 보류',interrupt_requested:'중단 확인 중',stopped:'중단 확인됨',unknown:'실행 결과 미확인',expired:'알림 만료',cancelled:'취소됨',failed:'실행 실패'}[state]||'상태 미확인');
export function reactiveCallCaption(agenda){const state=agenda?.reactive;if(!state)return '';const calls=state.calls||{},budgets=state.budgets||{};return `참여자 ${calls.public??0}/${budgets.public??agenda.request_budget??18} · 참여 판단 ${calls.relevance??0}/${budgets.relevance??36} · 좌장 ${calls.chair??0}/${budgets.chair??12}`;}
export function renderReactiveDetails(document,agenda,members){
 const state=agenda.reactive;if(!state)return null;
 const section=node(document,'section',undefined,'agenda-detail-section reactive-detail');section.append(node(document,'h3','자율 대화 진행'),node(document,'p',reactiveCallCaption(agenda),'reactive-call-caption'));
 const capability=state.interruptCapability;
 section.append(node(document,'p',capability?.hardInterrupt?'정확한 실행을 확인한 작업만 강제 중단할 수 있어요.':'현재 연결은 협조 종료를 지원해요. 마무리 요청 후 실행이 끝나는 것을 확인하며, 즉시 강제 중단은 지원하지 않아요.','setting-help'));
 const audit=node(document,'details',undefined,'reactive-audit'),intents=state.intents||[];audit.append(node(document,'summary',`참여 판단과 직접 대화 · ${intents.length}건`));
 const label=id=>members.get(id)?.alias||members.get(id)?.display_name||'참여 세션';
 if(!intents.length)audit.append(node(document,'p','관련 발언을 기다리고 있어요.','muted'));
 for(const intent of intents.slice(-24).reverse()){
  const row=node(document,'article',undefined,'reactive-intent'),targets=intent.targetMembershipIds||[];
  const direct=intent.kind==='peer_request'||intent.kind==='peer'||targets.length>0;
  const action=direct?'동료 질문':intent.decision==='abstain'?'참여 판단 · 침묵':intent.decision==='speak'?'참여 판단 · 발언':'참여 여부 판단';
  row.append(node(document,'span',action,'reactive-kind'),node(document,'strong',label(intent.membershipId)+(targets.length?' → '+targets.map(label).join(', '):'')),node(document,'span',reactiveStateLabel(intent.status),'reactive-state'));
  if(intent.reason)row.append(node(document,'p',intent.reason));
  if(intent.replyTo){const link=node(document,'a','관련 발언');link.href='#message-'+intent.replyTo;link.onclick=()=>section.closest('dialog')?.close();row.append(link);}
  if(intent.replyMessageId){const link=node(document,'a','답변 보기');link.href='#message-'+intent.replyMessageId;link.onclick=()=>section.closest('dialog')?.close();row.append(link);}
  const sources=node(document,'div',undefined,'agenda-sources');for(const id of (intent.sourceIds||[]).slice(0,3)){const link=node(document,'a',`근거 ${id.slice(0,8)}`);link.href='#message-'+id;link.onclick=()=>section.closest('dialog')?.close();sources.append(link);}if(sources.childNodes.length)row.append(sources);
  audit.append(row);
 }
 if(intents.length>24)audit.append(node(document,'p','최근 24건을 표시해요. 전체 기록은 안건 자료에서 확인할 수 있어요.','muted'));
 section.append(audit);
 const interventions=state.interventions||[];
 if(interventions.length){const list=node(document,'div',undefined,'reactive-interventions');list.append(node(document,'h4','중재·마무리 요청'));for(const item of interventions.slice(-12)){const row=node(document,'article',undefined,'reactive-intent'),targets=item.targetMembershipIds||[],verifiedStop=item.status==='stopped'&&item.proof?.terminated===true&&item.proof?.closed===true,stateLabel=item.status==='stopped'&&!verifiedStop?'종료 증거 미확인':item.action==='yield'&&item.status==='completed'?'응답 마무리 확인':reactiveStateLabel(item.status);row.append(node(document,'span',item.action==='yield'?'마무리 요청':item.action==='interrupt'?'실행 중단':'좌장 중재','reactive-kind'),node(document,'strong',targets.length?targets.map(label).join(', '):item.membershipId?label(item.membershipId):'좌장'),node(document,'span',stateLabel,'reactive-state'));if(item.reason)row.append(node(document,'p',item.reason));if(verifiedStop)row.append(node(document,'small',`종료 확인 · 실행 ${item.deliveryId||item.proof.deliveryId||'—'} · fence ${item.fence??item.proof.fence??'—'}`));list.append(row);}section.append(list);}
 return section;
}

export function createAgendaUI({document,request,renderMarkdown,renderAttachments,error,getRoom,getChannels,onChange}) {
  let roomId,agendas=[],activeId,knowledgeScope='all',knowledgeKind='',knowledgeStatus='',knowledgeQuery='';
  const current=()=>getRoom();
  const endpoint=path=>`/api/rooms/${roomId}${path}`;
  async function load(){
    const origin=roomId;if(!origin){agendas=[];activeId=null;renderCard();return;}const result=await request(`/api/rooms/${origin}/agendas`);if(roomId!==origin)return;agendas=(result.agendas||[]).map(normalizeAgenda);
    const active=agendas.find(item=>!['completed','cancelled'].includes(item.phase));activeId=active?.id||agendas[0]?.id;renderCard();
  }
  async function detail(id=activeId){if(!id)return null;return normalizeAgenda(await request(endpoint(`/agendas/${id}`)));}
  function renderCard(){
    const host=document.querySelector('#agendaCard');if(!host)return;host.replaceChildren();const agenda=agendas.find(item=>item.id===activeId);if(!agenda){host.hidden=true;return;}host.hidden=false;
    const heading=node(document,'div',undefined,'agenda-card-heading');heading.append(node(document,'strong',agenda.title),node(document,'span',phaseLabel(agenda.phase),'agenda-phase'));
    const latestRound=agenda.round??agenda.rounds.at(-1)?.ordinal??0,status=node(document,'p',`${agenda.discussionMode==='reactive'?'자율 대화':'좌장 진행'} · 라운드 ${latestRound} · revision ${agenda.revision??'—'}${agenda.reactive?' · '+reactiveCallCaption(agenda):''}`,'agenda-meta');
    const goal=node(document,'p',agenda.goal||agenda.summary||'목표를 불러오는 중입니다.','agenda-goal');
    const actions=node(document,'div',undefined,'agenda-actions');
    if(agenda.phase==='paused')actions.append(button('재개',()=>act(agenda.id,'resume')));else if(!['completed','cancelled'].includes(agenda.phase))actions.append(button('중지',()=>act(agenda.id,'pause')));
    if(!['completed','cancelled'].includes(agenda.phase)){actions.append(button('보완',()=>supplement(agenda.id)),button('취소',()=>act(agenda.id,'cancel')));}
    actions.append(button('결과 보기',()=>showAgenda(agenda.id)));
    const history=button(`안건 이력 · ${agendas.length}`,showHistory);history.className='agenda-history-action';actions.insertBefore(history,actions.lastChild);host.append(heading,status,goal,actions);
  }
  function button(label,handler){const b=node(document,'button',label);b.type='button';b.onclick=async()=>{try{await handler();}catch(e){error(e.message);}};return b;}
  async function act(agendaId,action,body={}){await request(endpoint(`/agendas/${agendaId}/${action}`),{method:'POST',body:JSON.stringify(body)});await load();onChange?.();}
  function dialog(title){const d=document.createElement('dialog'),f=document.createElement('form');f.method='dialog';f.append(node(document,'h2',title));d.append(f);document.body.append(d);d.addEventListener('close',()=>d.remove());return {d,f};}
  function field(form,label,name,kind='input'){const l=node(document,'label',label),input=document.createElement(kind);input.name=name;if(kind==='textarea')input.rows=3;else input.type='text';l.append(input);form.append(l);return input;}
  function actions(form,label){const menu=node(document,'menu'),cancel=button('취소',()=>form.closest('dialog').close()),submit=node(document,'button',label,'accent');submit.type='submit';menu.append(cancel,submit);form.append(menu);return submit;}
  async function start(){const room=current();if(!roomId||!room)return;if(room.archived_at){error('보관된 토론장에는 안건을 시작할 수 없습니다.');return;}const {d,f}=dialog('안건으로 토론');d.className='agenda-dialog';const title=field(f,'안건 제목','title'),body=field(f,'배경과 질문','body','textarea'),goal=field(f,'목표','goal','textarea'),criteria=field(f,'완료 기준','completionCriteria','textarea');
    const modeLabel=node(document,'label','진행 방식'),mode=document.createElement('select');mode.name='discussionMode';for(const [id,title] of [['reactive','자율 대화 · 참여자가 상대를 고르고 좌장이 중재'],['chair','좌장 진행 · 좌장이 질문 대상을 지정']]){const option=node(document,'option',title);option.value=id;mode.append(option);}modeLabel.append(mode);f.append(modeLabel);
    const modeHelp=node(document,'p','새 발언·자료를 확인한 참여자가 발언하거나 이번에는 참여하지 않을 수 있어요. 좌장은 논점 충돌과 마무리를 맡아요.','setting-help');f.append(modeHelp);
    const choices=node(document,'fieldset',undefined,'agenda-participants');choices.append(node(document,'legend','참여 세션 · 최종 결론 검토자'));
    for(const member of room.members||[]){if(member.left_at||member.read_only||member.role==='chair'||member.session_id===room.chair?.session_id)continue;const label=node(document,'label',undefined,'checkbox-row'),check=document.createElement('input');check.type='checkbox';check.name='participants';check.value=member.id;label.append(check,document.createTextNode(' '+(member.alias||member.display_name||member.native_id)));choices.append(label);}f.append(choices);
    const materialChoices=node(document,'fieldset',undefined,'agenda-participants');materialChoices.append(node(document,'legend','참조할 자료·지식'));try{const result=await request(endpoint('/knowledge'));for(const item of result.items||[]){const label=node(document,'label',undefined,'checkbox-row'),check=document.createElement('input');check.type='checkbox';check.name='materials';check.value=item.id;check.checked=true;label.append(check,document.createTextNode(` ${item.title} · v${item.revision}`));materialChoices.append(label);}}catch(e){error(e.message);return;}f.append(materialChoices);
    const budgets=node(document,'div',undefined,'agenda-budgets');const rounds=field(budgets,'최대 검토 라운드','roundBudget');rounds.type='number';rounds.min='2';rounds.value='3';const requests=field(budgets,'참여자 호출 한도 · 최종 검토 포함','requestBudget');requests.type='number';requests.min='1';requests.value='18';const timeout=field(budgets,'토론 시간(분)','timeoutMinutes');timeout.type='number';timeout.min='1';timeout.value='30';f.append(budgets);
    const reactiveBudgets=node(document,'details',undefined,'dialogue-advanced');reactiveBudgets.append(node(document,'summary','자율 대화 호출 한도'));const extra=node(document,'div',undefined,'agenda-budgets'),relevance=field(extra,'참여 판단 최대 호출','relevanceBudget'),chair=field(extra,'좌장 최대 호출','chairBudget');for(const [input,initial] of [[relevance,36],[chair,12]]){input.type='number';input.min='1';input.max='200';input.value=String(initial);}reactiveBudgets.append(extra,node(document,'p','참여하지 않기로 한 판단도 한 번의 호출로 셉니다. 한도는 이 안건에서만 사용해요.','setting-help'));f.append(reactiveBudgets,node(document,'p','이모지나 침묵은 동의로 세지 않고, 참여 세션의 최신 결론 검토를 받은 뒤 결과를 제안해요.','muted'));
    mode.onchange=()=>{const reactive=mode.value==='reactive';reactiveBudgets.hidden=!reactive;modeHelp.textContent=reactive?'새 발언·자료를 확인한 참여자가 발언하거나 이번에는 참여하지 않을 수 있어요. 좌장은 논점 충돌과 마무리를 맡아요.':'좌장이 조사·질문 대상을 고르고 답변을 모아 상호 검토를 요청해요.';};
    const message=node(document,'p','','form-error');f.append(message);const submit=actions(f,'토론 시작');f.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{const payload={title:title.value.trim(),body:body.value.trim(),goal:goal.value.trim(),completionCriteria:criteria.value.trim(),materialIds:[...f.querySelectorAll('[name=materials]:checked')].map(x=>x.value),targetMembershipIds:[...f.querySelectorAll('[name=participants]:checked')].map(x=>x.value),roundBudget:Number(rounds.value),requestBudget:Number(requests.value),timeoutSeconds:Number(timeout.value)*60,discussionMode:mode.value,...(mode.value==='reactive'?{relevanceBudget:Number(relevance.value),chairBudget:Number(chair.value)}:{})};const result=await request(endpoint('/agendas'),{method:'POST',body:JSON.stringify(payload)});activeId=value(result.agenda||result,'id','agendaId','agenda_id');d.close();await load();onChange?.();}catch(e){message.textContent=e.message;submit.disabled=false;}};d.showModal();title.focus();}
  function supplement(agendaId){const {d,f}=dialog('현재 안건 보완'),body=field(f,'추가할 내용','body','textarea'),message=node(document,'p','','form-error');f.append(message);const submit=actions(f,'보완 요청');f.onsubmit=async event=>{event.preventDefault();try{await act(agendaId,'supplement',{body:body.value.trim()});d.close();}catch(e){message.textContent=e.message;submit.disabled=false;}};d.showModal();body.focus();}
  async function showHistory(){
    if(!roomId)return;
    const origin=roomId,{d,f}=dialog('안건 이력');d.className='agenda-history-dialog';
    const intro=node(document,'p','이 토론장에서 진행한 안건과 결과를 다시 살펴봐요.','reader-subtitle');
    const controls=node(document,'div',undefined,'agenda-history-controls'),query=document.createElement('input'),filter=document.createElement('select');
    query.type='search';query.placeholder='안건 제목·목표 검색';query.setAttribute('aria-label','안건 이력 검색');filter.setAttribute('aria-label','안건 상태');
    for(const [id,title] of [['all','전체 안건'],['active','진행 중'],['completed','완료'],['cancelled','취소됨']]){const option=node(document,'option',title);option.value=id;filter.append(option);}
    controls.append(query,filter);const count=node(document,'p','','reader-count'),list=node(document,'div',undefined,'agenda-history-list');
    const footer=node(document,'footer',undefined,'reader-footer');footer.append(button('닫기',()=>d.close()));f.append(intro,controls,count,list,footer);
    function render(){
      if(roomId!==origin){d.close();return;}
      const q=query.value.trim().toLocaleLowerCase(),items=agendas.filter(item=>(filter.value==='all'||(filter.value==='active'?!['completed','cancelled'].includes(item.phase):item.phase===filter.value))&&`${item.title} ${item.goal||''}`.toLocaleLowerCase().includes(q));
      count.textContent=`전체 ${agendas.length}개 · ${items.length}개 표시`;list.replaceChildren();
      for(const item of items){
        const row=button('',async()=>{await showAgenda(item.id);});row.className='agenda-history-row';row.dataset.agendaId=item.id;
        const head=node(document,'span',undefined,'reader-row-head');head.append(node(document,'strong',item.title),node(document,'span',phaseLabel(item.phase),'agenda-phase'));
        const preview=(item.goal||agendaProse(item.summary)||'목표가 기록되지 않았어요.').replace(/\s+/g,' ').slice(0,180);
        row.append(head,node(document,'span',preview,'agenda-history-preview'),node(document,'small',`${outcomeLabel(item.outcome||(item.phase==='cancelled'?'cancelled':null))} · 결론 v${item.revision??'—'} · ${dateLabel(item.completed_at||item.created_at)}`));list.append(row);
      }
      if(!items.length)list.append(node(document,'div','조건에 맞는 안건이 없어요.','reader-empty'));
    }
    query.oninput=render;filter.onchange=render;render();d.showModal();query.focus();
  }
  async function showAgenda(id){try{
    const origin=roomId,agenda=await detail(id);if(roomId!==origin||!agenda)return;
    const {d,f}=dialog(agenda.title);d.className='agenda-detail-dialog reader-dialog';
    const heading=f.querySelector('h2'),header=node(document,'header',undefined,'reader-header');heading.id='agenda-result-title';d.setAttribute('aria-labelledby',heading.id);
    header.append(node(document,'p','DISCUSSION RESULT','reader-eyebrow'),heading);
    const meta=node(document,'div',undefined,'reader-badges');meta.append(node(document,'span',phaseLabel(agenda.phase),'agenda-phase'),node(document,'span',outcomeLabel(agenda.outcome||(agenda.phase==='cancelled'?'cancelled':null)),'agenda-outcome'),node(document,'span',`결론 v${agenda.revision??'—'}`),node(document,'span',dateLabel(agenda.completed_at||agenda.created_at)));header.append(meta);
    const tabs=node(document,'nav',undefined,'reader-tabs');tabs.setAttribute('aria-label','안건 결과 섹션');
    const content=node(document,'div',undefined,'agenda-reader-content'),panels=new Map();
    for(const [key,label] of [['summary','결론·검토'],['evidence',`논거 · ${agenda.arguments.length}`],['activity','진행 기록']]){
      const panel=node(document,'section',undefined,'agenda-reader-panel');panel.dataset.section=key;panel.setAttribute('aria-label',label);panel.hidden=key!=='summary';panels.set(key,panel);
      const tab=button(label,()=>{for(const [name,view] of panels)view.hidden=name!==key;for(const item of tabs.children)item.setAttribute('aria-pressed',String(item===tab));content.scrollTop=0;});tab.setAttribute('aria-pressed',String(key==='summary'));tabs.append(tab);content.append(panel);
    }
    f.replaceChildren(header,tabs,content);
    const room=current(),referenceOptions={roomId:origin,mentions:(room?.members||[]).map(m=>m.alias),references:createReferenceMap(room?.members||[],room?.messages||[])};
    f.addEventListener('click',event=>{if(d.open&&event.target.closest?.('a[href^="#message-"]'))d.close();});
    const members=new Map((room?.members||[]).flatMap(member=>[[member.id,member],[member.session_id,member]])),memberName=id=>members.get(id)?.alias||members.get(id)?.display_name||'참여 세션';
    const prose=(text,cls='rich-body')=>{const body=node(document,'div',undefined,cls);body.append(renderMarkdown(agendaProse(text),referenceOptions));return body;};
    function section(parent,title,caption){const card=node(document,'section',undefined,'agenda-reader-card');card.append(node(document,'h3',title));if(caption)card.append(node(document,'p',caption,'reader-subtitle'));parent.append(card);return card;}
    function linkSources(row,ids){
      if(!Array.isArray(ids)||!ids.length)return;
      const sources=node(document,'div',undefined,'agenda-sources');for(const id of ids){
        const message=(room?.messages||[]).find(m=>m.id===id),link=node(document,'a',message?`${memberName(message.sender_session_id)}의 발언`:'연결 자료');
        link.href=message?'#message-'+id:'#knowledge-'+id;link.onclick=event=>{d.close();if(!message){event.preventDefault();knowledge(id);}};sources.append(link);
      }row.append(sources);
    }
    const referenceCopy=button('참조 링크·에이전트 복사',()=>{const room=current();return showReferenceDialog({document,location:globalThis.location,request,target:{channel:room?.channel_id?{id:room.channel_id,name:room.channel_name||'채널'}:null,room,agenda},onError:error});});
    const summary=panels.get('summary'),result=section(summary,'좌장 최종 정리');result.classList.add('agenda-conclusion-card');result.append(referenceCopy,prose(agenda.summary||'아직 결론이 정리되지 않았어요.','rich-body agenda-result-body'));
    if(agenda.goal){const goal=node(document,'details',undefined,'agenda-context');goal.append(node(document,'summary','안건 목표와 완료 기준'),prose(agenda.goal));const criteria=agenda.completionCriteria;if(criteria?.length)goal.append(prose(Array.isArray(criteria)?criteria.map(x=>'- '+x).join('\n'):criteria));result.append(goal);}
    const reviews=section(summary,'참여자 검토',`최신 결론 v${agenda.revision??'—'}의 입장과 이전 검토를 구분해요.`),reviewList=node(document,'div',undefined,'agenda-review-list');reviews.append(reviewList);
    const latest=agenda.rounds.filter(r=>r.stage==='review').at(-1),expected=latest?.targetSnapshot||agenda.participants;
    for(const item of agenda.reviews){
      const row=node(document,'article',undefined,'agenda-review-card'),isCurrent=value(item,'conclusion_revision','conclusionRevision')===agenda.revision,head=node(document,'div',undefined,'reader-row-head');
      head.append(node(document,'strong',memberName(value(item,'membership_id','membershipId'))),node(document,'span',stanceLabel(item.stance),'agenda-stance'));row.append(head,node(document,'small',`결론 v${value(item,'conclusion_revision','conclusionRevision')??'—'} · ${isCurrent?'현재 결론 검토':'이전 결론 검토'}`),prose(item.body||''));linkSources(row,[...(item.sourceIds||item.source_ids||[]),...(item.reply_message_id?[item.reply_message_id]:[])]);renderAttachments?.(item.attachments,row);reviewList.append(row);
    }
    for(const id of expected)if(!agenda.reviews.some(r=>value(r,'membership_id','membershipId')===id&&value(r,'conclusion_revision','conclusionRevision')===agenda.revision))reviewList.append(node(document,'p',`${memberName(id)} · 현재 결론 미응답`,'reader-pending'));
    if(!reviewList.childNodes.length)reviewList.append(node(document,'p','아직 검토 기록이 없어요.','reader-empty'));
    const evidence=section(panels.get('evidence'),'주요 논거','발언의 근거와 원문을 함께 확인해요.');
    if(!agenda.arguments.length)evidence.append(node(document,'p','아직 등록된 논거가 없어요.','reader-empty'));
    for(const item of agenda.arguments){const row=node(document,'article',undefined,'agenda-evidence-card');row.append(node(document,'h4',memberName(value(item,'membership_id','membershipId','author','sender_session_id'))),prose(value(item,'body','summary')||''));linkSources(row,[...(item.sourceIds||item.source_ids||[]),...(item.id?[item.id]:[])]);renderAttachments?.(item.attachments,row);evidence.append(row);}
    const activity=panels.get('activity'),rounds=section(activity,'토론 라운드');
    if(!agenda.rounds.length)rounds.append(node(document,'p','아직 라운드 기록이 없어요.','reader-empty'));
    for(const round of agenda.rounds){const row=node(document,'article',undefined,'agenda-round-row');row.append(node(document,'strong',String(round.ordinal??'—'),'agenda-round-number'),node(document,'span',({review:'상호 검토',evidence:'조사·논거 수집'}[round.stage]||phaseLabel(round.stage))),node(document,'small',`결론 v${round.conclusion_revision??'—'} · ${round.closed_at?'종료':'진행 중'}`));rounds.append(row);}
    const reactive=renderReactiveDetails(document,agenda,members);if(reactive){reactive.classList.add('agenda-reader-card');if(!['completed','cancelled','paused'].includes(agenda.phase)){const controls=node(document,'div',undefined,'agenda-actions');controls.append(button('좌장에게 중재 요청',()=>intervene(agenda,[],d)),button('발언 마무리 요청',()=>intervene(agenda,null,d)));reactive.append(controls);}activity.append(reactive);}
    const delivery=section(activity,'승인 결과 공유',agenda.notices.length?'참여 세션별 전달·수신 확인 현황이에요.':'아직 승인 결과를 공유하지 않았어요.');for(const item of agenda.notices){const row=node(document,'article',undefined,'agenda-round-row');row.append(node(document,'strong',memberName(item.membership_id)),node(document,'span',noticeLabel(item.status),'notice-state'));delivery.append(row);}
    const footer=node(document,'footer',undefined,'reader-footer');footer.append(node(document,'p','결과 승인은 참여 세션에 공유되며, 후속 작업을 시작하지 않아요.','reader-subtitle'));
    if(agenda.phase==='completed'&&['consensus','qualified'].includes(agenda.outcome)&&agenda.revision!==undefined){const approve=button(agenda.notices.length?'공유 상태 새로고침':'결과 승인 및 공유',async()=>{await act(agenda.id,'approve',{revision:agenda.revision});d.close();await showAgenda(agenda.id);});approve.className='accent';footer.append(approve);}
    footer.append(button('닫기',()=>d.close()));f.append(footer);d.showModal();heading.tabIndex=-1;heading.focus();content.scrollTop=0;
  }catch(e){error(e.message);}}
  function intervene(agenda,targets,parent){const yielding=targets===null,{d,f}=dialog(yielding?'발언 마무리 요청':'좌장에게 중재 요청');d.className='agenda-dialog';f.append(node(document,'p',yielding?'선택한 세션의 새 발언을 보류하고 현재 응답의 마무리를 기다려요. 실행이 즉시 멈추는 기능은 아니에요.':'좌장이 쟁점과 대화 흐름을 읽고 필요한 대상에게 중재해요.','setting-help'));const reason=field(f,'요청 이유','reason','textarea');reason.maxLength=800;
    if(yielding){const choices=node(document,'fieldset',undefined,'agenda-participants');choices.append(node(document,'legend','마무리할 참여 세션'));for(const member of current()?.members||[]){if(!agenda.participants.includes(member.id)||member.left_at||member.read_only)continue;const label=node(document,'label',undefined,'checkbox-row'),check=document.createElement('input');check.type='checkbox';check.name='yieldTargets';check.value=member.id;label.append(check,document.createTextNode(' '+(member.alias||member.display_name||member.id)));choices.append(label);}f.append(choices);}
    const message=node(document,'p','','form-error');f.append(message);const submit=actions(f,'요청');f.onsubmit=async event=>{event.preventDefault();const targetMembershipIds=yielding?[...f.querySelectorAll('[name=yieldTargets]:checked')].map(x=>x.value):[];if(yielding&&!targetMembershipIds.length){message.textContent='마무리를 요청할 참여 세션을 골라줘.';return;}if(!reason.value.trim()){message.textContent='중재 또는 마무리가 필요한 이유를 적어줘.';return;}submit.disabled=true;try{await act(agenda.id,'intervene',{targetMembershipIds,reason:reason.value.trim()});d.close();parent?.close();await showAgenda(agenda.id);}catch(e){message.textContent=e.message;submit.disabled=false;}};d.showModal();reason.focus();}
  async function settings(){const {d,f}=dialog('앱 설정'),path=field(f,'자료·지식 저장 루트','storageRoot'),message=node(document,'p','','form-error');path.placeholder='D:\\inter_session_debate';try{const settings=await request('/api/settings');path.value=settings.storageRoot||settings.storage_root||'D:\\inter_session_debate';}catch(e){message.textContent=e.message;}f.append(message);const submit=actions(f,'저장');f.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{await request('/api/settings',{method:'POST',body:JSON.stringify({storageRoot:path.value.trim()})});d.close();}catch(e){message.textContent=e.message;submit.disabled=false;}};d.showModal();}
  async function knowledge(initialId=null){
    if(!roomId)return;const origin=roomId,{d,f}=dialog('자료·지식');d.className='knowledge-dialog reader-dialog';
    const heading=f.querySelector('h2'),header=node(document,'header',undefined,'reader-header');header.append(node(document,'p','KNOWLEDGE LIBRARY','reader-eyebrow'),heading,node(document,'p','채널의 자료와 토론에서 쌓인 논거·결론을 탐색해요.','reader-subtitle'));
    const controls=node(document,'div',undefined,'knowledge-controls'),scope=document.createElement('select'),kind=document.createElement('select'),status=document.createElement('select'),query=document.createElement('input');
    for(const [v,l] of [['all','현재 채널'],['room','현재 토론장'],['channel','채널 공용']]){const o=node(document,'option',l);o.value=v;scope.append(o);}scope.value=knowledgeScope;scope.setAttribute('aria-label','자료 범위');
    for(const [v,l] of [['','전체 종류'],['source','자료'],['argument','논거'],['consensus','합의']]){const o=node(document,'option',l);o.value=v;kind.append(o);}kind.value=knowledgeKind;kind.setAttribute('aria-label','자료 종류');
    for(const [v,l] of [['','전체 상태'],['draft','초안'],['published','게시됨'],['archived','보관됨']]){const o=node(document,'option',l);o.value=v;status.append(o);}status.value=knowledgeStatus;status.setAttribute('aria-label','자료 상태');
    query.type='search';query.placeholder='제목·본문 검색';query.setAttribute('aria-label','자료 검색');query.value=knowledgeQuery;controls.append(scope,kind,status,query);
    const list=node(document,'div',undefined,'knowledge-list');list.setAttribute('aria-label','자료 목록');const detail=node(document,'article',undefined,'knowledge-detail');detail.setAttribute('aria-label','선택한 자료');
    const split=node(document,'div',undefined,'knowledge-split'),footer=node(document,'footer',undefined,'reader-footer'),count=node(document,'p','','reader-subtitle');split.append(list,detail);
    const add=button('자료 추가',()=>addKnowledge(reload));add.className='accent';footer.append(count,add,button('닫기',()=>d.close()));f.replaceChildren(header,controls,split,footer);
    let timer,selectedId=null,listVersion=0,detailVersion=0,closed=false;
    const valid=()=>!closed&&roomId===origin;
    const empty=()=>detail.replaceChildren(node(document,'div','목록에서 자료를 선택해 주세요.','reader-empty'));
    function markSelected(){for(const row of list.querySelectorAll('.knowledge-row')){const selected=row.dataset.knowledgeId===selectedId;row.classList.toggle('selected',selected);row.setAttribute('aria-pressed',String(selected));}}
    function itemRow(item){const row=button('',()=>openItem(item.id));row.className='knowledge-row';row.dataset.knowledgeId=item.id;row.append(node(document,'strong',item.title||'제목 없는 항목'),node(document,'small',`${({source:'자료',argument:'논거',consensus:'합의'}[item.kind]||'자료')} · ${({draft:'초안',published:'게시됨',archived:'보관됨'}[item.status]||'초안')} · v${item.revision??'—'}`));return row;}
    async function reload(){
      const version=++listVersion;++detailVersion;selectedId=selectedId||null;
      knowledgeScope=scope.value;knowledgeKind=kind.value;knowledgeStatus=status.value;knowledgeQuery=query.value;
      list.replaceChildren(node(document,'p','불러오는 중…','muted'));detail.replaceChildren(node(document,'p','자료 목록을 불러오는 중…','muted'));
      try{
        const params=new URLSearchParams({scope:knowledgeScope});if(knowledgeKind)params.set('kind',knowledgeKind);if(knowledgeQuery.trim())params.set('query',knowledgeQuery.trim());
        const result=await request(`/api/rooms/${origin}/knowledge?`+params);if(!valid()||version!==listVersion)return;
        const items=(result.items||[]).filter(item=>!knowledgeStatus||item.status===knowledgeStatus);list.replaceChildren();count.textContent=`자료 ${items.length}개`;
        for(const item of items)list.append(itemRow(item));
        if(!items.length&&typeof initialId!=='string'){selectedId=null;list.append(node(document,'p','조건에 맞는 자료가 없습니다.','reader-empty'));empty();return;}
        const id=typeof initialId==='string'?initialId:items.some(item=>item.id===selectedId)?selectedId:items[0].id;
        initialId=null;await openItem(id);
      }catch(e){if(valid()&&version===listVersion){list.replaceChildren(node(document,'p',e.message,'form-error'));selectedId=null;empty();}}
    }
    async function openItem(id){
      const version=++detailVersion;selectedId=id;markSelected();detail.scrollTop=0;detail.setAttribute('aria-busy','true');detail.replaceChildren(node(document,'p','자료를 불러오는 중…','muted'));
      try{
        const response=await request(`/api/rooms/${origin}/knowledge/${id}`);if(!valid()||version!==detailVersion)return;
        const item=response.item||response;
        if(![...list.querySelectorAll('.knowledge-row')].some(row=>row.dataset.knowledgeId===id)){list.querySelector('.reader-empty')?.remove();list.append(itemRow({...item,id}));markSelected();count.textContent=`자료 ${list.querySelectorAll('.knowledge-row').length}개 · 연결 자료 포함`;}
        detail.replaceChildren(node(document,'p',`${({source:'자료',argument:'논거',consensus:'합의'}[item.kind]||'자료')} · ${({draft:'초안',published:'게시됨',archived:'보관됨'}[item.status]||'초안')} · v${item.revision??'—'}`,'reader-eyebrow'),node(document,'h3',item.title||'제목 없는 항목'));
        const body=node(document,'div',undefined,'rich-body');body.append(renderMarkdown(item.body||'',{roomId:origin,mentions:(current()?.members||[]).map(m=>m.alias),references:createReferenceMap(current()?.members||[],current()?.messages||[])}));detail.append(body);
        const citations=item.citations||[];for(const citation of citations){const href=safeUrl(typeof citation==='string'?citation:citation.url);if(href){const link=node(document,'a',(typeof citation==='object'&&citation.title)||'인용 원문');link.href=href;link.target='_blank';link.rel='noopener noreferrer';detail.append(link);}}
        const sourceIds=item.sourceIds||item.source_ids||item.links;if(sourceIds?.length){const links=node(document,'div',undefined,'knowledge-links');for(const sourceId of sourceIds){const link=node(document,'a',`연결 자료 ${String(sourceId).slice(0,8)}`);link.href='#knowledge-'+sourceId;link.onclick=event=>{event.preventDefault();openItem(sourceId);};links.append(link);}detail.append(links);}
      }catch(e){if(valid()&&version===detailVersion)detail.replaceChildren(node(document,'p',e.message,'form-error'));}
      finally{if(valid()&&version===detailVersion)detail.setAttribute('aria-busy','false');}
    }
    scope.onchange=reload;kind.onchange=reload;status.onchange=reload;query.oninput=()=>{clearTimeout(timer);timer=setTimeout(reload,180);};
    d.addEventListener('close',()=>{closed=true;clearTimeout(timer);});d.showModal();await reload();
  }
  function addKnowledge(done){const {d,f}=dialog('자료 추가'),kind=document.createElement('select');for(const [v,l] of [['source','자료'],['argument','논거'],['consensus','합의']]){const o=node(document,'option',l);o.value=v;kind.append(o);}const kindLabel=node(document,'label','종류');kindLabel.append(kind);f.append(kindLabel);const title=field(f,'제목','title'),body=field(f,'본문','body','textarea'),url=field(f,'원문 URL (선택)','url'),publish=node(document,'label',undefined,'checkbox-row'),publishInput=document.createElement('input'),message=node(document,'p','','form-error');publishInput.type='checkbox';publish.append(publishInput,document.createTextNode(' 채널 공용으로 게시'));url.required=false;f.append(publish,message);const submit=actions(f,'저장');f.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{const payload={kind:kind.value,title:title.value.trim(),body:body.value.trim(),published:publishInput.checked};const href=safeUrl(url.value.trim());if(url.value.trim()&&!href)throw new Error('http(s) URL만 연결할 수 있습니다.');if(href)payload.url=href;await request(endpoint('/knowledge'),{method:'POST',body:JSON.stringify(payload)});d.close();await done();}catch(e){message.textContent=e.message;submit.disabled=false;}};d.showModal();title.focus();}
  return {setRoom:async id=>{roomId=id;await load();},start,settings,knowledge,refresh:load,open:showAgenda};
}
