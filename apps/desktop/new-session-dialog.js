import {attachDirectoryPicker} from './directory-picker.js';
export function showNewSessionDialog({document,room,request,onChange=()=>{},creation=null,autoPoll=true,makeRequestKey=()=>document.defaultView.crypto.randomUUID()}){
 const el=(tag,value,cls)=>{const node=document.createElement(tag);if(value)node.textContent=value;if(cls)node.className=cls;return node};
 const d=el('dialog',null,'session-create-dialog'),f=el('form');f.method='dialog';d.append(f);document.body.append(d);
 f.append(el('h2','새 Chat 세션 만들기'),el('p','선택한 작업 폴더에서 새 대화를 만들고 이 토론장에 추가해요. 생성된 세션은 토론장의 질문을 자동으로 전달받아요.','setting-help'));
 const provider=el('select'),cwd=el('input');provider.name='provider';provider.required=true;for(const [id,label] of [['claude','Claude'],['codex','Codex']]){const option=el('option',label);option.value=id;provider.append(option)}
 cwd.name='cwd';cwd.required=true;cwd.value=creation?.cwd||room.cwd||'';provider.value=creation?.provider||'claude';
 for(const [label,input] of [['Provider',provider],['작업 폴더',cwd]]){const field=el('label',label);field.append(input);f.append(field)}const picker=attachDirectoryPicker(cwd),pickerAvailable=!picker.disabled;
 const status=el('p',null,'session-create-status'),message=el('p',null,'form-error');status.setAttribute('role','status');message.setAttribute('role','alert');f.append(status,message);
 const menu=el('menu'),cancel=el('button','취소'),submit=el('button','세션 만들기','accent');cancel.type='button';submit.type='submit';menu.append(cancel,submit);f.append(menu);
 let record=creation,requestKey=creation?.requestKey||makeRequestKey(),busy=false,disposed=false,composing=false,timer,checks=0;
 const schedule=()=>{clearTimeout(timer);if(autoPoll&&!disposed&&record?.status==='pending'&&checks<12)timer=setTimeout(()=>void run(true),1500)};
 const render=()=>{provider.disabled=cwd.disabled=busy||!!record;picker.disabled=!pickerAvailable||busy||!!record;submit.disabled=busy;f.setAttribute('aria-busy',String(busy));cancel.textContent=record?'닫기':'취소';submit.textContent=busy?'확인 중…':record?.status==='pending'?'연결 상태 확인':record?.status==='failed'?'새 요청 작성':'세션 만들기';status.textContent=record?.status==='pending'?'새 세션의 연결을 준비하고 있어요. 대화 ID가 확인되면 토론장에 자동으로 참여해요.':record?.status==='failed'?'세션을 만들지 못했어요. 아래 원인을 확인해줘.':record?.status==='ready'?'새 세션이 토론장에 참여했어요.':'';message.textContent=record?.error||'';};
 async function run(reconcile=false){
  if(busy||disposed)return;
  if(record?.status==='failed'){record=null;requestKey=makeRequestKey();render();return;}
  if(!record&&!f.reportValidity())return;
  busy=true;render();message.textContent='';
  try{
   const path=record?`/api/rooms/${room.id}/session-creations/${record.id}/reconcile`:`/api/rooms/${room.id}/sessions/create`;
   const payload=record?{}:{provider:provider.value,cwd:cwd.value.trim(),requestKey};
   record=await request(path,{method:'POST',body:JSON.stringify(payload)});checks++;await onChange(record);
   if(disposed)return;if(record?.status==='ready'){d.close();return;}render();schedule();
  }catch(error){if(!disposed)message.textContent=error.message;}
  finally{busy=false;if(!disposed){submit.disabled=false;provider.disabled=cwd.disabled=!!record;picker.disabled=!pickerAvailable||!!record;f.setAttribute('aria-busy','false');submit.textContent=record?.status==='pending'?'연결 상태 확인':record?.status==='failed'?'새 요청 작성':'세션 만들기';}}
 }
 f.addEventListener('compositionstart',()=>{composing=true});f.addEventListener('compositionend',()=>{composing=false});
 f.onsubmit=event=>{event.preventDefault();if(composing)return;return run(!!record)};cancel.onclick=()=>d.close();d.addEventListener('close',()=>{disposed=true;clearTimeout(timer);d.remove()});d.showModal();render();if(record?.status==='pending')schedule();return d;
}
