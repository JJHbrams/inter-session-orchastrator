import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {matchingRuntimeSessions,nativeChatInvitation,mergeNativeCatalogSessions} from '../apps/desktop/session-choice.js';
import {renderSessionDetail,sessionPresentation} from '../apps/desktop/session-inspector.js';

const native={provider:'codex',host:'orca/local',nativeId:'chat-42',cwd:'C:/work',profile:'default',title:'Existing chat',handle:'actor-42',incarnation:'runtime:fence',verified:true,mode:'live_attach',capabilities:{transport:'orca-native-chat',automaticInput:true,followup:true,rawInspect:false}};

test('native chat invitation retains the exact discovered identity and never enters terminal choices',()=>{
 assert.deepEqual(nativeChatInvitation(native),{provider:'codex',nativeId:'chat-42',cwd:'C:/work',handle:'actor-42',incarnation:'runtime:fence'});
 assert.deepEqual(matchingRuntimeSessions([native,{...native,capabilities:{},nativeId:'terminal'}],'codex','C:/work').map(s=>s.nativeId),['terminal']);
});

test('native discovery upgrades same-identity catalog metadata without duplicate terminal candidates',()=>{
 const prior={provider:'codex',nativeId:'chat-42',cwd:'C:/work',title:'Saved alias',capabilities:{}},other={provider:'claude',nativeId:'other',cwd:'C:/work',title:'Other'};
 const result=mergeNativeCatalogSessions([prior,other],[native]);
 assert.deepEqual(result.map(item=>item.nativeId),['other','chat-42']);
 assert.equal(result[1].title,'Existing chat');
 assert.equal(result[1].live,true);
 assert.equal(result[1].capabilities.transport,'orca-native-chat');
 assert.deepEqual(mergeNativeCatalogSessions([prior],[native],'existing').map(item=>item.nativeId),['chat-42']);
});

test('native chat inspector describes direct attachment and disables terminal-only controls',()=>{
 const member={id:'m',session_id:'s',alias:'Existing chat',provider:'codex',native_id:native.nativeId,cwd:native.cwd,mode:'live_attach',handle:native.handle,incarnation:native.incarnation,capabilities:native.capabilities,modelSettings:{observed:{model:'gpt',effort:'high'}}};
 const room={id:'r',members:[member],deliveries:[],chair:null,chair_runs:[]},document=new JSDOM('<main></main>').window.document;
 const view=sessionPresentation(room,member),result=renderSessionDetail({document,room,member,view,avatar:()=>document.createElement('span'),actions:{settings(){},output(){},automation(){},provision(){},leave(){},recheck(){},reconcile(){}}});
 assert.equal(view.settingsAllowed,false);
 assert.match(result.element.textContent,/기존 Orca 채팅 직접 연결/);
 assert.equal(result.element.querySelector('.session-settings-action').disabled,true);
 assert.equal([...result.element.querySelectorAll('button')].some(b=>b.textContent==='원래 출력 보기'),false);
 assert.ok([...result.element.querySelectorAll('button')].some(b=>b.textContent.includes('자동 전달')));
 assert.equal([...result.element.querySelectorAll('button')].some(b=>b.textContent==='참여 정보 발급'),false);
});

test('server reserves native registration for verification endpoint and routes native deliveries',async()=>{
 const source=await readFile(new URL('../services/coordinator/server.js',import.meta.url),'utf8');
 assert.match(source,/\/api\/sessions\/native-chat/);
 assert.match(source,/nativeChatAdapter\.verify\(\{provider:b\.provider,nativeId:b\.nativeId,cwd:b\.cwd,handle:b\.handle\|\|null,incarnation:b\.incarnation\|\|null\}\)/);
 assert.match(source,/native chat invitations must use \/api\/sessions\/native-chat/);
 assert.match(source,/claudeDirectBinding\(binding\)\?direct:nativeChatBinding\(binding\)\?native:terminal/);
 assert.match(source,/automaticInput:b\.automaticInput===true/);
 const app=await readFile(new URL('../apps/desktop/app.js',import.meta.url),'utf8');
 assert.match(app,/\{\.\.\.nativeChat,automaticInput:autoRow\.input\.checked\}/);
});
