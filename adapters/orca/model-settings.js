import {createSettingsTransport} from './index.js';
const effortName=value=>({ 'extra high':'xhigh', 'very high':'xhigh' }[value.toLowerCase()]||value.toLowerCase());
const modelId=label=>label.toLowerCase().replace(/[^a-z0-9.]+/g,'-').replace(/^-|-$/g,'');
export function parseModelMenu(lines,provider){
 const text=lines.join('\n'),heading=provider==='codex'?'Select Model and Effort':'Select model';
 const start=lines.findLastIndex(line=>line.trim()===heading);if(start<0)return null;
 const tail=lines.slice(start),footer=tail.at(-1)?.trim();
 if(provider==='codex'?!/enter select.*esc back/.test(footer):!/s to use this session only.*Esc to cancel/.test(footer))return null;
 const options=tail.flatMap(line=>{const m=line.trim().match(/^(?:[↓↑]\s*)?([›❯]?)\s*(\d+)\.\s+(.+?)(?:\s{2,}|$)/);if(!m)return [];const raw=m[3],label=raw.replace(/\s*\(current\)|\s*✔|\s*\(recommended\)/g,'').trim();return [{id:modelId(label),label,index:Number(m[2]),selected:!!m[1],current:/\(current\)|✔/.test(line)}];});
 const selected=options.find(x=>x.selected),current=options.find(x=>x.current);if(!selected||!current)return null;
 const match=tail.join('\n').match(/\b(Low|Medium|High|Extra high|Xhigh|Max|Ultra) effort\b/i);
 return {kind:'model',options,selected,current,effort:match?effortName(match[1]):null,lines};
}
export function parseEffortMenu(lines){
 const start=lines.findLastIndex(line=>line.trim().startsWith('Select Reasoning Level for ')||line.trim()==='Advanced Reasoning');
 if(start<0||!/enter (?:default|select).*esc back/.test(lines.at(-1)||''))return null;
 const options=lines.slice(start).flatMap(line=>{const m=line.trim().match(/^([›]?)\s*(\d+)\.\s+(Low|Medium|High|Extra high|Max|Ultra|More reasoning…)(?:\s|$)/i);return m?[{id:m[3].startsWith('More')?'more':effortName(m[3]),index:Number(m[2]),selected:!!m[1],current:line.includes('(current)')}]:[];});
 const selected=options.find(x=>x.selected);if(!selected||selected.id!=='more'&&!/s session/.test(lines.at(-1)))return null;return {kind:'effort',options,selected,current:options.find(x=>x.current),lines};
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const menuSurface=lines=>{const start=lines.findLastIndex(line=>/^(Select model|Select Model and Effort|Select Reasoning Level for .+|Advanced Reasoning|Switch model\?)$/.test(line.trim()));return start<0?null:lines.slice(start).map(line=>line.trim()).filter(Boolean);};
export function parseSwitchConfirmation(lines){const start=lines.findLastIndex(line=>line.trim()==='Switch model?');if(start<0)return null;const tail=lines.slice(start).map(x=>x.trim());if(!tail.some(x=>x.includes('full history gets re-read on your next message.'))||tail.some(x=>/credits|billing|payment/i.test(x)))return null;const selected=tail.find(x=>/^❯ 1\. Yes, switch to /.test(x));if(!selected||tail.at(-1)!=='2. No, go back')return null;return {kind:'confirm',target:selected.replace(/^❯ 1\. Yes, switch to /,''),lines};}
const delay=()=>new Promise(resolve=>setTimeout(resolve,120));
export function createNativeModelSettings({transport=createSettingsTransport()}={}){
 async function read(binding,session){return transport.read(binding,session);}
 async function menu(binding,session,kind){for(let n=0;n<12;n++){const lines=await read(binding,session),m=kind==='model'?parseModelMenu(lines,session.provider):parseEffortMenu(lines);if(m)return m;await delay();}throw Error('지원하는 모델 선택기 화면을 확인하지 못했어. 원래 세션을 확인해줘.');}
 async function key(binding,session,snapshot,key){const lines=await read(binding,session);if(!same(menuSurface(lines),menuSurface(snapshot.lines)))throw Error('선택기 화면이 변경되어 입력을 중단했어.');await transport.key(binding,key);}
 async function move(binding,session,snapshot,target,kind){for(let n=0;n<32;n++){if(snapshot.selected.id===target)return snapshot;const item=snapshot.options.find(x=>x.id===target);if(!item)throw Error('현재 CLI 목록에서 선택한 항목을 확인하지 못했어.');await key(binding,session,snapshot,item.index>snapshot.selected.index?'down':'up');snapshot=await menu(binding,session,kind);}throw Error('선택기 이동 한도를 초과했어.');}
 async function close(binding,session,snapshot){for(let n=0;n<4;n++){await key(binding,session,snapshot,'escape');const lines=await read(binding,session);snapshot=parseModelMenu(lines,session.provider)||parseEffortMenu(lines);if(snapshot)continue;const ready=await transport.preflight(binding,session);if(ready.ok)return;break;}throw Error('모델 선택기를 닫은 뒤 대기 상태를 확인하지 못했어.');}
 async function snapshot(binding,session){await transport.key(binding,'model');let m=await menu(binding,session,'model');const models=m.options.filter(x=>!x.id.startsWith('default')).map(({id,label})=>({id,label}));
  if(session.provider==='claude'){const result={model:m.current.id,modelLabel:m.current.label,effort:m.effort,models,efforts:['low','medium','high','xhigh','max']};await close(binding,session,m);return result;}
  const model=m.current;m=await move(binding,session,m,model.id,'model');await key(binding,session,m,'enter');m=await menu(binding,session,'effort');const result={model:model.id,modelLabel:model.label,effort:m.current?.id||null,models,efforts:m.options.filter(x=>x.id!=='more').map(x=>x.id)};
  if(m.options.some(x=>x.id==='more')){m=await move(binding,session,m,'more','effort');await key(binding,session,m,'enter');m=await menu(binding,session,'effort');result.efforts=[...new Set([...result.efforts,...m.options.map(x=>x.id)])];if(!result.effort||result.effort==='more')result.effort=m.current?.id||null;}
  await close(binding,session,m);return result;
 }
 async function apply(binding,session,input){await transport.key(binding,'model');let m=await menu(binding,session,'model');m=await move(binding,session,m,input.model,'model');
  if(session.provider==='codex'){await key(binding,session,m,'enter');m=await menu(binding,session,'effort');if(!m.options.some(x=>x.id===input.effort)&&m.options.some(x=>x.id==='more')){m=await move(binding,session,m,'more','effort');await key(binding,session,m,'enter');m=await menu(binding,session,'effort');}m=await move(binding,session,m,input.effort,'effort');}
  else{const levels=['low','medium','high','xhigh','max'];for(let n=0;m.effort!==input.effort&&n<6;n++){if(!m.effort||!levels.includes(input.effort))throw Error('현재 모델의 effort 선택을 확인하지 못했어.');const prior=m.effort;await key(binding,session,m,levels.indexOf(input.effort)>levels.indexOf(m.effort)?'right':'left');m=await menu(binding,session,'model');if(prior===m.effort)throw Error('이 모델이나 정책에서 요청한 effort를 선택할 수 없어.');}if(m.effort!==input.effort)throw Error('effort 선택을 확인하지 못했어.');}
  const selectedModel=session.provider==='claude'?m.selected.label:null;
  await key(binding,session,m,'session');if(session.provider==='claude'){const confirmation=parseSwitchConfirmation(await read(binding,session));if(confirmation){if(confirmation.target!==selectedModel)throw Error('모델 전환 확인창의 대상이 요청과 달라.');await key(binding,session,confirmation,'enter');}}
  const ready=await transport.preflight(binding,session);if(!ready.ok)throw Error('변경 뒤 세션 대기 상태를 확인하지 못했어.');const result=await snapshot(binding,session);if(result.model!==input.model||result.effort!==input.effort)throw Error('원래 CLI를 재조회한 값이 요청과 달라.');return result;
 }
 return {
  withGuard(assertCurrent,evidence={}){return createNativeModelSettings({transport:{preflight:async(binding,session)=>{assertCurrent();return transport.preflight(binding,session,evidence);},read:async(...args)=>{assertCurrent();return transport.read(...args);},key:async(...args)=>{assertCurrent();return transport.key(...args);}}});},
  preflight:transport.preflight,
  async inspect(binding,session){return snapshot(binding,session);},
  apply,
  async reconcile(binding,session){const lines=await read(binding,session),m=parseModelMenu(lines,session.provider)||parseEffortMenu(lines)||(session.provider==='claude'&&parseSwitchConfirmation(lines));if(m)await close(binding,session,m);else{const ready=await transport.preflight(binding,session);if(!ready.ok)throw Error(ready.reason);}return snapshot(binding,session);}
 };
}
