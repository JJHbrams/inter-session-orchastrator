/** Isolated real-Pixi renderer probe. No coordinator/provider mutations. */
export async function pixiSmokeInPage(){
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async test=>{const end=Date.now()+10000;while(Date.now()<end){if(test())return true;await wait(40)}return false};
 const result={officePixiReady:false,officeIdleAnimated:false,officePixiFrames:false,officeChairCrowned:false,officeChairFacingParticipants:false,officeSeatedParticipants:false,officeSceneTransitions:false,officeEntryAnimated:false,officeExitAnimated:false,officeWorkSeated:false,officeIdleRegistrationStable:false,officeWorkHeadScaleStable:false,officeFloorCollisionFree:false,officeObjectOcclusion:false,officeDockTransitions:false,officeCrownAnchored:false,officeObservedLayout:false};
 result.officePixiReady=await until(()=>{const c=document.querySelector('#agentOffice canvas[data-renderer="pixi"]');return c?.dataset.ready==='true'&&c.width>0&&c.height>0});
 if(!result.officePixiReady)return result;
 let probe,host,monitorTimer;const runtimeErrors=[];const runtimeError=e=>runtimeErrors.push(String(e.message||e.reason||e));window.addEventListener('error',runtimeError);
 try{
  const {createOfficePixiScene}=await import('/office-pixi-scene.js');
  const {CHAIR_SEAT}=await import('/office-pixi-model.js');
  const {canStand,roomContains,segmentClear}=await import('/office-scene-space.js');
  host=document.createElement('div');host.className='office-artboard';host.style.cssText='position:fixed;left:0;top:0;width:520px;height:200px;transform:none;pointer-events:none;z-index:10';document.body.append(host);
  probe=createOfficePixiScene({document,host});probe.setRoom('smoke-office');probe.setPresentation({collapsed:false,visible:true,reducedMotion:false});
  const agents=[{id:'smoke-idle',sessionId:'smoke',label:'검증용 세션',provider:'claude',kind:'session',role:'participant',state:'idle',activity:'none',zone:'table',updatedAt:'smoke'},{id:'smoke-chair',sessionId:'chair',label:'검증용 좌장',provider:'claude',kind:'session',role:'chair',state:'running',activity:'responding',zone:'table',updatedAt:'smoke'},{id:'smoke-peer',sessionId:'peer',label:'검증용 참여자',provider:'codex',kind:'session',role:'participant',state:'idle',activity:'none',zone:'table',updatedAt:'smoke'}];
  const node=id=>host.querySelector('[data-agent-id="'+id+'"]');
  const members=()=>['smoke-idle','smoke-peer'].map(node);
  const atMeeting=n=>n?.dataset.seated==='true'&&!n.dataset.station;
  const trace=()=>[...host.querySelectorAll('.office-agent')].map(n=>({id:n.dataset.id,action:n.dataset.action,state:n.dataset.state,seated:n.dataset.seated,station:n.dataset.station,x:n.dataset.currentFootx,y:n.dataset.currentFooty}));
  const safety={walkSamples:0,invisibleWalking:0,collisions:0,crossings:0,outside:0,occluders:new Set(),phases:new Set(),previous:new Map()};
  monitorTimer=setInterval(()=>{try{for(const n of host.querySelectorAll('.office-agent')){const d=n.dataset,p={x:Number(d.currentFootx),y:Number(d.currentFooty)},visible=Number(d.visibleAlpha??1)>.05,walking=d.transition==='walking';safety.phases.add(d.transition);for(const id of (d.occluders||'').split(',').filter(Boolean))safety.occluders.add(id);if(visible&&!roomContains(p,0))safety.outside++;if(visible&&walking){safety.walkSamples++;if(d.spriteVisible!=='true')safety.invisibleWalking++;if(!canStand(p))safety.collisions++;const before=safety.previous.get(d.id);if(before?.walking&&!segmentClear(before.p,p))safety.crossings++}safety.previous.set(d.id,{p,walking})}}catch(e){runtimeErrors.push(e.message)}},25);
  await probe.readyPromise;probe.setSnapshot({agents});
  result.officeEntryAnimated=await until(()=>members().some(n=>n?.dataset.action==='entering'));
  const settled=await until(()=>members().every(atMeeting)&&node('smoke-chair')?.dataset.crown==='true');
  if(settled){
   const idle=node('smoke-idle'),canvas=host.querySelector('canvas'),offset=Number(idle.dataset.idleOffset||0),idlePose=idle.dataset.pose,startFrame=Number(canvas.dataset.frame||0);
   result.officeIdleAnimated=await until(()=>idle.dataset.action==='idle'&&idle.dataset.state==='idle'&&(idle.dataset.pose!==idlePose||Math.abs(Number(idle.dataset.idleOffset||0)-offset)>.03));
   result.officePixiFrames=Number(canvas.dataset.frame||0)>startFrame;
   const geometry=n=>({pose:Number(n.dataset.pose),width:Number(n.dataset.registeredHeadWidth),height:Number(n.dataset.registeredHeadHeight),y:Number(n.dataset.registeredHeadY),scaleX:Number(n.dataset.bodyScaleX),scaleY:Number(n.dataset.bodyScaleY),frame:[n.dataset.frameX,n.dataset.frameY,n.dataset.frameWidth,n.dataset.frameHeight].map(Number)});
   const collect=async(id,ms)=>{const samples=[],end=Date.now()+ms;while(Date.now()<end){samples.push(geometry(node(id)));await wait(40)}return samples};
   const idleGeometry=await collect('smoke-peer',3200);
   const span=(samples,key)=>Math.max(...samples.map(s=>s[key]))-Math.min(...samples.map(s=>s[key]));
   result.officeIdleRegistrationStable=new Set(idleGeometry.map(s=>s.pose)).size>=2&&idleGeometry.every(s=>s.width>0&&s.height>0&&s.scaleX>0&&s.scaleY>0)&&span(idleGeometry,'width')<=1.5&&span(idleGeometry,'height')<=2&&span(idleGeometry,'y')<=2;
   const chair=node('smoke-chair');result.officeChairCrowned=chair.dataset.crown==='true'&&chair.dataset.chair==='true';
   result.officeChairFacingParticipants=chair.dataset.seated==='true'&&chair.dataset.facing==='front'&&Number(chair.dataset.seatX)===CHAIR_SEAT.x&&Number(chair.dataset.seatY)===CHAIR_SEAT.y;
   result.officeSeatedParticipants=members().every(n=>atMeeting(n)&&n.dataset.crown==='false');
   const transitionStart=Date.now(),transitionFrame=Number(canvas.dataset.frame||0);
   probe.setSnapshot({agents:[...agents.map(a=>a.role==='chair'?a:{...a,state:'running',activity:a.id==='smoke-peer'?'coding':'reading',zone:a.id==='smoke-peer'?'development':'library',updatedAt:'work'}),{id:'smoke-server-child',sessionId:'server-child',parentId:'smoke-peer',label:'벽 뒤 경로 검증',provider:'codex',kind:'subagent',role:'worker',state:'running',activity:'terminal',zone:'server',updatedAt:'work'}]});
   const walked=await until(()=>node('smoke-peer')?.dataset.action==='walking');
   const worked=await until(()=>node('smoke-peer')?.dataset.action==='coding'&&node('smoke-idle')?.dataset.action==='reading'&&node('smoke-server-child')?.dataset.seated==='true'&&node('smoke-server-child')?.dataset.station==='server');
   result.officeWorkSeated=node('smoke-idle')?.dataset.seated==='true'&&node('smoke-idle').dataset.station==='library'&&node('smoke-peer')?.dataset.seated==='true'&&node('smoke-peer').dataset.station==='development';
   const workGeometry=await collect('smoke-peer',900);
   result.officeWorkHeadScaleStable=new Set(workGeometry.map(s=>s.pose)).size>=2&&workGeometry.every(s=>s.width>0&&Math.abs(s.width-idleGeometry[0].width)<=2)&&span(workGeometry,'width')<=1.5;
   result.officeRegistrationDetails={idlePoses:[...new Set(idleGeometry.map(s=>s.pose))],workPoses:[...new Set(workGeometry.map(s=>s.pose))],idleWidthSpan:span(idleGeometry,'width'),idleHeightSpan:span(idleGeometry,'height'),idleYSpan:span(idleGeometry,'y'),idle:idleGeometry.filter((s,i,a)=>a.findIndex(v=>v.pose===s.pose)===i),work:workGeometry.filter((s,i,a)=>a.findIndex(v=>v.pose===s.pose)===i)};
   const atWork=trace();
   probe.setSnapshot({agents});
   const returned=await until(()=>members().every(atMeeting));
   result.officeSceneTransitions=walked&&worked&&result.officeWorkSeated&&returned;
   const atReturn=trace();
   probe.setSnapshot({agents:agents.filter(a=>a.id!=='smoke-peer')});
   const exiting=await until(()=>node('smoke-peer')?.dataset.action==='exiting');
   const removed=await until(()=>!node('smoke-peer'));
   result.officeExitAnimated=exiting&&removed;
   probe.setPresentation({reducedMotion:true});
   const observedParents=[
    {id:'observed-parent-a',sessionId:'observed-session-a',label:'Observed A',provider:'claude',kind:'session',role:'chair',state:'unknown',activity:'none',zone:'table',updatedAt:'observed'},
    {id:'observed-parent-b',sessionId:'observed-session-b',label:'Observed B',provider:'claude',kind:'session',role:'participant',state:'completed',activity:'none',zone:'table',updatedAt:'observed'},
    {id:'observed-parent-c',sessionId:'observed-session-c',label:'Observed C',provider:'claude',kind:'session',role:'participant',state:'completed',activity:'none',zone:'table',updatedAt:'observed'},
    {id:'observed-parent-d',sessionId:'observed-session-d',label:'Observed D',provider:'claude',kind:'session',role:'participant',state:'completed',activity:'none',zone:'table',updatedAt:'observed'},
    {id:'observed-parent-e',sessionId:'observed-session-e',label:'Observed E',provider:'claude',kind:'session',role:'participant',state:'completed',activity:'none',zone:'table',updatedAt:'observed'}
   ];
   const observedChildren=[...Array(9)].map((_,index)=>{const parentId=index<7?'observed-parent-b':'observed-parent-c',ordinal=index<7?index+1:index-6;return{id:`observed-child-${index+1}`,sessionId:`observed-child-session-${index+1}`,parentId,label:`Observed ${parentId.endsWith('b')?'B':'C'} child ${ordinal}`,provider:'claude',kind:'subagent',role:'worker',state:'unknown',activity:'none',zone:'table',updatedAt:'observed'}});
   const observedAgents=[...observedParents,...observedChildren];
   probe.setSnapshot({agents:observedAgents});
   const observedIds=observedAgents.map(agent=>agent.id),observedNodes=()=>observedIds.map(node),headFields=['headLeft','headTop','headWidth','headHeight'],crownFields=['crownLeft','crownTop','crownWidth','crownHeight','crownBaseGap'];
   const observedSettled=await until(()=>observedNodes().every(n=>n&&n.dataset.transition===''&&n.dataset.routeBlocked!=='true'));
   const observed=observedNodes(),parents=observed.slice(0,5),children=observed.slice(5);
   const invalidFields=[];
   const readRect=(n,prefix)=>{const values=['Left','Top','Width','Height'].map(key=>Number(n.dataset[`${prefix}${key}`]));if(!values.every(Number.isFinite)||values[2]<=0||values[3]<=0){invalidFields.push(`${n.dataset.id||n.dataset.agentId}:${prefix}`);return null}return{x:values[0],y:values[1],width:values[2],height:values[3]}};
   const heads=observed.map(n=>({id:n.dataset.id||n.dataset.agentId,rect:readRect(n,'head')})),crowns=parents.filter(n=>n.dataset.crown==='true').map(n=>({id:n.dataset.id||n.dataset.agentId,rect:readRect(n,'crown'),gap:Number(n.dataset.crownBaseGap)}));
   for(const n of observed)for(const field of headFields)if(!Number.isFinite(Number(n.dataset[field])))invalidFields.push(`${n.dataset.id||n.dataset.agentId}:${field}`);
   for(const n of parents.filter(n=>n.dataset.crown==='true'))for(const field of crownFields)if(!Number.isFinite(Number(n.dataset[field])))invalidFields.push(`${n.dataset.id||n.dataset.agentId}:${field}`);
   const overlaps=[];for(let i=0;i<heads.length;i++)for(let j=i+1;j<heads.length;j++){const a=heads[i].rect,b=heads[j].rect;if(!a||!b)continue;const width=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),height=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)),area=width*height,ratio=area/Math.min(a.width*a.height,b.width*b.height);if(width>2&&height>2&&ratio>=.1)overlaps.push({a:heads[i].id,b:heads[j].id,width,height,ratio});}
   const foots=observed.map(n=>`${n.dataset.currentFootx},${n.dataset.currentFooty}`),chairCrown=crowns[0],chairHead=heads.find(head=>head.id==='observed-parent-a')?.rect,crownCenter=chairCrown?.rect?chairCrown.rect.x+chairCrown.rect.width/2:NaN;
   const crownAnchored=!!(chairCrown&&chairHead&&Math.abs(chairCrown.gap)<=2&&crownCenter>=chairHead.x&&crownCenter<=chairHead.x+chairHead.width);
   result.officeCrownAnchored=crownAnchored;
   const identitiesPreserved=observed.every((n,index)=>n._agent?.role===observedAgents[index].role&&n._agent?.sessionId===observedAgents[index].sessionId&&n._agent?.state===observedAgents[index].state&&n._agent?.parentId===(observedAgents[index].parentId||undefined));
   result.officeObservedLayout=observedSettled&&invalidFields.length===0&&observed.length===14&&parents.every(n=>n.dataset.seated==='true'&&n._agent?.provider==='claude')&&parents[0].dataset.state==='unknown'&&parents.slice(1).every(n=>n.dataset.state==='completed')&&crowns.length===1&&children.length===9&&children.every((n,index)=>n.dataset.state==='unknown'&&n.dataset.support==='true'&&n.dataset.seated==='false'&&n.dataset.parentId===observedChildren[index].parentId&&n.textContent.includes(`${observedChildren[index].parentId==='observed-parent-b'?'Observed B':'Observed C'}·${index<7?index+1:index-6}`)&&canStand({x:Number(n.dataset.currentFootx),y:Number(n.dataset.currentFooty)}))&&identitiesPreserved&&new Set(foots).size===foots.length&&overlaps.length===0&&crownAnchored;
   result.officeObservedLayoutDetails={count:observed.length,heads,crowns,invalidFields,overlaps,footCoordinates:foots,settled:observedSettled};
   result.officeFloorCollisionFree=safety.walkSamples>50&&safety.invisibleWalking===0&&safety.collisions===0&&safety.crossings===0&&safety.outside===0&&runtimeErrors.length===0;
   result.officeObjectOcclusion=safety.occluders.has('partition-wall')&&(safety.occluders.has('whiteboard')||safety.occluders.has('meeting-table'));
   result.officeDockTransitions=safety.phases.has('undocking')&&safety.phases.has('docking');
   result.officeSceneSafetyDetails={walkSamples:safety.walkSamples,invisibleWalking:safety.invisibleWalking,collisions:safety.collisions,crossings:safety.crossings,outside:safety.outside,occluders:[...safety.occluders],phases:[...safety.phases],runtimeErrors};
   result.officeTransitionDetails={settled,walked,worked,returned,exiting,removed,elapsedMs:Date.now()-transitionStart,frames:Number(canvas.dataset.frame||0)-transitionFrame,atWork,atReturn};
  }
 }finally{clearInterval(monitorTimer);window.removeEventListener('error',runtimeError);probe?.destroy();host?.remove()}
 return result;
}
