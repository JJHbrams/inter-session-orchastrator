import {ATTENTION, TERMINAL, OFFICE_ANCHORS, brief, floorPath, spot, selection, distance, floorPoint, meetingLayout, CHAIR_SEAT} from './office-pixi-model.js';
import {MEETING_SEAT_FRAMES} from './office-seat-frames.js';

const poseFor = a => a.state === 'completed' ? 7 : ({reading:3,research:3,coding:4,terminal:5,responding:6,synthesis:6,delegating:6}[a.activity] ?? 0);
const provider = a => a.provider === 'claude' ? 'claude' : 'codex';
const add = (p,c) => p.addChild?.(c);
const gone = (x,o) => x?.destroy?.(o);
const actionFor = a => a.state === 'running' ? ({reading:'reading',research:'reading',coding:'coding',terminal:'terminal',responding:'thinking',synthesis:'thinking',delegating:'thinking'}[a.activity] || 'working') : 'idle';
const phaseFor = id => [...String(id)].reduce((n,c) => ((n*31)+c.charCodeAt(0))>>>0,7)%500/100;
const directions = ['front','back','left','right'];

export function createOfficePixiScene({document,host,onSelect,onStatus,loadPixi=()=>import('/vendor/pixi.mjs')}={}) {
 if (!document || !host) throw Error('createOfficePixiScene requires document and host');
 let snapshot={agents:[]}, online=true, destroyed=false, visible=!document.hidden;
 let presentation={collapsed:false,visible:true,reducedMotion:false};
 let P,app,actors,bg,fg,mask,tableFg,tableMask,seatAtlas,emptyChair;
 let started=false,frame=0,revision=0,appInitialized=false,appDisposed=false;
 const textures=new Map(),views=new Map(),records=new Map(),trips=new Map(),retired=new Map();
 const decorations=[];
 const board=host;
 board.classList.add('office-artboard');board.dataset.renderer='pixi';board.dataset.ready='false';
 const overlay=document.createElement('div');overlay.className='office-sprite-layer';board.replaceChildren(overlay);
 const disposeApp=()=>{if(!appInitialized||appDisposed||!app)return;appDisposed=true;app.destroy?.(true,{children:true,texture:false,textureSource:false})};
 const moving=()=>!destroyed&&online&&visible&&presentation.visible!==false&&!presentation.collapsed&&!presentation.reducedMotion;
 const status=e=>{if(!destroyed)onStatus?.({visibleCount:records.size,workingCount:[...records.values()].filter(r=>r.agent.state==='running').length,ready:started,error:e?.message})};
 const logical=()=>({w:app?.screen?.width||board.clientWidth||800,h:app?.screen?.height||Math.round((board.clientWidth||800)/2.6)});
 const foot=r=>({x:+r.node.dataset.currentFootx,y:+r.node.dataset.currentFooty,zone:r.node.dataset.zone||'floor'});
 const visualFoot=r=>foot(r);
 const place=r=>{
  if(!r.container)return;
  const {w,h}=logical(),p=visualFoot(r);
  r.container.x=p.x*w/100;r.container.y=p.y*h/100;r.container.zIndex=Math.round(p.y*10);
  const size=Math.max(r.agent.kind==='subagent'?20:28,Math.min(r.agent.kind==='subagent'?50:72,w*.06));
  r.container.scale?.set?.(size/r.size);
  r.node.style.width=`${size+12}px`;r.node.style.height=`${size}px`;
  r.node.style.left=`${p.x}%`;r.node.style.top=`${p.y}%`;r.node.style.zIndex=String(10+Math.round(p.y*10));
  r.node.dataset.visualX=String(r.container.x.toFixed(2));r.node.dataset.visualY=String(r.container.y.toFixed(2));
  r.node.dataset.pose=String(r.pose);r.node.dataset.idleOffset='0';
 };
 const setFoot=(r,p)=>{r.node.dataset.x=String(p.x);r.node.dataset.y=String(p.y);r.node.dataset.currentFootx=String(p.x);r.node.dataset.currentFooty=String(p.y);r.node.dataset.zone=p.zone||'floor';place(r)};
 const tex=async a=>{
  const key=provider(a);
  if(!textures.has(key)){const loading=P.Assets.load(`/assets/office/${key}-sprites.png`).catch(error=>{if(textures.get(key)===loading)textures.delete(key);throw error});textures.set(key,loading)}
  return textures.get(key);
 };
 const crop=(key,base,p)=>{
  const id=`${key}:${p}`;
  if(!views.has(id))views.set(id,new P.Texture({source:base.source,frame:new P.Rectangle((p%4)*443.5,p>=4?443.5:0,443.5,443.5)}));
  return views.get(id);
 };
 const seatTexture=(row,facing)=>{
  const col=Math.max(0,directions.indexOf(facing)),index=row*4+col,key=`meeting:${index}`;
  if(!views.has(key)){const [x,y,w,h]=MEETING_SEAT_FRAMES[index];views.set(key,new P.Texture({source:seatAtlas.source,frame:new P.Rectangle(x,y,w,h)}))}
  return views.get(key);
 };
 const graphic=draw=>{const g=new P.Graphics();draw(g);return g};
 const parts=r=>{
  if(r.container)return;
  const {w}=logical(),s=Math.max(r.agent.kind==='subagent'?20:28,Math.min(r.agent.kind==='subagent'?50:72,w*.06));
  r.size=s;r.container=new P.Container();r.container.label='office-agent:'+r.agent.id;r.container.sortableChildren=true;
  r.body=new P.Sprite(crop(provider(r.agent),r.texture,r.pose));r.body.anchor?.set?.(.5,.85);r.body.width=s;r.body.height=s;
  r.eyes=graphic(g=>{g.rect(-s*.045,-s*.4,s*.075,s*.08).fill({color:0xf49b6a});g.rect(s*.095,-s*.41,s*.075,s*.08).fill({color:0xf49b6a});g.rect(-s*.04,-s*.355,s*.065,s*.015).fill({color:0x302523});g.rect(s*.10,-s*.365,s*.065,s*.015).fill({color:0x302523})});
  r.eyes.visible=false;r.prop=graphic(()=>{});r.prop.visible=false;
  add(r.container,r.body);add(r.container,r.eyes);add(r.container,r.prop);add(actors,r.container);
 };
 const remove=id=>{const r=records.get(id);if(!r)return;trips.delete(id);retired.set(id,r.agent.updatedAt||'');gone(r.container,{children:true});r.node.remove();records.delete(id);status()};
 const create=(agent,target)=>{
  const node=document.createElement('button');node.type='button';node.className='office-agent';node.dataset.agentId=node.dataset.id=agent.id;
  node.onclick=()=>onSelect?.(selection(node._agent));
  const label=document.createElement('span'),detail=document.createElement('small');label.className='office-agent-label';detail.className='office-agent-detail';node.append(label,detail);overlay.append(node);
  const r={agent,node,label,detail,phase:phaseFor(agent.id),pose:poseFor(agent),texture:null,seated:false,seat:null};records.set(agent.id,r);
  setFoot(r,agent.kind==='subagent'?{...spot({...agent,state:'completed'},0),zone:'door'}:target);return r;
 };
 const travel=(id,target,removeAfter=false,fromSeat=null,toSeat=null)=>{
  const r=records.get(id);if(!r)return;
  const active=trips.get(id);
  if(active&&active.target.x===target.x&&active.target.y===target.y){active.removeAfter||=removeAfter;return}
  const from=foot(r);
  if(from.x===target.x&&from.y===target.y){trips.delete(id);if(removeAfter)remove(id);return}
  // A short stand-up / sit-down segment joins the seat to the safe floor route.
  // Keep the rendered foot continuous; the table foreground hides legs behind it.
  const escape=[active?.exitApproach,active?.enterApproach].filter(Boolean).sort((a,b)=>distance(from,a)-distance(from,b))[0];
  const exit=fromSeat?.approach||(!floorPoint(from)?escape:null);
  const enter=toSeat?.approach||null,routeStart=exit||from,routeEnd=enter||target;
  const same=(a,b)=>a.x===b.x&&a.y===b.y;
  const route=same(routeStart,routeEnd)?[]:floorPath(routeStart,routeEnd);
  if(!same(routeStart,routeEnd)&&!route.length){if(removeAfter)remove(id);return}
  const points=[];
  if(exit&&!same(from,exit))points.push(exit);
  points.push(...route);
  if(enter&&!same(routeEnd,target))points.push(target);
  if(!points.length)return;
  r.seated=false;trips.set(id,{from,target,points,index:0,progress:0,removeAfter,exitApproach:exit,enterApproach:enter});
 };
 const setAction=r=>{
  const at=foot(r);
  r.seated=!!r.seat&&!trips.has(r.agent.id)&&at.x===r.seat.x&&at.y===r.seat.y;
  r.node.dataset.seated=String(r.seated);r.node.dataset.chair=String(r.agent.role==='chair');
  r.node.dataset.facing=r.seated?r.seat.facing:'';
  r.node.dataset.seatX=r.seat?String(r.seat.x):'';r.node.dataset.seatY=r.seat?String(r.seat.y):'';
  r.node.dataset.action=trips.has(r.agent.id)?'walking':r.seated?(r.agent.state==='running'&&['responding','synthesis','delegating'].includes(r.agent.activity)?'talking':actionFor(r.agent)):actionFor(r.agent);
  place(r);
 };
 const animate=r=>{
  if(!r.body)return;
  const a=r.node.dataset.action,p=r.phase,s=r.size,isClaude=provider(r.agent)==='claude';
  r.pose=a==='walking'?(Math.floor(p*7)%2?2:1):poseFor(r.agent);
  if(r.seated){
   const talking=a==='talking'&&(!moving()||Math.floor(p*2.8)%2===0);
   r.pose=(isClaude?0:2)+(talking?1:0);
   r.body.texture=seatTexture(r.pose,r.seat.facing);r.body.anchor?.set?.(.5,1);
   const ratio=r.body.texture.frame.width/r.body.texture.frame.height;
   r.body.width=s*1.2*ratio;r.body.height=s*1.2;
  }else{r.body.texture=crop(provider(r.agent),r.texture,r.pose);r.body.anchor?.set?.(.5,.85);r.body.width=s;r.body.height=s}
  r.body.scale.x=Math.abs(r.body.scale.x);r.body.rotation=0;r.body.x=0;r.body.y=0;
  r.eyes.visible=false;r.eyes.scale?.set?.(1,1);r.prop.visible=false;r.prop.alpha=1;r.prop.rotation=0;r.prop.x=0;r.prop.y=0;r.prop.scale?.set?.(1,1);
  if(r.propAction!==a){
   r.prop.clear();
   if(a==='reading')r.prop.poly([0,-s*.23,s*.17,-s*.25,s*.15,-s*.06,0,-s*.05]).fill({color:0xffefd0,alpha:.95});
   else if(a==='coding'){r.prop.rect(-s*.13,-s*.18,s*.11,s*.055).fill({color:0x26343a});r.prop.rect(s*.05,-s*.18,s*.11,s*.055).fill({color:0x26343a})}
   else if(a==='terminal'){r.prop.rect(s*.13,-s*.29,s*.06,s*.02).fill({color:0x8cf4d0});r.prop.rect(s*.13,-s*.25,s*.11,s*.02).fill({color:0x8cf4d0});r.prop.rect(s*.13,-s*.21,s*.025,s*.035).fill({color:0x8cf4d0})}
   else if(a==='thinking'||a==='talking')r.prop.rect(s*.23,-s*.98,s*.04,s*.04).rect(s*.30,-s*1.02,s*.04,s*.04).rect(s*.37,-s*.98,s*.04,s*.04).fill({color:0xffe4a3});
   r.propAction=a;
  }
  let bob=0;
  if(a==='walking'){
   r.body.scale.x=((trips.get(r.agent.id)?.target.x??foot(r).x)<foot(r).x?-1:1)*Math.abs(r.body.scale.x);
   bob=Math.abs(Math.sin(p*12))*s*.035;
  }else if(a==='idle'){
   bob=Math.sin(p*2.1)*(r.seated?.45:.9);
   if(!r.seated&&isClaude){r.eyes.visible=r.pose===0&&(p%3.2)>.13&&(p%3.2)<.25;r.body.x=Math.sin(p*.7)*.35;r.eyes.x=r.body.x}
   else if(!r.seated)r.body.rotation=Math.sin(p*1.7)*.025;
  }else if(a==='reading'){r.prop.visible=true;r.prop.scale.x=.6+Math.abs(Math.sin(p*4))*.4;r.prop.rotation=Math.sin(p*4)*.04}
  else if(a==='coding'){r.prop.visible=true;r.prop.y=Math.sin(p*14)*1.2;r.prop.rotation=Math.sin(p*14)*.035}
  else if(a==='terminal'){r.prop.visible=true;r.prop.alpha=Math.sin(p*5)>0?1:.35}
  else if(a==='thinking'){r.prop.visible=true;r.prop.y=Math.sin(p*4)*1.4}
  else if(a==='talking'){r.prop.visible=true;r.prop.alpha=.65+Math.sin(p*5)*.3}
  if(!moving()){bob=0;r.body.rotation=0;r.body.x=0;r.eyes.visible=false;r.prop.rotation=0;r.prop.y=0;r.prop.scale?.set?.(1,1);r.prop.alpha=1}
  const {h}=logical();r.container.y=visualFoot(r).y*h/100+bob;
  r.node.dataset.pose=String(r.pose);r.node.dataset.idleOffset=String(bob.toFixed(3));r.node.dataset.visualX=String(r.container.x.toFixed(2));r.node.dataset.visualY=String(r.container.y.toFixed(2));r.node.dataset.blink=String(r.eyes.visible);
 };
 const tick=d=>{
  if(!moving())return;
  const ms=Math.min(64,Math.max(0,d?.deltaMS??d??16));app.canvas.dataset.frame=String(++frame);
  for(const[id,t]of trips){
   const r=records.get(id);if(!r){trips.delete(id);continue}
   let rest=30*ms/1000;
   while(rest&&t.index<t.points.length){
    const end=t.points[t.index],len=distance(t.from,end)||1,step=Math.min(rest,(1-t.progress)*len);t.progress+=step/len;
    setFoot(r,{x:t.from.x+(end.x-t.from.x)*t.progress,y:t.from.y+(end.y-t.from.y)*t.progress,zone:t.target.zone});rest-=step;
    if(t.progress>=1){t.from=end;t.index++;t.progress=0}
   }
   if(t.index===t.points.length){trips.delete(id);if(t.removeAfter)remove(id)}
  }
  for(const r of records.values()){r.phase=(r.phase+ms/1000)%100;setAction(r);animate(r)}
 };
 const sync=()=>{if(app?.ticker)moving()?app.ticker.start?.():app.ticker.stop?.()};
 const drawMasks=(w,h)=>{
  mask?.clear?.().poly([w*.39,h*.39,w*.48,h*.35,w*.49,h*.60,w*.47,h*.64,w*.39,h*.65,w*.38,h*.61]).fill({color:0xffffff,alpha:1});
  tableMask?.clear?.().poly([w*.442,h*.70,w*.45,h*.65,w*.49,h*.61,w*.56,h*.596,w*.61,h*.62,w*.624,h*.66,w*.62,h*.72,w*.605,h*.76,w*.605,h*.825,w*.596,h*.825,w*.596,h*.765,w*.51,h*.792,w*.51,h*.845,w*.5,h*.845,w*.5,h*.79,w*.46,h*.778,w*.46,h*.81,w*.45,h*.81,w*.45,h*.764,w*.444,h*.735]).fill({color:0xffffff,alpha:1});
 };
 const placeChair=(sprite,seat,scale=1)=>{
  const {w,h}=logical(),texture=sprite.texture,ratio=texture.frame.width/texture.frame.height;
  sprite.anchor?.set?.(.5,1);sprite.height=Math.max(28,Math.min(72,w*.06))*.95*scale;sprite.width=sprite.height*ratio;
  sprite.x=seat.x*w/100;sprite.y=seat.y*h/100;sprite.zIndex=Math.round(seat.y*10);
 };
 const refreshChairs=layout=>{
  if(!emptyChair)return;
  const seats=[...layout.values()];emptyChair.visible=!seats.some(s=>s.chair);placeChair(emptyChair,CHAIR_SEAT);
  const occupied=seats.some(s=>!s.chair);
  for(const d of decorations){d.sprite.visible=!occupied;placeChair(d.sprite,d.seat)}
 };
 const resize=()=>{
  if(!appInitialized||destroyed)return;
  const w=Math.max(1,board.clientWidth||800),h=Math.max(1,Math.round(w/2.6));app.renderer.resize?.(w,h,Math.min(globalThis.devicePixelRatio||1,2));
  for(const sprite of[bg,fg,tableFg])if(sprite){sprite.width=w;sprite.height=h}
  drawMasks(w,h);refreshChairs(meetingLayout(snapshot.agents||[]));for(const r of records.values()){place(r);animate(r)}app.render?.();
 };
 const paint=async expected=>{
  if(!started||destroyed||expected!==revision)return;
  const agents=(snapshot.agents||[]).filter(a=>a.state!=='left').slice(0,25),layout=meetingLayout(agents),shown=new Set(),slots=new Map(),anchors={...OFFICE_ANCHORS,...(snapshot.anchors||{})};
  refreshChairs(layout);
  for(const agent of agents){
   if(expected!==revision)return;
   const old=retired.get(agent.id);if(old===agent.updatedAt&&TERMINAL.has(agent.state))continue;if(old&&!TERMINAL.has(agent.state))retired.delete(agent.id);shown.add(agent.id);
   const seat=layout.get(agent.id)||null,zone=TERMINAL.has(agent.state)&&agent.kind==='subagent'?'door':ATTENTION.has(agent.state)?'table':agent.zone||'table',i=slots.get(zone)||0;slots.set(zone,i+1);
   const target=seat||spot(agent,i,anchors);
   let r=records.get(agent.id);if(!r){if(TERMINAL.has(agent.state)&&agent.kind==='subagent'){retired.set(agent.id,agent.updatedAt||'');continue}r=create(agent,target)}
   const previousSeat=r.seated?r.seat:null;
   r.agent=agent;r.seat=seat;r.node._agent=agent;r.label.textContent=agent.label||'세션';r.detail.textContent=brief(agent);
   r.node.dataset.state=agent.state;r.node.dataset.provider=agent.provider||'';r.node.classList.toggle('office-child',agent.kind==='subagent');r.node.classList.toggle('office-working',agent.state==='running');r.node.classList.toggle('office-attention',ATTENTION.has(agent.state));
   r.node.setAttribute('aria-label',`${agent.label||'이름 없는 세션'} · ${brief(agent)}`);
   if(!r.texture){try{const base=await tex(agent);if(destroyed||expected!==revision||records.get(agent.id)!==r)return;r.texture=base;parts(r);place(r)}catch(e){status(e)}}
   if(agent.role==='chair'){trips.delete(agent.id);setFoot(r,target)}
   else if(TERMINAL.has(agent.state)&&agent.kind==='subagent'){
    if(presentation.reducedMotion)remove(agent.id);else travel(agent.id,{...spot({...agent,state:'completed'},0,anchors),zone:'door'},true);
   }else{
    const at=foot(r);
    if(presentation.reducedMotion){trips.delete(agent.id);setFoot(r,target)}
    else if(at.x!==target.x||at.y!==target.y)travel(agent.id,target,false,previousSeat,seat);
   }
   if(records.get(agent.id)===r){setAction(r);animate(r)}
  }
  if(expected!==revision)return;for(const id of[...records.keys()])if(!shown.has(id))remove(id);sync();app.render?.();status();
 };
 const visibility=()=>{visible=!document.hidden;sync()};document.addEventListener('visibilitychange',visibility);
 const readyPromise=Promise.resolve().then(loadPixi).then(async lib=>{
  if(destroyed)return;P=lib;await P.Assets.init?.({preferences:{preferWorkers:false}});if(destroyed)return;
  app=new P.Application();await app.init({width:Math.max(1,board.clientWidth||800),height:Math.max(1,Math.round((board.clientWidth||800)/2.6)),autoDensity:true,resolution:Math.min(globalThis.devicePixelRatio||1,2),preference:['webgl','canvas'],backgroundAlpha:0});
  appInitialized=true;if(destroyed){disposeApp();return}
  app.canvas.dataset.renderer='pixi';app.canvas.dataset.ready='false';app.canvas.dataset.frame='0';board.prepend(app.canvas);app.stage.sortableChildren=true;
  await P.Assets.load('/assets/office/office-background.png');if(destroyed)return;
  const base=await P.Assets.load('/assets/office/office-meeting-background.png');if(destroyed)return;
  seatAtlas=await P.Assets.load('/assets/office/meeting-seats.png');if(destroyed)return;
  bg=new P.Sprite(base);bg.width=app.screen.width;bg.height=app.screen.height;add(app.stage,bg);
  actors=new P.Container();actors.sortableChildren=true;add(app.stage,actors);
  fg=new P.Sprite(base);fg.width=app.screen.width;fg.height=app.screen.height;mask=new P.Graphics();fg.mask=mask;fg.zIndex=650;mask.zIndex=650;add(actors,mask);add(actors,fg);
  tableFg=new P.Sprite(base);tableFg.width=app.screen.width;tableFg.height=app.screen.height;tableMask=new P.Graphics();tableFg.mask=tableMask;tableFg.zIndex=770;tableMask.zIndex=770;add(actors,tableMask);add(actors,tableFg);drawMasks(app.screen.width,app.screen.height);
  emptyChair=new P.Sprite(seatTexture(4,CHAIR_SEAT.facing));emptyChair.label='meeting-chair-empty';add(actors,emptyChair);
  for(const seat of[{x:61.8,y:67,facing:'left'},{x:49,y:87,facing:'back'},{x:62,y:82,facing:'back'}]){const sprite=new P.Sprite(seatTexture(4,seat.facing));sprite.label='meeting-chair-decoration';decorations.push({sprite,seat});add(actors,sprite)}
  const ro=globalThis.ResizeObserver?new ResizeObserver(resize):null;ro?.observe(board);board._pixiResizeObserver=ro;
  app.ticker.maxFPS=30;app.ticker.add(tick);started=true;board.dataset.ready='true';sync();await paint(revision);if(!destroyed)app.canvas.dataset.ready='true';status();
 }).catch(e=>{if(destroyed)return;board.dataset.ready='false';status(e);throw e});
 return {
  readyPromise,
  setSnapshot(next={}){if(!destroyed){snapshot=next;revision++;if(started)void paint(revision)}},
  setRoom(){if(destroyed)return;revision++;trips.clear();retired.clear();for(const id of[...records.keys()])remove(id);snapshot={agents:[]};if(started)void paint(revision)},
  setConnection(next){if(destroyed)return;online=!!next;sync();status()},
  setPresentation(next={}){
   if(destroyed)return;presentation={...presentation,...next};
   if(presentation.reducedMotion){const pending=[...trips];trips.clear();for(const[id,t]of pending){const r=records.get(id);if(r){setFoot(r,t.target);if(t.removeAfter)remove(id);else{setAction(r);animate(r)}}}}
   sync();if(appInitialized)app.render?.();status();
  },
  destroy(){destroyed=true;revision++;document.removeEventListener('visibilitychange',visibility);board._pixiResizeObserver?.disconnect?.();for(const id of[...records.keys()])remove(id);app?.ticker?.remove?.(tick);disposeApp();for(const view of views.values())gone(view);views.clear();textures.clear();board.replaceChildren()}
 };
}
