/** Isolated real-Pixi renderer probe. No coordinator/provider mutations. */
export async function pixiSmokeInPage(){
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async test=>{const end=Date.now()+10000;while(Date.now()<end){if(test())return true;await wait(40)}return false};
 const result={officePixiReady:false,officeIdleAnimated:false,officePixiFrames:false,officeChairCrowned:false,officeChairFacingParticipants:false,officeSeatedParticipants:false,officeSceneTransitions:false,officeEntryAnimated:false,officeExitAnimated:false,officeWorkSeated:false};
 result.officePixiReady=await until(()=>{const c=document.querySelector('#agentOffice canvas[data-renderer="pixi"]');return c?.dataset.ready==='true'&&c.width>0&&c.height>0});
 if(!result.officePixiReady)return result;
 let probe,host;
 try{
  const {createOfficePixiScene}=await import('/office-pixi-scene.js');
  host=document.createElement('div');host.className='office-artboard';host.style.cssText='position:fixed;left:0;top:0;width:520px;height:200px;transform:none;pointer-events:none;z-index:10';document.body.append(host);
  probe=createOfficePixiScene({document,host});probe.setRoom('smoke-office');probe.setPresentation({collapsed:false,visible:true,reducedMotion:false});
  const agents=[{id:'smoke-idle',sessionId:'smoke',label:'검증용 세션',provider:'claude',kind:'session',role:'participant',state:'idle',activity:'none',zone:'table',updatedAt:'smoke'},{id:'smoke-chair',sessionId:'chair',label:'검증용 좌장',provider:'claude',kind:'session',role:'chair',state:'running',activity:'responding',zone:'table',updatedAt:'smoke'},{id:'smoke-peer',sessionId:'peer',label:'검증용 참여자',provider:'codex',kind:'session',role:'participant',state:'idle',activity:'none',zone:'table',updatedAt:'smoke'}];
  const node=id=>host.querySelector('[data-agent-id="'+id+'"]');
  const members=()=>['smoke-idle','smoke-peer'].map(node);
  const atMeeting=n=>n?.dataset.seated==='true'&&!n.dataset.station;
  const trace=()=>[...host.querySelectorAll('.office-agent')].map(n=>({id:n.dataset.id,action:n.dataset.action,state:n.dataset.state,seated:n.dataset.seated,station:n.dataset.station,x:n.dataset.currentFootx,y:n.dataset.currentFooty}));
  await probe.readyPromise;probe.setSnapshot({agents});
  result.officeEntryAnimated=await until(()=>members().some(n=>n?.dataset.action==='entering'));
  const settled=await until(()=>members().every(atMeeting)&&node('smoke-chair')?.dataset.crown==='true');
  if(settled){
   const idle=node('smoke-idle'),canvas=host.querySelector('canvas'),offset=Number(idle.dataset.idleOffset||0),startFrame=Number(canvas.dataset.frame||0);
   result.officeIdleAnimated=await until(()=>idle.dataset.action==='idle'&&idle.dataset.state==='idle'&&Math.abs(Number(idle.dataset.idleOffset||0)-offset)>.03);
   result.officePixiFrames=Number(canvas.dataset.frame||0)>startFrame;
   const chair=node('smoke-chair');result.officeChairCrowned=chair.dataset.crown==='true'&&chair.dataset.chair==='true';
   result.officeChairFacingParticipants=chair.dataset.seated==='true'&&chair.dataset.facing==='front'&&Number(chair.dataset.seatX)>38&&Number(chair.dataset.seatX)<49&&Number(chair.dataset.seatY)>64&&Number(chair.dataset.seatY)<71;
   result.officeSeatedParticipants=members().every(n=>atMeeting(n)&&n.dataset.crown==='false');
   const transitionStart=Date.now(),transitionFrame=Number(canvas.dataset.frame||0);
   probe.setSnapshot({agents:agents.map(a=>a.role==='chair'?a:{...a,state:'running',activity:a.id==='smoke-peer'?'coding':'reading',zone:a.id==='smoke-peer'?'development':'library',updatedAt:'work'})});
   const walked=await until(()=>node('smoke-peer')?.dataset.action==='walking');
   const worked=await until(()=>node('smoke-peer')?.dataset.action==='coding'&&node('smoke-idle')?.dataset.action==='reading');
   result.officeWorkSeated=node('smoke-idle')?.dataset.seated==='true'&&node('smoke-idle').dataset.station==='library'&&node('smoke-peer')?.dataset.seated==='true'&&node('smoke-peer').dataset.station==='development';
   const atWork=trace();
   probe.setSnapshot({agents});
   const returned=await until(()=>members().every(atMeeting));
   result.officeSceneTransitions=walked&&worked&&result.officeWorkSeated&&returned;
   const atReturn=trace();
   probe.setSnapshot({agents:agents.filter(a=>a.id!=='smoke-peer')});
   const exiting=await until(()=>node('smoke-peer')?.dataset.action==='exiting');
   const removed=await until(()=>!node('smoke-peer'));
   result.officeExitAnimated=exiting&&removed;
   result.officeTransitionDetails={settled,walked,worked,returned,exiting,removed,elapsedMs:Date.now()-transitionStart,frames:Number(canvas.dataset.frame||0)-transitionFrame,atWork,atReturn};
  }
 }finally{probe?.destroy();host?.remove()}
 return result;
}
