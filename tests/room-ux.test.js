import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const root=new URL('..',import.meta.url);

test('room creation exposes its workspace and advances to session selection',async()=>{
 const html=await readFile(new URL('apps/desktop/index.html',root),'utf8');
 const dom=new JSDOM(html),doc=dom.window.document;
 assert.ok(doc.querySelector('#roomCwd'));
 assert.ok(doc.querySelector('#workspaceButton'));
 assert.ok(doc.querySelector('#workspaceDetail'));
 const app=await readFile(new URL('apps/desktop/app.js',root),'utf8');
 assert.match(app,/await openRoom\(r\.id\);showDiscovery\(\)/);
});

test('manual runtime binding requires an explicit terminal confirmation',async()=>{
 const app=await readFile(new URL('apps/desktop/app.js',root),'utf8');
 assert.match(app,/req\('\/api\/discovery'\)/);
 assert.match(app,/session\.provider===provider\.value&&session\.cwd===cwd\.value/);
 assert.match(app,/선택한 터미널이 위 대화 ID의 세션인지 확인했어요/);
 assert.match(app,/const verified=Boolean\(exactBinding\|\|\(selectedBinding&&confirmation\.input\.checked\)\)/);
 assert.match(app,/handle:writable\?binding\?\.handle\|\|null:null/);
});
