const node=(doc,tag,text,cls)=>{const el=doc.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
export function modelCaption(member){const state=member.modelSettings;if(state?.control?.status==='unknown')return '설정 결과 확인 필요';if(state?.control)return '설정 확인 중…';const value=state?.observed;if(value)return `${value.modelLabel||value.model||'모델 미확인'} · ${value.effort||'effort 미확인'}`;if(state?.lookup?.status==='pending')return '모델 · effort 확인 중…';if(state?.lookup?.status==='failed')return '모델 정보 확인 필요';return '모델 · effort 조회 필요';}
export async function participantSettingsDialog({document,member,request,onChange}){
 const d=node(document,'dialog',null,'participant-settings-dialog'),f=node(document,'form');f.method='dialog';d.append(f);document.body.append(d);
 f.append(node(document,'h2',`${member.alias||member.display_name} · 모델 설정`),node(document,'p',`${member.provider} · ${member.native_id}`,'settings-session-identity'));
 const status=node(document,'p','','settings-application'),error=node(document,'p','','form-error'),fields=node(document,'div',null,'chair-setting-fields');
 const model=node(document,'select'),effort=node(document,'select'),ml=node(document,'label','모델'),el=node(document,'label','추론 깊이 · effort');model.name='model';effort.name='effort';ml.append(model);el.append(effort);fields.append(ml,el);
 f.append(status,fields,node(document,'p','변경은 이 세션에만 적용돼. 같은 세션이 참여한 다른 토론장에도 반영돼. 진행 중인 응답이나 미전송 입력이 있으면 먼저 마쳐줘.','setting-help'),error);
 const menu=node(document,'menu'),refresh=node(document,'button','현재값 다시 확인'),cancel=node(document,'button','닫기'),save=node(document,'button','이 세션에 적용','accent');refresh.type=cancel.type='button';save.type='submit';menu.append(refresh,cancel,save);f.append(menu);cancel.onclick=()=>d.close();d.addEventListener('close',()=>d.remove());
 let value=member.modelSettings?.observed,unknown=member.modelSettings?.control?.status==='unknown',busy=false,confirmed=false,failed=false;
 function render(){model.replaceChildren();effort.replaceChildren();for(const item of value?.models||[]){const o=node(document,'option',item.label);o.value=item.id;model.append(o);}model.value=value?.model||'';
  for(const id of value?.efforts||[]){const o=node(document,'option',id);o.value=id;effort.append(o);}effort.value=value?.effort||'';
  const cached=value?`마지막 확인값: ${value.modelLabel||value.model} · ${value.effort||'미확인'} · ${new Date(value.observedAt).toLocaleString('ko-KR')}`:'원래 세션의 모델·effort를 아직 확인하지 않았어.';
  status.textContent=(failed?'현재값 조회 실패. ':unknown?'설정 결과 확인 필요. ':'')+cached;refresh.textContent=unknown?'설정 연결 확인':'현재값 다시 확인';controls();
 }
 function controls(){save.disabled=busy||unknown||!confirmed||!value||!model.value||!effort.value;refresh.disabled=busy;model.disabled=effort.disabled=busy||unknown||!confirmed||!value;}
 async function run(action,payload={}){if(busy)return;busy=true;confirmed=false;failed=false;error.textContent='';controls();status.textContent=action==='apply'?'원래 세션에 적용하고 다시 확인하는 중…':'원래 세션의 선택기를 확인하는 중… (최대 2분)';try{value=await request(action,payload);unknown=false;confirmed=true;await onChange?.();}catch(e){error.textContent=e.message;failed=true;unknown=e.code==='SETTINGS_UNKNOWN'||e.code==='NETWORK_UNCERTAIN';await onChange?.();}finally{busy=false;render();}}
 refresh.onclick=()=>run(unknown?'reconcile':'inspect');f.onsubmit=event=>{event.preventDefault();if(save.disabled)return;run('apply',{provider:member.provider,model:model.value,effort:effort.value});};render();d.showModal();if(!unknown)await run('inspect');
 return d;
}
