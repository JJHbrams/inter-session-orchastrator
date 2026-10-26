import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAgenda,safeUrl} from '../apps/desktop/agenda-ui.js';

test('agenda UI normalizes API naming without inventing a completion state',()=>{
 const agenda=normalizeAgenda({agenda_id:'a1',status:'reviewing',current_revision:4,current_round:2,result_summary:'검토 중',participant_ids:['p1']});
 assert.deepEqual(agenda,{agenda_id:'a1',status:'reviewing',current_revision:4,current_round:2,result_summary:'검토 중',participant_ids:['p1'],id:'a1',title:'제목 없는 안건',phase:'reviewing',outcome:undefined,revision:4,round:2,summary:'검토 중',arguments:[],reviews:[],notices:[],goal:undefined,completionCriteria:undefined,participants:['p1']});
});

test('knowledge links accept only HTTP(S) URLs',()=>{
 assert.equal(safeUrl('https://example.test/source'),'https://example.test/source');
 assert.equal(safeUrl('javascript:alert(1)'),null);
 assert.equal(safeUrl('file:///C:/secret'),null);
});
