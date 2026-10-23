import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryPresentation} from '../apps/desktop/delivery-status.js';

test('queued delivery with a preflight reason is visibly blocked without changing its scheduler state',()=>{
 const view=deliveryPresentation({state:'queued',blocked_reason:'draft_exists'});
 assert.deepEqual(view,{state:'blocked',label:'전달 차단',reason:'Orca가 입력란의 문구를 감지해 전달을 보류했어요. 현재 연동은 실제 초안과 추천 문구를 구분하지 못해요.',blocked:true});
 assert.deepEqual(deliveryPresentation({state:'queued',blocked_reason:null}),{state:'queued',label:'요청 대기',reason:null,blocked:false});
});

test('legacy English composer reason remains a Korean blocked explanation',()=>{
 const view=deliveryPresentation({state:'queued',blocked_reason:'composer is not exactly empty and idle'});
 assert.equal(view.label,'전달 차단');
 assert.match(view.reason,/입력창이 비어 있는지 확인할 수 없어/);
});

test('adapter Korean reasons are shown once without a generic prefix',()=>{
 const reason=deliveryPresentation({state:'queued',blocked_reason:'draft_exists'}).reason;
 assert.equal(deliveryPresentation({state:'queued',blocked_reason:reason}).reason,reason);
});
