const effortNames={low:'낮음',medium:'보통',high:'높음',xhigh:'매우 높음',max:'최대',ultra:'최대 확장'};
const make=(document,tag,content,className)=>{const el=document.createElement(tag);if(content)el.textContent=content;if(className)el.className=className;return el;};
const effortId=value=>typeof value==='string'?value:value.effort||value.id;

export function chairSettingsFields(document,catalog,{provider='claude',model=null,effort=null,lockedProvider=false}={}){
 const element=make(document,'div','','chair-setting-fields'),providers=catalog.providers||[];
 const providerLabel=make(document,'label','Provider'),providerInput=make(document,'select');providerInput.name='provider';providerInput.required=true;providerInput.disabled=lockedProvider;
 for(const item of providers){const option=make(document,'option',item.label||item.id);option.value=item.id;providerInput.append(option);}providerInput.value=provider;
 providerLabel.append(providerInput);element.append(providerLabel);
 const modelLabel=make(document,'label','모델'),modelInput=make(document,'select');modelInput.name='model';modelLabel.append(modelInput);element.append(modelLabel);
 const customLabel=make(document,'label','모델 ID 직접 입력'),customInput=make(document,'input');customInput.name='customModel';customInput.maxLength=160;customInput.placeholder='provider에서 지원하는 모델 ID';customLabel.append(customInput);element.append(customLabel);
 const effortLabel=make(document,'label','추론 깊이 · effort'),effortInput=make(document,'select');effortInput.name='effort';effortLabel.append(effortInput);element.append(effortLabel);
 const note=make(document,'p','높을수록 더 오래 생각할 수 있어요. 지원 범위와 실제 적용값은 선택한 모델·계정 정책에 따라 달라져요.','setting-help');element.append(note);
 const selectedProvider=()=>providers.find(item=>item.id===providerInput.value)||providers[0]||{};
 function fillEfforts(wanted=''){
  const entry=selectedProvider(),selected=entry.models?.find(item=>item.id===modelInput.value);
  const values=[...new Set(['',...(selected?.efforts||[]).map(effortId).filter(Boolean)])];effortInput.replaceChildren();effortInput.disabled=values.length===1;
  note.textContent=selected?'높을수록 더 오래 생각할 수 있어요. 모델·계정 정책에 따라 실제 적용값이 달라질 수 있어요.':'목록에서 모델을 선택하면 지원하는 effort를 고를 수 있어요. CLI 기본 모델과 직접 입력한 모델은 기본 effort를 사용해요.';
  for(const value of values){const option=make(document,'option',value?`${effortNames[value]||value} · ${value}`:'CLI 기본값');option.value=value;effortInput.append(option);}effortInput.value=values.includes(wanted)?wanted:'';
 }
 function syncModel(wantedEffort=''){
  customLabel.hidden=modelInput.value!=='__custom__';customInput.required=!customLabel.hidden;customInput.disabled=customLabel.hidden;fillEfforts(wantedEffort);
 }
 function fillModels(wantedModel=null,wantedEffort=''){
  modelInput.replaceChildren();const defaults=make(document,'option','CLI 기본값');defaults.value='';modelInput.append(defaults);
  const entries=selectedProvider().models||[];
  for(const item of entries){if(!item.id)continue;const option=make(document,'option',item.label||item.id);option.value=item.id;modelInput.append(option);}
  if(selectedProvider().allowCustomModel!==false||wantedModel&&!entries.some(item=>item.id===wantedModel)){const direct=make(document,'option','모델 ID 직접 입력…');direct.value='__custom__';modelInput.append(direct);}
  const known=!wantedModel||entries.some(item=>item.id===wantedModel);modelInput.value=known?(wantedModel||''):'__custom__';customInput.value=known?'':wantedModel;
  syncModel(wantedEffort||'');
 }
 providerInput.addEventListener('change',()=>fillModels());modelInput.addEventListener('change',()=>syncModel());
 fillModels(model,effort);
 return {element,providerInput,modelInput,customInput,effortInput,value:()=>({provider:lockedProvider?provider:providerInput.value,model:(modelInput.value==='__custom__'?customInput.value.trim():modelInput.value)||null,effort:effortInput.value||null})};
}

export const dialoguePresets=[
 {rounds:1,label:'한 번만',detail:'좌장이 질문하고 답을 받아 한 번 정리해요.'},
 {rounds:3,label:'필요하면 더 묻기',detail:'질문과 답변을 최대 3차례까지 주고받아요.'},
 {rounds:6,label:'충분히 논의하기',detail:'최대 6차례까지 의견을 주고받아요.'}
];

export function dialogueLimitSummary(rounds,requests){
 return `내 입력 한 번 → 질문·답변 최대 ${rounds}차례 → 좌장 정리. 이 과정의 메시지 전달은 총 ${requests}건까지예요.`;
}
