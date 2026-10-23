import {parseAliases, mentionAt, mentionSpans, ALL_MENTION, resolveMentionTargets} from '/mentions.js';
import {createApiClient} from '/api-client.js';
import {initLayout,mentionMenuGeometry} from '/layout.js';
import {marked} from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import {createRenderer,createMentionInput} from '/rich-text.js';
import {createAttachmentComposer} from '/attachments.js';
let current, rooms=[], channels=[], pendingSend, selectedRoomId;const draftBodies=new Map();const stateLabel={queued:'요청 대기',claimed:'전달 예약',submitting:'요청 제공 중',accepted:'호스트 접수',running:'생성 중',completed:'응답 회수',unknown:'확인 필요',blocked:'차단',failed:'실패',cancelled:'취소'}; const $=s=>document.querySelector(s);
const connection=document.createElement('div');connection.id='connection';connection.setAttribute('role','status');connection.hidden=true;$('#error').before(connection);
const api=createApiClient({onConnection:state=>{connection.hidden=state==='online';connection.textContent=state==='offline'?'연결 끊김 · 입력은 보존돼. 로컬 서버가 돌아오면 자동으로 다시 연결할게.':state==='reconnecting'?'로컬 서버에 다시 연결하는 중…':'';}});
const req=api.request;
const renderMarkdown=createRenderer({parse:source=>marked.parse(source,{gfm:true,breaks:true}),sanitize:DOMPurify.sanitize.bind(DOMPurify)});
const text=(tag,value,cls)=>{const x=document.createElement(tag);x.textContent=value;if(cls)x.className=cls;return x};
function error(value=''){const e=$('#error');e.textContent=value;e.hidden=!value}
function active(){return current&&!current.archived_at}
function renameButton(label,onClick){
 const button=text('button','','rename-link rename-icon');button.type='button';button.title=label;button.setAttribute('aria-label',label);button.onclick=onClick;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
 path.setAttribute('d','m16 4 4 4M4 16 16 4a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5Z');svg.append(path);button.append(svg);return button;
}
function renderNav(){
 const nav=$('#rooms');nav.replaceChildren();
 const groups=[...channels.map(c=>[c,rooms.filter(r=>r.channel_id===c.id)]),[{name:'채널 없음'},rooms.filter(r=>!r.channel_id)]];
 for(const [channel,list] of groups){
  if(!list.length&&!channel.id)continue;
  const heading=text('div','','channel-label');heading.append(text('span','# '+channel.name,'nav-label'));
  if(channel.id){heading.dataset.channelId=channel.id;heading.append(renameButton(channel.name+' 채널 이름 변경',()=>renameDialog('channel',channel)));}
  nav.append(heading);
  for(const room of list){
   const selected=current?.id===room.id,row=text('div','','room-nav-row'+(selected?' active':''));row.dataset.roomId=room.id;
   const button=text('button',(room.archived_at?'⌁ ':'# ')+room.name,'room-link'+(selected?' active':''));button.type='button';button.onclick=()=>openRoom(room.id);
   if(selected)button.setAttribute('aria-current','page');
   row.append(button,renameButton(room.name+' 토론장 이름 변경',()=>renameDialog('room',room)));nav.append(row);
  }
 }
 const select=$('#channelChoice'),empty=text('option','채널 없음');empty.value='';select.replaceChildren(empty);
 for(const c of channels){const option=text('option',c.name);option.value=c.id;select.append(option);}
}
async function refresh(keep=true){const [rs,cs]=await Promise.all([req('/api/rooms'),req('/api/channels')]);rooms=rs.rooms;channels=cs.channels;renderNav();if(keep&&current){const found=rooms.find(r=>r.id===current.id);if(found)await openRoom(found.id,false)}}
function deliveryText(message){
 const ds=current.deliveries.filter(d=>d.message_id===message.id);if(!ds.length)return null;
 const wrap=document.createElement('div');wrap.className='delivery-list';
 for(const d of ds){
  const m=current.members.find(x=>x.id===d.membership_id);
  const badge=text('span',`${m?.alias||m?.display_name||m?.native_id||'수신자'} · ${stateLabel[d.state]||d.state}`,'badge '+d.state);
  badge.title=`요청: ${d.request_id}${d.blocked_reason?'\n사유: '+d.blocked_reason:''}`;wrap.append(badge);
  if(d.blocked_reason)wrap.append(text('span',d.blocked_reason,'delivery-reason'));
  if((d.kind==='followup'||message.kind==='followup')&&d.state!=='completed'){
   const retry=text('button',d.state==='unknown'||d.state==='accepted'||d.state==='running'?'수신 확인':'다시 전달','delivery-retry');retry.type='button';
   retry.title=['accepted','running','unknown'].includes(d.state)?'이미 접수되었을 수 있어 실행하지 않고 수신 상태만 다시 확인해.':'동일 요청을 안전하게 다시 전달해.';
   retry.onclick=async()=>{retry.disabled=true;try{const result=await req(`/api/rooms/${current.id}/deliveries/${d.id}/retry`,{method:'POST',body:'{}'});if(result.message||result.error)error(result.error||result.message);await openRoom(current.id,false);}catch(e){error(e.message);retry.disabled=false;}};
   wrap.append(retry);
  }
 }
 return wrap;
}

let timelineSignature;
function renderTimeline() {
  renderReactionRoster();
  const signature=JSON.stringify([current.id,current.messages,current.deliveries,current.reactions,current.members.map(m=>[m.session_id,m.alias,m.avatar,m.provider])]);
  if(signature===timelineSignature)return;timelineSignature=signature;
  const view=$('#timeline'); view.replaceChildren();
  if(!current.messages.length) {view.append(text('div','@별칭으로 질문하거나, 게시로 대화의 맥락을 남겨보세요.','empty'));return;}
  for(const m of current.messages) {
    const card=document.createElement('section');card.className='message';card.id='message-'+m.id;
    const author=current.members.find(x=>x.session_id===m.sender_session_id);
    const speaker=m.sender_role||(!m.sender_session_id?'user':'member');
    card.classList.add(speaker==='user'?'message-user':speaker==='chair'?'message-chair':'message-member');
    if(author&&speaker!=='user')applySessionColor(card,author);
    const head=text('div','','message-head');
    head.append(author?avatar(author):text('span',speaker==='system'?'↻':'나','avatar human'));
    head.append(text('strong',author?memberName(author):speaker==='system'?'조율 서비스':'사용자','message-author'));
    if(author)head.append(text('span',providerName(author),'provider-badge'));
    if(speaker==='chair')head.append(text('span','좌장','speaker-role'));
    const body=text('div','','rich-body');
    body.append(renderMarkdown(m.body,{roomId:current.id,mentions:[ALL_MENTION,...current.members.map(member=>member.alias)]}));
    card.append(head,body);
    renderAttachments(m.attachments,card);
    const meta=text('div',`${m.kind} · ${new Date(m.created_at).toLocaleString('ko-KR')}`,'message-meta');
    if(m.reply_to){const a=text('a','원문 보기');a.href='#message-'+m.reply_to;meta.append(document.createTextNode(' · '),a);}
    if(m.decision_id){const a=text('a','결정 제안 보기');a.href='#decision-'+m.decision_id;a.onclick=()=>{const target=document.getElementById('decision-'+m.decision_id);const history=target?.closest('details');if(history)history.open=true;};meta.append(document.createTextNode(' · '),a);}
    card.append(meta);const ds=deliveryText(m);if(ds)card.append(ds);
    renderReactions(m,card);view.append(card);
  }
}
function renderAttachments(attachments,card){
  if(!attachments?.length)return;
  const list=text('div','','shared-attachments');
  for(const attachment of attachments){
    const path=`/api/rooms/${current.id}/attachments/${attachment.id}`;
    const item=text('div','','shared-attachment');
    if(/^image\//.test(attachment.mime||'')){const image=document.createElement('img');image.src=path;image.alt=attachment.filename;image.loading='lazy';item.append(image);}
    const link=text('a',attachment.filename||'첨부 파일');link.href=path+'?download=1';link.download=attachment.filename||'';link.title='다운로드';item.append(link,text('small',formatBytes(attachment.size||0)));list.append(item);
  }card.append(list);
}
const formatBytes=size=>size<1024?size+' B':size<1048576?Math.ceil(size/1024)+' KiB':(size/1048576).toFixed(1)+' MiB';

function renderParticipants() {
  const area=$('#participants'),chairArea=$('#chairProfile');area.replaceChildren();chairArea.replaceChildren();
  for(const m of current.members) {
    const deliveries=current.deliveries.filter(d=>d.membership_id===m.id&&['followup','steer'].includes(d.kind));
    const state=['running','unknown','submitting','accepted','claimed','queued','blocked'].find(state=>deliveries.some(d=>d.state===state));
    const b=text('button','','participant'+(state==='running'?' generating':''));
    applySessionColor(b,m);
    b.disabled=!!m.left_at;b.dataset.state=state||'idle';
    const identity=text('span','','participant-identity'),name=text('span','','participant-name');name.append(text('strong',memberName(m)),text('span',providerName(m)+(m.role==='chair'?' · 좌장':''),'provider-badge'));identity.append(avatar(m),name);
    b.append(identity);
    const ownedChair=current.chair?.session_id===m.session_id;
    b.append(text('span',m.left_at?'이탈':ownedChair&&current.chair.status!=='ready'?chairStatus(current.chair.status):m.read_only?'읽기 전용':state?stateLabel[state]:ownedChair?'별도 좌장 · 자동 응답':'참여 중 · 협력 연결',state==='unknown'||m.read_only?'blocked':'ok'));
    b.title=`${m.display_name||''}\n${m.provider} · ${m.mode}`;
    b.onclick=()=>{$('.inspector').classList.add('open');detailToggle.setAttribute('aria-expanded','true');const detail=$('#memberDetail'),capabilities=typeof m.capabilities==='string'?JSON.parse(m.capabilities||'{}'):(m.capabilities||{});detail.replaceChildren(text('strong',memberName(m)),text('div',`원래 이름: ${m.display_name||'없음'}\nNative ID: ${m.native_id}\nCWD: ${m.cwd}\n연결 모드: ${m.mode}\n소유: ${m.ownership}\n정책: ${m.policy_revision||'관측 불가'}\n상태: ${m.blocked_reason||'사용자가 확인한 참여 정보'}`,'detail'));const raw=text('button','원래 세션 출력 보기');raw.disabled=capabilities.rawInspect!==true;raw.title=raw.disabled?'이 참여자에 원래 출력 조회가 허용되지 않았어.':'';raw.onclick=async()=>{try{const r=await req(`/api/rooms/${current.id}/sessions/${m.session_id}/output`);detail.replaceChildren(text('p',r.warning||'선택한 출력입니다.','muted'),text('pre',(r.lines||[]).join('\n'),'detail'))}catch(e){error(e.message)}};detail.append(raw);const canAutomate=m.mode==='live_attach'&&m.handle&&m.incarnation;if(canAutomate){const automatic=memberButton(capabilities.automaticInput?'자동 전달 해제':'자동 전달 연결',async()=>{const result=await req(`/api/rooms/${current.id}/sessions/${m.session_id}/automation`,{method:'POST',body:JSON.stringify({enabled:!capabilities.automaticInput})});if(result.message||result.error)error(result.error||result.message);await openRoom(current.id,false);});automatic.title=capabilities.automaticInput?'이 세션의 새 자동 전달을 끄고 협력 연결은 유지해.':'확인된 현재 세션에만 새 자동 전달을 허용해.';detail.append(automatic);}else if(m.mode==='live_attach')detail.append(text('p','자동 전달은 이 대화 ID·작업 폴더에 정확히 연결된 현재 세션을 확인한 뒤에만 허용할 수 있어.','muted'));if(ownedChair){detail.append(text('p',current.chair.error||'이 토론장만 맡는 별도 세션이야. 초대한 참여자와 다른 대화 ID로 이어가.','muted'));for(const run of current.chair_runs||[]){if(run.status==='unknown'){detail.append(text('p','결과 확인 필요 · '+(run.error||'응답 접수 여부 미확인'),'form-error'));if(run.output_json)detail.append(memberButton('저장된 결과 적용',async()=>{await req(`/api/rooms/${current.id}/chair/reconcile`,{method:'POST',body:JSON.stringify({runId:run.id})});await openRoom(current.id,false);detail.replaceChildren(text('p','저장된 결과를 적용했어. 모델을 다시 실행하지 않았어.'));}));}}}else{detail.append(memberButton('참여 정보 발급',()=>provision(m)),memberButton('토론에서 빼기',()=>leaveMember(m)));}};(ownedChair?chairArea:area).append(b);
  }
  if(!chairArea.children.length)chairArea.append(text('p',current.chair?chairStatus(current.chair.status):'별도 좌장을 만들어줘.','muted'));
  if(!area.children.length)area.append(text('p','함께 논의할 세션을 초대해줘.','muted'));
}
let decisionSignature;
function renderDecisions(){
  const signature=JSON.stringify([current.id,current.decisions]);if(signature===decisionSignature)return;decisionSignature=signature;
  const box=$('#decisions');box.replaceChildren();
  $('#summaryStatus').textContent=current.decisions.length?'최신 정리 · '+current.decisions.length+'건':'';
  if(!current.decisions.length){box.append(text('p','좌장에게 취합을 요청하면 이곳에 정리가 쌓여.','muted'));return;}
  const decisions=[...current.decisions].sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
  const render=d=>{
    const item=text('article','','decision');item.id='decision-'+d.id;
    const body=text('div','','decision-body rich-body');body.tabIndex=0;body.setAttribute('aria-label','토론 정리 내용');body.append(renderMarkdown(d.body,{roomId:current.id,mentions:[ALL_MENTION,...current.members.map(member=>member.alias)]}));item.append(body);
    renderAttachments(d.attachments,item);
    const footer=text('div','','decision-footer'),owner=current.members.find(m=>m.session_id===d.owner);
    footer.append(text('small',(d.status==='confirmed'?'사용자 확정':'미확정 제안')+(owner?' · '+memberName(owner):'')));
    const sourceIds=(d.source_ids||'').split(',').filter(Boolean);
    if(sourceIds.length){const sources=document.createElement('details');sources.className='decision-sources';sources.append(text('summary','근거 '+sourceIds.length+'개'));for(const [index,id] of sourceIds.entries()){const link=text('a','원문 '+(index+1));link.href='#message-'+id;sources.append(link);}footer.append(sources);}
    if(d.status==='proposed')footer.append(memberButton('사용자 확정',async()=>{await req(`/api/rooms/${current.id}/decisions/${d.id}/confirm`,{method:'POST',body:'{}'});await openRoom(current.id,false);}));
    item.append(footer);return item;
  };
  box.append(render(decisions[0]));
  if(decisions.length>1){const history=document.createElement('details');history.className='decision-history';history.append(text('summary','이전 정리 '+(decisions.length-1)+'건'));for(const d of decisions.slice(1))history.append(render(d));box.append(history);}
}
async function openRoom(id,scroll=true){
 try{
  if(current?.id!==id)closeMentionMenu();
  const timeline=$('#timeline'),follow=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<60;
  if(scroll)selectedRoomId=id;
  const previousId=current?.id,view=await req('/api/rooms/'+id);
  if(id!==selectedRoomId)return;
  if(previousId&&previousId!==id)draftBodies.set(previousId,$('#body').value);
  current=view;attachmentComposer.setRoom(current.id);
  if(previousId!==current.id)$('#body').value=draftBodies.get(current.id)||'';
  $('#title').textContent=current.name+(current.archived_at?' · 보관됨':current.paused_at?' · 중지됨':'');$('#pause').textContent=current.paused_at?'재개':'중지';$('#pause').disabled=!active();$('#archive').disabled=!active();renderNav();renderParticipants();renderTimeline();renderDecisions();renderMentionMenu();updateRoomControls();renderChairControl();loadWorkspace(current.id);if(scroll||follow)$('#timeline').scrollTop=$('#timeline').scrollHeight;
 }catch(e){if(e.code!=='NETWORK_UNCERTAIN')error(e.message)}
}

async function loadWorkspace(roomId=current?.id){
 if(!roomId)return;
 const detail=$('#workspaceDetail');
 try{
  const workspace=await req(`/api/rooms/${roomId}/workspace`);if(current?.id!==roomId)return;
  detail.replaceChildren(text('p',workspace.cwd||current.cwd||'작업 폴더를 설정해줘.','detail'));
  if(workspace.artifactDir)detail.append(text('p','자료 폴더: '+workspace.artifactDir,'detail'));
  if(workspace.error)detail.append(text('p',workspace.error,'form-error'));
  const files=workspace.files||[];
  if(files.length){const list=document.createElement('ul');list.className='workspace-files';for(const file of files)list.append(text('li',`${file.name} · ${formatBytes(file.size||0)}${file.kind?' · '+file.kind:''}`));detail.append(list);}
 }catch(e){if(current?.id===roomId)detail.replaceChildren(text('p',e.message,'form-error'));}
}
async function workspaceDialog(){
 if(!current)return;const {d,f}=dialog('토론장 작업 공간');
 const cwd=inputField(f,'작업 폴더','cwd',current.cwd||'');cwd.required=false;
 const note=text('p','좌장·합의·자료는 이 토론장의 작업 공간에 함께 보관돼. 기존의 관련 없는 파일은 덮어쓰지 않아.','muted');
 const message=text('p','','form-error'),exportButton=memberButton('기록과 자료 내보내기',async()=>{message.textContent='내보내는 중…';const result=await req(`/api/rooms/${current.id}/workspace/export`,{method:'POST',body:'{}'});message.textContent=result.message||result.error||'내보냈어.';await loadWorkspace(current.id);});
 f.append(note,exportButton,message);actions(f,'작업 폴더 저장');
 f.onsubmit=async event=>{event.preventDefault();try{const result=await req(`/api/rooms/${current.id}/workspace`,{method:'POST',body:JSON.stringify({cwd:cwd.value.trim()})});current.cwd=result.cwd||cwd.value.trim();d.close();await loadWorkspace(current.id);}catch(e){message.textContent=e.message;}};
 d.showModal();
}

const memberName=m=>m?.alias||m?.display_name||'참여자';
const providerName=m=>({codex:'Codex',claude:'Claude'}[m.provider]||m.provider);
const sessionColor=member=>/^#[0-9a-f]{6}$/i.test(member?.avatar||'')?member.avatar:'#6479c9';
function applySessionColor(node,member){node.classList.add('session-colored');node.style.setProperty('--session-color',sessionColor(member));}
function avatar(member) {
  const node=text('span',memberName(member).slice(0,1),'avatar');
  const color=sessionColor(member);
  node.style.setProperty('--avatar',color);node.setAttribute('aria-hidden','true');
  const wrap=text('span','','avatar-with-provider');wrap.append(node);
  if(['codex','claude','antigravity'].includes(member.provider)){const icon=document.createElement('img');icon.className='provider-icon';icon.src='/assets/providers/'+member.provider+'.png';icon.alt=providerName(member)+' 아이콘';icon.title=providerName(member);wrap.append(icon);}
  return wrap;
}
const reactionTypes=[
 ['👍','좋아요','답변에 대한 긍정 평가예요. 결정 확정은 아니에요.'],
 ['👎','반대','구체적인 근거가 없으면 다음 입력에서 반대 이유를 확인해요.'],
 ['❓','모르겠음','어려운 지점을 확인하고 설명을 보완할 신호예요.'],
 ['✅','확인(알았음)','내용을 받았거나 이해했어요. 동의·작업 완료와는 달라요.'],
 ['💡','아이디어 있음','구체적인 내용이 없으면 다음 입력에서 반응한 사람에게 아이디어를 물어요.'],
 ['❤️','공감','기존 공감 반응이에요. 긍정적인 의견으로 보존해요.',true],
 ['👀','확인 중','기존 확인 중 반응이에요. 이해했다는 확인과는 달라요.',true]
];
let reactionRosterSelection;
function reactor(row){
 const sessionId=row.session_id||(row.actor?.startsWith('session:')?row.actor.slice(8):null);
 const member=current?.members.find(m=>m.session_id===sessionId);
 return row.actor==='local-human'?{alias:'사용자',avatar:'#394657',human:true}:{...member,...row,alias:row.alias||member?.alias||'알 수 없는 세션'};
}
function renderReactionRoster(){
 const dialog=$('#reactionRoster');if(!dialog?.open||!reactionRosterSelection)return;
 const {roomId,messageId,emoji}=reactionRosterSelection;
 if(current?.id!==roomId){dialog.close();return;}
 const type=reactionTypes.find(r=>r[0]===emoji),rows=(current.reactions||[]).filter(r=>r.message_id===messageId&&r.emoji===emoji);
 dialog.querySelector('h2').textContent=`${emoji} ${type[1]} · ${rows.length}명`;
 dialog.querySelector('.reaction-meaning').textContent=type[2];
 const list=dialog.querySelector('.reactor-list'),scroll=list.scrollTop;list.replaceChildren();
 for(const row of rows){
  const person=reactor(row),item=text('li','','reactor-row'),identity=text('div','','reactor-identity');
  item.append(avatar(person.human?{alias:'나',avatar:person.avatar}:person));
  identity.append(text('strong',person.alias),text('small',person.human?'사용자':`${providerName(person)||'Agent'}${person.left_at?' · 토론에서 나감':''}`));
  item.append(identity);list.append(item);
 }
 if(!rows.length)list.append(text('li','아직 반응한 사람이 없어요.','muted'));
 list.scrollTop=scroll;
}
function openReactionRoster(messageId,emoji){
 let dialog=$('#reactionRoster');
 if(!dialog){
  dialog=document.createElement('dialog');dialog.id='reactionRoster';dialog.className='reaction-dialog';dialog.setAttribute('aria-labelledby','reactionRosterTitle');
  const heading=text('h2','');heading.id='reactionRosterTitle';
  const close=text('button','닫기','reaction-roster-close');close.type='button';close.onclick=()=>dialog.close();
  const list=document.createElement('ul');list.className='reactor-list';
  dialog.append(heading,text('p','','reaction-meaning'),list,close);document.body.append(dialog);
 }
 reactionRosterSelection={roomId:current.id,messageId,emoji};dialog.showModal();renderReactionRoster();
}
function renderReactions(message,card) {
 const wrap=text('div','','reactions');wrap.setAttribute('aria-label','메시지 반응');
 for(const [emoji,name,,legacy] of reactionTypes){
  const rows=(current.reactions||[]).filter(r=>r.message_id===message.id&&r.emoji===emoji);if(legacy&&!rows.length)continue;
  const on=rows.some(r=>r.actor==='local-human'),group=text('span','','reaction-group'+(on?' selected':''));
  const button=text('button',emoji,'reaction'+(on?' selected':''));button.type='button';
  button.setAttribute('aria-label',name+' 반응');button.setAttribute('aria-pressed',String(on));
  button.title=name;
  button.onclick=async()=>{button.disabled=true;try{await req(`/api/rooms/${current.id}/messages/${message.id}/reactions`,{method:'POST',body:JSON.stringify({emoji,active:!on})});await openRoom(current.id,false);}catch(e){error(e.message);button.disabled=false;}};
  group.append(button);
  if(rows.length){const count=text('button',String(rows.length),'reaction-count');count.type='button';count.setAttribute('aria-label',`${name} 반응자 ${rows.length}명 보기`);count.title=rows.map(r=>reactor(r).alias).join(', ');count.onclick=()=>openReactionRoster(message.id,emoji);group.append(count);}
  wrap.append(group);
 }
 card.append(wrap);
}
let mentionIndex=0,mentionClosed=false;
const mentionInput=createMentionInput({textarea:$('#body'),getSpans:value=>{
 const aliases=new Set([ALL_MENTION,...(current?.members||[]).filter(m=>!m.left_at).map(m=>m.alias)]);
 return mentionSpans(value).filter(span=>aliases.has(span.alias));
}});
const mentionMenu=$('#mentionMenu');
document.body.append(mentionMenu);
function closeMentionMenu(){mentionClosed=true;renderMentionMenu();}
function positionMentionMenu(){
 if(mentionMenu.hidden)return;
 const anchor=$('#body').getBoundingClientRect(),menu=mentionMenu.getBoundingClientRect();
 const geometry=mentionMenuGeometry(anchor,menu,{width:window.innerWidth,height:window.innerHeight});
 mentionMenu.style.left=geometry.left+'px';mentionMenu.style.top=geometry.top+'px';mentionMenu.style.maxHeight=geometry.maxHeight+'px';
}
window.addEventListener('resize',positionMentionMenu);
window.addEventListener('scroll',positionMentionMenu,true);
window.addEventListener('blur',closeMentionMenu);
document.addEventListener('focusin',event=>{if(event.target.closest('dialog'))closeMentionMenu();});
document.addEventListener('pointerdown',event=>{if(event.target!==$('#body')&&!mentionMenu.contains(event.target))closeMentionMenu();});
new ResizeObserver(positionMentionMenu).observe($('#composer'));
function currentMention() {const body=$('#body');return mentionAt(body.value,body.selectionStart);}
function mentionCandidates() {
  const span=currentMention();if(!span||!current)return [];
  return [{alias:ALL_MENTION,group:true},...current.members.filter(m=>!m.left_at&&m.alias!==ALL_MENTION)].filter(m=>m.alias?.toLowerCase().startsWith(span.alias.toLowerCase()));
}
function chooseMention(member) {
  const body=$('#body'),span=currentMention();if(!span)return;
  const inserted='@'+member.alias+' ';
  body.value=body.value.slice(0,span.start)+inserted+body.value.slice(span.end);
  body.focus();body.setSelectionRange(span.start+inserted.length,span.start+inserted.length);
  mentionClosed=false;mentionIndex=0;renderMentionMenu();
}
function resolvedPreview() {
  if(!current)return {members:[],problem:''};
  const readyChair=()=>{const chairs=current.members.filter(m=>!m.left_at&&m.role==='chair');const chair=chairs[0];if(!current.chair||current.chair.status!=='ready'||chairs.length!==1||chair.session_id!==current.chair.session_id||chair.read_only)return {problem:'준비된 전용 좌장이 필요해.'};if(current.deliveries.some(d=>d.session_id===current.chair.session_id&&d.state==='unknown'))return {problem:'좌장 카드에서 이전 실행 결과를 먼저 확인해줘.'};return {member:chair};};
  if(mentionSpans($('#body').value,true).some(span=>!span.alias))return {members:[],problem:'멘션할 이름을 골라줘.'};
  const aliases=parseAliases($('#body').value),members=current.members.filter(m=>!m.left_at);
  if(!aliases.length){
    const ready=readyChair();return ready.problem?{members:[],problem:ready.problem}:{members:[ready.member],problem:'',chair:true};
  }
  let chosen;
  try{chosen=resolveMentionTargets(aliases,members,current.chair?.session_id);}
  catch(e){return {members:[],problem:e.code==='MENTION_READ_ONLY'?`@${e.alias} · 읽기 전용이라 질문을 보낼 수 없어.`:`@${e.alias} · 현재 토론에서 찾을 수 없는 이름이야.`};}
  if(chosen.some(m=>m.role==='chair')){const ready=readyChair();if(ready.problem)return {members:[],problem:ready.problem};}
  return {members:chosen,problem:chosen.length?'':'질문할 수 있는 참여자가 없어.',all:aliases.includes(ALL_MENTION)};
}
function renderPreview() {
  const box=$('#recipientPreview');if(!box)return;box.replaceChildren();
  const kind=$('#kind').value;
  const execution=['followup','steer'].includes(kind);
  $('#composer button[type=submit]').textContent='보내기';
  $('#composeNote').textContent=!execution?'공동 대화에 기록해요.':'@이름으로 지정 · @to_all은 좌장 제외 모두 · 멘션이 없으면 좌장이 조율해요.';
  if(['post','notify'].includes(kind)){box.append(text('span','게시와 알림은 실행 요청을 만들지 않아요.'));return;}
  const preview=resolvedPreview();box.className='recipient-preview'+(preview.problem?' invalid':'');
  if(preview.problem){box.append(text('span',preview.problem));return;}
  box.append(text('span',preview.chair?'좌장이 내용을 보고 필요한 참여자에게 전달해요':preview.all?'전체 멘션 · 보낼 대상':'보낼 대상','recipient-caption'));
  for(const m of preview.members){const chip=text('span','','recipient-chip');chip.append(avatar(m),text('span',memberName(m)));box.append(chip);}
  if(!preview.members.length)box.append(text('span','질문할 수 있는 참여자가 없어요.'));
}
function renderMentionMenu() {
  mentionInput.render();
  const menu=$('#mentionMenu');if(!menu)return;
  const candidates=mentionCandidates();menu.replaceChildren();
  mentionIndex=Math.max(0,Math.min(mentionIndex,candidates.length-1));
  menu.hidden=mentionClosed||!candidates.length;
  $('#body').setAttribute('aria-expanded',String(!menu.hidden));
  $('#body').removeAttribute('aria-activedescendant');
  candidates.forEach((member,index)=>{
    const option=text('button','','mention-option'+(index===mentionIndex?' selected':''));option.type='button';
    option.id='mention-option-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected',String(index===mentionIndex));
    option.append(member.group?text('span','@','avatar'):avatar(member),text('strong',member.group?'@'+ALL_MENTION:memberName(member)),text('small',member.group?'좌장 제외 · 참여자 모두':providerName(member)+(member.role==='chair'?' · 좌장':member.read_only?' · 읽기 전용':'')));
    option.onmousedown=e=>e.preventDefault();option.onclick=()=>chooseMention(member);menu.append(option);
    if(!menu.hidden&&index===mentionIndex)$('#body').setAttribute('aria-activedescendant',option.id);
  });
  if(!menu.hidden)requestAnimationFrame(positionMentionMenu);
  renderPreview();
}
$('#body').addEventListener('input',()=>{if(current)draftBodies.set(current.id,$('#body').value);error();mentionClosed=false;mentionIndex=0;renderMentionMenu();});
$('#body').addEventListener('click',()=>{mentionClosed=false;renderMentionMenu();});
$('#body').addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229)return;
  if(event.key==='Enter'&&event.shiftKey)return;
  const candidates=$('#mentionMenu').hidden?[]:mentionCandidates();
  if(candidates.length){
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();mentionIndex=(mentionIndex+(event.key==='ArrowDown'?1:-1)+candidates.length)%candidates.length;renderMentionMenu();}
    else if(['Enter','Tab'].includes(event.key)){event.preventDefault();chooseMention(candidates[mentionIndex]);}
    else if(event.key==='Escape'){event.preventDefault();mentionClosed=true;renderMentionMenu();}
    return;
  }
  if(event.key==='Enter'){
    event.preventDefault();const submit=$('#composer button[type=submit]');
    if(!event.repeat&&!submit.disabled)$('#composer').requestSubmit(submit);
  }
});
const attachmentStrip=text('div','','attachment-strip');attachmentStrip.id='attachmentStrip';attachmentStrip.setAttribute('aria-live','polite');
const attachButton=text('button','파일 추가','attachment-button');attachButton.type='button';attachButton.setAttribute('aria-label','파일 선택');
const attachInput=document.createElement('input');attachInput.type='file';attachInput.multiple=true;attachInput.hidden=true;attachInput.setAttribute('aria-label','첨부할 파일 선택');
const attachmentToolbar=text('div','','attachment-toolbar');attachmentToolbar.append(attachButton,attachInput,attachmentStrip);$('#body').closest('.message-label').after(attachmentToolbar);
$('#body').required=false;
$('#body').placeholder='@이름으로 지정 · Enter 전송 · Shift+Enter 줄바꿈';
const asBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
const attachmentComposer=createAttachmentComposer({
  upload:async(roomId,file,requestKey)=>req(`/api/rooms/${roomId}/attachments`,{method:'POST',body:JSON.stringify({filename:file.name,mime:file.type||'application/octet-stream',base64:await asBase64(file),requestKey})}),
  discard:async(roomId,id)=>req(`/api/rooms/${roomId}/attachments/${id}/discard`,{method:'POST',body:'{}'}),
  render:items=>{for(const image of attachmentStrip.querySelectorAll('img'))URL.revokeObjectURL(image.src);attachmentStrip.replaceChildren();for(const item of items){const chip=text('div','','attachment-chip '+item.status);if(item.file.type.startsWith('image/')){const preview=document.createElement('img');preview.src=URL.createObjectURL(item.file);preview.alt='';chip.append(preview);}chip.append(text('span',item.file.name),text('small',item.status==='ready'?'준비됨':item.status==='uploading'?'업로드 중':item.error||'실패'));if(item.status==='failed'&&!item.invalid){const retry=text('button','재시도');retry.type='button';retry.onclick=()=>attachmentComposer.retry(item);chip.append(retry);}const remove=text('button','제거');remove.type='button';remove.onclick=()=>attachmentComposer.remove(item);chip.append(remove);attachmentStrip.append(chip);}renderPreview();},
  onChange:()=>updateRoomControls()
});
attachButton.onclick=()=>attachInput.click();attachInput.onchange=()=>{attachmentComposer.add(attachInput.files);attachInput.value='';};
$('#composer').addEventListener('dragover',event=>{event.preventDefault();$('#composer').classList.add('dragging');});
$('#composer').addEventListener('dragleave',()=>$('#composer').classList.remove('dragging'));
$('#composer').addEventListener('drop',event=>{event.preventDefault();$('#composer').classList.remove('dragging');if(event.dataTransfer?.files?.length)attachmentComposer.add(event.dataTransfer.files);});
$('#body').addEventListener('paste',event=>{const images=[...event.clipboardData?.files||[]].filter(file=>file.type.startsWith('image/'));if(images.length){event.preventDefault();attachmentComposer.add(images);}});
$('#composer').addEventListener('submit',async event=>{
  event.preventDefault();if(!active())return error('보관된 토론장에는 새 입력을 남길 수 없습니다.');
  const kind=$('#kind').value,preview=resolvedPreview();
  if(['followup','steer'].includes(kind)&&(preview.problem||!preview.members.length))return error(preview.problem||'질문할 수 있는 참여자가 없어.');
  if(attachmentComposer.pending())return error('첨부 업로드가 끝난 뒤 보낼 수 있어.');
  if(attachmentComposer.hasFailed())return error('실패한 첨부를 재시도하거나 제거해줘.');
  const attachments=attachmentComposer.items().filter(item=>item.status==='ready');
  const roomId=current.id,payload={body:$('#body').value,kind,routingMode:'auto',targets:[],attachmentIds:attachments.map(item=>item.meta.id)};
  if(!payload.body.trim()&&!payload.attachmentIds.length)return error('메시지나 첨부를 추가해줘.');
  const signature=JSON.stringify({room:current.id,...payload});
  if(pendingSend?.signature!==signature)pendingSend={signature,key:crypto.randomUUID()};
  const sending=pendingSend;
  try{await req(`/api/rooms/${roomId}/messages`,{method:'POST',body:JSON.stringify({...payload,requestKey:sending.key})});if(pendingSend===sending)pendingSend=null;attachmentComposer.clearSent(attachments,roomId);if(draftBodies.get(roomId)===payload.body)draftBodies.set(roomId,'');if(current?.id===roomId){if($('#body').value===payload.body){$('#body').value='';mentionClosed=false;}await openRoom(roomId);error();}}
  catch(e){error(e.message);}
});
$('#newRoom').onclick=()=>$('#roomDialog').showModal();$('#newChannel').onclick=()=>$('#channelDialog').showModal();$('#createRoom').onclick=async e=>{e.preventDefault();try{const r=await req('/api/rooms',{method:'POST',body:JSON.stringify({name:$('#roomName').value,channelId:$('#channelChoice').value||null,cwd:$('#roomCwd').value.trim()||undefined})});$('#roomDialog').close();await refresh(false);await openRoom(r.id);showDiscovery()}catch(e){error(e.message)}};$('#createChannel').onclick=async e=>{e.preventDefault();try{await req('/api/channels',{method:'POST',body:JSON.stringify({name:$('#channelName').value})});$('#channelDialog').close();refresh(false)}catch(e){error(e.message)}};
$('#pause').onclick=async()=>{try{await req(`/api/rooms/${current.id}/${current.paused_at?'resume':'pause'}`,{method:'POST',body:'{}'});openRoom(current.id)}catch(e){error(e.message)}};$('#archive').onclick=async()=>{try{await req(`/api/rooms/${current.id}/archive`,{method:'POST',body:'{}'});await refresh(false);error('토론장을 보관했습니다.')}catch(e){error(e.message)}};$('#discover').onclick=async()=>{try{const d=await req('/api/discovery');$('#memberDetail').textContent=d.error||d.sessions.map(s=>`${s.provider}: ${s.handle}\n${s.blockedReason}`).join('\n\n')||'발견된 세션이 없습니다.'}catch(e){error(e.message)}};
$('#kind').onchange=()=>renderPreview();
let polling=false;
async function pollRoom(){if(polling)return;polling=true;try{if(current)await openRoom(current.id,false);else{await refresh(false);const first=rooms.find(r=>!r.archived_at)||rooms[0];if(first)await openRoom(first.id);else updateRoomControls();}}catch(e){if(e.code!=='NETWORK_UNCERTAIN')error(e.message);}finally{polling=false;}}
pollRoom();setInterval(pollRoom,5000);

function memberButton(label,action){const b=text('button',label);b.onclick=async()=>{try{await action()}catch(e){error(e.message)}};return b}
async function setRole(member,role){await req(`/api/rooms/${current.id}/role`,{method:'POST',body:JSON.stringify({sessionId:member.session_id,role})});await openRoom(current.id,false)}
async function leaveMember(member){await req(`/api/rooms/${current.id}/leave`,{method:'POST',body:JSON.stringify({sessionId:member.session_id})});$('#memberDetail').replaceChildren(text('p','토론에서 빠졌어. 원래 세션은 계속 유지돼.'));await openRoom(current.id,false)}
function dialog(title){const d=document.createElement('dialog'),f=document.createElement('form');f.method='dialog';f.append(text('h2',title));d.append(f);document.body.append(d);d.addEventListener('close',()=>d.remove());return {d,f}}
function inputField(form,label,name,value='',type='text'){const l=text('label',label),i=document.createElement('input');i.name=name;i.type=type;i.value=value;i.required=true;l.append(i);form.append(l);return i}
function actions(form,submitLabel){const menu=document.createElement('menu'),cancel=text('button','취소'),submit=text('button',submitLabel,'accent');cancel.value='cancel';cancel.type='button';cancel.onclick=()=>form.closest('dialog').close();submit.type='submit';menu.append(cancel,submit);form.append(menu)}
async function provision(member){const result=await req(`/api/rooms/${current.id}/provision`,{method:'POST',body:JSON.stringify({sessionId:member.session_id})});const {d,f}=dialog('선택한 세션의 참여 정보');f.append(text('p','이 설정은 선택한 세션만 사용해. 다른 토론이나 세션에는 쓰지 않아.','muted'));const download=memberButton('비공개 설정 파일 저장',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result.config,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='rooms-'+member.provider+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});f.append(download,text('pre','node packages/mcp/participant.js --config 설정파일경로 inbox','detail'),text('p','MCP 클라이언트에는 packages/mcp/server.js와 ROOMS_URL / ROOMS_TOKEN을 이 설정 값으로 연결하면 돼. 등록만으로 기존 CLI를 자동으로 깨우지는 않아.','muted'));const close=memberButton('닫기',()=>d.close());f.append(close);d.showModal()}
function checkboxRow(labelText,disabled=false){const label=text('label','','checkbox-row'),input=document.createElement('input');input.type='checkbox';input.disabled=disabled;label.append(input,document.createTextNode(labelText));return {label,input};}
async function invite(candidate){
 if(!active())return error('먼저 토론장을 선택해줘.');
 const {d,f}=dialog(candidate?'선택한 세션 초대':'세션 직접 등록'),errorBox=text('p','','form-error');
 const providerLabel=text('label','Provider'),provider=document.createElement('select');for(const item of ['codex','claude']){const option=text('option',item);option.value=item;provider.append(option)}provider.value=candidate?.provider||'codex';providerLabel.append(provider);f.append(providerLabel);
 const name=inputField(f,'원래 세션 설명 (선택)','displayName',candidate?.title||candidate?.provider||'');name.required=false;
 const native=inputField(f,'세션에서 확인한 고유 대화 ID','nativeId',candidate?.nativeId||'');const cwd=inputField(f,'작업 폴더','cwd',candidate?.cwd||current.cwd||'');const profile=inputField(f,'원래 프로필','profile',candidate?.profile||'default');
 const exactBinding=candidate?.handle&&candidate?.incarnation?candidate:null;let selectedBinding=exactBinding;
 const pullRow=checkboxRow(' 확인한 세션에 MCP 직접 호출 허용',!exactBinding),autoRow=checkboxRow(' 이 세션에 자동 입력 전달 허용',!exactBinding),rawRow=checkboxRow(' 원래 세션 출력 조회 허용',!exactBinding);
 const bindingArea=text('section','','runtime-binding');
 const selector=document.createElement('select');selector.setAttribute('aria-label','확인할 현재 터미널 선택');selector.disabled=true;
 const confirmation=checkboxRow(' 선택한 터미널이 위 대화 ID의 세션인지 확인했어요',!exactBinding);
 const clearBinding=()=>{if(exactBinding)return;selectedBinding=null;selector.value='';confirmation.input.checked=false;};
 const syncCapabilities=()=>{const verified=Boolean(exactBinding||(selectedBinding&&confirmation.input.checked));pullRow.input.disabled=!verified;autoRow.input.disabled=!verified||!pullRow.input.checked;rawRow.input.disabled=!verified||!pullRow.input.checked;if(pullRow.input.disabled)pullRow.input.checked=false;if(autoRow.input.disabled)autoRow.input.checked=false;if(rawRow.input.disabled)rawRow.input.checked=false;};
 const invalidateBinding=()=>{clearBinding();syncCapabilities();};provider.onchange=invalidateBinding;native.oninput=invalidateBinding;cwd.oninput=invalidateBinding;selector.onchange=()=>{selectedBinding=runtimeBindings[Number(selector.value)]||null;confirmation.input.checked=false;syncCapabilities();};confirmation.input.onchange=syncCapabilities;pullRow.input.onchange=syncCapabilities;
 let runtimeBindings=[];
 async function loadRuntimeChoices(){
  if(exactBinding)return;
  selector.replaceChildren(text('option','현재 터미널을 선택해줘.'));selector.disabled=true;bindingArea.append(text('p','현재 Orca 터미널을 불러오는 중…','muted'));
  try{const result=await req('/api/discovery');runtimeBindings=(result.sessions||[]).filter(session=>session.provider===provider.value&&session.cwd===cwd.value&&session.handle&&session.incarnation);selector.replaceChildren(text('option',runtimeBindings.length?'현재 터미널을 선택해줘.':'같은 provider·작업 폴더의 현재 터미널이 없어.'));selector.options[0].value='';runtimeBindings.forEach((session,index)=>{const option=text('option',`${session.title||session.profile||'현재 세션'} · ${session.handle} · ${session.cwd}`);option.value=String(index);selector.append(option);});selector.disabled=!runtimeBindings.length;}catch(e){bindingArea.append(text('p',e.message,'form-error'));}finally{syncCapabilities();}}
 if(exactBinding)bindingArea.append(text('p','카탈로그가 이 대화 ID의 현재 연결을 정확히 확인했어. 자동 전달은 아래에서 별도로 허용해야 해.','muted'));
 else {bindingArea.append(text('p','자동 전달을 원하면 현재 Orca 터미널을 직접 고르고, 이 대화 ID와 같은 세션인지 확인해줘. 작업 폴더만으로 연결하지 않아.','muted'),selector,confirmation.label);provider.addEventListener('change',loadRuntimeChoices);cwd.addEventListener('change',loadRuntimeChoices);await loadRuntimeChoices();}
 f.append(bindingArea,pullRow.label,autoRow.label,rawRow.label,errorBox);syncCapabilities();actions(f,'초대');
 f.onsubmit=async event=>{event.preventDefault();if(!f.reportValidity())return;try{const writable=pullRow.input.checked,binding=exactBinding||selectedBinding;const result=await req('/api/sessions',{method:'POST',body:JSON.stringify({provider:provider.value,host:binding?.host||candidate?.host||'orca/local',nativeId:native.value,cwd:cwd.value,profile:profile.value,displayName:name.value,mode:writable?'live_attach':'read_only',ownership:'borrowed',verified:writable,handle:writable?binding?.handle||null:null,incarnation:writable?binding?.incarnation||null:null,capabilities:{followup:writable,mcpPull:writable,automaticInput:writable&&autoRow.input.checked,rawInspect:writable&&rawRow.input.checked},policyRevision:writable?'participant-confirmed-inherited':null})});await req(`/api/rooms/${current.id}/join`,{method:'POST',body:JSON.stringify({sessionId:result.session.id,readOnly:!writable})});d.close();await openRoom(current.id,false);}catch(e){errorBox.textContent=e.message;}};d.showModal();
}
async function showDiscovery(){
 const {d,f}=dialog('세션 카탈로그'),content=text('div','조회 중…','discovery-list'),filters=text('div','','catalog-filters');
 const query=document.createElement('input');query.type='search';query.placeholder='provider, 제목, 요약, ID, 작업 폴더 검색';query.setAttribute('aria-label','세션 카탈로그 검색');
 const provider=document.createElement('select');provider.setAttribute('aria-label','Provider 필터');for(const value of ['','codex','claude']){const option=text('option',value||'모든 provider');option.value=value;provider.append(option);}filters.append(query,provider);f.append(text('p','선택한 세션의 제목·요약·원래 ID·작업 폴더와 현재 연결 상태를 확인한 뒤 초대해.','muted'),filters,content,memberButton('직접 등록',()=>{d.close();invite()}),memberButton('닫기',()=>d.close()));d.showModal();
 let timer;const load=async()=>{content.replaceChildren(text('p','조회 중…','muted'));try{const params=new URLSearchParams();if(query.value.trim())params.set('query',query.value.trim());if(provider.value)params.set('provider',provider.value);const result=await req('/api/sessions/catalog?'+params);content.replaceChildren();for(const warning of result.errors||[])content.append(text('p',warning,'form-error'));for(const candidate of result.sessions||[]){const row=document.createElement('article');row.className='discovery-row';const title=text('strong',candidate.title||candidate.nativeId||'제목 없는 세션');const status=text('span',candidate.live?'연결됨':candidate.blockedReason||'연결 상태 미확인','catalog-status '+(candidate.live?'live':'blocked'));row.append(title,status,text('p',`${candidate.provider||'unknown'} · ${candidate.nativeId||'ID 미확인'}`,'detail'),text('p',candidate.summary||'요약 없음','detail'),text('p',candidate.cwd||'작업 폴더 미확인','detail'));const choose=memberButton('선택하고 초대',()=>{d.close();invite(candidate)});row.append(choose);content.append(row);}if(!result.sessions?.length)content.append(text('p','조건에 맞는 세션이 없어. 직접 등록할 수 있어.','muted'));}catch(e){content.replaceChildren(text('p',e.message,'form-error'));}};const schedule=()=>{clearTimeout(timer);timer=setTimeout(load,180);};query.oninput=schedule;provider.onchange=load;await load();
}
async function editLimits(){if(!current)return;const {d,f}=dialog('토론 한도');const requests=inputField(f,'사용자 요청당 최대 전달 수','requests',current.request_budget,'number'),rounds=inputField(f,'요청당 최대 자동 대화 라운드','rounds',current.round_budget,'number');for(const i of [requests,rounds]){i.min='1';i.max='100'}f.append(text('p','새 사용자 입력마다 별도 한도를 사용해요. 병렬 질문은 한 라운드로 세며, 한도에 도달하면 추가 자동 질문만 멈춰요.','muted'));const errorBox=text('p','','form-error');f.append(errorBox);actions(f,'적용');f.onsubmit=async e=>{e.preventDefault();try{await req(`/api/rooms/${current.id}/limits`,{method:'POST',body:JSON.stringify({requestBudget:Number(requests.value),roundBudget:Number(rounds.value)})});d.close();await openRoom(current.id,false)}catch(e){errorBox.textContent=e.message}};d.showModal()}
function updateRoomControls(){for(const id of ['invite','limits','workspaceButton'])$('#'+id).disabled=!active();$('#composer button[type=submit]').disabled=!active()||attachmentComposer?.pending();const steer=$('#kind option[value=steer]');steer.disabled=true;steer.textContent='방향 수정 · 연결 미지원';}
const inviteButton=memberButton('세션 초대',()=>invite());inviteButton.id='invite';const limitButton=memberButton('토론 한도',editLimits);limitButton.id='limits';$('.room-actions').prepend(inviteButton,limitButton);$('#discover').onclick=showDiscovery;
$('#workspaceButton').onclick=workspaceDialog;

$('#kind').value='followup';$('#kind').dispatchEvent(new Event('change'));

const chairStatus=state=>({initializing:'좌장 생성 중',ready:'좌장 준비됨',submitting:'좌장에게 전달 중',running:'응답 생성 중',unknown:'좌장 실행 확인 필요',failed:'좌장 연결 실패'}[state]||state);
const createChairButton=memberButton('별도 좌장 만들기',async()=>{
  if(!active())return;
  const roomId=current.id;createChairButton.disabled=true;
  try{await req(`/api/rooms/${roomId}/chair`,{method:'POST',body:'{}'});await openRoom(roomId,false);}finally{renderChairControl();}
});
createChairButton.id='createChair';createChairButton.title='이 토론장만 맡는 별도 Claude 대화를 만들고, 이후에는 같은 ID로 이어가.';$('.room-actions').prepend(createChairButton);
function renderChairControl(){const chair=current?.chair;createChairButton.disabled=!active()||!!chair;createChairButton.textContent=chair?chairStatus(chair.status):'별도 좌장 만들기';createChairButton.title=chair?.error||'초대한 참여자와 다른 전용 Claude 세션';if(chair?.error)error('좌장 · '+chair.error);}
const detailToggle=memberButton('세션 상세',()=>{const open=$('.inspector').classList.toggle('open');detailToggle.setAttribute('aria-expanded',String(open));});detailToggle.classList.add('details-toggle');detailToggle.setAttribute('aria-expanded','false');$('.room-actions').append(detailToggle);

const closeInspector=memberButton('닫기',()=>{$('.inspector').classList.remove('open');detailToggle.setAttribute('aria-expanded','false');});closeInspector.className='inspector-close';$('.inspector').prepend(closeInspector);

initLayout();

const renameRoomButton=renameButton('토론장 이름 변경',()=>{if(current)renameDialog('room',current);});
renameRoomButton.id='renameRoom';
$('#title').after(renameRoomButton);

const expandSummary=memberButton('크게 보기',()=>{
 const {d,f}=dialog('토론 정리');d.classList.add('summary-dialog');
 const copy=$('#decisions').cloneNode(true);copy.removeAttribute('id');
 for(const element of copy.querySelectorAll('[id]'))element.removeAttribute('id');
 for(const button of copy.querySelectorAll('button'))button.remove();
 for(const detail of copy.querySelectorAll('details'))detail.open=true;
 for(const link of copy.querySelectorAll('a'))link.addEventListener('click',()=>d.close());
 f.append(copy);const close=memberButton('닫기',()=>d.close());f.append(close);d.showModal();
});
expandSummary.id='expandSummary';expandSummary.className='summary-expand';
$('.summary-heading').append(expandSummary);

function renameDialog(kind,item){
 const isRoom=kind==='room',name=isRoom?current?.id===item.id?current.name:item.name:channels.find(c=>c.id===item.id)?.name||item.name;
 const {d,f}=dialog(isRoom?'토론장 이름 바꾸기':'채널 이름 바꾸기');
 const field=inputField(f,'이름','name',name),message=text('p','','form-error');
 field.maxLength=isRoom?120:80;field.autocomplete='off';message.setAttribute('role','alert');
 f.append(message);actions(f,'저장');
 const submit=f.querySelector('button[type=submit]');
 let saving=false;
 f.onsubmit=async event=>{
  event.preventDefault();if(saving)return;
  if(!field.value.trim()){message.textContent='이름을 입력해줘.';field.focus();return;}
  saving=true;submit.disabled=true;message.textContent='';
  try{
   const renamed=await req('/api/'+(isRoom?'rooms':'channels')+'/'+item.id+'/rename',{method:'POST',body:JSON.stringify({name:field.value.trim()})});
   if(isRoom){rooms=rooms.map(r=>r.id===item.id?{...r,name:renamed.name}:r);if(current?.id===item.id)current.name=renamed.name;}
   else channels=channels.map(c=>c.id===item.id?{...c,name:renamed.name}:c);
   renderNav();if(isRoom&&current?.id===item.id)$('#title').textContent=current.name+(current.archived_at?' · 보관됨':current.paused_at?' · 중지됨':'');
   d.close();
  }catch(error){message.textContent=error.message;saving=false;submit.disabled=false;}
 };
 d.showModal();field.select();
}
