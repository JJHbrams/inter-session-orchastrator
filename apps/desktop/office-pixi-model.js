import {canStand,floorPath} from './office-scene-space.js';
export {canStand,floorPath};
export const floorPoint=canStand;
export const OFFICE_ANCHORS={door:[15,80],library:[25.7,47.2],development:[57,41.9],server:[85.5,55.5],table:[55,67]};
export const WORK_STATIONS=Object.freeze({library:{x:25.7,y:47.2,approach:{x:22,y:50}},development:{x:57,y:41.9,approach:{x:58,y:50}},server:{x:85.5,y:55.5,approach:{x:89,y:65}}});
export const TABLE_SLOTS=[[40,79],[69,75],[55,88],[33,76],[73,85],[41,90],[66,90],[31,68]];
export const CHAIR_SEAT=Object.freeze({x:43.8,y:67.8,zone:'table',seat:true,facing:'front',chair:true,approach:{x:37,y:70,zone:'table'}});
export const ATTENTION=new Set(['waiting','unknown','failed']);
export const TERMINAL=new Set(['completed','left']);
const FLOOR_NODES=[{x:20,y:65},{x:37,y:70},{x:40,y:87},{x:42,y:53},{x:73,y:53},{x:77,y:65},{x:89,y:65},{x:72,y:90},{x:90,y:90}];
const limit=(n,a,b)=>Math.min(b,Math.max(a,n));
const hash=s=>[...String(s)].reduce((n,c)=>((n*31)+c.charCodeAt(0))>>>0,7);
export const distance=(a,b)=>Math.hypot((b.x-a.x)*2.6,b.y-a.y);
export const selection=a=>({sessionId:a.parentId?null:a.sessionId,membershipId:a.parentId?null:a.membershipId,parentId:a.parentId||null,id:a.parentId||a.id});
const MEETING_STATES=new Set(['idle','queued','waiting','unknown','failed','completed']);
const MEETING_APPROACHES=[{x:37,y:70},{x:40,y:87},{x:42,y:53},{x:73,y:53},{x:72,y:90}];
const MEETING_SEATS=[{x:57,y:88},{x:43.8,y:88},{x:40,y:86},{x:49,y:64},{x:59,y:63},{x:66,y:72},{x:66,y:81},{x:61,y:88},{x:51,y:89}];
const meetingApproach=seat=>MEETING_APPROACHES.reduce((best,node)=>distance(node,seat)<distance(best,seat)?node:best);
const participantSeat=(index,count)=>{if(index<MEETING_SEATS.length)return MEETING_SEATS[index];const slot=index-MEETING_SEATS.length,total=Math.max(count-MEETING_SEATS.length,1),angle=(-Math.PI/2)+(Math.PI*2*slot/total);return{x:53.4+Math.cos(angle)*13,y:76.5+Math.sin(angle)*13};};
export const SEAT_DIRECTIONS=Object.freeze(['right','front-right','front','front-left','left','back-left','back','back-right']);
export const facingChair=seat=>{
 const vx=(CHAIR_SEAT.x-seat.x)*2.6,vy=CHAIR_SEAT.y-seat.y;
 const angle=Math.atan2(vy,vx),index=((Math.round(angle/(Math.PI/4))%8)+8)%8;
 return SEAT_DIRECTIONS[index];
};
export function isAtMeeting(agent={}){if(agent.state==='left')return false;if(agent.role==='chair')return true;return agent.kind==='session'&&(agent.zone==='table'||MEETING_STATES.has(agent.state));}
export function meetingReservations(agents=[]){const reservations=new Map(),members=agents.filter(a=>a.kind==='session'&&!a.parentId&&a.state!=='left'&&a.role!=='chair').sort((a,b)=>String(a.id).localeCompare(String(b.id)));for(let i=0;i<members.length;i++){const point=participantSeat(i,members.length),approach=meetingApproach(point);reservations.set(members[i].id,{...point,zone:'table',seat:true,facing:facingChair(point),chair:false,approach:{...approach,zone:'table'}})}return reservations;}
export function meetingLayout(agents=[]){const layout=new Map(),chair=agents.find(a=>a.role==='chair'&&isAtMeeting(a)),reservations=meetingReservations(agents);if(chair)layout.set(chair.id,{...CHAIR_SEAT,approach:{...CHAIR_SEAT.approach}});for(const agent of agents)if(agent.role!=='chair'&&isAtMeeting(agent)){const reservation=reservations.get(agent.id);if(reservation)layout.set(agent.id,reservation)}return layout;}
export function brief(a){if(a.state==='queued')return '요청 대기';if(ATTENTION.has(a.state))return({waiting:'확인 대기',unknown:'상태 확인',failed:'연결 확인'})[a.state];if(TERMINAL.has(a.state))return '자리로 돌아옴';return({reading:'책 읽는 중',research:'자료 보는 중',coding:'파일 편집 중',terminal:'터미널 보는 중',synthesis:'의견 취합 중',delegating:'작업 위임 중',responding:'응답 중',none:'대기 중'})[a.activity]||'대기 중'}
export function stationSpot(a,index=0,anchors=OFFICE_ANCHORS){
 const name=['library','development','server'].includes(a.zone)?a.zone:'library',base=WORK_STATIONS[name],anchor=anchors[name],valid=Array.isArray(anchor)&&anchor.length>=2&&anchor.slice(0,2).every(Number.isFinite),x=valid?anchor[0]:base.x,y=valid?anchor[1]:base.y;
 const col=index%3,row=Math.floor(index/3),offset=col===0?0:(col%2?-3:3),dx=x-base.x,dy=y-base.y;
 const candidates=[{x:base.approach.x+dx+(name==='server'?Math.max(0,offset):offset),y:base.approach.y+dy+row*3},{x:base.approach.x+dx,y:base.approach.y+dy},base.approach,...FLOOR_NODES];
 const approach=candidates.find(p=>floorPoint(p)&&floorPath({x:15,y:80},p).length)||base.approach;
 return{x:x+offset,y:y+row*3,zone:name,station:name,secondary:index>0,facing:({library:'front',development:'back-left',server:'back-right'})[name],seat:true,approach:{...approach,zone:name}};
}

export function spot(a,index,anchors=OFFICE_ANCHORS){const zone=TERMINAL.has(a.state)&&a.kind==='subagent'?'door':ATTENTION.has(a.state)?'table':a.zone||'table';if(zone==='table'){const[x,y]=TABLE_SLOTS[index%TABLE_SLOTS.length];return{x,y,zone}}const[x,y]=anchors[zone]||OFFICE_ANCHORS[zone],h=hash(a.id),col=index%5,row=Math.floor(index/5),offset=zone==='door'?0:[0,-1,1,-2,2][col];return{x:limit(x+offset*5.6+((h%7)-3)*.2,5,95),y:limit(y+row*6+((h>>3)%5)*.4,7,92),zone}}
