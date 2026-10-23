const labels={queued:'요청 대기',claimed:'전달 예약',submitting:'요청 제공 중',accepted:'호스트 접수',running:'생성 중',completed:'응답 회수',unknown:'확인 필요',blocked:'차단',failed:'실패',cancelled:'취소'};

const reasons={
  draft_exists:'Orca가 입력란의 문구를 감지해 전달을 보류했어요. 현재 연동은 실제 초안과 추천 문구를 구분하지 못해요.',
  busy_idle_unverified:'세션이 대기 상태인지 확인되지 않아 전달하지 않았어요. 작업이 끝난 뒤 다시 확인해요.',
  identity_changed:'확인했던 세션 연결이 바뀌어 전달하지 않았어요. 원래 세션 연결을 다시 확인해요.',
  screen_unavailable:'세션 화면을 확인할 수 없어 전달하지 않았어요. 원래 세션 연결을 다시 확인해요.',
  composer_unverified:'입력창이 비어 있는지 확인할 수 없어 전달하지 않았어요. 원래 세션에서 입력창을 확인한 뒤 다시 시도해요.'
};

export function deliveryReason(value){
 if(!value)return null;
 if(reasons[value])return reasons[value];
 if(value==='입력창에 작성 중인 초안이 있어 전달하지 않았어요. 원래 세션에서 초안을 전송하거나 지운 뒤 다시 확인해요.')return reasons.draft_exists;
 if(Object.values(reasons).includes(value))return value;
 if(value==='composer is not exactly empty and idle')return reasons.composer_unverified;
 if(value==='terminal identity changed'||value==='unverified native terminal identity')return reasons.identity_changed;
 if(value==='busy terminal'||value==='idle-unverified')return reasons.busy_idle_unverified;
 return `전달 조건을 다시 확인해야 해요. ${value}`;
}

export function deliveryPresentation(delivery){
 const blocked=delivery?.state==='queued'&&!!delivery?.blocked_reason;
 const state=blocked?'blocked':delivery?.state;
 return {state,label:blocked?'전달 차단':(labels[state]||state||'확인 필요'),reason:deliveryReason(delivery?.blocked_reason),blocked};
}
