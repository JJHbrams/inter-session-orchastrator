import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reviewPrompt} from '../services/coordinator/review-prompt.js';
const make=()=>({type:'agenda_review',agendaId:randomUUID(),roundId:randomUUID(),conclusionRevision:2,candidate:'candidate',arguments:[{id:randomUUID(),author:randomUUID(),body:'argument',attachments:[]}],attachmentRefs:[],expectedResponse:'review'});
test('even short reviews use scoped references and preserve originals',()=>{const p=make(),r=JSON.parse(reviewPrompt(p));assert.equal(r.referencesOnly,true);assert.equal(r.candidate,undefined);assert.equal(r.arguments[0].body,undefined);assert.equal(p.arguments[0].body,'argument');assert.equal(r.contextReference.tool,'room_history_read');});
test('three substantive arguments use exact source references without truncating originals',()=>{
 const p=make();p.candidate='결론'.repeat(1600);p.arguments=Array.from({length:3},()=>({id:randomUUID(),author:randomUUID(),body:'근거'.repeat(1400),attachments:[{id:randomUUID(),filename:'proof.md',sha256:'a'.repeat(64)}]}));
 const original=structuredClone(p),wire=reviewPrompt(p),r=JSON.parse(wire);
 assert.ok(wire.length<=8000);assert.equal(r.referencesOnly,true);assert.equal(r.candidate,undefined);assert.equal(r.candidateOmitted,true);assert.deepEqual(r.arguments.map(x=>x.id),p.arguments.map(x=>x.id));assert.deepEqual(r.arguments[0].attachments,p.arguments[0].attachments);assert.equal(r.contextReference.agendaId,p.agendaId);assert.equal(r.contextReference.conclusionRevision,2);assert.match(r.expectedResponse,/full candidate/);assert.deepEqual(p,original);
});
test('full-size candidate and large metadata retain bounded, scoped retrieval instructions',()=>{
 const p=make();p.candidate='x'.repeat(8000);p.arguments=Array.from({length:100},()=>({id:randomUUID(),author:randomUUID(),body:'z'.repeat(8000),attachments:[{id:randomUUID(),filename:'name'.repeat(50),sha256:'a'.repeat(64)}]}));
 const wire=reviewPrompt(p),r=JSON.parse(wire);assert.ok(wire.length<=8000);assert.deepEqual(r.argumentMessageIds,p.arguments.map(x=>x.id));assert.equal(r.contextReference.candidateField,'agendas[].current_conclusion');assert.equal(r.contextReference.argumentsField,'agendas[].arguments');assert.equal(r.attachmentsInContext,true);assert.equal(p.candidate.length,8000);
});
