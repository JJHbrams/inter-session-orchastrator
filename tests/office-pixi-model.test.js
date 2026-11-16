import test from 'node:test';
import assert from 'node:assert/strict';
import {TABLE_SLOTS,floorPath,floorPoint,spot} from '../apps/desktop/office-pixi-model.js';

test('table anchors are the approved floor slots and never on the table',()=>{for(let i=0;i<TABLE_SLOTS.length;i++){const p=spot({id:`a${i}`,zone:'table',state:'queued'},i);assert.deepEqual([p.x,p.y],TABLE_SLOTS[i]);assert.equal(floorPoint(p),true)}});
test('floor routing has only safe sampled segments',()=>{const path=floorPath({x:40,y:79},{x:58,y:50}),all=[{x:40,y:79},...path];assert.ok(path.length);for(let i=1;i<all.length;i++)for(let s=0;s<=24;s++)assert.equal(floorPoint({x:all[i-1].x+(all[i].x-all[i-1].x)*s/24,y:all[i-1].y+(all[i].y-all[i-1].y)*s/24}),true)});
