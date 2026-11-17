import {ATTENTION, TERMINAL, OFFICE_ANCHORS, WORK_STATIONS, brief, floorPath, spot, stationSpot, selection, distance, floorPoint, meetingLayout, meetingReservations, supportLayout, CHAIR_SEAT} from './office-pixi-model.js';
import {roomContains,canStand} from './office-scene-space.js';
import {occludersAt} from './office-scene-occlusion.js';
import {MEETING_SEAT_FRAMES} from './office-seat-frames.js';
import {OFFICE_ACTION_ASSETS, OFFICE_ACTION_GEOMETRY} from './office-action-frames.js';
import {COMPOSITE_DIRECTIONS, OFFICE_COMPOSITE_ASSETS} from './office-composite-frames.js';

const poseFor = a => a.state === 'completed' ? 7 : ({reading:3,research:3,coding:4,terminal:5,responding:6,synthesis:6,delegating:6}[a.activity] ?? 0);
const provider = a => a.provider === 'claude' ? 'claude' : 'codex';
const add = (p,c) => p.addChild?.(c);
const gone = (x,o) => x?.destroy?.(o);
const actionFor = a => a.state === 'running' ? ({reading:'reading',research:'reading',coding:'coding',terminal:'terminal',responding:'thinking',synthesis:'thinking',delegating:'thinking'}[a.activity] || 'working') : 'idle';
const phaseFor = id => [...String(id)].reduce((n,c) => ((n*31)+c.charCodeAt(0))>>>0,7)%500/100;
const spriteSize=(agent,w,support)=>support?.meetingOverflow?Math.max(16,Math.min(38,w*.032)):agent.kind==='subagent'?Math.max(16,Math.min(40,w*.035)):Math.max(28,Math.min(72,w*.06));
const directions = COMPOSITE_DIRECTIONS;
const legacyDirections = ['front','back','left','right'];
const legacyFacing = facing => ({'front-left':'left','back-left':'left','front-right':'right','back-right':'right'})[facing]||facing;

export function createOfficePixiScene({document,host,onSelect,onStatus,loadPixi=()=>import('/vendor/pixi.mjs')}={}) {
 if (!document || !host) throw Error('createOfficePixiScene requires document and host');
 let snapshot={agents:[]}, online=true, destroyed=false, visible=!document.hidden;
 let presentation={collapsed:false,visible:true,reducedMotion:false};
 let P,app,actors,bg,fg,mask,tableFg,tableMask,doorFg,doorMask,seatAtlas,emptyChair,workAtlas;
 let started=false,frame=0,revision=0,appInitialized=false,appDisposed=false,snapshotBeforeReady=false,resizeFrame=0;
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
  r.container.x=p.x*w/100;r.container.y=p.y*h/100;r.container.zIndex=Math.round(p.y*10);
  const size=spriteSize(r.agent,w,r.support);
  r.container.scale?.set?.(size/r.size);
  r.node.style.width=`${size+12}px`;r.node.style.height=`${size}px`;
  r.node.style.left=`${p.x}%`;r.node.style.top=`${p.y}%`;r.node.style.zIndex=String(10+Math.round(p.y*10));
  r.node.dataset.visualX=String(r.container.x.toFixed(2));r.node.dataset.visualY=String(r.container.y.toFixed(2));
  r.node.dataset.pose=String(r.pose);r.node.dataset.idleOffset='0';
  maskRenderable(r.container,p);
  r.node.dataset.occluders=occludersAt(p).map(o=>o.id).join(',');
 };
 const setFoot=(r,p)=>{r.node.dataset.x=String(p.x);r.node.dataset.y=String(p.y);r.node.dataset.currentFootx=String(p.x);r.node.dataset.currentFooty=String(p.y);r.node.dataset.zone=p.zone||'floor';place(r)};
 const detachMask=renderable=>{if(!renderable)return;renderable.mask=null;gone(renderable._occlusionMask);renderable._occlusionMask=null;renderable._occlusionKey=null};
 const clearGhost=r=>{if(r.ghost){detachMask(r.ghost);gone(r.ghost,{children:true})}r.ghost=null;r.ghostSeat=null};
 const ghostAt=(r,point,targetSeat=null)=>{clearGhost(r);if(!r.body||!point)return;const g=new P.Container(),sprite=new P.Sprite(r.body.texture),{w,h}=logical();if(targetSeat){const station=targetSeat.station,assetKey=station?'work-chair-composite':`${provider(r.agent)}-chair-composite`,asset=OFFICE_COMPOSITE_ASSETS[assetKey],column=station?({library:0,development:1,server:2}[station]??0):Math.max(0,directions.indexOf(targetSeat.facing||'front')),row=station?(provider(r.agent)==='claude'?1:3):0,texture=compositeTexture(assetKey,station?r.texture.work:r.texture.seated,column,row),geometry=asset.geometry[row*asset.columns+column],artFoot=geometry.foot; sprite.texture=texture;sprite.anchor?.set?.((artFoot[0]-texture.frame.x)/texture.frame.width,(artFoot[1]-texture.frame.y)/texture.frame.height);const scale=r.size*(station?1.75:1.6)/(asset.size[1]/asset.rows);sprite.scale?.set?.(scale,scale)}else{sprite.anchor?.set?.(r.body.anchor?.x??.5,r.body.anchor?.y??.95);sprite.scale?.set?.(r.body.scale?.x??1,r.body.scale?.y??1)}g.x=point.x*w/100;g.y=point.y*h/100;g.scale?.set?.(r.container.scale?.x??1,r.container.scale?.y??1);g.zIndex=Math.round(point.y*10);g.label=`office-seat-ghost:${r.agent.id}`;add(g,sprite);add(actors,g);maskRenderable(g,point);r.ghost=g;r.ghostSeat={x:point.x,y:point.y}};
 const maskRenderable=(renderable,point)=>{if(!renderable?.setMask||!P)return;const holes=occludersAt(point),{w,h}=logical(),key=`${w}x${h}:${holes.map(o=>o.id).join(',')}`;if(renderable._occlusionKey===key)return;detachMask(renderable);renderable._occlusionKey=key;if(!holes.length)return;const g=new P.Graphics();for(const o of holes)g.poly(o.visual.flatMap(p=>[p.x*w/100,p.y*h/100])).fill({color:0xffffff,alpha:1});renderable._occlusionMask=g;add(actors,g);renderable.setMask({mask:g,inverse:true})};
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
  const {w}=logical(),s=spriteSize(r.agent,w,r.support);
  r.size=s;r.container=new P.Container();r.container.label='office-agent:'+r.agent.id;r.container.sortableChildren=true;
  r.chairSprite=new P.Sprite(seatTexture(4,'front'));r.chairSprite.label=`office-chair:${r.agent.id}`;r.chairSprite.visible=false;r.chairSprite.zIndex=0;
  r.chairFront=new P.Sprite(seatTexture(4,'back'));r.chairFront.label=`office-chair-front:${r.agent.id}`;r.chairFront.visible=false;r.chairFront.zIndex=2;
  r.body=new P.Sprite(actionTexture(`${provider(r.agent)}-travel`,r.texture.travel,0,0));r.body.anchor?.set?.(.5,.85);r.body.width=s;r.body.height=s;r.body.zIndex=1;
  r.eyes=graphic(g=>{g.rect(-s*.045,-s*.4,s*.075,s*.08).fill({color:0xf49b6a});g.rect(s*.095,-s*.41,s*.075,s*.08).fill({color:0xf49b6a});g.rect(-s*.04,-s*.355,s*.065,s*.015).fill({color:0x302523});g.rect(s*.10,-s*.365,s*.065,s*.015).fill({color:0x302523})});
  r.eyes.visible=false;r.prop=graphic(()=>{});r.prop.visible=false;
  r.crown=graphic(g=>{g.poly([-s*.26,-s*.08,-s*.21,-s*.32,-s*.08,-s*.18,0,-s*.40,s*.09,-s*.18,s*.22,-s*.32,s*.27,-s*.08]).fill({color:0x382818});g.poly([-s*.20,-s*.10,-s*.17,-s*.26,-s*.07,-s*.14,0,-s*.33,s*.07,-s*.14,s*.18,-s*.26,s*.21,-s*.10]).fill({color:0xf6c744});g.rect(-s*.13,-s*.12,s*.06,s*.045).rect(s*.07,-s*.12,s*.06,s*.045).fill({color:0xd9435f});});r.crown.visible=false;r.crown.zIndex=4;
  add(r.container,r.chairSprite);add(r.container,r.body);add(r.container,r.eyes);add(r.container,r.prop);add(r.container,r.crown);add(r.container,r.chairFront);add(actors,r.container);
 };
 const remove=id=>{const r=records.get(id);if(!r)return;trips.delete(id);clearGhost(r);detachMask(r.container);gone(r.container,{children:true});retired.set(id,r.agent.updatedAt||'');r.node.remove();records.delete(id);status()};
 const create=(agent,target,atTarget=false)=>{
  const node=document.createElement('button');node.type='button';node.className='office-agent';node.dataset.agentId=node.dataset.id=agent.id;
  node.onclick=()=>{if(!node.disabled)onSelect?.(selection(node._agent))};
  const label=document.createElement('span'),detail=document.createElement('small');label.className='office-agent-label';detail.className='office-agent-detail';node.append(label,detail);overlay.append(node);
  const r={agent,node,label,detail,phase:phaseFor(agent.id),pose:poseFor(agent),texture:null,seated:false,seat:null,station:null,displaySeat:null,displayStation:null,walkDistance:0};records.set(agent.id,r);
  setFoot(r,atTarget?target:doorSpot());return r;
 };
 const travel=(id,target,removeAfter=false,fromSeat=null,toSeat=null,mode='walking')=>{
  const r=records.get(id);if(!r)return;
  const active=trips.get(id);
  if(active&&active.target.x===target.x&&active.target.y===target.y){active.removeAfter||=removeAfter;return}
  const from=foot(r),leavingSeat=!!fromSeat&&(r.seated||active?.phase==='undocking')&&from.x===fromSeat.x&&from.y===fromSeat.y,exit=leavingSeat?fromSeat.approach:(canStand(from)?from:active?.phase==='undocking'&&canStand(active.exitApproach)?active.exitApproach:null),enter=toSeat?.approach||(canStand(target)?target:null);
  if(!target||!roomContains(target,0)||(!toSeat&&!canStand(target))||!exit||!enter||!canStand(exit)||!canStand(enter)){r.node.dataset.routeBlocked='true';r.detail.textContent='이동 경로 확인 필요';return false}
  const route=floorPath(exit,enter);
  if(!route.length&&!(exit.x===enter.x&&exit.y===enter.y)){r.node.dataset.routeBlocked='true';r.detail.textContent='이동 경로 확인 필요';return false}
  r.node.dataset.routeBlocked='false';r.seated=false;clearGhost(r);if(leavingSeat){ghostAt(r,fromSeat);if(r.body)r.body.visible=false}else if(r.body)r.body.visible=true;trips.set(id,{from:exit,target,points:route,index:0,progress:0,removeAfter,exitApproach:exit,enterApproach:enter,mode,phase:leavingSeat?'undocking':'walking',elapsed:0,toSeat});return true;
 };
 const setAction=r=>{
  const at=foot(r);
  const seat=r.displaySeat||r.displayStation;r.seated=!!seat&&!trips.has(r.agent.id)&&at.x===seat.x&&at.y===seat.y;
  r.node.dataset.seated=String(r.seated);r.node.dataset.chair=String(r.agent.role==='chair');
  r.node.dataset.facing=r.seated?(seat.facing||'front'):(r.support?.facing||'');
  r.node.dataset.support=String(!!r.support);r.node.dataset.meetingOverflow=String(!!r.support?.meetingOverflow);
  r.node.dataset.station=r.seated&&r.displayStation?r.displayStation.station:r.station?.seat===false?r.station.station:'';
  r.node.dataset.secondary=String(!!r.station?.secondary);
  r.node.dataset.seatX=seat?String(seat.x):'';r.node.dataset.seatY=seat?String(seat.y):'';
  const trip=trips.get(r.agent.id);r.detail.textContent=r.node.dataset.routeBlocked==='true'?'이동 경로 확인 필요':trip?.mode==='entering'?'입장 중':trip?.mode==='exiting'?'퇴장 중':brief(r.agent);r.node.setAttribute('aria-label',`${r.displayLabel||r.agent.label||'이름 없는 세션'} · ${r.detail.textContent}`);r.node.dataset.action=trip?(trip.mode||'walking'):r.seated?(r.agent.state==='running'&&['responding','synthesis','delegating'].includes(r.agent.activity)?'talking':actionFor(r.agent)):actionFor(r.agent);r.node.dataset.transition=trip?.phase||'';
  r.node.disabled=!!trip?.removeAfter;
  r.node.dataset.crown=String(!!r.crown?.visible);
  place(r);r.node.dataset.spriteVisible=String(r.body?.visible!==false);
 };
 const animateComposite=(r,atMeeting,atStation)=>{
  const a=r.node.dataset.action,p=r.phase,assetKey=atMeeting?`${provider(r.agent)}-chair-composite`:'work-chair-composite';
  const asset=OFFICE_COMPOSITE_ASSETS[assetKey],column=atMeeting?Math.max(0,directions.indexOf(r.node.dataset.facing||'front')):({library:0,development:1,server:2}[r.displayStation.station]??0);
  const row=atMeeting?(a==='talking'?(Math.floor(p/.6)%2?2:0):(p%3.2)<.16?1:0):(provider(r.agent)==='claude'?(Math.floor(p*2)%2?2:1):(Math.floor(p*2)%2?4:3));
  r.chairSprite.visible=false;r.chairFront.visible=false;
  r.body.texture=compositeTexture(assetKey,atMeeting?r.texture.seated:r.texture.work,column,row);
  r.body.rotation=0;r.body.x=0;r.body.y=0;
  const frameRect=r.body.texture.frame,geometry=asset.geometry?.[row*asset.columns+column],head=geometry?.head||[frameRect.x,frameRect.y,frameRect.width,frameRect.height*.45];
  const artFoot=geometry?.foot||[frameRect.x+frameRect.width/2,frameRect.y+frameRect.height];
  r.body.anchor?.set?.((artFoot[0]-frameRect.x)/frameRect.width,(artFoot[1]-frameRect.y)/frameRect.height);
  const pixelScale=r.size*(assetKey==='work-chair-composite'?1.75:1.6)/(asset.size[1]/asset.rows);r.body.scale.set?.(pixelScale,pixelScale);
  const scaleY=Math.abs(r.body.scale.y),scaleX=Math.abs(r.body.scale.x),containerScaleX=Math.abs(r.container.scale?.x??1),containerScaleY=Math.abs(r.container.scale?.y??1);
  const headTop=-(artFoot[1]-frameRect.y)*scaleY+(head[1]-frameRect.y)*scaleY,headCenterX=((head[0]+head[2]/2)-artFoot[0])*scaleX;
  r.crown.x=headCenterX;r.crown.y=headTop+r.size*.10;r.crown.visible=!!(r.agent.kind==='session'&&!r.agent.parentId&&r.agent.role==='chair'&&atMeeting);r.node.dataset.crown=String(r.crown.visible);
  r.node.dataset.headLeft=String(r.container.x+(head[0]-artFoot[0])*scaleX*containerScaleX);r.node.dataset.headTop=String(r.container.y+headTop*containerScaleY);r.node.dataset.headWidth=String(head[2]*scaleX*containerScaleX);r.node.dataset.headHeight=String(head[3]*scaleY*containerScaleY);r.node.dataset.crownLeft=String(r.container.x+(r.crown.x-r.size*.26)*containerScaleX);r.node.dataset.crownTop=String(r.container.y+(r.crown.y-r.size*.40)*containerScaleY);r.node.dataset.crownWidth=String(r.size*.53*containerScaleX);r.node.dataset.crownHeight=String(r.size*.32*containerScaleY);r.node.dataset.crownBaseGap=String((r.crown.y-r.size*.08-headTop)*containerScaleY);
  const boundary=['entering','exiting'].includes(a)?Math.min(1,distance(foot(r),doorSpot())/7):1;r.container.alpha=boundary;r.node.style.opacity=String(boundary);r.node.dataset.doorOcclusion=String((1-boundary).toFixed(3));
  r.pose=row*asset.columns+column;r.node.dataset.pose=String(r.pose);r.node.dataset.spriteAsset=assetKey;r.node.dataset.idleOffset='0';r.node.dataset.visualX=String(r.container.x.toFixed(2));r.node.dataset.visualY=String(r.container.y.toFixed(2));r.node.dataset.frameX=String(frameRect.x);r.node.dataset.frameY=String(frameRect.y);r.node.dataset.frameWidth=String(frameRect.width);r.node.dataset.frameHeight=String(frameRect.height);r.node.dataset.bodyScaleX=String((scaleX*containerScaleX).toFixed(6));r.node.dataset.bodyScaleY=String((scaleY*containerScaleY).toFixed(6));r.node.dataset.registeredHeadWidth=String((head[2]*scaleX*containerScaleX).toFixed(3));r.node.dataset.registeredHeadHeight=String((head[3]*scaleY*containerScaleY).toFixed(3));r.node.dataset.registeredHeadY=String((headTop*containerScaleY).toFixed(3));r.node.dataset.actualHeadX=String((head[0]*scaleX*containerScaleX).toFixed(3));r.node.dataset.actualHeadY=String((head[1]*scaleY*containerScaleY).toFixed(3));r.node.dataset.actualHeadWidth=String((head[2]*scaleX*containerScaleX).toFixed(3));r.node.dataset.actualHeadHeight=String((head[3]*scaleY*containerScaleY).toFixed(3));r.node.dataset.seatBaseline='0';r.node.dataset.renderDepth=String(r.container.zIndex);r.node.dataset.blink=String(atMeeting&&a==='idle'&&row===1);
 };
 const animate=r=>{
  if(!r.body)return;
  const a=r.node.dataset.action,p=r.phase,s=r.size,isClaude=provider(r.agent)==='claude';
  const inTransit=['walking','entering','exiting'].includes(a),atStation=r.seated&&r.displayStation,atMeeting=r.seated&&r.displaySeat,standingStation=!!r.station&&r.station.seat===false;
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
   key=`${provider(r.agent)}-travel`;row=a==='entering'?0:a==='exiting'?1:a==='idle'?0:2;col=inTransit?Math.floor((r.walkDistance||0)/3.5)%4:standingStation?Math.floor(p/.6)%2:0;
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
  if(!atMeeting&&!atStation)bodyY=-((frameRect.y+frameRect.height)-(hy+hh/2))*Math.abs(r.body.scale.y);
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
  const containerScale=Math.abs(r.container.scale?.x??1),containerScaleY=Math.abs(r.container.scale?.y??1);
  r.node.dataset.headLeft=String(r.container.x-targetHeadWidth*containerScale/2);r.node.dataset.headTop=String(r.container.y+(bodyY-targetHeadHeight/2)*containerScaleY);r.node.dataset.headWidth=String(targetHeadWidth*containerScale);r.node.dataset.headHeight=String(targetHeadHeight*containerScaleY);r.node.dataset.actualHeadWidth=String(hw*Math.abs(r.body.scale.x)*containerScale);r.node.dataset.actualHeadHeight=String(hh*Math.abs(r.body.scale.y)*containerScaleY);
  r.node.dataset.bodyScaleX=String((Math.abs(r.body.scale.x)*containerScale).toFixed(6));r.node.dataset.bodyScaleY=String((Math.abs(r.body.scale.y)*Math.abs(r.container.scale?.y??1)).toFixed(6));r.node.dataset.frameX=String(frameRect.x);r.node.dataset.frameY=String(frameRect.y);r.node.dataset.frameWidth=String(frameRect.width);r.node.dataset.frameHeight=String(frameRect.height);
  r.pose=row*4+col;r.node.dataset.pose=String(r.pose);r.node.dataset.spriteAsset=key;r.node.dataset.idleOffset=String(bodyY.toFixed(3));r.node.dataset.visualX=String(r.container.x.toFixed(2));r.node.dataset.visualY=String(r.container.y.toFixed(2));r.node.dataset.chairVisualX=String((r.container.x+(r.chairSprite.x||0)).toFixed(2));r.node.dataset.chairVisualY=String((r.container.y+(r.chairSprite.y||0)).toFixed(2));r.node.dataset.crownHeadOffset=String((r.crown.y-r.body.y).toFixed(3));r.node.dataset.registeredHeadWidth=String((hw*Math.abs(r.body.scale.x)*containerScale).toFixed(3));r.node.dataset.registeredHeadHeight=String((hh*Math.abs(r.body.scale.y)*Math.abs(r.container.scale?.y??1)).toFixed(3));r.node.dataset.registeredHeadY=String((r.body.y*Math.abs(r.container.scale?.y??1)).toFixed(3));r.node.dataset.seatBaseline=String((r.body.y).toFixed(3));r.node.dataset.renderDepth=String(r.container.zIndex);r.node.dataset.blink=String(atMeeting&&a==='idle'&&row===1);
 };
 const tick=d=>{
  if(!moving())return;
  const ms=Math.min(64,Math.max(0,d?.deltaMS??d??16));app.canvas.dataset.frame=String(++frame);
  for(const[id,t]of trips){
   const r=records.get(id);if(!r){trips.delete(id);continue}
   if(t.phase==='undocking'){t.elapsed+=ms;if(r.ghost)r.ghost.alpha=Math.max(0,1-t.elapsed/220);r.body.visible=true;r.container.alpha=Math.min(1,t.elapsed/220);setFoot(r,t.exitApproach);if(t.elapsed<220)continue;t.phase='walking';clearGhost(r);refreshChairs(meetingLayout(snapshot.agents||[]),snapshot.agents||[]);continue}
   if(t.phase==='docking'){t.elapsed+=ms;if(r.ghost)r.ghost.alpha=Math.min(1,t.elapsed/220);r.container.alpha=Math.max(0,1-t.elapsed/220);if(t.elapsed<220)continue;clearGhost(r);r.body.visible=true;r.container.alpha=1;setFoot(r,t.target);trips.delete(id);if(t.removeAfter)remove(id);refreshChairs(meetingLayout(snapshot.agents||[]),snapshot.agents||[]);continue}
   let rest=30*ms/1000;
   while(rest&&t.index<t.points.length){
    const end=t.points[t.index],len=distance(t.from,end)||1,step=Math.min(rest,(1-t.progress)*len);t.progress+=step/len;r.walkDistance=(r.walkDistance||0)+step;
    setFoot(r,{x:t.from.x+(end.x-t.from.x)*t.progress,y:t.from.y+(end.y-t.from.y)*t.progress,zone:t.target.zone});rest-=step;
    if(t.progress>=1){setFoot(r,{...end,zone:t.target.zone});t.from=end;t.index++;t.progress=0}
   }
   if(t.index===t.points.length){if(t.toSeat){ghostAt(r,t.target,t.toSeat);r.ghost.alpha=0;r.body.visible=true;t.phase='docking';t.elapsed=0;refreshChairs(meetingLayout(snapshot.agents||[]),snapshot.agents||[])}else{trips.delete(id);if(t.removeAfter)remove(id)}}
  }
  for(const r of records.values()){if(!r.container||!r.body)continue;r.phase=(r.phase+ms/1000)%100;setAction(r);animate(r);r.node.dataset.spriteVisible=String(r.body.visible!==false);const trip=trips.get(r.agent.id);if(trip?.phase==='undocking'||trip?.phase==='docking'){const alpha=Math.max(0,Math.min(1,trip.elapsed/220));r.container.alpha=trip.phase==='undocking'?alpha:1-alpha;r.node.style.opacity=String(r.container.alpha);r.node.dataset.visibleAlpha=String(r.container.alpha.toFixed(3))}else r.node.dataset.visibleAlpha=String((r.container.alpha??1).toFixed(3))}
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
 const addDecoration=seat=>{const sprite=new P.Sprite(seatTexture(4,seat.facing));sprite.label='meeting-chair-decoration';decorations.push({sprite,seat});add(actors,sprite)};
 const refreshChairs=(layout,agents=[])=>{
  if(!emptyChair)return;
  const seats=[...layout.values()];emptyChair.visible=!seats.some(s=>s.chair);placeChair(emptyChair,CHAIR_SEAT);
  maskRenderable(emptyChair,CHAIR_SEAT);const reservations=[...meetingReservations(agents).values()].filter(seat=>seat.seat!==false);
  while(decorations.length<reservations.length)addDecoration(reservations[decorations.length]);
  for(let i=0;i<decorations.length;i++){const d=decorations[i],seat=reservations[i];if(!seat){d.sprite.visible=false;continue}const occupied=[...records.values()].some(r=>(r.seated&&r.displaySeat?.x===seat.x&&r.displaySeat?.y===seat.y)||(r.ghostSeat?.x===seat.x&&r.ghostSeat?.y===seat.y));d.sprite.visible=!occupied;d.sprite.texture=seatTexture(4,seat.facing);placeChair(d.sprite,seat);maskRenderable(d.sprite,seat)}
  const occupiedStations=new Set(agents.filter(a=>!layout.has(a.id)&&a.state==='running'&&['library','development','server'].includes(a.zone)).map(a=>a.zone));
  for(const chair of emptyWorkChairs){chair.sprite.visible=!occupiedStations.has(chair.station);placeEmptyWorkChair(chair.sprite,WORK_STATIONS[chair.station],chair.column);maskRenderable(chair.sprite,WORK_STATIONS[chair.station])}
 };
 const resizeNow=()=>{
  if(!appInitialized||destroyed)return;
  const w=Math.max(1,board.clientWidth||800),h=Math.max(1,Math.round(w/2.6));app.renderer.resize?.(w,h,Math.min(globalThis.devicePixelRatio||1,2));
  for(const sprite of[bg,fg,tableFg,doorFg])if(sprite){sprite.width=w;sprite.height=h}
  for(const front of stationFronts){front.sprite.width=w;front.sprite.height=h}
  drawMasks(w,h);refreshChairs(meetingLayout(snapshot.agents||[]),snapshot.agents||[]);for(const r of records.values()){place(r);animate(r)}app.render?.();
 };
 const resize=()=>{if(resizeFrame||destroyed)return;const view=document.defaultView;resizeFrame=view?.requestAnimationFrame?.(()=>{resizeFrame=0;resizeNow()})||0;if(!resizeFrame)resizeNow()};
 const paint=async expected=>{
  if(!started||destroyed||expected!==revision)return;
  const active=(snapshot.agents||[]).filter(a=>a.state!=='left'),agents=[...active.filter(a=>a.kind!=='subagent'),...active.filter(a=>a.kind==='subagent')].slice(0,25),layout=meetingLayout(agents),supportPlaces=supportLayout(agents,meetingReservations(agents)),shown=new Set(),slots=new Map(),stationSlots=new Map(),stationCounts=new Map(),anchors={...OFFICE_ANCHORS,...(snapshot.anchors||{})};
  const parents=new Map(agents.filter(a=>a.kind!=='subagent').map(a=>[a.id,a])),childLabels=new Map(),childCounts=new Map();
  for(const child of agents.filter(a=>a.kind==='subagent').sort((a,b)=>String(a.parentId).localeCompare(String(b.parentId))||String(a.id).localeCompare(String(b.id)))){const n=(childCounts.get(child.parentId)||0)+1;childCounts.set(child.parentId,n);childLabels.set(child.id,`${parents.get(child.parentId)?.label||'보조'}·${n}`)}
  for(const agent of agents.filter(a=>!layout.has(a.id)&&a.state==='running'&&['library','development','server'].includes(a.zone)).sort((a,b)=>((a.kind==='subagent'||a.parentId?1:0)-(b.kind==='subagent'||b.parentId?1:0))||String(a.id).localeCompare(String(b.id)))){const index=stationCounts.get(agent.zone)||0;stationSlots.set(agent.id,index);stationCounts.set(agent.zone,index+1)}
  refreshChairs(layout,agents);
  for(const agent of agents){
   if(expected!==revision)return;
   const old=retired.get(agent.id);if(retired.has(agent.id)&&old===agent.updatedAt&&TERMINAL.has(agent.state))continue;if(old&&!TERMINAL.has(agent.state))retired.delete(agent.id);shown.add(agent.id);
   const requestedSeat=layout.get(agent.id)||null,seat=requestedSeat?.seat===false?null:requestedSeat,support=supportPlaces.get(agent.id)||(requestedSeat?.seat===false?requestedSeat:null),zone=TERMINAL.has(agent.state)&&agent.kind==='subagent'?'door':ATTENTION.has(agent.state)?'table':agent.zone||'table',i=slots.get(zone)||0;slots.set(zone,i+1);
   const station=!seat&&agent.state==='running'&&['library','development','server'].includes(zone)?stationSpot(agent,stationSlots.get(agent.id)||0,anchors):null;
   const stationSeat=station?.seat===false?null:station,target=seat||station||support||spot(agent,i,anchors);
   let r=records.get(agent.id);const entering=!r;if(!r){if(TERMINAL.has(agent.state)&&agent.kind==='subagent'){retired.set(agent.id,agent.updatedAt||'');continue}r=create(agent,target,snapshotBeforeReady&&!!target&&roomContains(target,0)&&(!!seat||!!stationSeat||canStand(target)))}
   const previousSeat=r.displaySeat||r.displayStation;
   r.agent=agent;r.seat=seat;r.station=station;r.support=support;r.displayLabel=childLabels.get(agent.id)||agent.label||'세션';r.node._agent=agent;r.label.textContent=r.displayLabel;r.node.title=`${r.displayLabel} · ${brief(agent)}`;r.detail.textContent=brief(agent);
   r.node.dataset.state=agent.state;r.node.dataset.kind=agent.kind;r.node.dataset.parentId=agent.parentId||'';r.node.dataset.provider=agent.provider||'';r.node.classList.toggle('office-child',agent.kind==='subagent');r.node.classList.toggle('office-overflow',!!support?.meetingOverflow);r.node.classList.toggle('office-working',agent.state==='running');r.node.classList.toggle('office-attention',ATTENTION.has(agent.state));
   r.node.setAttribute('aria-label',`${agent.label||'이름 없는 세션'} · ${brief(agent)}`);
   if(!r.texture){try{const base=await tex(agent);if(destroyed||expected!==revision||records.get(agent.id)!==r)return;r.texture=base;parts(r);place(r)}catch(e){status(e)}}
   if(agent.role==='chair'){trips.delete(agent.id);r.displaySeat=seat;r.displayStation=stationSeat;setFoot(r,target)}
   else if(TERMINAL.has(agent.state)&&agent.kind==='subagent'){
    if(presentation.reducedMotion)remove(agent.id);else travel(agent.id,doorSpot(),true,previousSeat,null,'exiting');
   }else{
    const at=foot(r);
    if(presentation.reducedMotion){if((seat||stationSeat||canStand(target))&&roomContains(target,0)){trips.delete(agent.id);r.displaySeat=seat;r.displayStation=stationSeat;setFoot(r,target)}else r.node.dataset.routeBlocked='true';}
    else if(at.x!==target.x||at.y!==target.y){const moved=travel(agent.id,target,false,previousSeat,seat||stationSeat,entering?'entering':'walking');if(moved){r.displaySeat=seat;r.displayStation=stationSeat}}
    else {r.displaySeat=seat;r.displayStation=stationSeat}
   }
   if(records.get(agent.id)===r){setAction(r);animate(r)}
  }
  if(expected!==revision)return;for(const id of[...records.keys()])if(!shown.has(id)){const r=records.get(id);if(presentation.reducedMotion)remove(id);else{travel(id,doorSpot(),true,r.seated?(r.seat||r.station):null,null,'exiting');if(records.get(id)===r){setAction(r);animate(r)}}}refreshChairs(layout,agents);sync();app.render?.();status();
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
  doorFg=new P.Sprite(base);doorFg.width=app.screen.width;doorFg.height=app.screen.height;doorMask=new P.Graphics();doorFg.mask=doorMask;doorFg.zIndex=901;doorMask.zIndex=901;add(actors,doorMask);add(actors,doorFg);drawMasks(app.screen.width,app.screen.height);
  emptyChair=new P.Sprite(seatTexture(4,CHAIR_SEAT.facing));emptyChair.label='meeting-chair-empty';add(actors,emptyChair);
  for(const seat of[{x:61.8,y:67,facing:'left'},{x:49,y:87,facing:'back'},{x:62,y:82,facing:'back'}])addDecoration(seat)
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
   if(presentation.reducedMotion){const pending=[...trips];trips.clear();for(const[id,t]of pending){const r=records.get(id);if(!r)continue;clearGhost(r);if(r.body)r.body.visible=true;if(r.container)r.container.alpha=1;r.node.style.opacity='1';if(t.removeAfter){remove(id);continue}if(t.target&&roomContains(t.target,0)&&(t.toSeat||canStand(t.target))){setFoot(r,t.target)}else r.node.dataset.routeBlocked='true';setAction(r);animate(r)}refreshChairs(meetingLayout(snapshot.agents||[]),snapshot.agents||[])}
   sync();if(appInitialized)app.render?.();status();
  },
  destroy(){destroyed=true;revision++;document.removeEventListener('visibilitychange',visibility);board._pixiResizeObserver?.disconnect?.();if(resizeFrame)document.defaultView?.cancelAnimationFrame?.(resizeFrame);resizeFrame=0;for(const id of[...records.keys()])remove(id);for(const sprite of[emptyChair,...decorations.map(d=>d.sprite),...emptyWorkChairs.map(c=>c.sprite)])detachMask(sprite);app?.ticker?.remove?.(tick);disposeApp();for(const view of views.values())gone(view);views.clear();textures.clear();actionAtlases.clear();board.replaceChildren()}
 };
}
