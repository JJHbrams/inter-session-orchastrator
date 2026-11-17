// Foreground silhouettes and floor-front envelopes measured in the 2022 x 778 authored room.
// These are camera occlusion shapes, not floor collision footprints or chair cutouts.
const normalize=p=>({x:p[0]*100/2022,y:p[1]*100/778});
const object=(id,visual,front)=>Object.freeze({id,visual:visual.map(normalize),front:front.map(normalize)});
export const SCENE_OCCLUDERS=Object.freeze([
 object('whiteboard',[[789,303],[971,272],[991,467],[950,498],[789,506],[769,475]],[[769,475],[789,506],[950,498],[991,467]]),
 object('meeting-table',[[893,545],[910,506],[991,475],[1132,464],[1233,482],[1262,513],[1254,560],[1223,591],[1223,642],[1205,642],[1205,595],[1031,616],[1031,657],[1011,657],[1011,615],[930,605],[930,630],[910,630],[910,595],[897,572]],[[893,572],[910,630],[930,630],[1011,657],[1031,657],[1205,642],[1223,642],[1254,560],[1262,513]]),
 object('library-desk',[[461,326],[621,289],[722,322],[708,420],[677,429],[677,366],[556,381],[546,426],[516,428],[516,370],[463,358]],[[461,358],[516,428],[546,426],[556,381],[677,429],[708,420],[722,322]]),
 object('development-desk',[[960,198],[1120,164],[1364,213],[1312,321],[1230,305],[1150,281],[1063,304],[960,273]],[[960,273],[1063,304],[1150,281],[1230,305],[1312,321],[1364,213]]),
 object('server-desk',[[1650,314],[1800,286],[1940,350],[1932,470],[1815,444],[1710,414]],[[1650,314],[1710,414],[1815,444],[1932,470],[1940,350]]),
 object('sofa',[[1480,535],[1545,500],[1665,520],[1723,570],[1705,652],[1660,676],[1512,648],[1460,605]],[[1460,605],[1512,648],[1660,676],[1705,652],[1723,570]]),
 object('partition-wall',[[1468,371],[1966,476],[1961,657],[1464,542]],[[1464,542],[1961,657]])
]);
export function frontAtX(object,x){const line=object.front;if(x<=line[0].x)return line[0].y;if(x>=line.at(-1).x)return line.at(-1).y;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i];if(x<=b.x)return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x||1)}return line.at(-1).y}
export function occludersAt(point,{marginX=3.5}={}){return SCENE_OCCLUDERS.filter(o=>{const xs=o.visual.map(p=>p.x);return point.x>=Math.min(...xs)-marginX&&point.x<=Math.max(...xs)+marginX&&point.y<frontAtX(o,point.x)-.15})}
