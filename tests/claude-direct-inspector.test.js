import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {sessionPresentation,renderSessionDetail} from '../apps/desktop/session-inspector.js';

test('direct Claude detail preserves original identity and hides terminal-only controls',()=>{
 const member={id:'m',session_id:'s',alias:'Claude',provider:'claude',mode:'resume',handle:'original-id',incarnation:'direct:1',native_id:'original-id',cwd:'C:/original',ownership:'borrowed',capabilities:{transport:'claude-direct',automaticInput:true,followup:true,rawInspect:false,mcpPull:false}},room={id:'r',members:[member],deliveries:[{membership_id:'m',kind:'followup',state:'queued',blocked_reason:'native_session_busy'}],chair:null,chair_runs:[]},view=sessionPresentation(room,member),document=new JSDOM('<main/>').window.document;
 const result=renderSessionDetail({document,room,member,view,avatar:()=>document.createElement('span'),actions:{automation:()=>{},leave:()=>{},settings:()=>{},output:()=>{},provision:()=>{},recheck:()=>{},reconcile:()=>{}}});document.body.append(result.element);const text=result.element.textContent;
 assert.match(text,/원래 Claude 대화 직접 이어가기/);assert.match(text,/original-id/);assert.match(text,/C:\/original/);assert.match(text,/기존 실행이 있으면/);assert.ok([...result.element.querySelectorAll('button')].some(x=>/자동 전달/.test(x.textContent)));assert.equal(result.element.querySelector('.session-settings-action'),null);assert.equal([...result.element.querySelectorAll('button')].some(x=>/원래 출력 보기|참여 정보 발급/.test(x.textContent)),false);assert.equal(view.state,'blocked');
});
