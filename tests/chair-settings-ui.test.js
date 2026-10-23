import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {chairSettingsFields,dialogueLimitSummary} from '../apps/desktop/chair-settings.js';
const catalog={providers:[{id:'claude',models:[{id:'sonnet',efforts:['low','medium','high']}],efforts:['low','medium','high']},{id:'codex',models:[{id:'codex-model',efforts:['medium','high','xhigh']}],efforts:['low','medium','high','xhigh']}]};
test('switching chair provider resets incompatible model and effort without overwriting global settings',()=>{
 const dom=new JSDOM(),fields=chairSettingsFields(dom.window.document,catalog,{provider:'claude',model:'sonnet',effort:'high'});
 fields.providerInput.value='codex';fields.providerInput.dispatchEvent(new dom.window.Event('change'));
 assert.deepEqual(fields.value(),{provider:'codex',model:null,effort:null});
 assert.equal(fields.effortInput.disabled,true);assert.equal(fields.effortInput.options.length,1);
 fields.modelInput.value='codex-model';fields.modelInput.dispatchEvent(new dom.window.Event('change'));fields.effortInput.value='xhigh';
 assert.deepEqual(fields.value(),{provider:'codex',model:'codex-model',effort:'xhigh'});
});
test('editing an existing chair preserves a custom model and its immutable provider',()=>{
 const dom=new JSDOM(),fields=chairSettingsFields(dom.window.document,catalog,{provider:'claude',model:'private-model',effort:'medium',lockedProvider:true});
 assert.equal(fields.providerInput.disabled,true);assert.equal(fields.customInput.disabled,false);assert.equal(fields.customInput.value,'private-model');
 fields.providerInput.value='codex';assert.equal(fields.value().provider,'claude');
 assert.match(dialogueLimitSummary(3,20),/내 입력 한 번.*3차례.*20건/);
});
