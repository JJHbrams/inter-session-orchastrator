/** Runs only in the isolated packaged smoke renderer, never a user's profile. */
export async function pixiSmokeInPage(){
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async test=>{const end=Date.now()+10000;while(Date.now()<end){if(test())return true;await wait(40)}return false};
 const officePixiReady=await until(()=>{const c=document.querySelector('#agentOffice canvas[data-renderer="pixi"]');return c?.dataset.ready==='true'&&c.width>0&&c.height>0});
 let officeIdleAnimated=false,officePixiFrames=false,officeChairCrowned=false,officeChairFacingParticipants=false,officeSeatedParticipants=false,officeSceneTransitions=false,officeTransitionDetails=null,probe,host;
 if(officePixiReady){
  try{
   const {createOfficePixiScene}=await import('/office-pixi-scene.js');
   host=document.createElement('div');host.className='office-artboard';host.style.cssText='position:fixed;left:0;top:0;width:520px;height:200px;transform:none;pointer-events:none;z-index:10';document.body.append(host);
   probe=createOfficePixiScene({document,host});probe.setRoom('smoke-office');probe.setPresentation({collapsed:false,visible:true,reducedMotion:false});
   const smokeAgents=[{id:'smoke-idle',sessionId:'smoke',label:'검증용 세션',provider:'claude',kind:'session',role:'participant',state:'idle',activity:'none',zone:'table',updatedAt:'smoke'},{id:'smoke-chair',sessionId:'chair',label:'검증용 좌장',provider:'claude',kind:'session',role:'chair',state:'running',activity:'responding',zone:'table',updatedAt:'smoke'},{id:'smoke-peer',sessionId:'peer',label:'검증용 참여자',provider:'codex',kind:'session',role:'participant',state:'idle',activity:'none',zone:'table',updatedAt:'smoke'}];
   probe.setSnapshot({agents:smokeAgents});
   await probe.readyPromise;
   const loaded=await until(()=>['smoke-idle','smoke-chair','smoke-peer'].every(id=>host.querySelector('[data-agent-id="'+id+'"]')?.dataset.visualY!==undefined));
   if(loaded){const node=host.querySelector('[data-agent-id="smoke-idle"]'),canvas=host.querySelector('canvas'),first=Number(node.dataset.idleOffset||0),startFrame=Number(canvas.dataset.frame||0);
    officeIdleAnimated=await until(()=>Math.abs(Number(node.dataset.idleOffset||0)-first)>.03&&node.dataset.state==='idle');
    officePixiFrames=Number(canvas.dataset.frame||0)>startFrame;
    const chair=host.querySelector('[data-agent-id="smoke-chair"]');
    officeChairCrowned=chair?.dataset.crown==='true'&&chair.dataset.chair==='true';
    officeChairFacingParticipants=chair?.dataset.seated==='true'&&chair.dataset.facing==='front'&&Number(chair.dataset.seatX)>38&&Number(chair.dataset.seatX)<49&&Number(chair.dataset.seatY)>64&&Number(chair.dataset.seatY)<71;
    officeSeatedParticipants=host.querySelectorAll('.office-agent[data-chair="false"][data-seated="true"][data-crown="false"]').length===2;
    const transitionStart=Date.now(),transitionFrame=Number(canvas.dataset.frame||0);
    probe.setSnapshot({agents:smokeAgents.map(a=>a.role==='chair'?a:{...a,state:'running',activity:a.id==='smoke-peer'?'coding':'reading',zone:a.id==='smoke-peer'?'development':'library',updatedAt:'work'})});
    const walked=await until(()=>host.querySelector('[data-agent-id="smoke-peer"]')?.dataset.action==='walking');
    const worked=await until(()=>host.querySelector('[data-agent-id="smoke-peer"]')?.dataset.action==='coding'&&host.querySelector('[data-agent-id="smoke-idle"]')?.dataset.action==='reading');
    const atWork=[...host.querySelectorAll('.office-agent')].map(n=>({id:n.dataset.id,action:n.dataset.action,seated:n.dataset.seated,x:n.dataset.currentFootx,y:n.dataset.currentFooty}));
    const away=host.querySelectorAll('.office-agent[data-chair="false"][data-seated="true"]').length===0;
    probe.setSnapshot({agents:smokeAgents});
    const returned=await until(()=>host.querySelectorAll('.office-agent[data-chair="false"][data-seated="true"]').length===2);
    officeSceneTransitions=walked&&worked&&away&&returned;
    officeTransitionDetails={walked,worked,away,returned,elapsedMs:Date.now()-transitionStart,frames:Number(canvas.dataset.frame||0)-transitionFrame,atWork,atReturn:[...host.querySelectorAll('.office-agent')].map(n=>({id:n.dataset.id,action:n.dataset.action,seated:n.dataset.seated,x:n.dataset.currentFootx,y:n.dataset.currentFooty}))};
   }
  }finally{probe?.destroy();host?.remove()}
 }
 return {officePixiReady,officeIdleAnimated,officePixiFrames,officeChairCrowned,officeChairFacingParticipants,officeSeatedParticipants,officeSceneTransitions,officeTransitionDetails};
}
