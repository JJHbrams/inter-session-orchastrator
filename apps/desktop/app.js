import {sessionMembers,memberKey,sessionPresentation,renderSessionDetail,capabilitiesFor} from '/session-inspector.js';
import {participantSettingsDialog} from '/participant-settings-ui.js';
import {matchingRuntimeSessions,verifiedRuntimeBinding,isNativeChatSession,nativeChatInvitation} from '/session-choice.js';
import {parseAliases, mentionAt, mentionSpans, ALL_MENTION, resolveMentionTargets} from '/mentions.js';
import {createApiClient} from '/api-client.js';
import {bindCreationForm} from '/creation-form.js';
import {attachDirectoryPicker} from '/directory-picker.js';
import {sessionLocation} from '/session-location.js';
import {showNewSessionDialog} from '/new-session-dialog.js';
import {initLayout,mentionMenuGeometry} from '/layout.js';
import {marked} from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import {createRenderer,createMentionInput,createReferenceMap} from '/rich-text.js';
import {createAttachmentComposer,createAttachmentViewer,renderSharedAttachments} from '/attachments.js';
import {deliveryPresentation} from '/delivery-status.js';
import {chairSettingsFields,dialoguePresets,dialogueLimitSummary} from '/chair-settings.js';
import {createAgendaUI,agendaMessagePresentation} from '/agenda-ui.js';
import {UNASSIGNED_CHANNEL_KEY,bindChannelDisclosure,createChannelNav,expandParentForNewRoom,parseReferenceHash,syncRoomChannelOptions} from '/channel-nav.js';
import {showReferenceDialog} from '/reference-links.js';
let current, rooms=[], channels=[], pendingSend, selectedRoomId,showArchived=false;const draftBodies=new Map(); const $=s=>document.querySelector(s);
const connection=document.createElement('div');connection.id='connection';connection.setAttribute('role','status');connection.hidden=true;$('#error').before(connection);
const api=createApiClient({onConnection:state=>{connection.hidden=state==='online';connection.textContent=state==='offline'?'연결 끊김 · 입력은 보존돼. 로컬 서버가 돌아오면 자동으로 다시 연결할게.':state==='reconnecting'?'로컬 서버에 다시 연결하는 중…':'';}});
const req=api.request;
api.authenticate().then(({version})=>{const label=$('#appVersion');label.textContent=version?`v${version}`:'버전 확인 불가';label.title=version?`현재 실행 중인 버전: ${version}`:'실행 버전 정보를 읽을 수 없어요.';}).catch(()=>{$('#appVersion').textContent='버전 확인 불가';});
const renderMarkdown=createRenderer({parse:source=>marked.parse(source,{gfm:true,breaks:true}),sanitize:DOMPurify.sanitize.bind(DOMPurify)});
const attachmentViewer=createAttachmentViewer({document,authenticate:()=>api.authenticate(),renderMarkdown,getContext:id=>current?.id===id?{mentions:current.members.map(m=>m.alias),references:createReferenceMap(current.members,current.messages)}:{}});
let agendaUI;
const channelNav=createChannelNav();
const text=(tag,value,cls)=>{const x=document.createElement(tag);x.textContent=value;if(cls)x.className=cls;return x};
function actionIcon(name){
 const paths={search:'m21 21-5-5 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',invite:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M17 11h6',workspace:'M3 7h7l2 2h9v11H3Z M3 7V4h7l2 3',chair:'M5 12h14v8H5Z M7 12V4h10v8 M3 16h18',detail:'M4 4h16v16H4Z M14 4v16',close:'M6 6l12 12M18 6 6 18',more:'M5 12h.01 M12 12h.01 M19 12h.01',archive:'M3 4h18v4H3Z M5 8v12h14V8 M10 12h4',pause:'M8 5v14 M16 5v14',settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',reset:'M4 11a8 8 0 1 1 2 7 M4 4v7h7'};
 paths.restore='M3 4h18v4H3Z M5 8v12h14V8 M12 17v-6 M9 14l3-3 3 3';
 paths.reaction='M21 12a9 9 0 1 1-9-9 M8 14s1.5 2 4 2 4-2 4-2 M8 9h.01 M14 9h.01 M19 2v6 M16 5h6';
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('action-icon');path.setAttribute('d',paths[name]||paths.more);svg.append(path);return svg;
}
function decorateAction(button,name){if(!button)return;const label=button.textContent;button.replaceChildren(actionIcon(name),text('span',label,'tool-label'));button.setAttribute('aria-label',label);button.title=label;}
function renderToolbar(){for(const [id,icon] of [['invite','invite'],['createChair','chair'],['workspaceButton','workspace'],['pause','pause'],['archive','archive'],['limits','settings']])decorateAction($('#'+id),icon);}
function error(value=''){const e=$('#error');e.textContent=value;e.hidden=!value}
function active(){return current&&!current.archived_at}
function visibleRooms(){return rooms.filter(room=>showArchived||(!room.archived_at&&!channels.find(channel=>channel.id===room.channel_id)?.archived_at));}
async function ensureVisibleSelection(){
 const visible=visibleRooms();if(current&&visible.some(room=>room.id===current.id))return openRoom(current.id,false);
 if(current)draftBodies.set(current.id,$('#body').value);
 if(visible.length)return openRoom(visible[0].id);
 current=null;selectedRoomId=null;timelineSignature=undefined;decisionSignature=undefined;attachmentComposer.setRoom(null);$('#body').value='';$('#title').textContent='토론장을 선택하세요';
 $('#timeline').replaceChildren(text('div',showArchived?'토론장을 만들어 대화를 시작해보세요.':'표시할 토론장이 없어요. 새로 만들거나 보관 항목을 확인해보세요.','empty'));
 $('#chairProfile').replaceChildren();$('#participants').replaceChildren();$('#decisions').replaceChildren();$('#summaryStatus').textContent='';selectedSessionKey=null;memberDetailSignature='';participantRenderSignature='';$('#memberDetail').textContent='참여 세션을 선택해줘.';$('#workspaceDetail').textContent='토론장을 선택해줘.';
 renderNav();renderMentionMenu();renderPreview();updateRoomControls();renderChairControl();$('#pause').disabled=true;$('#archive').disabled=true;
}
async function changeArchive(kind,item){
 try{closeNavContextMenu();await req(`/api/${kind==='channel'?'channels':'rooms'}/${item.id}/${item.archived_at?'restore':'archive'}`,{method:'POST',body:'{}'});await refresh(false);await ensureVisibleSelection();error();}catch(e){error(e.message);}
}
function renameButton(label,onClick){
 const button=text('button','','rename-link rename-icon');button.type='button';button.title=label;button.setAttribute('aria-label',label);button.onclick=onClick;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
 path.setAttribute('d','m16 4 4 4M4 16 16 4a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5Z');svg.append(path);button.append(svg);return button;
}
function navRowActions(kind,item){
 const actions=text('span','','nav-row-actions'),label=kind==='channel'?'채널':'토론장';
 const rename=renameButton(item.name+' '+label+' 이름 변경',event=>{event.stopPropagation();closeNavContextMenu();renameDialog(kind,(kind==='channel'?channels:rooms).find(value=>value.id===item.id)||item);});rename.title='이름 변경';
 const archiveLabel=item.archived_at?'보관 해제':'보관',archive=text('button','','nav-row-action');archive.type='button';archive.append(actionIcon(item.archived_at?'restore':'archive'));archive.setAttribute('aria-label',item.name+' '+label+' '+archiveLabel);
 const remaining=kind==='channel'?rooms.filter(room=>room.channel_id===item.id&&!room.archived_at).length:0;
 archive.disabled=!item.archived_at&&remaining>0;archive.title=archive.disabled?`하위 토론장 ${remaining}개를 먼저 보관해줘.`:archiveLabel;
 archive.onclick=event=>{event.stopPropagation();changeArchive(kind,(kind==='channel'?channels:rooms).find(value=>value.id===item.id)||item);};
 for(const [button,action] of [[rename,'rename'],[archive,'archive']]){button.classList.add('nav-row-action');button.dataset.navAction=action;button.dataset.navKind=kind;button.dataset.navId=item.id;}
 actions.append(rename,archive);return actions;
}
let navContextMenu;
function closeNavContextMenu(restoreFocus=false){
 if(!navContextMenu)return;
 const {element,kind,id}=navContextMenu;navContextMenu=null;element.remove();
 if(restoreFocus){const selector=kind==='channel'?`[data-channel-id="${CSS.escape(id)}"]`:`[data-room-id="${CSS.escape(id)}"] .room-link`;$('#rooms').querySelector(selector)?.focus();}
}
function bindNavContextMenu(element,kind,item){
 element.setAttribute('aria-haspopup','menu');
 const open=event=>{
  event.preventDefault();event.stopPropagation();closeNavContextMenu();
  const menu=text('div','','nav-context-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label',item.name+' '+(kind==='channel'?'채널':'토론장'));
  const rename=text('button','이름 변경');rename.type='button';rename.setAttribute('role','menuitem');
  rename.onclick=()=>{closeNavContextMenu();const target=(kind==='channel'?channels:rooms).find(value=>value.id===item.id);if(target)renameDialog(kind,target);};
  const latest=(kind==='channel'?channels:rooms).find(value=>value.id===item.id)||item;
  const reference=text('button','참조 복사');reference.type='button';reference.setAttribute('role','menuitem');reference.onclick=()=>showReferenceCopy(kind==='channel'?{channel:latest}:{channel:latest.channel_id?channels.find(c=>c.id===latest.channel_id):null,room:latest});
  const archive=text('button',latest.archived_at?'보관 해제':kind==='channel'?'채널 보관':'토론장 보관');archive.type='button';archive.setAttribute('role','menuitem');archive.onclick=()=>changeArchive(kind,latest);
  const remaining=kind==='channel'?rooms.filter(room=>room.channel_id===item.id&&!room.archived_at).length:0;
  archive.disabled=!latest.archived_at&&remaining>0;menu.append(rename,reference,archive);
  if(archive.disabled)menu.append(text('p',`하위 토론장 ${remaining}개를 먼저 보관해줘.`,'context-note'));
  document.body.append(menu);navContextMenu={element:menu,kind,id:item.id};
  const rect=element.getBoundingClientRect(),box=menu.getBoundingClientRect(),keyboard=event.type==='keydown';
  const x=keyboard?rect.left:event.clientX,y=keyboard?rect.bottom:event.clientY;
  menu.style.left=Math.max(8,Math.min(x,window.innerWidth-box.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,window.innerHeight-box.height-8))+'px';rename.focus();
 };
 element.oncontextmenu=open;
 element.onkeydown=event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))open(event);};
}
document.addEventListener('pointerdown',event=>{if(navContextMenu&&!navContextMenu.element.contains(event.target))closeNavContextMenu();});
document.addEventListener('keydown',event=>{
 if(!navContextMenu)return;
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeNavContextMenu(true);}
 else if(event.key==='Tab')closeNavContextMenu(true);
 else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=[...navContextMenu.element.querySelectorAll('[role="menuitem"]:not(:disabled)')],index=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length;items[next]?.focus();}
});
window.addEventListener('resize',()=>closeNavContextMenu());
document.addEventListener('scroll',event=>{if(navContextMenu&&!navContextMenu.element.contains(event.target))closeNavContextMenu();},true);
function renderNav(){
 const nav=$('#rooms'),focused=document.activeElement;
 const focusId=focused.closest?.('[data-room-id],[data-channel-id]')?.dataset;
 const focusedAction=focused.dataset.navAction?{...focused.dataset}:null;
 nav.replaceChildren();
 const visible=visibleRooms(),groups=[...channels.filter(c=>showArchived||!c.archived_at).map(c=>[c,visible.filter(r=>r.channel_id===c.id)]),[{name:'채널 없음'},visible.filter(r=>!r.channel_id)]];
 for(const [channel,list] of groups){
  if(!list.length&&!channel.id)continue;
  const key=channel.id||UNASSIGNED_CHANNEL_KEY,heading=text('div','','channel-label'+(channel.archived_at?' archived':''));
  const toggle=text('button','','channel-toggle');toggle.type='button';toggle.dataset.channelId=key;
  const chevron=text('span','','channel-chevron');chevron.setAttribute('aria-hidden','true');toggle.append(chevron,text('span',(channel.id?'# ':'')+channel.name,'nav-label'));if(channel.archived_at)toggle.append(text('small','보관','nav-archive-badge'));
  const childGroup=text('div','','channel-child-group');childGroup.id='channel-children-'+encodeURIComponent(key);
  toggle.setAttribute('aria-controls',childGroup.id);heading.append(toggle);
  toggle.title=channel.name;
  if(channel.id){bindNavContextMenu(toggle,'channel',channel);heading.append(navRowActions('channel',channel));}
  bindChannelDisclosure({button:toggle,group:childGroup,state:channelNav,key});
  nav.append(heading,childGroup);
  for(const room of list){
   const selected=current?.id===room.id,row=text('div','','room-nav-row'+(selected?' active':''));row.dataset.roomId=room.id;
   const button=text('button',room.name,'room-link'+(selected?' active':'')+(room.archived_at?' archived':''));if(room.archived_at)button.append(text('small','보관','nav-archive-badge'));button.type='button';button.onclick=()=>{closeNavContextMenu();openRoom(room.id);};bindNavContextMenu(button,'room',room);
   if(selected)button.setAttribute('aria-current','page');
   button.title=room.name;row.append(button,navRowActions('room',room));childGroup.append(row);
  }
 }
 if(focusedAction)nav.querySelector(`[data-nav-kind="${focusedAction.navKind}"][data-nav-id="${CSS.escape(focusedAction.navId)}"][data-nav-action="${focusedAction.navAction}"]`)?.focus();
 else if(focusId?.roomId)nav.querySelector(`[data-room-id="${CSS.escape(focusId.roomId)}"] .room-link`)?.focus();
 else if(focusId?.channelId)nav.querySelector(`[data-channel-id="${CSS.escape(focusId.channelId)}"]`)?.focus();
 syncRoomChannelOptions($('#channelChoice'),channels);
}
async function refresh(keep=true){const [rs,cs]=await Promise.all([req('/api/rooms'),req('/api/channels')]);rooms=rs.rooms;channels=cs.channels;renderNav();if(keep&&current){const found=rooms.find(r=>r.id===current.id);if(found)await openRoom(found.id,false)}}
async function retryDelivery(d,m,retry={disabled:false}){retry.disabled=true;try{const roomId=current.id,endpoint=`/api/rooms/${roomId}/deliveries/${d.id}/retry`,result=await req(endpoint,{method:'POST',body:'{}'});if(result.composerConfirmation){const {d:confirmDialog,f}=dialog(`입력란 확인 · ${m?.alias||m?.display_name||m?.native_id||'수신자'}`),errorBox=text('p','','form-error');f.append(text('p','Orca가 입력으로 보고한 문구야. 추천 문구를 초안으로 잘못 감지했을 수 있어. 원래 세션의 입력란이 비어 있을 때만 확인해줘. 이 확인은 현재 요청 한 건에만 적용되고 60초 뒤 만료돼.','muted'),text('pre',result.composerConfirmation.phrasePreview||'(문구 없음)','detail'),errorBox);actions(f,'입력란이 비어 있음 · 이번 요청 전달');f.onsubmit=async event=>{event.preventDefault();const submit=f.querySelector('[type=submit]');submit.disabled=true;try{const confirmed=await req(endpoint,{method:'POST',body:JSON.stringify({composerConfirmation:result.composerConfirmation.nonce})});if(confirmed.message||confirmed.error)error(confirmed.error||confirmed.message);confirmDialog.close();await openRoom(roomId,false);}catch(e){errorBox.textContent=e.message;submit.disabled=false;}};confirmDialog.showModal();return;}if(result.message||result.error)error(result.error||result.message);await openRoom(roomId,false);}catch(e){error(e.message);retry.disabled=false;}}
function deliveryText(message){
 const ds=current.deliveries.filter(d=>d.message_id===message.id);if(!ds.length)return null;
 const wrap=document.createElement('div');wrap.className='delivery-list';
 for(const d of ds){
  const m=current.members.find(x=>x.id===d.membership_id);
  const presentation=deliveryPresentation(d);
  const badge=text('span',`${m?.alias||m?.display_name||m?.native_id||'수신자'} · ${presentation.label}`,'badge '+presentation.state);
  badge.title=`요청: ${d.request_id}${presentation.reason?'\n사유: '+presentation.reason:''}`;wrap.append(badge);
  if(presentation.reason&&m){const details=text('button','상태 상세','delivery-status-detail');details.type='button';details.onclick=()=>showMemberDetail(memberKey(m));wrap.append(details);}
  if((d.kind==='followup'||message.kind==='followup')&&d.state!=='completed'){
   const chairDelivery=m?.session_id===current.chair?.session_id;
   if(chairDelivery&&d.state==='unknown'){const check=text('button','상태 확인','delivery-retry');check.type='button';check.title='좌장의 저장된 답변이 있으면 좌장 카드에서 반영할 수 있어. 저장된 답변이 없으면 모델을 다시 보내지 않아.';check.onclick=()=>showMemberDetail(memberKey(m));wrap.append(check);continue;}
   const retry=text('button',presentation.blocked||d.state==='unknown'?'상태 다시 확인':'응답 재호출','delivery-retry');retry.type='button';
   retry.title=presentation.blocked?'전달 조건을 다시 확인하고, 준비되면 기존 요청을 전달해요. 새 요청을 만들지 않아요.':d.state==='unknown'?'같은 요청의 접수 상태를 먼저 확인해요.':'기존 요청을 확인하고 누락된 응답을 다시 요청해요.';
   retry.onclick=()=>retryDelivery(d,m,retry);
   wrap.append(retry);
  }
 }
 return wrap;
}

let timelineSignature;
function renderTimeline() {
  renderReactionRoster();
  renderReactionPicker();
  const signature=JSON.stringify([current.id,current.messages,current.deliveries,current.reactions,current.members.map(m=>[m.session_id,m.alias,m.avatar,m.provider])]);
  if(signature===timelineSignature)return;timelineSignature=signature;
  const view=$('#timeline'); view.replaceChildren();
  if(!current.messages.length) {view.append(text('div','@별칭으로 질문하거나, 게시로 대화의 맥락을 남겨보세요.','empty'));return;}
  const references=createReferenceMap(current.members,current.messages);
  for(const m of current.messages) {
    const presentation=agendaMessagePresentation(m,current.chair);
    if(presentation?.internal){const activity=document.createElement('details');activity.className='agenda-activity';activity.id='message-'+m.id;activity.append(text('summary',presentation.title));const content=text('div','','rich-body');content.append(renderMarkdown(presentation.body,{roomId:current.id,mentions:[]}));activity.append(content);const ds=deliveryText(m);if(ds)activity.append(ds);view.append(activity);continue;}
    const card=document.createElement('section');card.className='message';card.id='message-'+m.id;
    const author=current.members.find(x=>x.session_id===(presentation?.authorSessionId||m.sender_session_id));
    const speaker=presentation?.authorSessionId?'chair':m.sender_role||(!m.sender_session_id?'user':'member');
    card.classList.add(speaker==='user'?'message-user':speaker==='chair'?'message-chair':speaker==='system'?'message-system':'message-member');
    if(author&&speaker!=='user')applySessionColor(card,author);
    const head=text('div','','message-head');
    head.append(author?avatar(author):text('span',speaker==='system'?'↻':'나','avatar human'));
    head.append(text('strong',author?memberName(author):speaker==='system'?'조율 서비스':'사용자','message-author'));
    if(author)head.append(text('span',providerName(author),'provider-badge'));
    if(speaker==='chair')head.append(text('span','좌장','speaker-role'));
    const body=text('div','','rich-body');
    body.append(renderMarkdown(presentation?.body||m.body,{roomId:current.id,mentions:[ALL_MENTION,...current.members.map(member=>member.alias)],references}));
    if(presentation?.title)head.append(text('span',presentation.title,'speaker-role'));card.append(head,body);if(presentation?.details){const details=document.createElement('details');details.append(text('summary','공유된 논거 보기'),text('div',presentation.details,'agenda-peer-arguments'));card.append(details);}
    renderAttachments(m.attachments,card);
    const meta=text('div',`${m.kind} · ${new Date(m.created_at).toLocaleString('ko-KR')}`,'message-meta');
    if(m.reply_to){const a=text('a','원문 보기');a.href='#message-'+m.reply_to;meta.append(document.createTextNode(' · '),a);}
    if(m.decision_id){const a=text('a','결정 제안 보기');a.href='#decision-'+m.decision_id;a.onclick=()=>{const target=document.getElementById('decision-'+m.decision_id);const history=target?.closest('details');if(history)history.open=true;};meta.append(document.createTextNode(' · '),a);}
    card.append(meta);const ds=deliveryText(m);if(ds)card.append(ds);
    renderReactions(m,card);view.append(card);
  }
  positionReactionPicker();
}
function renderAttachments(attachments,card){
  if(!attachments?.length)return;
  card.append(renderSharedAttachments({document,roomId:current.id,attachments,onOpen:(id,file)=>attachmentViewer.open(id,file)}));
}
const formatBytes=size=>size<1024?size+' B':size<1048576?Math.ceil(size/1024)+' KiB':(size/1048576).toFixed(1)+' MiB';

let participantRenderSignature='',selectedSessionKey=null,memberDetailSignature='';
function showMemberDetail(key){
 selectedSessionKey=key;$('.inspector').classList.add('open');detailToggle.setAttribute('aria-expanded','true');memberDetailSignature='';renderMemberDetail();renderParticipants();
}
function renderMemberDetail(){
 const detail=$('#memberDetail'),m=current&&sessionMembers(current).find(member=>memberKey(member)===selectedSessionKey);
 if(!m){memberDetailSignature='';detail.replaceChildren(text('div','카드를 선택하면 모델 설정과 연결 상태를 확인할 수 있어요.','session-inspector-empty'));return;}
 const roomId=current.id,view=sessionPresentation(current,m),signature=JSON.stringify({roomId,archived:current.archived_at,paused:current.paused_at,member:m,view,runs:view.ownedChair?current.chair_runs:null});
 if(signature===memberDetailSignature)return;memberDetailSignature=signature;
 const stillSelected=()=>current?.id===roomId&&selectedSessionKey===memberKey(m),refresh=()=>current?.id===roomId&&openRoom(roomId,false);
 const action=async callback=>{try{if(!stillSelected())return;await callback();}catch(e){if(stillSelected()&&rendered?.element.isConnected){rendered.feedback.hidden=false;rendered.feedback.textContent=e.message;}}};
 let rendered;
 rendered=renderSessionDetail({document,room:current,member:m,view,avatar,actions:{
  settings:()=>view.ownedChair?chairSettingsDialog():participantSettingsDialog({document,member:m,request:(name,data)=>req(`/api/rooms/${roomId}/sessions/${m.session_id}/settings/${name}`,{method:'POST',body:JSON.stringify(data),signal:AbortSignal.timeout(120000)}),onChange:refresh}),
  output:()=>action(async()=>{const result=await req(`/api/rooms/${roomId}/sessions/${m.session_id}/output`);if(!stillSelected()||!rendered.element.isConnected)return;rendered.output.hidden=false;rendered.output.replaceChildren(text('h3','원래 세션 출력'),text('p',result.warning||'조회한 원래 세션 출력이에요.','session-helper'),text('pre',(result.lines||[]).join('\n')));}),
  refreshMetadata:()=>action(async()=>{await req(`/api/rooms/${roomId}/sessions/${m.session_id}/metadata`,{method:'POST',body:'{}'});await openRoom(roomId,false)}),
  automation:()=>action(async()=>{const result=await req(`/api/rooms/${roomId}/sessions/${m.session_id}/automation`,{method:'POST',body:JSON.stringify({enabled:!capabilitiesFor(m).automaticInput})});if(result.message||result.error)error(result.error||result.message);await refresh();}),
  provision:()=>action(()=>provision(m)),leave:()=>action(()=>leaveMember(m)),
  reconcile:runId=>action(async()=>{await req(`/api/rooms/${roomId}/chair/reconcile`,{method:'POST',body:JSON.stringify({runId})});await refresh();}),
  recheck:()=>retryDelivery(view.pending,m)
 }});detail.replaceChildren(rendered.element);
}
function chairOnboarding(chair,onConfigure){
 const state=chair?.status==='ready'?null:({missing:{title:'좌장 미설정',message:'직접 게시·허용 참여자 요청은 가능해. 자동 조율·안건 토론에는 좌장이 필요해.',action:'좌장 설정'},initializing:{title:'좌장 생성 중',message:'준비 전에는 자동 조율·안건 토론을 쓸 수 없어.'},failed:{title:'좌장 연결 실패',message:'상태를 확인하거나 다시 설정해.'},unknown:{title:'좌장 실행 확인 필요',message:'자동 조율·안건 토론 전에 상태를 확인해.'},submitting:{title:'좌장에게 전달 중',message:'응답 상태를 확인하는 중이야.'},running:{title:'응답 생성 중',message:'좌장이 응답을 만들고 있어.'}}[chair?.status]||{title:'좌장 미설정',message:'직접 게시·허용 참여자 요청은 가능해. 자동 조율·안건 토론에는 좌장이 필요해.',action:'좌장 설정'});if(!state)return null;
 const notice=document.createElement('section');notice.className='chair-onboarding';notice.dataset.state=chair?.status||'missing';notice.append(text('strong',state.title),text('p',state.message));if(state.action){const action=text('button',state.action);action.type='button';action.disabled=!active();action.onclick=onConfigure;notice.append(action);}return notice;
}
function renderParticipants() {
 const members=sessionMembers(current),views=members.map(m=>sessionPresentation(current,m));
 const signature=JSON.stringify({room:current.id,archived:current.archived_at,paused:current.paused_at,members:current.members,creations:current.sessionCreations,chair:current.chair,runs:current.chair_runs,selectedSessionKey,deliveries:current.deliveries.filter(d=>!['completed','cancelled'].includes(d.state)),activities:views.map(v=>[v.activity,v.label])});
 if(signature===participantRenderSignature)return;participantRenderSignature=signature;
 const area=$('#participants'),chairArea=$('#chairProfile');area.replaceChildren();chairArea.replaceChildren();
 for(const [index,m] of members.entries()){
  const view=views[index],selected=selectedSessionKey===memberKey(m),b=text('button','','participant'+(view.state==='running'?' generating':'')+(view.active?' activity-active':'')+(selected?' selected':''));
  applySessionColor(b,m);b.type='button';b.dataset.state=view.state;b.dataset.activity=view.activity;b.dataset.sessionKey=memberKey(m);b.setAttribute('aria-pressed',String(selected));b.setAttribute('aria-controls','memberDetail');
  const identity=text('span','','participant-identity'),name=text('span','','participant-name');name.append(text('strong',memberName(m)),text('span',providerName(m)+(view.ownedChair?' · 좌장':''),'provider-badge'));identity.append(avatar(m),name);b.append(identity);
  b.append(text('span',view.caption,'participant-model-caption'));const location=sessionLocation({...m,cwd:m.cwd||(view.ownedChair?current.chair?.cwd||current.cwd:null)}),project=text('span',location.label,'participant-project');project.title=location.path;b.append(project);b.append(text('span',view.label,'session-status '+view.severity+(view.severity==='working'?' ok':'')));
  b.title=memberName(m)+' · '+view.hint;b.onclick=()=>showMemberDetail(memberKey(m));(view.ownedChair?chairArea:area).append(b);
 }
 for(const creation of current.sessionCreations||[]){if(creation.status==='ready')continue;const card=memberButton('',()=>createSession(creation)),location=sessionLocation(creation);card.className='participant session-pending';card.dataset.state=creation.status==='failed'?'failed':'initializing';card.append(text('strong',`새 ${creation.provider==='codex'?'Codex':'Claude'} 세션`),text('span',location.label,'participant-project'),text('span',creation.status==='failed'?'생성 확인 필요':'연결 준비 중','session-status warning'));card.title=location.path;area.append(card);}

 const chairNotice=chairOnboarding(current.chair,()=>chairSettingsDialog({onboarding:true}));if(chairNotice)chairArea.prepend(chairNotice);
 if(!chairArea.children.length&&!current.chair)chairArea.append(text('p','별도 좌장을 만들어줘.','muted'));
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
    const body=text('div','','decision-body rich-body');body.tabIndex=0;body.setAttribute('aria-label','토론 정리 내용');body.append(renderMarkdown(d.body,{roomId:current.id,mentions:[ALL_MENTION,...current.members.map(member=>member.alias)],references:createReferenceMap(current.members,current.messages)}));item.append(body);
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
async function openRoom(id,scroll=true,preserveReferenceHash=false){
 try{
  if(current?.id!==id)closeMentionMenu();
  const timeline=$('#timeline'),follow=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<60;
  if(scroll)selectedRoomId=id;
  if(scroll&&!preserveReferenceHash&&!(location.hash.startsWith('#message-')&&!current)){
   const nextHash=new URLSearchParams({room:id}).toString();
   if(location.hash.slice(1)!==nextHash)history.pushState(null,'',location.pathname+'#'+nextHash);
   handledReferenceHash=nextHash;
  }
  const previousId=current?.id,view=await req('/api/rooms/'+id);
  if(id!==selectedRoomId)return;
  if(previousId&&previousId!==id)draftBodies.set(previousId,$('#body').value);
  current=view;attachmentComposer.setRoom(current.id);
  if(previousId!==current.id){$('#body').value=draftBodies.get(current.id)||'';selectedSessionKey=null;memberDetailSignature='';}
  $('#title').textContent=current.name+(current.archived_at?' · 보관됨':current.paused_at?' · 중지됨':'');$('.eyebrow').textContent=(channels.find(c=>c.id===current.channel_id)?.name||'채널 없음')+' / 토론장';$('#pause').textContent=current.paused_at?'재개':'중지';$('#pause').disabled=!active();$('#archive').textContent=current.archived_at?'보관 해제':'토론장 보관';$('#archive').disabled=false;renderNav();renderParticipants();renderMemberDetail();renderTimeline();renderDecisions();renderMentionMenu();updateRoomControls();renderChairControl();renderToolbar();loadWorkspace(current.id);await agendaUI?.setRoom(current.id);if(scroll||follow)$('#timeline').scrollTop=$('#timeline').scrollHeight;
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
 const cwd=inputField(f,'작업 폴더','cwd',current.cwd||'');cwd.required=false;attachDirectoryPicker(cwd);
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
 ['👍','좋아요','긍정적인 의견이나 대화상의 동의예요. 최종 결론 확정은 아니에요.'],
 ['👎','반대','구체적인 근거가 없으면 다음 입력에서 반대 이유를 확인해요.'],
 ['❓','모르겠음','어려운 지점을 확인하고 설명을 보완할 신호예요.'],
 ['✅','확인(알았음)','내용을 받았거나 이해했어요. 동의·작업 완료와는 달라요.'],
 ['👀','검토 중','이 내용을 읽고 검토하고 있어요. 확인 완료나 동의는 아니에요.'],
 ['💡','아이디어 있음','구체적인 내용이 없으면 다음 입력에서 반응한 사람에게 아이디어를 물어요.'],
 ['❤️','공감','기존 공감 반응이에요. 긍정적인 의견으로 보존해요.',true]
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
let reactionPickerSelection;
function reactionAddButton(messageId){return document.getElementById('message-'+messageId)?.querySelector('.reaction-add');}
function closeReactionPicker(restore=false){
 const selection=reactionPickerSelection,picker=$('#reactionPicker');
 if(picker?.matches(':popover-open'))picker.hidePopover();
 reactionPickerSelection=null;
 const trigger=selection&&reactionAddButton(selection.messageId);trigger?.setAttribute('aria-expanded','false');
 if(restore)trigger?.focus({preventScroll:true});
}
function positionReactionPicker(){
 const picker=$('#reactionPicker');if(!picker?.matches(':popover-open')||!reactionPickerSelection)return;
 const trigger=reactionAddButton(reactionPickerSelection.messageId);
 if(!trigger){closeReactionPicker();return;}
 const anchor=trigger.getBoundingClientRect(),box=picker.getBoundingClientRect(),width=document.documentElement.clientWidth,height=window.innerHeight;
 picker.style.left=Math.max(12,Math.min(anchor.left,width-box.width-12))+'px';
 picker.style.top=Math.max(12,Math.min(anchor.top-box.height-8>=12?anchor.top-box.height-8:anchor.bottom+8,height-box.height-12))+'px';
}
function renderReactionPicker(){
 const picker=$('#reactionPicker');if(!picker?.matches(':popover-open')||!reactionPickerSelection)return;
 const {roomId,messageId}=reactionPickerSelection;
 if(current?.id!==roomId||!current.messages.some(m=>m.id===messageId)){closeReactionPicker();return;}
 for(const button of picker.querySelectorAll('[data-emoji]')){
  const selected=current.reactions.some(r=>r.message_id===messageId&&r.emoji===button.dataset.emoji&&r.actor==='local-human');
  button.setAttribute('aria-pressed',String(selected));button.classList.toggle('selected',selected);
 }
}
async function setMessageReaction(roomId,messageId,emoji,active,button){
 button.disabled=true;
 try{
  await req(`/api/rooms/${roomId}/messages/${messageId}/reactions`,{method:'POST',body:JSON.stringify({emoji,active})});
  if(current?.id===roomId){await openRoom(roomId,false);if(document.activeElement===document.body)reactionAddButton(messageId)?.focus({preventScroll:true});}
 }catch(e){error(e.message);}finally{button.disabled=false;}
}
function openReactionPicker(messageId){
 if(reactionPickerSelection?.messageId===messageId&&$('#reactionPicker')?.matches(':popover-open')){closeReactionPicker(true);return;}
 let picker=$('#reactionPicker');
 if(!picker){
  picker=text('div','','reaction-picker');picker.id='reactionPicker';picker.setAttribute('popover','auto');picker.setAttribute('role','dialog');picker.setAttribute('aria-labelledby','reactionPickerTitle');
  const header=text('div','','reaction-picker-header'),heading=text('strong','반응 추가');heading.id='reactionPickerTitle';
  const close=text('button','×','reaction-picker-close');close.type='button';close.title='닫기';close.setAttribute('aria-label','반응 선택 닫기');close.onclick=()=>closeReactionPicker(true);header.append(heading,close);
  const choices=text('div','','reaction-options');
  for(const [emoji,name,,legacy] of reactionTypes){
   if(legacy)continue;
   const button=text('button','','reaction-option');button.type='button';button.dataset.emoji=emoji;button.title=name;button.setAttribute('aria-label',name+' 반응 선택');button.setAttribute('aria-pressed','false');
   button.append(text('span',emoji,'reaction-option-emoji'),text('small',name));
   button.onclick=()=>{const {roomId,messageId}=reactionPickerSelection,on=current.reactions.some(r=>r.message_id===messageId&&r.emoji===emoji&&r.actor==='local-human');closeReactionPicker(true);setMessageReaction(roomId,messageId,emoji,!on,button);};choices.append(button);
  }
  picker.append(header,choices);picker.addEventListener('toggle',event=>{if(event.newState==='closed'){const selection=reactionPickerSelection;reactionPickerSelection=null;if(selection)reactionAddButton(selection.messageId)?.setAttribute('aria-expanded','false');}});
  document.body.append(picker);
 }
 reactionPickerSelection={roomId:current.id,messageId};picker.showPopover({source:reactionAddButton(messageId)});renderReactionPicker();positionReactionPicker();reactionAddButton(messageId)?.setAttribute('aria-expanded','true');picker.querySelector('.reaction-option').focus({preventScroll:true});
}
window.addEventListener('resize',()=>closeReactionPicker());
document.addEventListener('scroll',event=>{const picker=$('#reactionPicker');if(reactionPickerSelection&&!picker?.contains(event.target))closeReactionPicker();},true);
function renderReactions(message,card) {
 const wrap=text('div','','reactions');wrap.setAttribute('aria-label','메시지 반응');
 for(const [emoji,name] of reactionTypes){
  const rows=(current.reactions||[]).filter(r=>r.message_id===message.id&&r.emoji===emoji);if(!rows.length)continue;
  const on=rows.some(r=>r.actor==='local-human'),group=text('span','','reaction-group'+(on?' selected':''));
  const button=text('button',emoji,'reaction'+(on?' selected':''));button.type='button';
  button.setAttribute('aria-label',name+' 반응');button.setAttribute('aria-pressed',String(on));
  button.title=name;
  const roomId=current.id;button.onclick=()=>setMessageReaction(roomId,message.id,emoji,!on,button);
  group.append(button);
  if(rows.length){const count=text('button',String(rows.length),'reaction-count');count.type='button';count.setAttribute('aria-label',`${name} 반응자 ${rows.length}명 보기`);count.title=rows.map(r=>reactor(r).alias).join(', ');count.onclick=()=>openReactionRoster(message.id,emoji);group.append(count);}
  wrap.append(group);
 }
 const add=text('button','','reaction-add');add.type='button';add.append(actionIcon('reaction'));add.title='반응 추가';add.setAttribute('aria-label','반응 추가');add.setAttribute('aria-haspopup','dialog');add.setAttribute('aria-controls','reactionPicker');add.setAttribute('popovertarget','reactionPicker');add.setAttribute('aria-expanded',String(reactionPickerSelection?.messageId===message.id));add.onclick=event=>{event.preventDefault();openReactionPicker(message.id);};wrap.append(add);
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
const imageButton=text('button','이미지 추가','attachment-button'),imageInput=document.createElement('input');imageButton.type='button';imageButton.setAttribute('aria-label','이미지 선택');imageInput.type='file';imageInput.accept='image/png,image/jpeg,image/gif,image/webp';imageInput.multiple=true;imageInput.hidden=true;imageInput.setAttribute('aria-label','첨부할 이미지 선택');imageButton.title='이미지 선택 · 입력창에 Ctrl+V로 붙여넣기도 가능해요.';imageButton.onclick=()=>imageInput.click();imageInput.onchange=()=>{attachmentComposer.add(imageInput.files);imageInput.value='';};attachmentToolbar.insertBefore(imageButton,attachmentStrip);attachmentToolbar.append(imageInput);
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
$('#newRoom').onclick=()=>$('#roomDialog').showModal();$('#newChannel').onclick=()=>$('#channelDialog').showModal();
attachDirectoryPicker($('#roomCwd'));
bindCreationForm({dialog:$('#channelDialog'),onSubmit:()=>req('/api/channels',{method:'POST',body:JSON.stringify({name:$('#channelName').value.trim()})}),onSuccess:()=>refresh(false),onError:e=>error(e.message)});
bindCreationForm({dialog:$('#roomDialog'),onSubmit:()=>req('/api/rooms',{method:'POST',body:JSON.stringify({name:$('#roomName').value.trim(),channelId:$('#channelChoice').value||null,cwd:$('#roomCwd').value.trim()||undefined})}),onSuccess:async room=>{expandParentForNewRoom(channelNav,room.channel_id);await refresh(false);await openRoom(room.id);if(current?.id===room.id)await chairSettingsDialog({onboarding:true});},onError:e=>error(e.message)});
$('#pause').onclick=async()=>{try{await req(`/api/rooms/${current.id}/${current.paused_at?'resume':'pause'}`,{method:'POST',body:'{}'});openRoom(current.id)}catch(e){error(e.message)}};$('#archive').onclick=()=>{if(current)changeArchive('room',current);};
$('#showArchived').onclick=async()=>{showArchived=!showArchived;$('#showArchived').setAttribute('aria-checked',String(showArchived));closeNavContextMenu();await refresh(false);await ensureVisibleSelection();};
$('#kind').onchange=()=>renderPreview();
function createSession(creation=null){if(!active())return error('먼저 토론장을 선택해줘.');const room={id:current.id,cwd:current.cwd};return showNewSessionDialog({document,room,creation,request:req,onChange:async()=>{if(current?.id===room.id)await openRoom(room.id,false)}});}
async function showReferenceCopy(target){
 return showReferenceDialog({document,location,request:req,target,onError:error});
}
let polling=false;
let handledReferenceHash='';
async function followReferenceHash(){
 const raw=location.hash.slice(1),route=parseReferenceHash(raw);if(!route)return false;if(raw===handledReferenceHash)return !(route.roomId&&current?.id===route.roomId);if(route.error){error(route.error);return true;}const {channelId,roomId,agendaId}=route;
 const room=roomId&&rooms.find(item=>item.id===roomId),channel=channelId&&channels.find(item=>item.id===channelId);if((roomId&&!room)||(channelId&&room&&room.channel_id!==channelId)){error('참조 대상 채널 또는 토론장을 찾을 수 없습니다.');handledReferenceHash=raw;return true;}if(!room){if(!channel){error('참조 대상 채널을 찾을 수 없습니다.');handledReferenceHash=raw;return true;}channelNav.expand(channelId);renderNav();const {d,f}=dialog('채널 토론장');f.append(text('p',`${channel.name}의 토론장을 읽기 전용으로 열어.`,'muted'));for(const item of rooms.filter(value=>value.channel_id===channelId)){f.append(memberButton(item.name,()=>{d.close();openRoom(item.id);}));}f.append(memberButton('닫기',()=>d.close()));d.showModal();handledReferenceHash=raw;return true;}
 const parentChannel=channel||channels.find(item=>item.id===room.channel_id);if(room.archived_at||parentChannel?.archived_at){showArchived=true;$('#showArchived').setAttribute('aria-checked','true');}if(parentChannel)channelNav.expand(parentChannel.id);await openRoom(roomId,true,true);if(!agendaId){handledReferenceHash=raw;return true;}if(location.hash.slice(1)!==raw)return true;const agendas=await req(`/api/rooms/${roomId}/agendas`);if(location.hash.slice(1)!==raw)return true;if(!(agendas.agendas||[]).some(item=>item.id===agendaId)){error('참조 대상 안건을 찾을 수 없습니다.');handledReferenceHash=raw;return true;}await agendaUI?.refresh();if(location.hash.slice(1)!==raw)return true;await agendaUI?.open?.(agendaId);handledReferenceHash=raw;return true;
}
async function pollRoom(){if(polling)return;polling=true;try{await refresh(false);if(!await followReferenceHash())await ensureVisibleSelection();}catch(e){if(e.code!=='NETWORK_UNCERTAIN')error(e.message);}finally{polling=false;}}
pollRoom();setInterval(pollRoom,5000);
window.addEventListener('hashchange',()=>{followReferenceHash().catch(e=>error(e.message));});

function memberButton(label,action){const b=text('button',label);b.type='button';b.onclick=async()=>{try{await action()}catch(e){error(e.message)}};return b}
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
 const native=inputField(f,'세션에서 확인한 고유 대화 ID','nativeId',candidate?.nativeId||'');const cwd=inputField(f,'작업 폴더','cwd',candidate?.cwd||current.cwd||'');const profile=inputField(f,'원래 프로필','profile',candidate?.profile||'default');attachDirectoryPicker(cwd);
 const nativeChat=nativeChatInvitation(candidate);
 const connectionMode=text('section','','invite-connection-mode'),connectionDescription=nativeChat?'기존 Chat에 요청을 보내고 답변을 받아와.':'현재 Orca 터미널을 확인한 뒤 필요한 권한을 선택해.';
 connectionMode.append(text('span','연결 방식'),text('strong',nativeChat?'Orca Chat 직접 연결':'Orca 터미널 연결'),text('p',connectionDescription));f.append(connectionMode);
 let exactBinding=!nativeChat&&candidate?.handle&&candidate?.incarnation?candidate:null,selectedBinding=exactBinding;
 const autoRow=checkboxRow(' 이 세션에 자동 입력 전달 허용',!exactBinding&&!nativeChat);
 let pullRow,rawRow;
 if(nativeChat){provider.disabled=true;native.readOnly=true;cwd.readOnly=true;profile.readOnly=true;name.readOnly=true;autoRow.input.checked=true;autoRow.label.replaceChildren(autoRow.input,document.createTextNode(' 이 채팅에 자동 요청 전달 허용'));}
 else {pullRow=checkboxRow(' 확인한 세션에 MCP 직접 호출 허용',!exactBinding);rawRow=checkboxRow(' 원래 세션 출력 조회 허용',!exactBinding);}
 const permissionArea=document.createElement('fieldset');permissionArea.className='invite-permissions';permissionArea.append(text('legend','사용 가능한 권한'));
 if(nativeChat)permissionArea.append(autoRow.label);else permissionArea.append(pullRow.label,autoRow.label,rawRow.label);
 const bindingArea=text('section','','runtime-binding');
 const selector=document.createElement('select');selector.setAttribute('aria-label','확인할 현재 터미널 선택');selector.disabled=true;
 const confirmation=checkboxRow(' 선택한 터미널이 위 대화 ID의 세션인지 확인했어요',!exactBinding);
 const clearBinding=()=>{exactBinding=null;selectedBinding=null;selector.value='';confirmation.input.checked=false;if(!selector.isConnected)bindingArea.append(selector,confirmation.label);loadRuntimeChoices();};
 const syncCapabilities=()=>{if(nativeChat){autoRow.input.disabled=false;return;}confirmation.input.disabled=!selectedBinding;const verified=verifiedRuntimeBinding(exactBinding,selectedBinding,confirmation.input.checked);pullRow.input.disabled=!verified;autoRow.input.disabled=!verified||!pullRow.input.checked;rawRow.input.disabled=!verified||!pullRow.input.checked;if(pullRow.input.disabled)pullRow.input.checked=false;if(autoRow.input.disabled)autoRow.input.checked=false;if(rawRow.input.disabled)rawRow.input.checked=false;};
 const invalidateBinding=()=>{clearBinding();syncCapabilities();};provider.onchange=invalidateBinding;native.oninput=invalidateBinding;cwd.oninput=invalidateBinding;profile.oninput=invalidateBinding;selector.onchange=()=>{selectedBinding=selector.value===''?null:runtimeBindings[Number(selector.value)]||null;confirmation.input.checked=false;syncCapabilities();};confirmation.input.onchange=syncCapabilities;if(pullRow)pullRow.input.onchange=syncCapabilities;
 let runtimeBindings=[],runtimeLookup=null,runtimeVersion=0;
 const runtimeStatus=text('p','','muted');
 async function loadRuntimeChoices(){
  if(exactBinding)return;
  const version=++runtimeVersion;selector.replaceChildren(text('option','현재 터미널을 선택해줘.'));selector.disabled=true;runtimeStatus.textContent='현재 Orca 터미널을 불러오는 중…';if(!runtimeStatus.isConnected)bindingArea.append(runtimeStatus);
  try{const result=await (runtimeLookup??=req('/api/discovery'));if(version!==runtimeVersion||!d.open)return;runtimeBindings=matchingRuntimeSessions(result.sessions||[],provider.value,cwd.value);selector.replaceChildren(text('option',runtimeBindings.length?'현재 터미널을 선택해줘.':'같은 provider·작업 폴더의 현재 터미널이 없어.'));selector.options[0].value='';runtimeBindings.forEach((session,index)=>{const option=text('option',`${session.title||session.profile||'현재 세션'} · ${session.handle} · ${session.cwd}`);option.value=String(index);selector.append(option);});selector.disabled=!runtimeBindings.length;runtimeStatus.textContent=runtimeBindings.length?'대화 ID까지 확인한 터미널만 선택해줘.':'읽기 전용으로 초대하거나 원래 세션의 작업 폴더를 확인해줘.';}catch(e){if(version===runtimeVersion)runtimeStatus.textContent=e.message;}finally{syncCapabilities();}}
 if(nativeChat)bindingArea.append(text('p','기존 Orca 채팅에 직접 참여해. 터미널 연결이나 원래 출력 조회는 사용하지 않아.','muted'));
 else if(exactBinding)bindingArea.append(text('p','이 대화 ID로 등록된 연결이야. 실제 실행 상태는 전송 직전에 다시 확인해. 자동 전달은 아래에서 별도로 허용해야 해.','muted'));
 else {bindingArea.append(text('p','자동 전달을 원하면 현재 Orca 터미널을 직접 고르고, 이 대화 ID와 같은 세션인지 확인해줘. 작업 폴더만으로 연결하지 않아.','muted'),selector,confirmation.label);provider.addEventListener('change',loadRuntimeChoices);cwd.addEventListener('change',loadRuntimeChoices);loadRuntimeChoices();}
 f.append(bindingArea,permissionArea,errorBox);syncCapabilities();actions(f,'초대');
 f.onsubmit=async event=>{event.preventDefault();if(!f.reportValidity())return;try{const writable=!!nativeChat||pullRow.input.checked,binding=exactBinding||selectedBinding;const result=await req(nativeChat?'/api/sessions/native-chat':'/api/sessions',{method:'POST',body:JSON.stringify(nativeChat?{...nativeChat,automaticInput:autoRow.input.checked}:{provider:provider.value,host:binding?.host||candidate?.host||'orca/local',nativeId:native.value,cwd:cwd.value,profile:profile.value,displayName:name.value,mode:writable?'live_attach':'read_only',ownership:'borrowed',verified:writable,handle:writable?binding?.handle||null:null,incarnation:writable?binding?.incarnation||null:null,capabilities:{followup:writable,mcpPull:writable,automaticInput:writable&&autoRow.input.checked,rawInspect:writable&&rawRow.input.checked},policyRevision:writable?'participant-confirmed-inherited':null})});await req(`/api/rooms/${current.id}/join`,{method:'POST',body:JSON.stringify({sessionId:result.session.id,readOnly:!writable})});d.close();await openRoom(current.id,false);}catch(e){errorBox.textContent=e.message;}};d.showModal();
}
async function showDiscovery(){
 const {d,f}=dialog('세션 선택');d.classList.add('session-picker');
 f.setAttribute('aria-label','초대할 세션 선택');
 const heading=f.querySelector('h2'),header=text('div','','picker-heading'),close=memberButton('×',()=>d.close());close.className='picker-close';close.setAttribute('aria-label','세션 선택 닫기');header.append(heading,close);
 const searchWrap=text('div','','picker-search'),query=document.createElement('input');query.type='search';query.placeholder='전체 작업공간에서 제목, 프로젝트, 세션 ID로 검색';query.setAttribute('aria-label','세션 카탈로그 검색');query.setAttribute('autocomplete','off');
 const clearQuery=memberButton('검색 지우기',()=>{query.value='';syncSearchScope();load();});clearQuery.type='button';clearQuery.className='picker-query-clear';clearQuery.hidden=true;searchWrap.append(actionIcon('search'),query,clearQuery);
 const filters=text('div','','picker-filters'),tabs=text('div','','provider-tabs');tabs.setAttribute('aria-label','Provider 필터');
 let provider='',entries=[],selected=-1,version=0,timer;
 const providerButtons=[];
 for(const [value,label] of [['','전체'],['codex','Codex'],['claude','Claude']]){const b=memberButton(label,()=>{provider=value;providerButtons.forEach(({value,button})=>button.setAttribute('aria-pressed',String(value===provider)));load();});b.setAttribute('aria-pressed',String(value===provider));providerButtons.push({value,button:b});tabs.append(b);}
 const internal=checkboxRow(' 작업용 세션 포함');internal.label.classList.add('picker-internal');filters.append(tabs,internal.label);
 const split=text('div','','picker-split'),list=document.createElement('div'),detail=text('aside','','picker-detail');list.className='picker-list';list.id='sessionPickerResults';list.setAttribute('role','listbox');list.setAttribute('aria-label','초대 가능한 세션');query.setAttribute('aria-controls',list.id);split.append(list,detail);
 const footer=text('div','','picker-footer'),status=text('span','조회 중…','picker-status');status.setAttribute('role','status');const manual=memberButton('직접 등록',()=>{d.close();invite();}),choose=memberButton('초대 계속',()=>{const candidate=entries[selected];if(candidate){d.close();invite(candidate);}});manual.className='picker-manual';choose.className='accent';choose.disabled=true;const create=memberButton('새 세션 만들기',()=>{d.close();createSession();});create.className='picker-new-session';footer.append(status,create,manual,choose);
 const warning=text('div','','picker-warning');warning.setAttribute('role','status');f.replaceChildren(header,searchWrap,filters,warning,split,footer);d.showModal();query.focus();
 const projectName=c=>sessionLocation(c).label.replace(/^프로젝트 · /,'');
 const timeLabel=value=>{const stamp=Date.parse(value);if(!Number.isFinite(stamp))return '';const elapsed=Math.max(0,Date.now()-stamp);return elapsed<3600000?'최근':elapsed<86400000?Math.floor(elapsed/3600000)+'시간 전':new Date(stamp).toLocaleDateString('ko-KR',{month:'short',day:'numeric'});};
 function select(index,focus=false){
  selected=index;const candidate=entries[index];choose.disabled=!candidate;
  list.querySelectorAll('[role="option"]').forEach((row,i)=>{row.setAttribute('aria-selected',String(i===index));row.tabIndex=i===index?0:-1;});
  query.removeAttribute('aria-activedescendant');detail.replaceChildren();
  if(!candidate){detail.append(text('p','목록에서 세션을 선택하면 원래 대화의 정보를 확인할 수 있어요.','picker-empty'));return;}
  const row=list.querySelectorAll('[role="option"]')[index];if(row){query.setAttribute('aria-activedescendant',row.id);row.scrollIntoView({block:'nearest'});if(focus)row.focus();}
  const badge=text('span',candidate.live?'등록된 연결':'대화 이력','picker-connection'+(candidate.live?' registered':''));
  detail.append(badge,text('h3',candidate.title||'제목 없는 세션'),text('p',candidate.summary||'저장된 요약이 없어요.','picker-description'));
  const fields=document.createElement('dl');for(const [label,value] of [['Provider',candidate.provider],['세션 ID',candidate.nativeId||candidate.sessionId],['작업 폴더',candidate.cwd||'미확인'],['프로젝트',projectName(candidate)],['최근 기록 갱신',candidate.updatedAt?new Date(candidate.updatedAt).toLocaleString('ko-KR'):'미확인']]){fields.append(text('dt',label),text('dd',value||'미확인'));}detail.append(fields);
  const copy=memberButton('ID 복사',async()=>{try{await navigator.clipboard.writeText(candidate.nativeId||candidate.sessionId);copy.textContent='복사됨';}catch{copy.textContent='ID를 선택해 복사해줘.';}});copy.className='picker-copy';detail.append(copy,text('p','다음 단계에서 실제 연결과 자동 전달 허용 범위를 확인해요.','picker-footnote'));
 }
 function navigate(event){if(!entries.length||event.isComposing)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();select((selected+(event.key==='ArrowUp'?-1:1)+entries.length)%entries.length,event.target!==query);}else if(event.key==='Enter'){event.preventDefault();choose.click();}}
 query.addEventListener('keydown',navigate);list.addEventListener('keydown',navigate);
 function syncSearchScope(){clearQuery.hidden=!query.value.trim();}
 async function load(){
  const own=++version;entries=[];selected=-1;choose.disabled=true;list.replaceChildren(text('p','세션을 찾고 있어요…','picker-empty'));select(-1);status.textContent='조회 중…';warning.textContent='';
  try{const params=new URLSearchParams();if(query.value.trim())params.set('query',query.value.trim());if(provider)params.set('provider',provider);if(internal.input.checked)params.set('includeInternal','1');const result=await req('/api/sessions/catalog?'+params);if(own!==version||!d.open)return;
   entries=result.sessions||[];list.replaceChildren();const activeQuery=query.value.trim();status.textContent=activeQuery?`전체 작업공간에서 “${activeQuery}” 검색 · ${entries.length}개`:`전체 작업공간 · ${entries.length}개 · 최근 기록 순`+(entries.length>=80?' · 최대 80개':'');
   warning.textContent=(result.errors||[]).map(e=>typeof e==='string'?e:`${e.provider}: ${e.message}`).join(' / ');
   entries.forEach((candidate,index)=>{const row=text('button','','picker-option');row.type='button';row.id='session-choice-'+index;row.setAttribute('role','option');row.setAttribute('aria-selected','false');row.tabIndex=-1;
    const icon=document.createElement('img');icon.src='/assets/providers/'+candidate.provider+'.png';icon.alt=candidate.provider;icon.className='picker-provider-icon';
    const summary=text('span','','picker-option-text');summary.append(text('strong',candidate.title||'제목 없는 세션'),text('span',(candidate.provider==='codex'?'Codex':'Claude')+' · '+projectName(candidate),'picker-option-meta'));
    const updated=text('small',timeLabel(candidate.updatedAt),'picker-updated');updated.title='최근 기록 갱신: '+(candidate.updatedAt?new Date(candidate.updatedAt).toLocaleString('ko-KR'):'미확인');
    row.append(icon,summary,updated);row.onclick=()=>select(index);row.ondblclick=()=>{select(index);choose.click();};list.append(row);
   });
   if(!entries.length)list.append(text('p','일치하는 세션이 없어요. 검색어를 바꾸거나 직접 등록해보세요.','picker-empty'));
   select(entries.length?0:-1);
  }catch(e){if(own!==version||!d.open)return;list.replaceChildren(text('p',e.message,'form-error'));status.textContent='조회 실패';}
 }
 query.oninput=()=>{syncSearchScope();clearTimeout(timer);timer=setTimeout(load,180);};internal.input.onchange=load;d.addEventListener('close',()=>{clearTimeout(timer);version++;});syncSearchScope();await load();
}
async function editLimits(){
 if(!active())return;const roomId=current.id,{d,f}=dialog('자동 대화 설정');d.classList.add('dialogue-settings-dialog');
 f.append(text('p','내 입력 한 번에 얼마나 논의할까요?','settings-intro'),text('p','여러 참여자에게 동시에 물어도 한 차례로 세요. 새 사용자 입력은 새 한도로 시작해요.','setting-help'));
 const choices=text('fieldset','','dialogue-presets');choices.append(text('legend','자동 질문·답변 횟수'));
 let selected=dialoguePresets.some(p=>p.rounds===current.round_budget)?String(current.round_budget):'custom';
 const customLabel=text('label','최대 횟수','custom-rounds'),rounds=document.createElement('input');rounds.type='number';rounds.name='rounds';rounds.min='1';rounds.max='100';rounds.required=true;rounds.value=current.round_budget;customLabel.append(rounds);
 for(const preset of [...dialoguePresets,{rounds:'custom',label:'직접 정하기',detail:'1~100차례 안에서 정해요.'}]){
  const label=text('label','','dialogue-preset'),radio=document.createElement('input');radio.type='radio';radio.name='preset';radio.value=String(preset.rounds);radio.checked=radio.value===selected;
  const copy=text('span');copy.append(text('strong',preset.label),text('small',preset.detail));label.append(radio,copy);choices.append(label);
  radio.onchange=()=>{selected=radio.value;sync();};
 }
 f.append(choices,customLabel);const advanced=text('details','','dialogue-advanced');advanced.append(text('summary','고급 · 메시지 전달 안전 상한'));
 const requests=inputField(advanced,'입력 한 번당 최대 메시지 전달 수','requests',current.request_budget,'number');requests.min='1';requests.max='100';
 advanced.append(text('p','여러 참여자에게 보낸 질문과 좌장의 취합 요청을 모두 합쳐 세요. 이 상한에 먼저 도달하면 선택한 횟수보다 일찍 자동 질문이 멈출 수 있어요.','setting-help'));
 const summary=text('p','','dialogue-limit-summary');f.append(advanced,summary,text('p','한도에 도달하면 추가 자동 질문만 멈춰요. 다음 사용자 입력은 계속 보낼 수 있어요.','setting-help'));
 function sync(){customLabel.hidden=selected!=='custom';rounds.disabled=selected!=='custom';summary.textContent=dialogueLimitSummary(selected==='custom'?Number(rounds.value):Number(selected),Number(requests.value));}
 rounds.oninput=sync;requests.oninput=sync;sync();const errorBox=text('p','','form-error');f.append(errorBox);actions(f,'적용');
 f.onsubmit=async event=>{event.preventDefault();const submit=f.querySelector('[type=submit]');submit.disabled=true;try{await req(`/api/rooms/${roomId}/limits`,{method:'POST',body:JSON.stringify({requestBudget:Number(requests.value),roundBudget:selected==='custom'?Number(rounds.value):Number(selected)})});d.close();await openRoom(roomId,false);}catch(e){errorBox.textContent=e.message;submit.disabled=false;}};d.showModal();
}
function updateRoomControls(){for(const id of ['invite','limits','workspaceButton'])$('#'+id).disabled=!active();$('#composer button[type=submit]').disabled=!active()||attachmentComposer?.pending();const steer=$('#kind option[value=steer]');steer.disabled=true;steer.textContent='방향 수정 · 연결 미지원';}
const inviteButton=memberButton('세션 초대',()=>showDiscovery());inviteButton.id='invite';const limitButton=memberButton('자동 대화 설정',editLimits);limitButton.id='limits';$('.room-actions').prepend(inviteButton,limitButton);$('#discover').onclick=showDiscovery;
agendaUI=createAgendaUI({document,request:req,renderMarkdown,renderAttachments,error,getRoom:()=>current,getChannels:()=>channels,onChange:()=>openRoom(current?.id,false)});
const agendaButton=memberButton('안건으로 토론',()=>agendaUI.start());agendaButton.id='agendaStart';agendaButton.classList.add('toolbar-primary');
const knowledgeButton=memberButton('자료·지식',()=>agendaUI.knowledge());knowledgeButton.id='knowledge';
const settingsButton=memberButton('앱 설정',()=>agendaUI.settings());settingsButton.id='appSettings';
$('.room-actions').prepend(agendaButton,knowledgeButton,settingsButton);
decorateAction(knowledgeButton,'workspace');decorateAction(settingsButton,'settings');
$('#workspaceButton').onclick=workspaceDialog;

$('#kind').value='followup';$('#kind').dispatchEvent(new Event('change'));

const chairStatus=state=>({initializing:'좌장 생성 중',ready:'좌장 준비됨',submitting:'좌장에게 전달 중',running:'응답 생성 중',unknown:'좌장 실행 확인 필요',failed:'좌장 연결 실패'}[state]||state);
let chairSettingsOpening=false;
async function chairSettingsDialog({onboarding=false}={}){
 if(!active()||chairSettingsOpening)return;chairSettingsOpening=true;const roomId=current.id,chair=current.chair;let catalog;try{catalog=await req('/api/chair/options');}catch(e){if(onboarding&&current?.id===roomId){error('토론장은 생성됐지만 좌장 설정 옵션을 불러오지 못했어요. 좌장 미설정 상태로 유지돼요.');renderParticipants();}else error(e.message);chairSettingsOpening=false;return;}if(current?.id!==roomId||!active()){chairSettingsOpening=false;return;}
 const {d,f}=dialog(chair?'좌장 설정':'좌장 만들기');d.classList.add('chair-settings-dialog');
 f.append(text('p',chair?'다음 응답에 쓸 모델과 추론 깊이를 정해요.':onboarding?'현재 좌장이 없어요. 설정한 뒤 다음 단계에서 세션을 초대할 수 있어요.':'이 토론장만 맡을 별도 좌장을 만들어요.','settings-intro'));
 const fields=chairSettingsFields(document,catalog,{provider:chair?.provider||catalog.defaults?.provider||'claude',model:chair?.model,effort:chair?.effort,lockedProvider:!!chair});f.append(fields.element);
 f.append(text('p',chair?'Provider와 대화 ID는 그대로 유지해요. 진행 중인 응답은 기존 설정으로 마치고, 변경한 설정은 다음 실행부터 적용해요.':'Provider는 생성 후 고정돼요. 모델과 effort는 토론 중에도 바꿀 수 있어요.','settings-application'));
 if(chair?.error)f.append(text('p',chair.error,'form-error'));
 const errorBox=text('p','','form-error');errorBox.setAttribute('role','status');f.append(errorBox);actions(f,chair?'다음 응답부터 적용':'좌장 만들기');if(onboarding&&!chair)f.querySelector('menu button[type=button]').textContent='나중에 설정';
 let saving=false;d.addEventListener('cancel',event=>{if(saving)event.preventDefault();});d.addEventListener('close',()=>{chairSettingsOpening=false;});
 f.onsubmit=async event=>{event.preventDefault();if(saving)return;saving=true;const values=fields.value();for(const control of f.querySelectorAll('input,select,button'))control.disabled=true;errorBox.textContent=chair?'설정 저장 중…':'별도 좌장을 생성 중이에요. 잠시 기다려주세요…';
  try{await req(`/api/rooms/${roomId}/chair${chair?'/settings':''}`,{method:'POST',body:JSON.stringify(values)});d.close();if(current?.id!==roomId)return;await openRoom(roomId,false);if(onboarding&&!chair&&current?.id===roomId)showDiscovery();}
  catch(e){errorBox.textContent=e.message;for(const control of f.querySelectorAll('input,select,button'))control.disabled=false;fields.providerInput.disabled=!!chair;fields.customInput.disabled=fields.modelInput.value!=='__custom__';fields.effortInput.disabled=fields.effortInput.options.length===1;}
  finally{saving=false;renderChairControl();renderToolbar();}
 };d.showModal();
}
const createChairButton=memberButton('좌장 만들기',()=>current?.chair?showMemberDetail(current.chair.session_id||'chair'):chairSettingsDialog());
createChairButton.id='createChair';$('.room-actions').prepend(createChairButton);
function renderChairControl(){const chair=current?.chair;createChairButton.disabled=!active()||chair?.status==='initializing';createChairButton.textContent=chair?(chair.status==='initializing'?'좌장 생성 중':'좌장 상세'):'좌장 만들기';createChairButton.title=chair?'좌장 상세와 모델·effort 설정':'별도 좌장 만들기';}
const detailToggle=memberButton('세션 상세',()=>{const open=$('.inspector').classList.toggle('open');detailToggle.setAttribute('aria-expanded',String(open));});detailToggle.classList.add('details-toggle');detailToggle.setAttribute('aria-expanded','false');$('.room-actions').append(detailToggle);

const closeInspector=memberButton('닫기',()=>{$('.inspector').classList.remove('open');detailToggle.setAttribute('aria-expanded','false');});closeInspector.className='inspector-close';closeInspector.replaceChildren(actionIcon('close'));closeInspector.setAttribute('aria-label','세션 상세 닫기');$('.inspector-heading').append(closeInspector);

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

const moreActions=document.createElement('details');moreActions.className='room-more';
const moreSummary=text('summary','','toolbar-more');moreSummary.setAttribute('aria-label','토론장 더 보기');moreSummary.title='더 보기';moreSummary.append(actionIcon('more'));
const morePanel=text('div','','room-more-panel');for(const button of [limitButton,$('#pause'),$('#archive'),$('.layout-reset')]){if(button){morePanel.append(button);button.addEventListener('click',()=>{moreActions.open=false;});}}
moreActions.append(moreSummary,morePanel);$('.room-actions').append(moreActions);inviteButton.classList.add('toolbar-primary');decorateAction(detailToggle,'detail');detailToggle.classList.add('toolbar-detail');renderToolbar();
document.addEventListener('pointerdown',event=>{if(moreActions.open&&!moreActions.contains(event.target))moreActions.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&moreActions.open){moreActions.open=false;moreSummary.focus();}});

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
