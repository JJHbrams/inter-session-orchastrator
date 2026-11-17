import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAIR_SEAT,MEETING_SEATS,brief,canStand,distance,facingChair,floorPath,floorPoint,isAtMeeting,meetingLayout,meetingReservations,spot,stationSpot,supportLayout,TABLE_SLOTS,WORK_STATIONS} from '../apps/desktop/office-pixi-model.js';
import {roomContains,segmentClear,routeFloor,ACTOR_FOOT_RADIUS} from '../apps/desktop/office-scene-space.js';

const physicalTable=point=>((point.x-53.4)/9)**2+((point.y-72.5)/11.5)**2<1;
const assertSafeRoute=point=>{assert.equal(canStand(point),true);assert.ok(floorPath({x:15,y:80},point).length);};
const assertClearance=(points,minimum)=>{for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)assert.ok(distance(points[i],points[j])>=minimum,`${points[i].x},${points[i].y} and ${points[j].x},${points[j].y}`);};
const actualOffice=()=>[
 {id:'session-daeun',nativeId:'claude-chair-001',sessionId:'session-daeun',membershipId:'member-daeun',label:'다은',provider:'claude',role:'chair',kind:'session',state:'unknown',activity:'none',zone:'table'},
 ...['minji','seojun','yujin','hyunwoo'].map((name,index)=>({id:`session-${name}`,nativeId:`claude-parent-00${index + 2}`,sessionId:`session-${name}`,membershipId:`member-${name}`,label:name,provider:'claude',kind:'session',state:'completed',activity:'responding',zone:'table'})),
 ...Array.from({length:7},(_,index)=>({id:`child-narin-${index}`,nativeId:`claude-narin-${index}`,parentId:'session-minji',label:'나린',provider:'claude',kind:'subagent',state:'unknown',activity:'none',zone:'table'})),
 ...Array.from({length:2},(_,index)=>({id:`child-junho-${index}`,nativeId:`claude-junho-${index}`,parentId:'session-seojun',label:'준호',provider:'claude',kind:'subagent',state:'unknown',activity:'none',zone:'table'}))
];

test('table anchors are approved safe floor slots',()=>{for(let i=0;i<TABLE_SLOTS.length;i++){const point=spot({id:`a${i}`,zone:'table',state:'queued'},i);assert.deepEqual([point.x,point.y],TABLE_SLOTS[i]);assert.equal(floorPoint(point),true);}});
test('floor routing has only safe sampled segments',()=>{const path=floorPath({x:40,y:79},{x:58,y:50}),all=[{x:40,y:79},...path];assert.ok(path.length);for(let i=1;i<all.length;i++)for(let sample=0;sample<=24;sample++)assert.equal(floorPoint({x:all[i-1].x+(all[i].x-all[i-1].x)*sample/24,y:all[i-1].y+(all[i].y-all[i-1].y)*sample/24}),true);});
test('chair is fixed behind the oval, faces the participants, and clears the whiteboard',()=>{
 assert.deepEqual(CHAIR_SEAT,{x:54,y:64,zone:'table',seat:true,facing:'front',chair:true,approach:{x:42,y:53,zone:'table'}});assert.equal(floorPoint(CHAIR_SEAT.approach),true);
 for(const agent of[{id:'chair',role:'chair',kind:'session',state:'running',zone:'library'},{id:'chair',role:'chair',kind:'session',state:'idle',zone:'table'}])assert.deepEqual(meetingLayout([agent]).get('chair'),CHAIR_SEAT);
});
test('six primary meeting seats are finite, outside the physical table, and face the chair',()=>{
 const agents=Array.from({length:8},(_,index)=>({id:`p${index}`,kind:'session',state:'idle',zone:'table'})),reservations=meetingReservations(agents),primary=[...reservations.values()].slice(0,6);
 assert.deepEqual(primary.map(({x,y})=>({x,y})),MEETING_SEATS);assertClearance(primary,12);
 for(const seat of primary){assert.equal(physicalTable(seat),false);assert.equal(seat.seat,true);assert.notEqual(seat.facing,undefined);assert.equal(floorPoint(seat.approach),true);}
 for(const point of [...reservations.values()].slice(6)){assert.equal(point.seat,false);assert.equal(point.meetingOverflow,true);assertSafeRoute(point);}
});
test('twenty-five parent reservations remain unique, routeable, and safely bounded without ellipse overflow',()=>{
 const agents=Array.from({length:25},(_,index)=>({id:`parent-${String(index).padStart(2,'0')}`,kind:'session',state:'idle',zone:'table'})),reservations=[...meetingReservations(agents).values()];
 assert.equal(reservations.length,25);assert.equal(new Set(reservations.map(point=>`${point.x},${point.y}`)).size,25);assert.equal(reservations.filter(point=>point.seat).length,6);assert.equal(reservations.filter(point=>point.meetingOverflow).length,19);
 const overflow=reservations.filter(point=>point.meetingOverflow);assertClearance(overflow,8.5);for(const point of overflow){assert.equal(point.compact,true);assertSafeRoute(point);for(const primary of reservations.filter(candidate=>candidate.seat))assert.ok(distance(point,primary)>=16);}
});
test('completed parents return to the meeting and completed children remain terminal',()=>{
 const parent={id:'parent',kind:'session',state:'completed',zone:'library'},child={id:'child',parentId:'parent',kind:'subagent',state:'completed',zone:'table'};
 assert.equal(isAtMeeting(parent),true);assert.equal(meetingLayout([parent]).has('parent'),true);assert.equal(supportLayout([parent,child]).has('child'),false);assert.equal(brief(parent),'응답 완료');
});
test('eligible parents attend without changing native session or child state',()=>{
 const active={id:'active',nativeId:'native-active',kind:'session',state:'failed',zone:'library'},moving={id:'moving',nativeId:'native-moving',kind:'session',state:'running',zone:'development'},child={id:'child',nativeId:'native-child',kind:'subagent',state:'idle',zone:'table'},left={id:'left',nativeId:'native-left',kind:'session',state:'left',zone:'table'},before=structuredClone([active,moving,child,left]);
 assert.equal(isAtMeeting(active),true);assert.equal(isAtMeeting(moving),false);assert.equal(isAtMeeting(child),false);assert.equal(isAtMeeting(left),false);assert.equal(meetingLayout([active,moving,child,left]).has('active'),true);assert.deepEqual([active,moving,child,left],before);
});
test('rear primary projections retain back-left, back, and back-right directions',()=>{const facings=new Set(MEETING_SEATS.map(facingChair));assert.ok(facings.has('back-left'));assert.ok(facings.has('back'));assert.ok(facings.has('back-right'));});
test('active parent membership reserves seats while a peer works so seated peers do not repack',()=>{
 const people=['a','b','c'].map(id=>({id,kind:'session',state:'idle',zone:'table'})),before=meetingLayout(people),working=people.map(agent=>agent.id==='b'?{...agent,state:'running',zone:'development'}:agent),after=meetingLayout(working),reserved=meetingReservations(working);
 for(const id of['a','c'])assert.deepEqual(after.get(id),before.get(id));assert.deepEqual(reserved.get('b'),before.get('b'));assert.equal(after.has('b'),false);
});
test('actual five-parent and nine-child snapshot is stable, unique, reachable, and keeps meaningful head clearance',()=>{
 const agents=actualOffice(),before=structuredClone(agents),reservations=meetingReservations(agents),meeting=meetingLayout(agents),support=supportLayout(agents,reservations),children=[...support.values()],targets=[...meeting.values(),...children];
 assert.equal(meeting.size,5);assert.equal(support.size,9);assert.equal(new Set(targets.map(point=>`${point.x},${point.y}`)).size,targets.length);assertClearance(children,12);
 for(const child of children){assert.equal(child.zone,'support');assert.equal(child.seat,false);assert.equal(TABLE_SLOTS.some(([x,y])=>x===child.x&&y===child.y),false);assertSafeRoute(child);for(const parent of meeting.values())assert.ok(distance(child,parent)>=16);}
 assert.deepEqual(agents,before);const shuffled=[...agents].reverse(),again=supportLayout(shuffled,meetingReservations(shuffled));assert.deepEqual([...support],[...again]);
});
test('running workstation children remain at their station rather than the support layout',()=>{const agents=[...actualOffice(),{id:'work',parentId:'session-minji',kind:'subagent',state:'running',zone:'library'}];assert.equal(supportLayout(agents).has('work'),false);});
test('generic table fallback no longer wraps after eight slots and exhausts safely',()=>{
 const ninth=spot({id:'ninth',zone:'table',state:'queued'},8);assert.notDeepEqual([ninth.x,ninth.y],TABLE_SLOTS[0]);assert.equal(ninth.zone,'support');assert.equal(ninth.seat,false);assert.equal(spot({id:'late',zone:'table',state:'queued'},Number.MAX_SAFE_INTEGER),null);
});
test('each workstation is reachable from doorway and meeting approaches',()=>{for(const station of Object.values(WORK_STATIONS))for(const from of[{x:15,y:80},{x:40,y:87},{x:72,y:90}]){const path=floorPath(from,station.approach),nodes=[from,...path];assert.ok(path.length);for(let i=1;i<nodes.length;i++)for(let sample=0;sample<=24;sample++)assert.equal(floorPoint({x:nodes[i-1].x+(nodes[i].x-nodes[i-1].x)*sample/24,y:nodes[i-1].y+(nodes[i].y-nodes[i-1].y)*sample/24}),true);}});
test('only primary workstation uses a chair and overflow workers have finite distinct connected floor points',()=>{for(const zone of Object.keys(WORK_STATIONS)){for(let index=0;index<25;index++){const point=stationSpot({zone},index);assert.ok(point);assert.equal(floorPoint(point.approach),true);assert.ok(floorPath({x:15,y:80},point.approach).length);assert.equal(point.seat,index===0);if(index>0){assert.equal(canStand(point),true);assert.deepEqual([point.x,point.y],[point.approach.x,point.approach.y]);}}const points=Array.from({length:24},(_,index)=>stationSpot({zone},index+1));assert.equal(new Set(points.map(point=>`${point.x},${point.y}`)).size,24);}});
test('walkable space excludes exterior, furniture, partition, and unsafe endpoints',()=>{assert.equal(roomContains({x:2,y:70}),false);assert.equal(canStand({x:90,y:45}),false);assert.equal(canStand({x:80,y:85}),false);assert.equal(canStand({x:88,y:77}),false);assert.equal(segmentClear({x:88,y:90},{x:89,y:65},ACTOR_FOOT_RADIUS),false);assert.deepEqual(routeFloor({x:90,y:45},{x:89,y:65}),[]);assert.deepEqual(routeFloor({x:15,y:80},{x:80,y:85}),[]);});
test('all portal routes stay collision-free and avoid the measured front table legs',()=>{
 const portals=[{x:15,y:80},{x:21,y:55},{x:57,y:49},{x:89,y:65},{x:37,y:70},{x:40,y:87}];for(const from of portals)for(const to of portals){const route=routeFloor(from,to),points=[from,...route];assert.ok(route.length||from===to);for(let i=1;i<points.length;i++)assert.equal(segmentClear(points[i-1],points[i]),true);}
 assert.equal(canStand({x:56.9925,y:82.7849}),false);const route=routeFloor({x:72,y:90},{x:22,y:50}),points=[{x:72,y:90},...route];assert.ok(route.length);for(let i=1;i<points.length;i++)for(let sample=0;sample<=50;sample++){const t=sample/50,point={x:points[i-1].x+(points[i].x-points[i-1].x)*t,y:points[i-1].y+(points[i].y-points[i-1].y)*t};assert.ok(point.x<44||point.x>63||point.y<60||point.y>84.5);}
});
