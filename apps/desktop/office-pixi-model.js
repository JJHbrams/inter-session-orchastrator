import {canStand,floorPath} from './office-scene-space.js';
export {canStand,floorPath};
export const floorPoint=canStand;
export const OFFICE_ANCHORS={door:[15,80],library:[25.7,47.2],development:[57,41.9],server:[85.5,55.5],table:[55,67]};
export const WORK_STATIONS=Object.freeze({library:{x:25.7,y:47.2,approach:{x:22,y:50}},development:{x:57,y:41.9,approach:{x:58,y:50}},server:{x:85.5,y:55.5,approach:{x:89,y:65}}});
export const TABLE_SLOTS=[[40,79],[69,75],[55,88],[33,76],[73,85],[41,90],[66,90],[31,68]];
export const CHAIR_SEAT=Object.freeze({x:54,y:64,zone:'table',seat:true,facing:'front',chair:true,approach:{x:42,y:53,zone:'table'}});
export const ATTENTION=new Set(['waiting','unknown','failed']);
export const TERMINAL=new Set(['completed','left']);
const FLOOR_NODES=[{x:20,y:65},{x:37,y:70},{x:40,y:87},{x:42,y:53},{x:73,y:53},{x:77,y:65},{x:89,y:65},{x:72,y:90},{x:90,y:90}];
const limit=(n,a,b)=>Math.min(b,Math.max(a,n));
const hash=s=>[...String(s)].reduce((n,c)=>((n*31)+c.charCodeAt(0))>>>0,7);
export const distance=(a,b)=>Math.hypot((b.x-a.x)*2.6,b.y-a.y);
export const selection=a=>({sessionId:a.parentId?null:a.sessionId,membershipId:a.parentId?null:a.membershipId,parentId:a.parentId||null,id:a.parentId||a.id});
const MEETING_STATES=new Set(['idle','queued','waiting','unknown','failed','completed']);
export const MEETING_SEATS=Object.freeze([{x:64,y:86},{x:54,y:91},{x:42.5,y:85},{x:40.5,y:70},{x:66.5,y:71},{x:66.5,y:55}]);
const MEETING_APPROACHES=[{x:37,y:70},{x:40,y:87},{x:42,y:53},{x:73,y:53},{x:72,y:90}];
const meetingApproach=seat=>MEETING_APPROACHES.reduce((best,node)=>distance(node,seat)<distance(best,seat)?node:best);
export const SEAT_DIRECTIONS=Object.freeze(['right','front-right','front','front-left','left','back-left','back','back-right']);
export const facingChair=seat=>{
 const vx=(CHAIR_SEAT.x-seat.x)*2.6,vy=CHAIR_SEAT.y-seat.y;
 const angle=Math.atan2(vy,vx),index=((Math.round(angle/(Math.PI/4))%8)+8)%8;
 return SEAT_DIRECTIONS[index];
};
const reachable=p=>canStand(p)&&floorPath({x:15,y:80},p).length>0;
const supportSeed=[{x:22,y:60},{x:28,y:60},{x:34,y:60},{x:22,y:76},{x:28,y:76},{x:34,y:76},{x:34,y:90},{x:70,y:60},{x:70,y:78},{x:70,y:90}];
const supportCandidates=(wide=false)=>{
 const grid=[];for(let y=48;y<=92;y+=1)for(let x=22;x<=70;x+=1)grid.push({x,y});
 const points=[];for(const point of [...supportSeed,...grid])if(canStand(point)&&point.x>=22&&((point.x<36.5&&point.y>=58)||point.x>52||point.y>=88)&&!points.some(other=>other.x===point.x&&other.y===point.y))points.push(point);
 return points;
};
const SUPPORT_POINTS=supportCandidates(),OBSERVER_POINTS=supportCandidates(true);
const chooseSupport=(used=[],kind='observer')=>(kind==='child'?SUPPORT_POINTS:OBSERVER_POINTS).find(point=>used.every(other=>distance(point,other)>=(kind==='observer'&&other.supportKind==='observer'?8.5:kind==='child'&&['child','observer'].includes(other.supportKind)?12:16))&&reachable(point))||null;
const meetingMembers=agents=>agents.filter(a=>a.kind==='session'&&!a.parentId&&a.state!=='left'&&a.role!=='chair').sort((a,b)=>String(a.id).localeCompare(String(b.id)));
export function isAtMeeting(agent={}){if(agent.state==='left')return false;if(agent.role==='chair')return true;return agent.kind==='session'&&(agent.zone==='table'||MEETING_STATES.has(agent.state));}
export function meetingReservations(agents=[]){
 const reservations=new Map(),members=meetingMembers(agents),used=[CHAIR_SEAT];
 for(let i=0;i<members.length;i++){
  const member=members[i];
  if(i<MEETING_SEATS.length){const point=MEETING_SEATS[i],approach=meetingApproach(point);reservations.set(member.id,{...point,zone:'table',seat:true,facing:facingChair(point),chair:false,approach:{...approach,zone:'table'}});used.push(point);}
  else {const point=chooseSupport(used);if(!point)continue;reservations.set(member.id,{...point,zone:'support',seat:false,meetingOverflow:true,compact:true,parentId:member.id,approach:{...point,zone:'support'}});used.push({...point,supportKind:'observer'});}
 }
 return reservations;
}
export function meetingLayout(agents=[]){const layout=new Map(),chair=agents.find(a=>a.role==='chair'&&isAtMeeting(a)),reservations=meetingReservations(agents);if(chair)layout.set(chair.id,{...CHAIR_SEAT,approach:{...CHAIR_SEAT.approach}});for(const agent of agents)if(agent.role!=='chair'&&isAtMeeting(agent)){const reservation=reservations.get(agent.id);if(reservation)layout.set(agent.id,reservation)}return layout;}
export function supportLayout(agents=[],reservations=meetingReservations(agents)){
 const layout=new Map(),used=[CHAIR_SEAT,...[...reservations.values()].map(point=>({x:point.x,y:point.y}))];
 const children=agents.filter(agent=>agent.kind==='subagent'&&agent.state!=='left'&&agent.state!=='completed'&&!(agent.state==='running'&&['library','development','server'].includes(agent.zone))).sort((a,b)=>String(a.parentId||'').localeCompare(String(b.parentId||''))||String(a.id).localeCompare(String(b.id)));
 for(const child of children){const point=chooseSupport(used,'child');if(!point)continue;layout.set(child.id,{...point,zone:'support',seat:false,parentId:child.parentId||null,approach:{...point,zone:'support'}});used.push({...point,supportKind:'child'});}
 return layout;
}
export function brief(a){if(a.state==='queued')return '요청 대기';if(ATTENTION.has(a.state))return({waiting:'확인 대기',unknown:'상태 확인',failed:'연결 확인'})[a.state];if(a.state==='completed')return '응답 완료';if(a.state==='left')return '자리로 돌아옴';return({reading:'책 읽는 중',research:'자료 보는 중',coding:'파일 편집 중',terminal:'터미널 보는 중',synthesis:'의견 취합 중',delegating:'작업 위임 중',responding:'응답 중',none:'대기 중'})[a.activity]||'대기 중'}
const overflowPoints=new Map();
export function stationSpot(a,index=0,anchors=OFFICE_ANCHORS){
 const name=['library','development','server'].includes(a.zone)?a.zone:'library',base=WORK_STATIONS[name],anchor=anchors[name],valid=Array.isArray(anchor)&&anchor.length>=2&&anchor.slice(0,2).every(Number.isFinite),x=valid?anchor[0]:base.x,y=valid?anchor[1]:base.y;
 if(index>0){const key=`${name}:${x}:${y}`;if(!overflowPoints.has(key)){const offsets={library:[[-6.2,10.8],[6.3,10.8],[0,19]],development:[[-6.5,9.1],[7,9.1],[0,18]],server:[[-5.5,8.5],[6,8.5],[-10,9]]}[name],preferred=offsets.map(([dx,dy])=>({x:x+dx,y:y+dy})),grid=[];for(let gy=44;gy<=92;gy+=2)for(let gx=16;gx<=94;gx+=2)grid.push({x:gx,y:gy});grid.sort((a,b)=>distance(a,{x,y})-distance(b,{x,y}));const points=[];for(const p of [...preferred,...grid])if(distance(p,{x,y})>=16&&points.every(q=>distance(p,q)>=16)&&reachable(p))points.push(p);overflowPoints.set(key,points);}const target=overflowPoints.get(key)[index-1];if(!target)return null;return{...target,zone:name,station:name,secondary:true,facing:({library:'front',development:'back-left',server:'back-right'})[name],seat:false,approach:{...target,zone:name}};}
 const dx=x-base.x,dy=y-base.y,candidates=[{x:base.approach.x+dx,y:base.approach.y+dy},base.approach,...FLOOR_NODES],approach=candidates.find(reachable)||base.approach;
 return{x,y,zone:name,station:name,secondary:false,facing:({library:'front',development:'back-left',server:'back-right'})[name],seat:true,approach:{...approach,zone:name}};
}
export function spot(a,index,anchors=OFFICE_ANCHORS){const zone=TERMINAL.has(a.state)&&a.kind==='subagent'?'door':ATTENTION.has(a.state)?'table':a.zone||'table';if(zone==='table'){const slot=TABLE_SLOTS[index];if(slot){const[x,y]=slot;return{x,y,zone};}const point=SUPPORT_POINTS[index-TABLE_SLOTS.length];return point?{...point,zone:'support',seat:false,approach:{...point,zone:'support'}}:null;}const[x,y]=anchors[zone]||OFFICE_ANCHORS[zone],h=hash(a.id),col=index%5,row=Math.floor(index/5),offset=zone==='door'?0:[0,-1,1,-2,2][col];return{x:limit(x+offset*5.6+((h%7)-3)*.2,5,95),y:limit(y+row*6+((h>>3)%5)*.4,7,92),zone};}
