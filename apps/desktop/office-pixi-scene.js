import {ATTENTION, TERMINAL, OFFICE_ANCHORS, WORK_STATIONS, brief, floorPath, spot, stationSpot, selection, distance, floorPoint, meetingLayout, CHAIR_SEAT} from './office-pixi-model.js';
import {MEETING_SEAT_FRAMES} from './office-seat-frames.js';
import {OFFICE_ACTION_ASSETS, OFFICE_ACTION_GEOMETRY} from './office-action-frames.js';
import {COMPOSITE_DIRECTIONS, OFFICE_COMPOSITE_ASSETS} from './office-composite-frames.js';

const poseFor = a => a.state === 'completed' ? 7 : ({reading:3,research:3,coding:4,terminal:5,responding:6,synthesis:6,delegating:6}[a.activity] ?? 0);
const provider = a => a.provider === 'claude' ? 'claude' : 'codex';
const add = (p,c) => p.addChild?.(c);
const gone = (x,o) => x?.destroy?.(o);
const actionFor = a => a.state === 'running' ? ({reading:'reading',research:'reading',coding:'coding',terminal:'terminal',responding:'thinking',synthesis:'thinking',delegating:'thinking'}[a.activity] || 'working') : 'idle';
const phaseFor = id => [...String(id)].reduce((n,c) => ((n*31)+c.charCodeAt(0))>>>0,7)%500/100;
const directions = COMPOSITE_DIRECTIONS;
const legacyDirections = ['front','back','left','right'];
const legacyFacing = facing => ({'front-left':'left','back-left':'left','front-right':'right','back-right':'right'})[facing]||facing;

export function createOfficePixiScene({document,host,onSelect,onStatus,loadPixi=()=>import('/vendor/pixi.mjs')}={}) {
 if (!document || !host) throw Error('createOfficePixiScene requires document and host');
 let snapshot={agents:[]}, online=true, destroyed=false, visible=!document.hidden;
 let presentation={collapsed:false,visible:true,reducedMotion:false};
 let P,app,actors,bg,fg,mask,tableFg,tableMask,doorFg,doorMask,seatAtlas,emptyChair,workAtlas;
 let started=false,frame=0,revision=0,appInitialized=false,appDisposed=false,snapshotBeforeReady=false;
 const textures=new Map(),actionAtlases=new Map(),compositeAtlases=new Map(),views=new Map(),records=new Map(),trips=new Map(),retired=new Map();
 const decorations=[],stationFronts=[],emptyWorkChairs=[];
 const board=host;
 board.classList.add('office-artboard');board.dataset.renderer='pixi';board.dataset.ready='false';
 const overlay=document.createElement('div');overlay.className='office-sprite-layer';board.replaceChildren(overlay);
 const disposeApp=()=>{if(!appInitialized||appDisposed||!app)return;appDisposed=true;app.destroy?.(true,{children:true,texture:false,textureSource:false})};
 const moving=()=>!destroyed&&online&&visible&&presentation.visible!==false&&!presentation.collapsed&&!presentation.reducedMotion;
 const status=e=>{if(!destroyed)onStatus?.({visibleCount:records.size,workingCount:[...records.values()].filter(r=>r.agent.state==='running'&&!trips.get(r.agent.id)?.removeAfter).length,ready:started,error:e?.message})};
 const logical=()=>({w:app?.screen?.width||board.clientWidth||800,h:app?.screen?.height||Math.round((board.clientWidth||800)/2.6)});
 const doorSpot=()=>({x:OFFICE_ANCHORS.door[0],y:OFFICE_ANCHORS.door[1],zone:'door'});
 const foot=r=>({x:+r.node.dataset.currentFootx,y:+r.node.dataset.currentFooty,zone:r.node.dataset.zone||'floor'});
 const visualFoot=r=>foot(r);
 const place=r=>{
  if(!r.container)return;
  const {w,h}=logical(),p=visualFoot(r);
  r.container.x=p.x*w/100;r.container.y=p.y*h/100;r.container.zIndex=r.seated&&r.station?.station==='library'?560:Math.round(p.y*10);
  const size=Math.max(r.agent.kind==='subagent'?20:28,Math.min(r.agent.kind==='subagent'?50:72,w*.06*(r.agent.kind==='subagent'?.82:1)));
  r.container.scale?.set?.(size/r.size);
  r.node.style.width=`${size+12}px`;r.node.style.height=`${size}px`;
  r.node.style.left=`${p.x}%`;r.node.style.top=`${p.y}%`;r.node.style.zIndex=String(10+Math.round(p.y*10));
  r.node.dataset.visualX=String(r.container.x.toFixed(2));r.node.dataset.visualY=String(r.container.y.toFixed(2));
  r.node.dataset.pose=String(r.pose);r.node.dataset.idleOffset='0';
 };
 const setFoot=(r,p)=>{r.node.dataset.x=String(p.x);r.node.dataset.y=String(p.y);r.node.dataset.currentFootx=String(p.x);r.node.dataset.currentFooty=String(p.y);r.node.dataset.zone=p.zone||'floor';place(r)};
 const tex=async a=>{
  const key=provider(a);
  if(!textures.has(key)){const loading=Promise.all([actionAtlas(`${key}-travel`),compositeAtlas(`${key}-chair-composite`),compositeAtlas('work-chair-composite')]).then(([travel,seated,work])=>({travel,seated,work})).catch(error=>{if(textures.get(key)===loading)textures.delete(key);throw error});textures.set(key,loading)}
  return textures.get(key);
 };
 const compositeAtlas=async key=>{
  const asset=OFFICE_COMPOSITE_ASSETS[key];if(!asset)throw Error(`unknown office composite atlas: ${key}`);
  const cached=compositeAtlases.get(key);if(cached?.frame)return cached;
  if(!cached){const loading=P.Assets.load(asset.url).then(value=>{if(!destroyed&&compositeAtlases.get(key)===loading)compositeAtlases.set(key,value);return value}).catch(error=>{if(compositeAtlases.get(key)===loading)compositeAtlases.delete(key);throw error});compositeAtlases.set(key,loading)}
  return compositeAtlases.get(key);
 };
 const actionAtlas=async key=>{
  const asset=OFFICE_ACTION_ASSETS[key];if(!asset)throw Error(`unknown office action atlas: ${key}`);
  const cached=actionAtlases.get(key);if(cached?.frame)return cached;
  if(!cached){const loading=P.Assets.load(asset.url).then(value=>{if(!destroyed&&actionAtlases.get(key)===loading)actionAtlases.set(key,value);return value}).catch(error=>{if(actionAtlases.get(key)===loading)actionAtlases.delete(key);throw error});actionAtlases.set(key,loading)}
  return actionAtlases.get(key);
 };
 const actionTexture=(key,base,col,row)=>{
  const asset=OFFICE_ACTION_ASSETS[key],index=row*asset.columns+col,id=`action:${key}:${index}`;
  if(!views.has(id)){const specified=OFFICE_ACTION_GEOMETRY[key]?.[index]?.frame||asset.frames?.[index],fw=base.frame.width/asset.columns,fh=base.frame.height/asset.rows,[x,y,w,h]=specified||[col*fw,row*fh,fw,fh];views.set(id,new P.Texture({source:base.source,frame:new P.Rectangle(x,y,w,h)}))}
  return views.get(id);
 };
 const compositeTexture=(key,base,col,row)=>{
  const asset=OFFICE_COMPOSITE_ASSETS[key],index=row*asset.columns+col,id=`composite:${key}:${index}`;
  if(!views.has(id)){const cellWidth=base.frame.width/asset.columns,cellHeight=base.frame.height/asset.rows,[x,y,w,h]=asset.frames?.[index]||[col*cellWidth,row*cellHeight,cellWidth,cellHeight];views.set(id,new P.Texture({source:base.source,frame:new P.Rectangle(x,y,w,h)}))}
  return views.get(id);
 };
 const crop=(key,base,p)=>{
  const id=`${key}:${p}`;
  if(!views.has(id))views.set(id,new P.Texture({source:base.source,frame:new P.Rectangle((p%4)*443.5,p>=4?443.5:0,443.5,443.5)}));
  return views.get(id);
 };
 const seatTexture=(row,facing)=>{
  const col=Math.max(0,legacyDirections.indexOf(legacyFacing(facing))),index=row*4+col,key=`meeting:${index}`;
  if(!views.has(key)){const [x,y,w,h]=MEETING_SEAT_FRAMES[index];views.set(key,new P.Texture({source:seatAtlas.source,frame:new P.Rectangle(x,y,w,h)}))}
  return views.get(key);
 };
 const graphic=draw=>{const g=new P.Graphics();draw(g);return g};
 const parts=r=>{
  if(r.container)return;
  const {w}=logical(),s=Math.max(r.agent.kind==='subagent'?20:28,Math.min(r.agent.kind==='subagent'?50:72,w*.06*(r.agent.kind==='subagent'?.82:1)));
  r.size=s;r.container=new P.Container();r.container.label='office-agent:'+r.agent.id;r.container.sortableChildren=true;
  r.chairSprite=new P.Sprite(seatTexture(4,'front'));r.chairSprite.label=`office-chair:${r.agent.id}`;r.chairSprite.visible=false;r.chairSprite.zIndex=0;
  r.chairFront=new P.Sprite(seatTexture(4,'back'));r.chairFront.label=`office-chair-front:${r.agent.id}`;r.chairFront.visible=false;r.chairFront.zIndex=2;
  r.body=new P.Sprite(actionTexture(`${provider(r.agent)}-travel`,r.texture.travel,0,0));r.body.anchor?.set?.(.5,.85);r.body.width=s;r.body.height=s;r.body.zIndex=1;
  r.eyes=graphic(g=>{g.rect(-s*.045,-s*.4,s*.075,s*.08).fill({color:0xf49b6a});g.rect(s*.095,-s*.41,s*.075,s*.08).fill({color:0xf49b6a});g.rect(-s*.04,-s*.355,s*.065,s*.015).fill({color:0x302523});g.rect(s*.10,-s*.365,s*.065,s*.015).fill({color:0x302523})});
  r.eyes.visible=false;r.prop=graphic(()=>{});r.prop.visible=false;
  r.crown=graphic(g=>{g.poly([-s*.26,-s*.08,-s*.21,-s*.32,-s*.08,-s*.18,0,-s*.40,s*.09,-s*.18,s*.22,-s*.32,s*.27,-s*.08]).fill({color:0x382818});g.poly([-s*.20,-s*.10,-s*.17,-s*.26,-s*.07,-s*.14,0,-s*.33,s*.07,-s*.14,s*.18,-s*.26,s*.21,-s*.10]).fill({color:0xf6c744});g.rect(-s*.13,-s*.12,s*.06,s*.045).rect(s*.07,-s*.12,s*.06,s*.045).fill({color:0xd9435f});});r.crown.visible=false;r.crown.zIndex=4;
  add(r.container,r.chairSprite);add(r.container,r.body);add(r.container,r.eyes);add(r.container,r.prop);add(r.container,r.crown);add(r.container,r.chairFront);add(actors,r.container);
 };
 const remove=id=>{const r=records.get(id);if(!r)return;trips.delete(id);retired.set(id,r.agent.updatedAt||'');gone(r.container,{children:true});r.node.remove();records.delete(id);status()};
 const create=(agent,target,atTarget=false)=>{
  const node=document.createElement('button');node.type='button';node.className='office-agent';node.dataset.agentId=node.dataset.id=agent.id;
  node.onclick=()=>{if(!node.disabled)onSelect?.(selection(node._agent))};
  const label=document.createElement('span'),detail=document.createElement('small');label.className='office-agent-label';detail.className='office-agent-detail';node.append(label,detail);overlay.append(node);
  const r={agent,node,label,detail,phase:phaseFor(agent.id),pose:poseFor(agent),texture:null,seated:false,seat:null,walkDistance:0};records.set(agent.id,r);
  setFoot(r,atTarget?target:doorSpot());return r;
 };
 const travel=(id,target,removeAfter=false,fromSeat=null,toSeat=null,mode='walking')=>{
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
  r.seated=false;trips.set(id,{from,target,points,index:0,progress:0,removeAfter,exitApproach:exit,enterApproach:enter,mode});
 };
 const setAction=r=>{
  const at=foot(r);
  const seat=r.seat||r.station;r.seated=!!seat&&!trips.has(r.agent.id)&&at.x===seat.x&&at.y===seat.y;
  r.node.dataset.seated=String(r.seated);r.node.dataset.chair=String(r.agent.role==='chair');
  r.node.dataset.facing=r.seated?(seat.facing||'front'):'';
  r.node.dataset.station=r.seated&&r.station?r.station.station:'';
  r.node.dataset.seatX=seat?String(seat.x):'';r.node.dataset.seatY=seat?String(seat.y):'';
  const trip=trips.get(r.agent.id);r.detail.textContent=trip?.mode==='entering'?'입장 중':trip?.mode==='exiting'?'퇴장 중':brief(r.agent);r.node.setAttribute('aria-label',`${r.agent.label||'이름 없는 세션'} · ${r.detail.textContent}`);r.node.dataset.action=trip?(trip.mode||'walking'):r.seated?(r.agent.state==='running'&&['responding','synthesis','delegating'].includes(r.agent.activity)?'talking':actionFor(r.agent)):actionFor(r.agent);
  r.node.disabled=!!trip?.removeAfter;
  r.node.dataset.crown=String(!!r.crown?.visible);
  place(r);
 };
 const animateComposite=(r,atMeeting,atStation)=>{
  const a=r.node.dataset.action,p=r.phase,assetKey=atMeeting?`${provider(r.agent)}-chair-composite`:'work-chair-composite';
  const asset=OFFICE_COMPOSITE_ASSETS[assetKey],column=atMeeting?Math.max(0,directions.indexOf(r.node.dataset.facing||'front')):({library:0,development:1,server:2}[r.station.station]??0);
  const row=atMeeting?(a==='talking'?2:(Math.floor(p*.75)%9===0?1:0)):(provider(r.agent)==='claude'?(Math.floor(p*2)%2?2:1):(Math.floor(p*2)%2?4:3));
  r.chairSprite.visible=false;r.chairFront.visible=false;
  r.body.texture=compositeTexture(assetKey,atMeeting?r.texture.seated:r.texture.work,column,row);
  r.body.rotation=0;r.body.x=0;r.body.y=0;
  const frameRect=r.body.texture.frame,geometry=asset.geometry?.[row*asset.columns+column],head=geometry?.head||[frameRect.x,frameRect.y,frameRect.width,frameRect.height*.45];
  const foot=geometry?.foot||[frameRect.x+frameRect.width/2,frameRect.y+frameRect.height];
  r.body.anchor?.set?.((foot[0]-frameRect.x)/frameRect.width,(foot[1]-frameRect.y)/frameRect.height);
  const pixelScale=r.size*(assetKey==='work-chair-composite'?1.75:1.6)/(asset.size[1]/asset.rows);r.body.scale.set?.(pixelScale,pixelScale);
  const scaleY=Math.abs(r.body.scale.y),scaleX=Math.abs(r.body.scale.x),containerScaleX=Math.abs(r.container.scale?.x??1),containerScaleY=Math.abs(r.container.scale?.y??1);
  const headTop=-(foot[1]-frameRect.y)*scaleY+(head[1]-frameRect.y)*scaleY,headCenterX=((head[0]+head[2]/2)-foot[0])*scaleX;
  r.crown.x=headCenterX;r.crown.y=headTop-r.size*.06;r.crown.visible=!!(r.agent.kind==='session'&&!r.agent.parentId&&r.agent.role==='chair'&&atMeeting);r.node.dataset.crown=String(r.crown.visible);
  const boundary=['entering','exiting'].includes(a)?Math.min(1,distance(foot(r),doorSpot())/7):1;r.container.alpha=boundary;r.node.style.opacity=String(boundary);r.node.dataset.doorOcclusion=String((1-boundary).toFixed(3));
  r.pose=row*asset.columns+column;r.node.dataset.pose=String(r.pose);r.node.dataset.spriteAsset=assetKey;r.node.dataset.idleOffset='0';r.node.dataset.visualX=String(r.container.x.toFixed(2));r.node.dataset.visualY=String(r.container.y.toFixed(2));r.node.dataset.frameX=String(frameRect.x);r.node.dataset.frameY=String(frameRect.y);r.node.dataset.frameWidth=String(frameRect.width);r.node.dataset.frameHeight=String(frameRect.height);r.node.dataset.bodyScaleX=String((scaleX*containerScaleX).toFixed(6));r.node.dataset.bodyScaleY=String((scaleY*containerScaleY).toFixed(6));r.node.dataset.registeredHeadWidth=String((head[2]*scaleX*containerScaleX).toFixed(3));r.node.dataset.registeredHeadHeight=String((head[3]*scaleY*containerScaleY).toFixed(3));r.node.dataset.registeredHeadY=String((headTop*containerScaleY).toFixed(3));r.node.dataset.actualHeadX=String((head[0]*scaleX*containerScaleX).toFixed(3));r.node.dataset.actualHeadY=String((head[1]*scaleY*containerScaleY).toFixed(3));r.node.dataset.actualHeadWidth=String((head[2]*scaleX*containerScaleX).toFixed(3));r.node.dataset.actualHeadHeight=String((head[3]*scaleY*containerScaleY).toFixed(3));r.node.dataset.seatBaseline='0';r.node.dataset.renderDepth=String(r.container.zIndex);r.node.dataset.blink=String(atMeeting&&a==='idle'&&row===1);
 };
 const animate=r=>{
  if(!r.body)return;
  const a=r.node.dataset.action,p=r.phase,s=r.size,isClaude=provider(r.agent)==='claude';
  const inTransit=['walking','entering','exiting'].includes(a),atStation=r.seated&&r.station,atMeeting=r.seated&&r.seat;
  const direction=Math.max(0,directions.indexOf(r.node.dataset.facing||'front'));
  if(atStation||atMeeting){animateComposite(r,atMeeting,atStation);return}
  let bodyY=0,key,col,row;
  r.chairSprite.visible=!!(atMeeting||atStation&&r.station.secondary);
  r.chairSprite.texture=seatTexture(4,r.node.dataset.facing||'front');
  r.chairSprite.anchor?.set?.(.5,1);r.chairSprite.height=s*.8;r.chairSprite.width=r.chairSprite.height*(r.chairSprite.texture.frame.width/r.chairSprite.texture.frame.height);
  r.chairFront.visible=!!atMeeting&&r.node.dataset.facing==='back';
  if(r.chairFront.visible){const id='meeting-chair-front:back',base=r.chairSprite.texture,rect=base.frame;if(!views.has(id))views.set(id,new P.Texture({source:base.source,frame:new P.Rectangle(rect.x,rect.y+rect.height*.55,rect.width,rect.height*.45)}));r.chairFront.texture=views.get(id);r.chairFront.anchor?.set?.(.5,1);r.chairFront.height=r.chairSprite.height*.45;r.chairFront.width=r.chairSprite.width;}

  if(atStation){
   key='work-torsos';row={library:0,development:1,server:2}[r.station.station]??0;col=(isClaude?0:2)+(Math.floor(p*2.5)%2);
   r.body.texture=actionTexture(key,r.texture.work,col,row);bodyY=-s*.55;
  }else if(atMeeting){
   key=`${provider(r.agent)}-seated`;row=(a==='talking'?2:0)+(Math.floor(p*(a==='talking'?2.6:.75))%2);col=direction;
   r.body.texture=actionTexture(key,r.texture.seated,col,row);
   if(a==='idle')bodyY=Math.sin(p*2.1)*.4;
  }else{
   key=`${provider(r.agent)}-travel`;row=a==='entering'?0:a==='exiting'?1:2;col=Math.floor((r.walkDistance||0)/3.5)%4;
   r.body.texture=actionTexture(key,r.texture.travel,col,row);
   if(inTransit)bodyY=Math.abs(Math.sin((r.walkDistance||0)*Math.PI/3.5))*s*.025;
  }
  const geometry=OFFICE_ACTION_GEOMETRY[key][row*4+col],frameRect=r.body.texture.frame;
  const refKey=`${provider(r.agent)}-seated`,refDirection=atMeeting?direction:atStation&&r.station.station!=='library'?1:0;
  const reference=OFFICE_ACTION_GEOMETRY[refKey][refDirection],unit=s*1.2/255;
  const targetHeadWidth=reference.head[2]*unit,targetHeadHeight=reference.head[3]*unit;
  const [hx,hy,hw,hh]=geometry.head;
  r.body.anchor?.set?.((hx+hw/2-frameRect.x)/frameRect.width,(hy+hh/2-frameRect.y)/frameRect.height);
  r.body.scale.set?.(targetHeadWidth/hw,targetHeadHeight/hh);r.body.rotation=0;r.body.x=0;
  const idleMotion=atMeeting&&a==='idle'&&moving()?Math.sin(p*2.1)*.4:0;
  bodyY=-(reference.frame[1]+reference.frame[3]-reference.head[1]-reference.head[3]/2)*unit;
  if(atMeeting&&direction===1)bodyY=-(s*.8*.45+targetHeadHeight/2+1);
  if(atStation){
   const {h}=logical(),containerScale=Math.abs(r.container.scale?.y||1),worldHeadHeight=targetHeadHeight*containerScale;
   const seam={library:.385,development:.37,server:.535}[r.station.station];
   bodyY=r.station.secondary?-(s*.8+targetHeadHeight/2):(seam*h-foot(r).y*h/100-worldHeadHeight/2-2)/containerScale;
  }
  bodyY+=idleMotion;
  if(inTransit&&moving())bodyY+=Math.abs(Math.sin((r.walkDistance||0)*Math.PI/3.5))*s*.025;
  if(inTransit){
   const trip=trips.get(r.agent.id),next=trip?.points[trip.index],dx=next?next.x-foot(r).x:0;
   if(Math.abs(dx)>.001)r.walkLeft=dx<0;
   const flip=a==='exiting'?!r.walkLeft:!!r.walkLeft;r.body.scale.x=(flip?-1:1)*Math.abs(r.body.scale.x);
  }
  r.body.y=bodyY;r.eyes.visible=false;r.prop.visible=false;
  r.crown.x=0;r.crown.y=bodyY-targetHeadHeight/2+s*.12;r.crown.visible=!!(r.agent.kind==='session'&&!r.agent.parentId&&r.agent.role==='chair'&&atMeeting);r.node.dataset.crown=String(r.crown.visible);
  const boundary=['entering','exiting'].includes(a)?Math.min(1,distance(foot(r),doorSpot())/7):1;
  r.container.alpha=boundary;r.node.style.opacity=String(boundary);r.node.dataset.doorOcclusion=String((1-boundary).toFixed(3));
  const {h}=logical();r.container.y=foot(r).y*h/100;
  const containerScale=Math.abs(r.container.scale?.x??1);
  r.node.dataset.bodyScaleX=String((Math.abs(r.body.scale.x)*containerScale).toFixed(6));r.node.dataset.bodyScaleY=String((Math.abs(r.body.scale.y)*Math.abs(r.container.scale?.y??1)).toFixed(6));r.node.dataset.frameX=String(frameRect.x);r.node.dataset.frameY=String(frameRect.y);r.node.dataset.frameWidth=String(frameRect.width);r.node.dataset.frameHeight=String(frameRect.height);
  r.pose=row*4+col;r.node.dataset.pose=String(r.pose);r.node.dataset.spriteAsset=key;r.node.dataset.idleOffset=String(bodyY.toFixed(3));r.node.dataset.visualX=String(r.container.x.toFixed(2));r.node.dataset.visualY=String(r.container.y.toFixed(2));r.node.dataset.chairVisualX=String((r.container.x+(r.chairSprite.x||0)).toFixed(2));r.node.dataset.chairVisualY=String((r.container.y+(r.chairSprite.y||0)).toFixed(2));r.node.dataset.crownHeadOffset=String((r.crown.y-r.body.y).toFixed(3));r.node.dataset.registeredHeadWidth=String((hw*Math.abs(r.body.scale.x)*containerScale).toFixed(3));r.node.dataset.registeredHeadHeight=String((hh*Math.abs(r.body.scale.y)*Math.abs(r.container.scale?.y??1)).toFixed(3));r.node.dataset.registeredHeadY=String((r.body.y*Math.abs(r.container.scale?.y??1)).toFixed(3));r.node.dataset.seatBaseline=String((r.body.y).toFixed(3));r.node.dataset.renderDepth=String(r.container.zIndex);r.node.dataset.blink=String(atMeeting&&a==='idle'&&row===1);
 };
 const tick=d=>{
  if(!moving())return;
  const ms=Math.min(64,Math.max(0,d?.deltaMS??d??16));app.canvas.dataset.frame=String(++frame);
  for(const[id,t]of trips){
   const r=records.get(id);if(!r){trips.delete(id);continue}
   let rest=30*ms/1000;
   while(rest&&t.index<t.points.length){
    const end=t.points[t.index],len=distance(t.from,end)||1,step=Math.min(rest,(1-t.progress)*len);t.progress+=step/len;r.walkDistance=(r.walkDistance||0)+step;
    setFoot(r,{x:t.from.x+(end.x-t.from.x)*t.progress,y:t.from.y+(end.y-t.from.y)*t.progress,zone:t.target.zone});rest-=step;
    if(t.progress>=1){setFoot(r,{...end,zone:t.target.zone});t.from=end;t.index++;t.progress=0}
   }
   if(t.index===t.points.length){trips.delete(id);if(t.removeAfter)remove(id)}
  }
  for(const r of records.values()){r.phase=(r.phase+ms/1000)%100;setAction(r);animate(r)}
 };
 const sync=()=>{if(app?.ticker)moving()?app.ticker.start?.():app.ticker.stop?.()};
 const drawMasks=(w,h)=>{
  for(const front of stationFronts)front.mask.clear().poly(front.points.map((n,i)=>n*(i%2?h:w))).fill({color:0xffffff,alpha:1});
  doorMask?.clear?.().poly([w*.068,h*.524,w*.128,h*.597,w*.128,h*.872,w*.07,h*.796]).poly([w*.184,h*.584,w*.194,h*.59,w*.194,h*.838,w*.184,h*.834]).fill({color:0xffffff,alpha:1});
  mask?.clear?.().poly([w*.39,h*.39,w*.48,h*.35,w*.49,h*.60,w*.47,h*.64,w*.39,h*.65,w*.38,h*.61]).fill({color:0xffffff,alpha:1});
  tableMask?.clear?.().poly([w*.442,h*.70,w*.45,h*.65,w*.49,h*.61,w*.56,h*.596,w*.61,h*.62,w*.624,h*.66,w*.62,h*.72,w*.605,h*.76,w*.605,h*.825,w*.596,h*.825,w*.596,h*.765,w*.51,h*.792,w*.51,h*.845,w*.5,h*.845,w*.5,h*.79,w*.46,h*.778,w*.46,h*.81,w*.45,h*.81,w*.45,h*.764,w*.444,h*.735]).fill({color:0xffffff,alpha:1});
 };
 const placeChair=(sprite,seat,scale=1)=>{
  const {w,h}=logical(),texture=sprite.texture,ratio=texture.frame.width/texture.frame.height;
  sprite.anchor?.set?.(.5,1);sprite.height=Math.max(28,Math.min(72,w*.06))*.95*scale;sprite.width=sprite.height*ratio;
  sprite.x=seat.x*w/100;sprite.y=seat.y*h/100;sprite.zIndex=Math.round(seat.y*10);
 };
 const placeEmptyWorkChair=(sprite,station,column)=>{
  const {w,h}=logical(),asset=OFFICE_COMPOSITE_ASSETS['work-chair-composite'],frame=sprite.texture.frame,geometry=asset.geometry[column],foot=geometry.foot,size=Math.max(28,Math.min(72,w*.06)),pixelScale=size*1.75/(asset.size[1]/asset.rows);
  sprite.anchor?.set?.((foot[0]-frame.x)/frame.width,(foot[1]-frame.y)/frame.height);sprite.scale?.set?.(pixelScale,pixelScale);sprite.x=station.x*w/100;sprite.y=station.y*h/100;sprite.zIndex=Math.round(station.y*10);
 };
 const refreshChairs=(layout,agents=[])=>{
  if(!emptyChair)return;
  const seats=[...layout.values()];emptyChair.visible=!seats.some(s=>s.chair);placeChair(emptyChair,CHAIR_SEAT);
  const occupied=seats.some(s=>!s.chair);
  for(const d of decorations){d.sprite.visible=!occupied;placeChair(d.sprite,d.seat)}
  const occupiedStations=new Set(agents.filter(a=>a.state==='running'&&['library','development','server'].includes(a.zone)).map(a=>a.zone));
  for(const chair of emptyWorkChairs){chair.sprite.visible=!occupiedStations.has(chair.station);placeEmptyWorkChair(chair.sprite,WORK_STATIONS[chair.station],chair.column)}
 };
 const resize=()=>{
  if(!appInitialized||destroyed)return;
  const w=Math.max(1,board.clientWidth||800),h=Math.max(1,Math.round(w/2.6));app.renderer.resize?.(w,h,Math.min(globalThis.devicePixelRatio||1,2));
  for(const sprite of[bg,fg,tableFg,doorFg])if(sprite){sprite.width=w;sprite.height=h}
  for(const front of stationFronts){front.sprite.width=w;front.sprite.height=h}
  drawMasks(w,h);refreshChairs(meetingLayout(snapshot.agents||[]),snapshot.agents||[]);for(const r of records.values()){place(r);animate(r)}app.render?.();
 };
 const paint=async expected=>{
  if(!started||destroyed||expected!==revision)return;
  const agents=(snapshot.agents||[]).filter(a=>a.state!=='left').slice(0,25),layout=meetingLayout(agents),shown=new Set(),slots=new Map(),anchors={...OFFICE_ANCHORS,...(snapshot.anchors||{})};
  refreshChairs(layout,agents);
  for(const agent of agents){
   if(expected!==revision)return;
   const old=retired.get(agent.id);if(old===agent.updatedAt&&TERMINAL.has(agent.state))continue;if(old&&!TERMINAL.has(agent.state))retired.delete(agent.id);shown.add(agent.id);
   const seat=layout.get(agent.id)||null,zone=TERMINAL.has(agent.state)&&agent.kind==='subagent'?'door':ATTENTION.has(agent.state)?'table':agent.zone||'table',i=slots.get(zone)||0;slots.set(zone,i+1);
   const station=!seat&&agent.state==='running'&&['library','development','server'].includes(zone)?stationSpot(agent,i,anchors):null;
   const target=seat||station||spot(agent,i,anchors);
   let r=records.get(agent.id);const entering=!r;if(!r){if(TERMINAL.has(agent.state)&&agent.kind==='subagent'){retired.set(agent.id,agent.updatedAt||'');continue}r=create(agent,target,snapshotBeforeReady)}
   const previousSeat=r.seated?(r.seat||r.station):null;
   r.agent=agent;r.seat=seat;r.station=station;r.node._agent=agent;r.label.textContent=agent.label||'세션';r.detail.textContent=brief(agent);
   r.node.dataset.state=agent.state;r.node.dataset.provider=agent.provider||'';r.node.classList.toggle('office-child',agent.kind==='subagent');r.node.classList.toggle('office-working',agent.state==='running');r.node.classList.toggle('office-attention',ATTENTION.has(agent.state));
   r.node.setAttribute('aria-label',`${agent.label||'이름 없는 세션'} · ${brief(agent)}`);
   if(!r.texture){try{const base=await tex(agent);if(destroyed||expected!==revision||records.get(agent.id)!==r)return;r.texture=base;parts(r);place(r)}catch(e){status(e)}}
   if(agent.role==='chair'){trips.delete(agent.id);setFoot(r,target)}
   else if(TERMINAL.has(agent.state)&&agent.kind==='subagent'){
    if(presentation.reducedMotion)remove(agent.id);else travel(agent.id,doorSpot(),true,previousSeat,null,'exiting');
   }else{
    const at=foot(r);
    if(presentation.reducedMotion){trips.delete(agent.id);setFoot(r,target)}
    else if(at.x!==target.x||at.y!==target.y)travel(agent.id,target,false,previousSeat,seat||station,entering?'entering':'walking');
   }
   if(records.get(agent.id)===r){setAction(r);animate(r)}
  }
  if(expected!==revision)return;for(const id of[...records.keys()])if(!shown.has(id)){const r=records.get(id);if(presentation.reducedMotion)remove(id);else{travel(id,doorSpot(),true,r.seated?(r.seat||r.station):null,null,'exiting');if(records.get(id)===r){setAction(r);animate(r)}}}sync();app.render?.();status();
 };
 const visibility=()=>{visible=!document.hidden;sync()};document.addEventListener('visibilitychange',visibility);
 const readyPromise=Promise.resolve().then(loadPixi).then(async lib=>{
  if(destroyed)return;P=lib;await P.Assets.init?.({preferences:{preferWorkers:false}});if(destroyed)return;
  app=new P.Application();await app.init({width:Math.max(1,board.clientWidth||800),height:Math.max(1,Math.round((board.clientWidth||800)/2.6)),autoDensity:true,resolution:Math.min(globalThis.devicePixelRatio||1,2),preference:['webgl','canvas'],backgroundAlpha:0});
  appInitialized=true;if(destroyed){disposeApp();return}
  app.canvas.dataset.renderer='pixi';app.canvas.dataset.ready='false';app.canvas.dataset.frame='0';board.prepend(app.canvas);app.stage.sortableChildren=true;
  await P.Assets.load('/assets/office/office-background.png');if(destroyed)return;
  const base=await P.Assets.load('/assets/office/office-chairless-background.png');if(destroyed)return;
  seatAtlas=await P.Assets.load('/assets/office/meeting-seats.png');if(destroyed)return;
  workAtlas=await compositeAtlas('work-chair-composite');if(destroyed)return;
  bg=new P.Sprite(base);bg.width=app.screen.width;bg.height=app.screen.height;add(app.stage,bg);
  actors=new P.Container();actors.sortableChildren=true;add(app.stage,actors);
  fg=new P.Sprite(base);fg.width=app.screen.width;fg.height=app.screen.height;mask=new P.Graphics();fg.mask=mask;fg.zIndex=650;mask.zIndex=650;add(actors,mask);add(actors,fg);
  tableFg=new P.Sprite(base);tableFg.width=app.screen.width;tableFg.height=app.screen.height;tableMask=new P.Graphics();tableFg.mask=tableMask;tableFg.zIndex=770;tableMask.zIndex=770;add(actors,tableMask);add(actors,tableFg);drawMasks(app.screen.width,app.screen.height);
  doorFg=new P.Sprite(base);doorFg.width=app.screen.width;doorFg.height=app.screen.height;doorMask=new P.Graphics();doorFg.mask=doorMask;doorFg.zIndex=901;doorMask.zIndex=901;add(actors,doorMask);add(actors,doorFg);drawMasks(app.screen.width,app.screen.height);
  for(const config of[{name:'library-desk',depth:550,points:[.228,.419,.307,.372,.357,.414,.35,.54,.335,.552,.335,.47,.275,.49,.27,.548,.255,.55,.255,.475,.229,.46]}]){const sprite=new P.Sprite(base),frontMask=new P.Graphics();sprite.width=app.screen.width;sprite.height=app.screen.height;sprite.mask=frontMask;sprite.zIndex=config.depth;frontMask.zIndex=config.depth;sprite.label=config.name;stationFronts.push({...config,sprite,mask:frontMask});add(actors,frontMask);add(actors,sprite)}drawMasks(app.screen.width,app.screen.height);
  emptyChair=new P.Sprite(seatTexture(4,CHAIR_SEAT.facing));emptyChair.label='meeting-chair-empty';add(actors,emptyChair);
  for(const seat of[{x:61.8,y:67,facing:'left'},{x:49,y:87,facing:'back'},{x:62,y:82,facing:'back'}]){const sprite=new P.Sprite(seatTexture(4,seat.facing));sprite.label='meeting-chair-decoration';decorations.push({sprite,seat});add(actors,sprite)}
  for(const [station,column] of Object.entries({library:0,development:1,server:2})){const sprite=new P.Sprite(compositeTexture('work-chair-composite',workAtlas,column,0));sprite.label=`work-chair-empty:${station}`;emptyWorkChairs.push({sprite,station,column});add(actors,sprite)}
  const ro=globalThis.ResizeObserver?new ResizeObserver(resize):null;ro?.observe(board);board._pixiResizeObserver=ro;
  app.ticker.maxFPS=30;app.ticker.add(tick);started=true;board.dataset.ready='true';sync();await paint(revision);snapshotBeforeReady=false;if(!destroyed)app.canvas.dataset.ready='true';status();
 }).catch(e=>{if(destroyed)return;board.dataset.ready='false';status(e);throw e});
 return {
  readyPromise,
  setSnapshot(next={}){if(!destroyed){if(!started)snapshotBeforeReady=true;snapshot=next;revision++;if(started)void paint(revision)}},
  setRoom(){if(destroyed)return;revision++;trips.clear();for(const id of[...records.keys()])remove(id);retired.clear();snapshot={agents:[]};if(started)void paint(revision)},
  setConnection(next){if(destroyed)return;online=!!next;sync();status()},
  setPresentation(next={}){
   if(destroyed)return;presentation={...presentation,...next};
   if(presentation.reducedMotion){const pending=[...trips];trips.clear();for(const[id,t]of pending){const r=records.get(id);if(r){setFoot(r,t.target);if(t.removeAfter)remove(id);else{setAction(r);animate(r)}}}}
   sync();if(appInitialized)app.render?.();status();
  },
  destroy(){destroyed=true;revision++;document.removeEventListener('visibilitychange',visibility);board._pixiResizeObserver?.disconnect?.();for(const id of[...records.keys()])remove(id);app?.ticker?.remove?.(tick);disposeApp();for(const view of views.values())gone(view);views.clear();textures.clear();actionAtlases.clear();board.replaceChildren()}
 };
}
