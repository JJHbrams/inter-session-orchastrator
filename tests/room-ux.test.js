import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {matchingRuntimeSessions,verifiedRuntimeBinding} from '../apps/desktop/session-choice.js';

const root=new URL('..',import.meta.url);

test('room creation exposes its workspace and starts chair onboarding before session selection',async()=>{
 const html=await readFile(new URL('apps/desktop/index.html',root),'utf8');
 const dom=new JSDOM(html),doc=dom.window.document;
 assert.ok(doc.querySelector('#roomCwd'));
 assert.ok(doc.querySelector('#workspaceButton'));
 assert.ok(doc.querySelector('#workspaceDetail'));
 const app=await readFile(new URL('apps/desktop/app.js',root),'utf8');
 assert.match(app,/await openRoom\([A-Za-z_$][\w$]*\.id\);\s*if\(current\?\.id===[A-Za-z_$][\w$]*\.id\)await chairSettingsDialog\(\{onboarding:true\}\)/);
 assert.match(app,/if\(onboarding&&!chair&&current\?\.id===roomId\)showDiscovery\(\)/);
 assert.match(app,/textContent='나중에 설정'/);
 assert.match(app,/토론장은 생성됐지만 좌장 설정 옵션을 불러오지 못했어요/);
 assert.match(app,/if\(signature===participantRenderSignature\)return/);
});

test('manual runtime binding requires an explicit terminal confirmation',async()=>{
 const terminal={provider:'codex',cwd:'C:/Work/Project/',handle:'term_exact',incarnation:'current'};
 const candidates=matchingRuntimeSessions([terminal,{...terminal,provider:'claude'},{...terminal,cwd:'C:/Work/Other'},{...terminal,incarnation:null}],'codex','c:\\work\\project');
 assert.deepEqual(candidates,[terminal]);
 assert.deepEqual(matchingRuntimeSessions([terminal],'codex','\\\\?\\C:\\Work\\Project'),[terminal]);
 assert.equal(verifiedRuntimeBinding(null,candidates[0],false),false);
 assert.equal(verifiedRuntimeBinding(null,null,true),false);
 assert.equal(verifiedRuntimeBinding(null,candidates[0],true),true);
 assert.equal(verifiedRuntimeBinding({...terminal,incarnation:null},null,true),false);
 assert.equal(verifiedRuntimeBinding(terminal,null,false),true);
});
