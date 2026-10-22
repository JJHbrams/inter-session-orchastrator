export const LAYOUT_KEY='session-rooms-layout-v1';
export const DEFAULTS={sidebar:218,composer:200,inspector:340};
const RANGE={sidebar:[160,420],composer:[174,360],inspector:[230,520]};
const finite=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const clamp=(n,min,max)=>Math.round(Math.max(min,Math.min(max,n)));
export function layoutLimits(viewport={}){
 const width=Math.max(320,finite(viewport.width,1280)),height=Math.max(320,finite(viewport.height,720));
 const available=Math.max(0,finite(viewport.availableHeight,height-90));
 return {width,available,budget:Math.max(174,available-123),ranges:{
  ...RANGE,sidebar:[160,Math.min(420,Math.max(160,width-487))],
  inspector:[230,Math.min(520,Math.max(230,width-28))]
 }};
}
export function clampLayout(values={},viewport={},preferredKey){
 const source=values&&typeof values==='object'&&!Array.isArray(values)?values:{};
 const limits=layoutLimits(viewport),out={};
 for(const [key,base] of Object.entries(DEFAULTS)){const [min,max]=limits.ranges[key];out[key]=clamp(finite(source[key],base),min,max);}
 out.composer=clamp(out.composer,RANGE.composer[0],Math.min(RANGE.composer[1],limits.budget));
 return out;
}
export function mentionMenuGeometry(anchor,menu,viewport={}){
 const width=Math.max(320,finite(viewport.width,1280)),height=Math.max(240,finite(viewport.height,720));
 const inset=8,gap=6,menuWidth=Math.max(0,finite(menu.width,0)),menuHeight=Math.max(0,finite(menu.height,0));
 const maxHeight=Math.min(230,Math.max(80,height-inset*2)),constrainedHeight=Math.min(menuHeight,maxHeight);
 const left=clamp(finite(anchor.left,0),inset,Math.max(inset,width-inset-menuWidth));
 const above=finite(anchor.top,0)-gap-constrainedHeight,below=finite(anchor.bottom,0)+gap;
 const top=above>=inset?above:Math.min(Math.max(inset,below),Math.max(inset,height-inset-constrainedHeight));
 return {left,top,maxHeight};
}
export function loadLayout(storage,viewport){try{return clampLayout(JSON.parse((storage??globalThis.localStorage).getItem(LAYOUT_KEY)||'{}'),viewport);}catch{return clampLayout({},viewport);}}
export function saveLayout(values,storage){try{(storage??globalThis.localStorage).setItem(LAYOUT_KEY,JSON.stringify(values));}catch{}}
export function resetLayout(storage){try{(storage??globalThis.localStorage).removeItem(LAYOUT_KEY);}catch{}return {...DEFAULTS};}

export function initLayout(){
 const $=s=>document.querySelector(s),handles=new Map();
 let preferred,layout,drag;
 const viewport=()=>({width:innerWidth,height:innerHeight,availableHeight:$('.workspace').clientHeight-$('.topbar').offsetHeight,sidebar:layout?.sidebar});
 function apply(key){
  layout=clampLayout(preferred,viewport(),key);
  for(const [name,value] of Object.entries(layout))document.documentElement.style.setProperty('--'+name,value+'px');
  const ranges=layoutLimits({...viewport(),sidebar:layout.sidebar}).ranges;
  for(const [name,handle] of handles){
   const minimum=clampLayout({...layout,[name]:-1e6},viewport(),name)[name];
   const maximum=clampLayout({...layout,[name]:1e6},viewport(),name)[name];
   handle.setAttribute('aria-valuemin',String(Math.max(ranges[name][0],minimum)));
   handle.setAttribute('aria-valuemax',String(maximum));
   handle.setAttribute('aria-valuenow',String(layout[name]));
   handle.setAttribute('aria-valuetext',layout[name]+' 픽셀');
  }
 }
 function persist(){preferred={...layout};saveLayout(preferred);}
 function stop(event){
  if(!drag||event&&event.pointerId!==undefined&&event.pointerId!==drag.pointerId)return;
  const active=drag;drag=null;document.body.classList.remove('resizing');
  if(active.handle.hasPointerCapture(active.pointerId))active.handle.releasePointerCapture(active.pointerId);
  persist();
 }
 function separator(name,label,axis,target,{inside=false,reverse=false}={}){
  const handle=document.createElement('div');handle.id='resize-'+name;handle.className='resize-handle '+axis;handle.tabIndex=0;
  handle.setAttribute('role','separator');handle.setAttribute('aria-label',label);handle.setAttribute('aria-orientation',axis);
  handle.title=label+' · 드래그 / 방향키 · Home 최소 / End 최대 · 더블클릭 기본값';
  handles.set(name,handle);
  if(inside)target.prepend(handle);else target.after(handle);
  handle.addEventListener('pointerdown',event=>{
   if(event.button!==0)return;event.preventDefault();stop();
   drag={name,handle,pointerId:event.pointerId,value:layout[name],position:axis==='vertical'?event.clientX:event.clientY,reverse};
   handle.focus();handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing');
  });
  handle.addEventListener('pointermove',event=>{
   if(!drag||drag.handle!==handle||drag.pointerId!==event.pointerId)return;
   const delta=(axis==='vertical'?event.clientX:event.clientY)-drag.position;
   preferred={...layout,[name]:drag.value+delta*(reverse?-1:1)};apply(name);
  });
  handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);
  handle.addEventListener('dblclick',()=>{preferred={...layout,[name]:DEFAULTS[name]};apply(name);persist();});
  handle.addEventListener('keydown',event=>{
   const negative=axis==='vertical'?'ArrowLeft':'ArrowUp',positive=axis==='vertical'?'ArrowRight':'ArrowDown';
   if(![negative,positive,'Home','End'].includes(event.key))return;
   event.preventDefault();let value=layout[name];
   if(event.key==='Home')value=-1e6;else if(event.key==='End')value=1e6;
   else value+=(event.key===positive?1:-1)*(reverse?-1:1)*(event.shiftKey?30:10);
   preferred={...layout,[name]:value};apply(name);persist();
  });
 }
 separator('sidebar','사이드바 너비','vertical',$('.sidebar'));
 separator('composer','작성 영역 높이','horizontal',$('#timeline'),{reverse:true});
 separator('inspector','세션 상세 너비','vertical',$('.inspector'),{inside:true,reverse:true});
 const reset=document.createElement('button');reset.type='button';reset.textContent='배치 초기화';reset.className='layout-reset';reset.title='저장한 패널 크기를 기본값으로 되돌리기';
 reset.onclick=()=>{preferred=resetLayout();apply();};$('.room-actions').append(reset);
 preferred=loadLayout(undefined,viewport());
 apply();new ResizeObserver(()=>apply()).observe($('.topbar'));
 window.addEventListener('resize',()=>apply());
}
