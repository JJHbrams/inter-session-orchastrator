import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaMessagePresentation} from '../apps/desktop/agenda-ui.js';
test('internal agenda routing is an activity, not another agent',()=>{const activity=agendaMessagePresentation({provenance:'coordinator',request_key:'agenda:a:chair:plan:1',body:'internal JSON'},{});assert.equal(activity.internal,true);assert.equal(activity.title,'좌장에게 토론 계획 요청');assert.equal(activity.authorSessionId,undefined)});
test('peer-review UI shows chair dialogue instead of raw routing JSON',()=>{const view=agendaMessagePresentation({provenance:'coordinator',request_key:'agenda:a:round:r:review',body:JSON.stringify({type:'agenda_review',candidate:'candidate',conclusionRevision:2,arguments:[{id:'arg',body:'peer argument'}]})},{session_id:'chair'});assert.equal(view.authorSessionId,'chair');assert.match(view.body,/candidate/);assert.match(view.details,/peer argument/);assert.doesNotMatch(view.body,/agenda_review/)});
