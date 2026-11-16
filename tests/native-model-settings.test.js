import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeModelSettings,parseModelMenu,parseEffortMenu,parseSwitchConfirmation} from '../adapters/orca/model-settings.js';
const codexModels=(selected=1,current=1)=>['Select Model and Effort',`${selected===1?'›':''} 1. GPT-5.6-Terra${current===1?' (current)':''}  Balanced`,`${selected===2?'›':''} 2. GPT-5.6-Luna${current===2?' (current)':''}  Fast`,'enter select · esc back'];
const codexEfforts=(selected=2,current=2)=>['Select Reasoning Level for GPT-5.6-Terra',...['Low','Medium','High'].map((name,i)=>`${selected===i+1?'›':''} ${i+1}. ${name}${current===i+1?' (current)':''}  Detail`),'enter default · s session · esc back'];
test('native parsers require recognized picker, cursor, current marker and session-only footer',()=>{
 assert.equal(parseModelMenu(codexModels(),'codex').current.id,'gpt-5.6-terra');assert.equal(parseEffortMenu(codexEfforts()).current.id,'medium');assert.equal(parseEffortMenu(['Select Reasoning Level for x','› 1. Medium','enter select']),null);
 const claude=['Select model',' 1. Opus 5.5  Complex','❯ 2. Sonnet 5.5 ✔  Efficient','◐ High effort (default) ←/→ to adjust','Enter to set as default · s to use this session only · Esc to cancel'];assert.equal(parseModelMenu(claude,'claude').effort,'high');assert.equal(parseModelMenu(claude,'claude').current.id,'sonnet-5.5');assert.equal(parseModelMenu(['assistant quoted: Select model',...claude.slice(1)],'claude'),null);
});
test('Codex applies with s, reads actual result again, and closes both menu levels',async()=>{
 let state='idle',selectedModel=1,currentModel=1,selectedEffort=2,currentEffort=2;const keys=[];
 const transport={preflight:async()=>({ok:state==='idle'}),read:async()=>state==='idle'?['idle']:state==='model'?codexModels(selectedModel,currentModel):codexEfforts(selectedEffort,currentEffort),key:async(b,key)=>{keys.push(key);if(key==='model'){state='model';selectedModel=currentModel;}else if(key==='enter'){assert.equal(state,'model');state='effort';selectedEffort=currentEffort;}else if(key==='down'){if(state==='model')selectedModel++;else selectedEffort++;}else if(key==='up'){if(state==='model')selectedModel--;else selectedEffort--;}else if(key==='session'){assert.equal(state,'effort');currentModel=selectedModel;currentEffort=selectedEffort;state='idle';}else if(key==='escape')state=state==='effort'?'model':'idle';}};
 const adapter=createNativeModelSettings({transport}),result=await adapter.apply({}, {provider:'codex'},{model:'gpt-5.6-luna',effort:'high'});assert.equal(result.model,'gpt-5.6-luna');assert.equal(result.effort,'high');assert.equal(state,'idle');assert.equal(keys.filter(x=>x==='session').length,1);assert.deepEqual(keys.slice(-2),['escape','escape']);
});
test('concurrent native menu edits stop before any setting key is sent',async()=>{
 let reads=0;const keys=[];const adapter=createNativeModelSettings({transport:{read:async()=>++reads===1?codexModels():codexModels(2),key:async(b,k)=>keys.push(k)}});await assert.rejects(adapter.apply({}, {provider:'codex'},{model:'gpt-5.6-luna',effort:'high'}),/화면이 변경/);assert.deepEqual(keys,['model']);
});
test('advanced effort navigation is recognized without granting session apply to the More row',()=>{
 const lines=['Select Reasoning Level for GPT-5.6-Luna','1. Medium (current)  Detail','› 5. More reasoning…  Max consumes usage limits faster','enter select · esc back'];assert.equal(parseEffortMenu(lines).selected.id,'more');assert.equal(parseEffortMenu(['Advanced Reasoning','› 1. Max  Higher usage','enter default · s session · esc back']).selected.id,'max');
});
test('Claude cache confirmation is distinct from billing or arbitrary prompts',()=>{
 const lines=['Switch model?','This conversation is cached. The full history gets re-read on your next message.','❯ 1. Yes, switch to Haiku 5.5','2. No, go back'];assert.equal(parseSwitchConfirmation(lines).target,'Haiku 5.5');assert.equal(parseSwitchConfirmation([...lines.slice(0,2),'Requires billing credits',...lines.slice(2)]),null);
});
test('background transcript updates do not cancel a stable native selection',async()=>{
 let mode='idle',count=0;const adapter=createNativeModelSettings({transport:{preflight:async()=>({ok:true}),read:async()=>mode==='model'?[`background ${++count}`,...codexModels()]:mode==='effort'?[`background ${++count}`,...codexEfforts()]:['idle'],key:async(b,k)=>{if(k==='model')mode='model';else if(k==='enter')mode='effort';else if(k==='escape')mode=mode==='effort'?'model':'idle';}}});const result=await adapter.inspect({}, {provider:'codex'});assert.equal(result.effort,'medium');assert.equal(mode,'idle');
});
test('active binding guard runs before every native settings read and key',async()=>{
 let valid=true;const keys=[];const adapter=createNativeModelSettings({transport:{read:async()=>{valid=false;return codexModels();},key:async(b,k)=>keys.push(k)}}).withGuard(()=>{if(!valid)throw Error('binding replaced');});await assert.rejects(adapter.apply({}, {provider:'codex'},{model:'gpt-5.6-luna',effort:'high'}),/binding replaced/);assert.deepEqual(keys,['model']);
});
test('guarded picker retains completed-prompt proof when checking the closed composer',async()=>{
 let mode='idle';const proofs=[],evidence={completedPrompts:['completed wake']};
 const adapter=createNativeModelSettings({transport:{preflight:async(b,s,proof)=>{proofs.push(proof);return {ok:true}},read:async()=>mode==='model'?codexModels():mode==='effort'?codexEfforts():['idle'],key:async(b,key)=>{if(key==='model')mode='model';else if(key==='enter')mode='effort';else if(key==='escape')mode=mode==='effort'?'model':'idle';}}}).withGuard(()=>{},evidence);
 const result=await adapter.inspect({}, {provider:'codex'});assert.equal(result.effort,'medium');assert.ok(proofs.length);assert.ok(proofs.every(proof=>proof===evidence));assert.equal(mode,'idle');
});
