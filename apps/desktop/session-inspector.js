import {deliveryPresentation} from './delivery-status.js';
import {modelCaption} from './participant-settings-ui.js';

const labels={queued:'요청 대기',claimed:'전달 준비',submitting:'전달 중',accepted:'접수됨',running:'응답 중',unknown:'결과 확인',blocked:'전달 보류',failed:'응답 실패',cancelled:'취소됨'};
const node=(doc,tag,value,cls)=>{const el=doc.createElement(tag);if(value)el.textContent=value;if(cls)el.className=cls;return el;};
export const capabilitiesFor=member=>typeof member.capabilities==='string'?JSON.parse(member.capabilities||'{}'):(member.capabilities||{});
export const memberKey=member=>member.session_id||'chair';
export function sessionMembers(room){const members=[...room.members];if(room.chair&&!members.some(m=>m.session_id&&m.session_id===room.chair.session_id))members.unshift({id:'chair',session_id:null,alias:'좌장',role:'chair',provider:room.chair.provider,native_id:room.chair.native_id,mode:'new',ownership:'owned'});return members;}

// Activity describes the current request's purpose, not a provider's hidden reasoning stream.
function runningActivity(room,pending,ownedChair){
 const message=(room.messages||[]).find(m=>m.id===pending?.message_id),key=message?.request_key||'';
 let body;try{body=JSON.parse(message?.body)}catch{}
 if(['agenda_relevance','agenda_participation'].includes(body?.type))return ['analysis','참여 판단 중'];
 if(body?.type==='agenda_review'||key.endsWith(':review'))return ['review','검토 중'];
 if(ownedChair){
  const stage=key.split(':chair:')[1]?.split(':')[0];
  if(['synthesize','final'].includes(stage))return ['synthesis','취합 중'];
  if(['discussion','refine'].includes(stage))return ['mediation','조율 중'];
  if(stage==='plan')return ['analysis','분석 중'];
 }
 if(key.includes(':evidence:'))return ['analysis','조사 중'];
 return ['response','응답 중'];
}

export function sessionPresentation(room,member){
 const ownedChair=!!room.chair&&(member.session_id===room.chair.session_id||member.id==='chair'),deliveries=room.deliveries.filter(d=>d.membership_id===member.id&&['followup','steer'].includes(d.kind)),writerBlocker=member.writerBlocker||null;
 const localBlocker=writerBlocker?.roomId===room.id?{id:writerBlocker.deliveryId,request_id:writerBlocker.requestId,state:writerBlocker.state,blocked_reason:writerBlocker.reason}:null;
 const pending=localBlocker||['running','unknown','submitting','accepted','claimed','queued','blocked'].map(state=>deliveries.find(d=>d.state===state)).find(Boolean)||(deliveries.at(-1)?.state==='failed'?deliveries.at(-1):null);
 const view=pending?deliveryPresentation(pending):null,control=member.modelSettings?.control;
 let state=view?.state||'idle',label=labels[state]||'대기 중',severity=['unknown','blocked'].includes(state)?'warning':state==='failed'?'error':state==='running'?'working':'neutral',reason=view?.reason||'',hint='카드를 눌러 세션 정보를 확인해요.';
 if(writerBlocker&&!localBlocker){state='unknown';label='결과 확인';severity='warning';reason=`다른 토론방의 요청(${writerBlocker.requestId}) 결과 확인이 먼저 필요해요.`;}
 if(state==='blocked'){
  const code=pending.blocked_reason||'';
  label=/draft|composer|입력/.test(code)?'입력 확인':/busy|idle/.test(code)?'대기 확인':/screen/.test(code)?'화면 확인':/identity|연결/.test(code)?'연결 확인':'전달 보류';
 }
 if(ownedChair&&room.chair.status!=='ready'){state=room.chair.status;label=state==='initializing'?'생성 중':'연결 실패';severity=state==='initializing'?'neutral':'error';reason=room.chair.error||'별도 좌장을 준비하고 있어요.';}
 if(control){state='settings';label=control.status==='unknown'?'설정 확인':'설정 중';severity=control.status==='unknown'?'warning':'neutral';reason=control.error||'원래 세션의 모델 설정을 확인하고 있어요.';}
 if(member.read_only){state='read_only';label='읽기 전용';severity='neutral';reason='대화와 자료를 조회할 수 있지만 실행 요청은 받지 않아요.';}
 if(member.left_at){state='left';label='이탈';severity='neutral';reason='이 세션은 토론장에서 나갔어요. 기존 발언과 기록은 유지돼요.';}
 let activity=({queued:'queued',claimed:'delivery',submitting:'delivery',accepted:'accepted',initializing:'setup',settings:severity==='warning'?'attention':'settings',unknown:'attention',blocked:'attention',failed:'error'}[state]||'idle');
 if(state==='running'){[activity,label]=runningActivity(room,pending,ownedChair);severity='working';}
 const active=!['idle','attention','error'].includes(activity);
 if(!reason)reason=({queued:'요청이 대기열에 있어요. 모델 실행은 아직 확인되지 않았어요.',delivery:'원래 세션에 요청을 전달하고 있어요. 모델 실행은 아직 확인되지 않았어요.',accepted:'호스트가 요청을 접수했어요. 모델의 실행 시작 확인을 기다려요.',analysis:'현재 조사·분석 또는 참여 판단 요청을 처리 중이에요. 내부 사고 단계는 따로 관측하지 않아요.',review:'현재 결론과 다른 참여자의 논거를 검토하는 요청을 처리 중이에요.',synthesis:'좌장이 현재 요청에 따라 논거와 결론을 취합 중이에요.',mediation:'좌장이 현재 요청에 따라 논점과 이견을 조율 중이에요.',response:'실제 모델 실행 시작을 확인했어요. 답변을 기다리고 있어요.'})[activity]||'';
 if(severity==='warning'||severity==='error')hint='상태 설명과 복구 방법은 우측 상세에서 확인해요.';
 const caption=ownedChair?`${room.chair.model||'CLI 기본 모델'} · ${room.chair.effort||'기본 effort'}`:modelCaption(member),nativeChat=capabilitiesFor(member).transport==='orca-native-chat',directClaude=capabilitiesFor(member).transport==='claude-direct'&&member.mode==='resume';
 const settingsAllowed=!nativeChat&&!directClaude&&!room.archived_at&&!member.left_at&&!member.read_only&&(ownedChair?room.chair.status==='ready':['codex','claude'].includes(member.provider)&&member.mode==='live_attach'&&!!member.handle&&!!member.incarnation);
 const settingsReason=settingsAllowed?'':directClaude?'Claude 직접 연결은 원래 CLI 설정을 따름':nativeChat?'기존 Orca 채팅의 모델 설정은 이 토론장에서 변경하지 않아요.':room.archived_at?'보관된 토론장이에요.':member.left_at?'이탈한 세션이에요.':member.read_only?'읽기 전용 세션이에요.':ownedChair?'좌장 연결이 준비된 뒤 설정할 수 있어요.':'현재 실행 중인 세션과의 연결을 먼저 확인해줘.';
 return {state,label,severity,reason,hint,caption,ownedChair,pending,writerBlocker,settingsAllowed,settingsReason,directClaude,activity,active};
}

export function renderSessionDetail({document,room,member,view,avatar,actions}){
 const root=node(document,'div','','session-detail'),header=node(document,'div','','session-detail-hero'),identity=node(document,'div','','session-detail-identity');
 header.append(avatar(member));identity.append(node(document,'strong',member.alias||member.display_name||'세션'),node(document,'span',`${member.provider} · ${view.ownedChair?'좌장':'참여 세션'}`));header.append(identity);root.append(header);
 const unknown=(room.chair_runs||[]).filter(r=>view.ownedChair&&r.status==='unknown');
 const status=node(document,'div','','session-state '+view.severity);status.append(node(document,'span',view.label,'session-state-label'),node(document,'p',(unknown.length?'이전 실행 결과를 확인한 뒤 계속할 수 있어요.':view.reason)||(view.state==='running'?'실제 응답 생성을 확인했어요.':view.state==='queued'?'아직 실행이 시작되지 않았어요.':view.ownedChair?'이 토론장을 맡는 별도 좌장이에요.':'새 요청을 받을 준비가 됐어요.')));root.append(status);
 const section=(title,kicker)=>{const el=node(document,'section','','session-detail-section'),heading=node(document,'div','','session-section-heading');heading.append(node(document,'h3',title),node(document,'span',kicker,'session-section-kicker'));el.append(heading);root.append(el);return el;};
 const button=(label,action,{disabled=false,title='',className=''}={})=>{const el=node(document,'button',label,'session-action '+className);el.type='button';el.disabled=disabled;el.title=title;el.onclick=async()=>{el.disabled=true;try{await action();}catch(error){feedback.hidden=false;feedback.textContent=error.message||'요청을 완료하지 못했어요.';}finally{if(el.isConnected)el.disabled=disabled;}};return el;};
 const model=section('모델 · effort','MODEL'),values=node(document,'div','','session-model-values');
 const observed=member.modelSettings?.observed,modelName=view.ownedChair?room.chair.model||'CLI 기본값':observed?.modelLabel||observed?.model||'미확인',effort=view.ownedChair?room.chair.effort||'기본값':observed?.effort||'미확인';
 for(const [name,value] of [['모델',modelName],['effort',effort]]){const row=node(document,'div');row.append(node(document,'span',name),node(document,'strong',value));values.append(row);}model.append(values);
 if(!view.directClaude){const settings=button('모델 · effort 설정',actions.settings,{disabled:!view.settingsAllowed,title:view.settingsReason,className:'session-settings-action'});settings.setAttribute('aria-label',`${member.alias||'좌장'} 모델·effort 설정`);model.append(settings);}
 if(capabilitiesFor(member).transport==='orca-native-chat'&&actions.refreshMetadata){model.append(button('모델 정보 다시 확인',actions.refreshMetadata,{disabled:member.modelSettings?.lookup?.status==='pending'}),node(document,'p',member.modelSettings?.lookup?.status==='failed'?'원래 세션의 설정 정보를 읽지 못했어요. 다시 확인할 수 있어요.':member.modelSettings?.observed?.reasonCode?'원래 세션이 일부 설정 값을 제공하지 않았어요. 확인된 값만 표시해요.':'초대 시와 응답 후 원래 세션의 설정 정보를 읽어와요.','session-helper'));}
 model.append(node(document,'p',view.settingsReason||(view.ownedChair?'변경은 다음 응답부터 적용돼요.':observed?`마지막 확인: ${new Date(observed.observedAt).toLocaleString('ko-KR')}. 설정 창에서 현재값을 다시 조회할 수 있어요.`:'확인된 설정값이 없어요. 모델 · effort 설정을 열면 원래 세션에서 조회해요. 조회에는 최대 2분이 걸릴 수 있어요.'),'session-helper'));
  if(view.reason||unknown.length||view.pending||view.writerBlocker){const diagnostics=section('상태와 복구','STATUS');
  for(const run of unknown){const item=node(document,'div','','session-diagnostic');item.append(node(document,'strong','이전 실행 확인 필요'),node(document,'p',run.error||'응답 접수 여부를 확인하지 못했어요.'));if(run.output_json)item.append(button('저장된 답변 반영',()=>actions.reconcile(run.id),{disabled:!!room.paused_at||!!room.archived_at}),node(document,'p','모델을 다시 호출하지 않고 저장된 응답을 검증해 토론장에 반영해요.','session-helper'));else item.append(node(document,'p','저장된 답변이 없어 재전송하지 않아. 실행 이력을 확인해줘.','session-helper'));diagnostics.append(item);}
  if(view.writerBlocker){const info=node(document,'dl','','session-facts');for(const [label,value] of [['차단 요청 ID',view.writerBlocker.requestId],['전달 상태',view.writerBlocker.state],['확인 사유',view.writerBlocker.reason]]){if(value){info.append(node(document,'dt',label),node(document,'dd',value));}}diagnostics.append(info);if(view.writerBlocker.roomId!==room.id)diagnostics.append(node(document,'p',`이 요청은 다른 토론방(${view.writerBlocker.roomId})에 있어요. 해당 방에서 상태를 확인해줘.`,'session-helper'));else diagnostics.append(node(document,'p','상태 확인은 원래 제출과 응답만 다시 읽고 작업을 재전송하지 않아요. 근거가 없으면 결과 확인 상태를 유지해 원래 연결과 이력을 확인해줘.','session-helper'));}
  else if(view.pending){const info=node(document,'dl','','session-facts');for(const [label,value] of [['요청 ID',view.pending.request_id],['전달 상태',view.pending.state]]){if(value){info.append(node(document,'dt',label),node(document,'dd',value));}}diagnostics.append(info);}
  if(!view.ownedChair&&view.pending?.blocked_reason&&(!view.writerBlocker||view.writerBlocker.roomId===room.id))diagnostics.append(button('전달 상태 다시 확인',actions.recheck,{disabled:!!room.archived_at}));
 }
 const runtime=section('연결과 작업 공간','CONNECTION'),caps=capabilitiesFor(member),nativeChat=caps.transport==='orca-native-chat',directClaude=view.directClaude,facts=node(document,'dl','','session-facts');
 for(const [label,value] of [['원래 이름',member.display_name],['Provider',member.provider],['Native ID',member.native_id||room.chair?.native_id],['작업 폴더',member.cwd||room.chair?.cwd||room.cwd],['연결 방식',view.ownedChair?'전용 좌장':directClaude?'원래 Claude 대화 직접 이어가기':nativeChat?'기존 Orca 채팅 직접 연결':member.mode],['소유',member.ownership],['정책',member.policy_revision]]){if(value){facts.append(node(document,'dt',label),node(document,'dd',value));}}runtime.append(facts);if(directClaude)runtime.append(node(document,'p','같은 Claude ID와 작업 위치를 보존해 이어가요. 기존 실행이 있으면 새 요청을 보내지 않고 대기해요.','session-helper'));
 if(!view.ownedChair){
  const group=node(document,'div','','session-action-grid');if(!nativeChat&&!directClaude)group.append(button('원래 출력 보기',actions.output,{disabled:member.left_at||caps.rawInspect!==true,title:caps.rawInspect?'':'원래 출력 조회 권한이 없어요.'}));
  if((member.mode==='live_attach'||directClaude)&&member.handle&&member.incarnation)group.append(button(caps.automaticInput?'자동 전달 해제':'자동 전달 연결',actions.automation,{disabled:!!room.archived_at||!!member.left_at||!!member.read_only}));runtime.append(group);
  const management=node(document,'details','','session-management');management.append(node(document,'summary','참여 관리'));if(!nativeChat&&!directClaude)management.append(button('참여 정보 발급',actions.provision,{disabled:!!member.left_at||!!room.archived_at}));management.append(button('토론에서 빼기',actions.leave,{disabled:!!member.left_at||!!room.archived_at,className:'session-danger'}));runtime.append(management);
 }
 const feedback=node(document,'p','','session-action-feedback');feedback.hidden=true;feedback.setAttribute('role','status');root.insertBefore(feedback,status.nextSibling);
 const output=node(document,'div','','session-output');output.hidden=true;root.append(output);
 return {element:root,output,feedback};
}
