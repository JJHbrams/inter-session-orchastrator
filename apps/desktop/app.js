import {parseAliases, mentionAt, mentionSpans} from '/mentions.js';
let csrf, current, rooms=[], channels=[], pendingSend, selectedRoomId;const stateLabel={queued:'요청 대기',claimed:'전달 예약',submitting:'요청 제공 중',accepted:'호스트 접수',running:'생성 중',completed:'응답 회수',unknown:'확인 필요',blocked:'차단',failed:'실패',cancelled:'취소'}; const $=s=>document.querySelector(s);
const req=async(path,opt={})=>{const r=await fetch(path,{...opt,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...opt.headers}});const data=await r.json();if(!r.ok)throw Error(data.error||'요청을 처리하지 못했습니다.');return data};
const text=(tag,value,cls)=>{const x=document.createElement(tag);x.textContent=value;if(cls)x.className=cls;return x};
function error(value=''){const e=$('#error');e.textContent=value;e.hidden=!value}
function active(){return current&&!current.archived_at}
function renderNav(){const nav=$('#rooms');nav.replaceChildren();const groups=[...channels.map(c=>[c,rooms.filter(r=>r.channel_id===c.id)]),[{name:'채널 없음'},rooms.filter(r=>!r.channel_id)]];for(const [channel,list] of groups){if(!list.length&&!channel.id)continue;nav.append(text('p','# '+channel.name,'channel-label'));for(const room of list){const b=text('button',(room.archived_at?'⌁ ':'# ')+room.name,'room-link'+(current?.id===room.id?' active':''));b.onclick=()=>openRoom(room.id);nav.append(b)}}const select=$('#channelChoice');const empty=text('option','채널 없음');empty.value='';select.replaceChildren(empty);for(const c of channels){const o=text('option',c.name);o.value=c.id;select.append(o)}}
async function refresh(keep=true){const [rs,cs]=await Promise.all([req('/api/rooms'),req('/api/channels')]);rooms=rs.rooms;channels=cs.channels;renderNav();if(keep&&current){const found=rooms.find(r=>r.id===current.id);if(found)await openRoom(found.id,false)}}
function deliveryText(message){const ds=current.deliveries.filter(d=>d.message_id===message.id);if(!ds.length)return null;const wrap=document.createElement('div');wrap.className='delivery-list';for(const d of ds){const m=current.members.find(x=>x.id===d.membership_id);const badge=text('span',`${m?.alias||m?.display_name||m?.native_id||'수신자'} · ${stateLabel[d.state]||d.state}`,'badge '+d.state);badge.title=`요청: ${d.request_id}${d.blocked_reason?'\n사유: '+d.blocked_reason:''}`;wrap.append(badge)}return wrap}

function renderTimeline() {
  const view=$('#timeline'); view.replaceChildren();
  if(!current.messages.length) {view.append(text('div','@별칭으로 질문하거나, 게시로 대화의 맥락을 남겨보세요.','empty'));return;}
  for(const m of current.messages) {
    const card=document.createElement('section');card.className='message';card.id='message-'+m.id;
    const author=current.members.find(x=>x.session_id===m.sender_session_id);
    const head=text('div','','message-head');
    head.append(author?avatar(author):text('span','나','avatar human'));
    head.append(text('strong',author?memberName(author):'사용자','message-author'));
    if(author)head.append(text('span',providerName(author),'provider-badge'));
    const body=text('p','');let cursor=0;
    for(const span of mentionSpans(m.body)) {
      body.append(document.createTextNode(m.body.slice(cursor,span.start)));
      const known=current.members.some(member=>member.alias===span.alias);
      body.append(text('span',m.body.slice(span.start,span.end),known?'mention':'mention unknown'));
      cursor=span.end;
    }
    body.append(document.createTextNode(m.body.slice(cursor)));
    card.append(head,body);
    const meta=text('div',`${m.kind} · ${new Date(m.created_at).toLocaleString('ko-KR')}`,'message-meta');
    if(m.reply_to){const a=text('a','원문 보기');a.href='#message-'+m.reply_to;meta.append(document.createTextNode(' · '),a);}
    card.append(meta);const ds=deliveryText(m);if(ds)card.append(ds);
    renderReactions(m,card);view.append(card);
  }
}

function renderParticipants() {
  const area=$('#participants');area.replaceChildren();
  for(const m of current.members) {
    const deliveries=current.deliveries.filter(d=>d.membership_id===m.id&&['followup','steer'].includes(d.kind));
    const state=['running','unknown','submitting','accepted','claimed','queued','blocked'].find(state=>deliveries.some(d=>d.state===state));
    const b=text('button','','participant'+(state==='running'?' generating':''));
    b.disabled=!!m.left_at;b.dataset.state=state||'idle';
    const identity=text('span','','participant-identity');identity.append(avatar(m),text('strong',memberName(m)));
    b.append(identity,text('span',providerName(m)+(m.role==='chair'?' · 좌장':''),'provider-badge'));
    b.append(text('span',m.left_at?'이탈':m.read_only?'읽기 전용':state?stateLabel[state]:'참여 중',state==='unknown'||m.read_only?'blocked':'ok'));
    b.title=`${m.display_name||''}\n${m.provider} · ${m.mode}`;
    b.onclick=()=>{const detail=$('#memberDetail');detail.replaceChildren(text('strong',memberName(m)),text('div',`원래 이름: ${m.display_name||'없음'}\nNative ID: ${m.native_id}\nCWD: ${m.cwd}\n연결 모드: ${m.mode}\n소유: ${m.ownership}\n정책: ${m.policy_revision||'관측 불가'}\n상태: ${m.blocked_reason||'사용자가 확인한 참여 정보'}`,'detail'));const raw=text('button','원래 세션 출력 보기');raw.disabled=JSON.parse(m.capabilities||'{}').rawInspect!==true;raw.title=raw.disabled?'이 참여자에 원래 출력 조회가 허용되지 않았어.':'';raw.onclick=async()=>{try{const r=await req(`/api/rooms/${current.id}/sessions/${m.session_id}/output`);detail.replaceChildren(text('p',r.warning||'선택한 출력입니다.','muted'),text('pre',(r.lines||[]).join('\n'),'detail'))}catch(e){error(e.message)}};detail.append(raw,memberButton('좌장으로 지정',()=>setRole(m,'chair')),memberButton('참여 정보 발급',()=>provision(m)),memberButton('토론에서 빼기',()=>leaveMember(m)))};area.append(b);
  }
}
function renderDecisions(){const box=$('#decisions');box.replaceChildren();if(!current.decisions.length){box.append(text('p','아직 제안된 결정이 없습니다.','muted'));return}for(const d of current.decisions){const item=document.createElement('div');item.className='decision';item.append(text('p',d.body),text('small',`${d.status==='confirmed'?'사용자 확정':'좌장 제안'} · 근거 ${d.source_ids?d.source_ids.split(',').length:0}개`));for(const source of (d.source_ids||'').split(',').filter(Boolean)){const a=text('a','근거 보기');a.href='#message-'+source;item.append(a)}if(d.status==='proposed'){const b=text('button','사용자 확정');b.onclick=async()=>{try{await req(`/api/rooms/${current.id}/decisions/${d.id}/confirm`,{method:'POST',body:'{}'});openRoom(current.id)}catch(e){error(e.message)}};item.append(b)}box.append(item)}}
async function openRoom(id,scroll=true){try{if(scroll)selectedRoomId=id;const view=await req('/api/rooms/'+id);if(id!==selectedRoomId)return;current=view;$('#title').textContent=current.name+(current.archived_at?' · 보관됨':current.paused_at?' · 중지됨':'');$('#pause').textContent=current.paused_at?'재개':'중지';$('#pause').disabled=!active();$('#archive').disabled=!active();renderNav();renderParticipants();renderTimeline();renderDecisions();renderMentionMenu();updateRoomControls();if(scroll)$('#timeline').scrollTop=$('#timeline').scrollHeight}catch(e){error(e.message)}}

const memberName=m=>m?.alias||m?.display_name||'참여자';
const providerName=m=>({codex:'Codex',claude:'Claude'}[m.provider]||m.provider);
function avatar(member) {
  const node=text('span',memberName(member).slice(0,1),'avatar');
  const color=/^#[0-9a-f]{6}$/i.test(member.avatar||'')?member.avatar:'#6479c9';
  node.style.setProperty('--avatar',color);node.setAttribute('aria-hidden','true');return node;
}
function renderReactions(message,card) {
  const wrap=text('div','','reactions');wrap.setAttribute('aria-label','메시지 반응');
  for(const [emoji,name] of [['👍','좋아요'],['❤️','공감'],['💡','아이디어'],['👀','확인 중']]) {
    const on=(current.reactions||[]).some(r=>r.message_id===message.id&&r.emoji===emoji&&r.actor==='local-human');
    const button=text('button',emoji+(on?' 1':''),'reaction'+(on?' selected':''));button.type='button';
    button.setAttribute('aria-label',name+' 반응');button.setAttribute('aria-pressed',String(on));
    button.title=name+(on?' 취소':'');
    button.onclick=async()=>{button.disabled=true;try{await req(`/api/rooms/${current.id}/messages/${message.id}/reactions`,{method:'POST',body:JSON.stringify({emoji,active:!on})});await openRoom(current.id,false);}catch(e){error(e.message);button.disabled=false;}};
    wrap.append(button);
  }
  card.append(wrap);
}
let mentionIndex=0,mentionClosed=false;
function currentMention() {const body=$('#body');return mentionAt(body.value,body.selectionStart);}
function mentionCandidates() {
  const span=currentMention();if(!span||!current)return [];
  return current.members.filter(m=>!m.left_at&&m.alias?.toLowerCase().startsWith(span.alias.toLowerCase()));
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
  if(mentionSpans($('#body').value,true).some(span=>!span.alias))return {members:[],problem:'멘션할 이름을 골라줘.'};
  const aliases=parseAliases($('#body').value),members=current.members.filter(m=>!m.left_at);
  if(!aliases.length)return {members:members.filter(m=>!m.read_only),problem:'',all:true};
  const chosen=[];
  for(const alias of aliases) {
    const matches=members.filter(m=>m.alias===alias);
    if(matches.length!==1)return {members:[],problem:`@${alias} · 현재 토론에서 찾을 수 없는 이름이야.`};
    if(matches[0].read_only)return {members:[],problem:`@${alias} · 읽기 전용이라 질문을 보낼 수 없어.`};
    chosen.push(matches[0]);
  }
  return {members:chosen,problem:''};
}
function renderPreview() {
  const box=$('#recipientPreview');if(!box)return;box.replaceChildren();
  const kind=$('#kind').value;
  if(['post','notify'].includes(kind)){box.append(text('span','게시와 알림은 실행 요청을 만들지 않아요.'));return;}
  const preview=resolvedPreview();box.className='recipient-preview'+(preview.problem?' invalid':'');
  if(preview.problem){box.append(text('span',preview.problem));return;}
  box.append(text('span',preview.all?'모두에게':'보낼 대상','recipient-caption'));
  for(const m of preview.members){const chip=text('span','','recipient-chip');chip.append(avatar(m),text('span',memberName(m)));box.append(chip);}
  if(!preview.members.length)box.append(text('span','질문할 수 있는 참여자가 없어요.'));
}
function renderMentionMenu() {
  const menu=$('#mentionMenu');if(!menu)return;
  const candidates=mentionCandidates();menu.replaceChildren();
  mentionIndex=Math.max(0,Math.min(mentionIndex,candidates.length-1));
  menu.hidden=mentionClosed||!candidates.length;
  $('#body').setAttribute('aria-expanded',String(!menu.hidden));
  $('#body').removeAttribute('aria-activedescendant');
  candidates.forEach((member,index)=>{
    const option=text('button','','mention-option'+(index===mentionIndex?' selected':''));option.type='button';
    option.id='mention-option-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected',String(index===mentionIndex));
    option.append(avatar(member),text('strong',memberName(member)),text('small',providerName(member)+(member.read_only?' · 읽기 전용':'')));
    option.onmousedown=e=>e.preventDefault();option.onclick=()=>chooseMention(member);menu.append(option);
    if(!menu.hidden&&index===mentionIndex)$('#body').setAttribute('aria-activedescendant',option.id);
  });
  renderPreview();
}
$('#body').addEventListener('input',()=>{error();mentionClosed=false;mentionIndex=0;renderMentionMenu();});
$('#body').addEventListener('click',()=>{mentionClosed=false;renderMentionMenu();});
$('#body').addEventListener('keydown',event=>{
  if(event.isComposing||$('#mentionMenu').hidden)return;
  const candidates=mentionCandidates();if(!candidates.length)return;
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();mentionIndex=(mentionIndex+(event.key==='ArrowDown'?1:-1)+candidates.length)%candidates.length;renderMentionMenu();}
  else if(['Enter','Tab'].includes(event.key)){event.preventDefault();chooseMention(candidates[mentionIndex]);}
  else if(event.key==='Escape'){event.preventDefault();mentionClosed=true;renderMentionMenu();}
});
$('#composer').addEventListener('submit',async event=>{
  event.preventDefault();if(!active())return error('보관된 토론장에는 새 입력을 남길 수 없습니다.');
  const kind=$('#kind').value,preview=resolvedPreview();
  if(['followup','steer'].includes(kind)&&(preview.problem||!preview.members.length))return error(preview.problem||'질문할 수 있는 참여자가 없어.');
  const payload={body:$('#body').value,kind,routingMode:'mentions',targets:[]};
  const signature=JSON.stringify({room:current.id,...payload});
  if(pendingSend?.signature!==signature)pendingSend={signature,key:crypto.randomUUID()};
  try{await req(`/api/rooms/${current.id}/messages`,{method:'POST',body:JSON.stringify({...payload,requestKey:pendingSend.key})});pendingSend=null;$('#body').value='';mentionClosed=false;await openRoom(current.id);error();}
  catch(e){error(e.message);}
});
$('#newRoom').onclick=()=>$('#roomDialog').showModal();$('#newChannel').onclick=()=>$('#channelDialog').showModal();$('#createRoom').onclick=async e=>{e.preventDefault();try{const r=await req('/api/rooms',{method:'POST',body:JSON.stringify({name:$('#roomName').value,channelId:$('#channelChoice').value||null})});$('#roomDialog').close();await refresh(false);openRoom(r.id)}catch(e){error(e.message)}};$('#createChannel').onclick=async e=>{e.preventDefault();try{await req('/api/channels',{method:'POST',body:JSON.stringify({name:$('#channelName').value})});$('#channelDialog').close();refresh(false)}catch(e){error(e.message)}};
$('#pause').onclick=async()=>{try{await req(`/api/rooms/${current.id}/${current.paused_at?'resume':'pause'}`,{method:'POST',body:'{}'});openRoom(current.id)}catch(e){error(e.message)}};$('#archive').onclick=async()=>{try{await req(`/api/rooms/${current.id}/archive`,{method:'POST',body:'{}'});await refresh(false);error('토론장을 보관했습니다.')}catch(e){error(e.message)}};$('#discover').onclick=async()=>{try{const d=await req('/api/discovery');$('#memberDetail').textContent=d.error||d.sessions.map(s=>`${s.provider}: ${s.handle}\n${s.blockedReason}`).join('\n\n')||'발견된 세션이 없습니다.'}catch(e){error(e.message)}};
$('#kind').onchange=()=>{renderPreview();$('#composeNote').textContent=['post','notify'].includes($('#kind').value)?'공동 대화에 기록해요.':'@이름으로 지정 · 멘션이 없으면 미리보기에 나온 모두에게';};
(async()=>{const b=await req('/api/bootstrap');csrf=b.csrf;await refresh(false);const first=rooms.find(r=>!r.archived_at)||rooms[0];if(first)openRoom(first.id);else updateRoomControls();setInterval(()=>{if(current)openRoom(current.id,false).catch(()=>{})},8000)})().catch(e=>error(e.message));

function memberButton(label,action){const b=text('button',label);b.onclick=async()=>{try{await action()}catch(e){error(e.message)}};return b}
async function setRole(member,role){await req(`/api/rooms/${current.id}/role`,{method:'POST',body:JSON.stringify({sessionId:member.session_id,role})});await openRoom(current.id,false)}
async function leaveMember(member){await req(`/api/rooms/${current.id}/leave`,{method:'POST',body:JSON.stringify({sessionId:member.session_id})});$('#memberDetail').replaceChildren(text('p','토론에서 빠졌어. 원래 세션은 계속 유지돼.'));await openRoom(current.id,false)}
function dialog(title){const d=document.createElement('dialog'),f=document.createElement('form');f.method='dialog';f.append(text('h2',title));d.append(f);document.body.append(d);d.addEventListener('close',()=>d.remove());return {d,f}}
function inputField(form,label,name,value='',type='text'){const l=text('label',label),i=document.createElement('input');i.name=name;i.type=type;i.value=value;i.required=true;l.append(i);form.append(l);return i}
function actions(form,submitLabel){const menu=document.createElement('menu'),cancel=text('button','취소'),submit=text('button',submitLabel,'accent');cancel.value='cancel';cancel.type='button';cancel.onclick=()=>form.closest('dialog').close();submit.type='submit';menu.append(cancel,submit);form.append(menu)}
async function provision(member){const result=await req(`/api/rooms/${current.id}/provision`,{method:'POST',body:JSON.stringify({sessionId:member.session_id})});const {d,f}=dialog('선택한 세션의 참여 정보');f.append(text('p','이 설정은 선택한 세션만 사용해. 다른 토론이나 세션에는 쓰지 않아.','muted'));const download=memberButton('비공개 설정 파일 저장',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result.config,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='rooms-'+member.provider+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});f.append(download,text('pre','node packages/mcp/participant.js --config 설정파일경로 inbox','detail'),text('p','MCP 클라이언트에는 packages/mcp/server.js와 ROOMS_URL / ROOMS_TOKEN을 이 설정 값으로 연결하면 돼. 등록만으로 기존 CLI를 자동으로 깨우지는 않아.','muted'));const close=memberButton('닫기',()=>d.close());f.append(close);d.showModal()}
async function invite(candidate){if(!active())return error('먼저 토론장을 선택해줘.');const {d,f}=dialog('세션 초대');const errorBox=text('p','','form-error');const providerLabel=text('label','Provider'),provider=document.createElement('select');for(const name of ['codex','claude']){const o=text('option',name);o.value=name;provider.append(o)}provider.value=candidate?.provider||'codex';providerLabel.append(provider);f.append(providerLabel);const name=inputField(f,'원래 세션 설명 (선택)','displayName',candidate?.provider||'');name.required=false;const native=inputField(f,'세션에서 확인한 고유 대화 ID','nativeId',candidate?.nativeId||'');const cwd=inputField(f,'작업 폴더','cwd',candidate?.cwd||'');const profile=inputField(f,'원래 프로필','profile',candidate?.profile||'default');f.append(text('p','터미널 이름이나 handle을 대화 ID로 쓰면 안 돼. 원래 세션이 확인한 ID를 입력해줘.','muted'));const pullLabel=text('label',''),pull=document.createElement('input');pull.type='checkbox';pullLabel.append(pull,document.createTextNode(' 확인한 세션에 MCP 직접 호출 허용'));const rawLabel=text('label',''),rawAllowed=document.createElement('input');rawAllowed.type='checkbox';rawAllowed.disabled=!candidate?.handle||!candidate?.incarnation;rawLabel.append(rawAllowed,document.createTextNode(' 원래 세션 출력 조회 허용'));f.append(pullLabel,rawLabel,errorBox);actions(f,'초대');f.onsubmit=async e=>{e.preventDefault();if(!f.reportValidity())return;try{const result=await req('/api/sessions',{method:'POST',body:JSON.stringify({provider:provider.value,host:'orca/local',nativeId:native.value,cwd:cwd.value,profile:profile.value,displayName:name.value,mode:pull.checked?'live_attach':'read_only',ownership:'borrowed',verified:pull.checked,handle:candidate?.handle||null,incarnation:candidate?.incarnation||null,capabilities:{followup:pull.checked,mcpPull:pull.checked,automaticInput:false,rawInspect:rawAllowed.checked},policyRevision:pull.checked?'participant-confirmed-inherited':null})});await req(`/api/rooms/${current.id}/join`,{method:'POST',body:JSON.stringify({sessionId:result.session.id,readOnly:!pull.checked})});d.close();await openRoom(current.id,false)}catch(e){errorBox.textContent=e.message}};d.showModal()}
async function showDiscovery(){const {d,f}=dialog('현재 Orca 세션');f.append(text('p','발견은 읽기 전용이야. 정확한 대화 ID를 확인한 뒤 초대할 수 있어.','muted'));const content=text('div','조회 중…','discovery-list');f.append(content,memberButton('직접 등록',()=>{d.close();invite()}),memberButton('닫기',()=>d.close()));d.showModal();try{const result=await req('/api/discovery');content.replaceChildren();if(result.error)content.append(text('p',result.error,'form-error'));for(const candidate of result.sessions||[]){const row=document.createElement('div');row.className='discovery-row';row.append(text('strong',candidate.provider),text('p',candidate.handle+' · '+candidate.incarnation,'detail'),text('p',candidate.cwd||'작업 위치 미확인','detail'),memberButton('ID 확인 후 초대',()=>{d.close();invite(candidate)}));content.append(row)}if(!result.sessions?.length&&!result.error)content.append(text('p','현재 조회 가능한 세션이 없어.'))}catch(e){content.textContent=e.message}}
async function editLimits(){if(!current)return;const {d,f}=dialog('토론 한도');const requests=inputField(f,'최대 요청 수','requests',current.request_budget,'number'),rounds=inputField(f,'좌장 질문 라운드','rounds',current.round_budget,'number');for(const i of [requests,rounds]){i.min='1';i.max='100'}const errorBox=text('p','','form-error');f.append(errorBox);actions(f,'적용');f.onsubmit=async e=>{e.preventDefault();try{await req(`/api/rooms/${current.id}/limits`,{method:'POST',body:JSON.stringify({requestBudget:Number(requests.value),roundBudget:Number(rounds.value)})});d.close();await openRoom(current.id,false)}catch(e){errorBox.textContent=e.message}};d.showModal()}
function updateRoomControls(){for(const id of ['invite','limits'])$('#'+id).disabled=!active();$('#composer button[type=submit]').disabled=!active();const steer=$('#kind option[value=steer]');steer.disabled=true;steer.textContent='방향 수정 · 연결 미지원';}
const inviteButton=memberButton('세션 초대',()=>invite());inviteButton.id='invite';const limitButton=memberButton('토론 한도',editLimits);limitButton.id='limits';$('.room-actions').prepend(inviteButton,limitButton);$('#discover').onclick=showDiscovery;
$('#kind').value='followup';$('#kind').dispatchEvent(new Event('change'));
