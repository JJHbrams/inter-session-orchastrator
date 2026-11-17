const ROOM=[[15,43],[34,25],[49,25],[65,29],[81,38],[95,48],[95,84],[87,94],[35,94],[12,82],[12,62]];
const WAYPOINTS=[[20,65],[37,70],[37,55],[40,87],[42,53],[73,53],[77,65],[89,65],[72,90],[90,90]];
const RECTANGLES=[[75,88,76,89],[77,85,84,92],[82,96,39,61],[48,69,23,45],[23,36,34,55],[41,46,58,72]];
// Include the front legs, whose authored floor edge reaches y=84.5.
const TABLE={x:53.4,y:72.5,rx:9,ry:11.5};
const WALL=[[72.7,69.4],[96.9,84.4]];
export const ACTOR_FOOT_RADIUS=2;
const metric=(a,b)=>Math.hypot((b.x-a.x)*2.6,b.y-a.y);
const pointSegment=(p,a,b)=>{const dx=(b[0]-a[0])*2.6,dy=b[1]-a[1],px=(p.x-a[0])*2.6,py=p.y-a[1],t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1)));return Math.hypot(px-dx*t,py-dy*t)};
const inPolygon=p=>{let inside=false;for(let i=0,j=ROOM.length-1;i<ROOM.length;j=i++){const [xi,yi]=ROOM[i],[xj,yj]=ROOM[j];if((yi>p.y)!==(yj>p.y)&&p.x<(xj-xi)*(p.y-yi)/(yj-yi)+xi)inside=!inside}return inside};
export function roomContains(point,radius=ACTOR_FOOT_RADIUS){if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||!inPolygon(point))return false;return ROOM.every((a,i)=>pointSegment(point,a,ROOM[(i+1)%ROOM.length])>=radius)}
const inRect=(p,[l,r,t,b],radius)=>p.x>=l-radius/2.6&&p.x<=r+radius/2.6&&p.y>=t-radius&&p.y<=b+radius;
const inTable=(p,radius)=>((p.x-TABLE.x)/(TABLE.rx+radius/2.6))**2+((p.y-TABLE.y)/(TABLE.ry+radius))**2<1;
export function canStand(point,radius=ACTOR_FOOT_RADIUS){return roomContains(point,radius)&&!RECTANGLES.some(rect=>inRect(point,rect,radius))&&!inTable(point,radius)&&pointSegment(point,WALL[0],WALL[1])>=radius}
export const floorPoint=canStand;
export function segmentClear(from,to,radius=ACTOR_FOOT_RADIUS){if(!canStand(from,radius)||!canStand(to,radius))return false;const length=Math.max(2,Math.ceil(metric(from,to)/.5));for(let i=1;i<length;i++){const t=i/length;if(!canStand({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t},radius))return false}return true}
export function routeFloor(from,to,radius=ACTOR_FOOT_RADIUS){if(!canStand(from,radius)||!canStand(to,radius))return [];const nodes=[from,to,...WAYPOINTS.map(([x,y])=>({x,y}))].filter(p=>canStand(p,radius)),cost=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),seen=new Set();cost[0]=0;while(seen.size<nodes.length){let current=-1;for(let i=0;i<nodes.length;i++)if(!seen.has(i)&&(current<0||cost[i]<cost[current]))current=i;if(current<0||!Number.isFinite(cost[current])||current===1)break;seen.add(current);for(let next=0;next<nodes.length;next++)if(!seen.has(next)&&next!==current&&segmentClear(nodes[current],nodes[next],radius)){const candidate=cost[current]+metric(nodes[current],nodes[next]);if(candidate<cost[next]){cost[next]=candidate;previous[next]=current}}}if(previous[1]<0)return[];const route=[];for(let current=1;current!==0;current=previous[current])route.push(nodes[current]);return route.reverse()}
export const floorPath=routeFloor;

// Read-only geometry used by the visual scene verification overlay.
export const SCENE_SPACE=Object.freeze({room:ROOM,waypoints:WAYPOINTS,rectangles:RECTANGLES,table:TABLE,wall:WALL,radius:ACTOR_FOOT_RADIUS});
