export const OFFICE_ANCHORS={door:[15,80],library:[27,60],development:[58,50],server:[72,48],table:[55,67]};
export const TABLE_SLOTS=[[40,79],[69,75],[55,88],[33,76],[73,85],[41,90],[66,90],[31,68]];
export const ATTENTION=new Set(['waiting','unknown','failed']);
export const TERMINAL=new Set(['completed','left']);
const FLOOR_NODES=[{x:37,y:70},{x:40,y:87},{x:42,y:53},{x:73,y:53},{x:72,y:90},{x:88,y:90}];
const TABLE={x:53.4,y:68.8,rx:9,ry:8.8},SURFACES=[[23,36,34,55],[48,69,23,45],[82,96,39,61],[41,46,58,72],[59,65,54,68],[47,53,71,82],[58,65,70,82],[73,87,62,85]];
const limit=(n,a,b)=>Math.min(b,Math.max(a,n));
const hash=s=>[...String(s)].reduce((n,c)=>((n*31)+c.charCodeAt(0))>>>0,7);
export const distance=(a,b)=>Math.hypot((b.x-a.x)*2.6,b.y-a.y);
export const selection=a=>({sessionId:a.parentId?null:a.sessionId,membershipId:a.parentId?null:a.membershipId,parentId:a.parentId||null,id:a.parentId||a.id});
export function brief(a){if(a.state==='queued')return '요청 대기';if(ATTENTION.has(a.state))return({waiting:'확인 대기',unknown:'상태 확인',failed:'연결 확인'})[a.state];if(TERMINAL.has(a.state))return '자리로 돌아옴';return({reading:'책 읽는 중',research:'자료 보는 중',coding:'파일 편집 중',terminal:'터미널 보는 중',synthesis:'생각 중',delegating:'정리 중',responding:'생각 중',none:'대기 중'})[a.activity]||'대기 중'}
export function spot(a,index,anchors=OFFICE_ANCHORS){const zone=TERMINAL.has(a.state)&&a.kind==='subagent'?'door':ATTENTION.has(a.state)?'table':a.zone||'table';if(zone==='table'){const[x,y]=TABLE_SLOTS[index%TABLE_SLOTS.length];return{x,y,zone}}const[x,y]=anchors[zone]||OFFICE_ANCHORS[zone],h=hash(a.id),col=index%5,row=Math.floor(index/5),offset=zone==='door'?0:[0,-1,1,-2,2][col];return{x:limit(x+offset*5.6+((h%7)-3)*.2,5,95),y:limit(y+row*6+((h>>3)%5)*.4,7,92),zone}}
export function floorPoint(p){return !(((p.x-TABLE.x)/TABLE.rx)**2+((p.y-TABLE.y)/TABLE.ry)**2<1||SURFACES.some(([l,r,t,b])=>p.x>l&&p.x<r&&p.y>t&&p.y<b));}
const safe=(a,b)=>Array.from({length:25},(_,i)=>({x:a.x+(b.x-a.x)*i/24,y:a.y+(b.y-a.y)*i/24})).every(floorPoint);
export function floorPath(from,to){const nodes=[from,to,...FLOOR_NODES],cost=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),seen=new Set();cost[0]=0;while(seen.size<nodes.length){let current=-1;for(let i=0;i<nodes.length;i++)if(!seen.has(i)&&(current<0||cost[i]<cost[current]))current=i;if(current<0||!Number.isFinite(cost[current])||current===1)break;seen.add(current);for(let next=0;next<nodes.length;next++)if(!seen.has(next)&&next!==current&&safe(nodes[current],nodes[next])){const candidate=cost[current]+distance(nodes[current],nodes[next]);if(candidate<cost[next]){cost[next]=candidate;previous[next]=current}}}if(previous[1]<0)return[];const result=[];for(let current=1;current!==0;current=previous[current])result.push(nodes[current]);return result.reverse()}
