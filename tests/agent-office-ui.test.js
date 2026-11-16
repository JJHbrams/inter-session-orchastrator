import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAgentOffice} from '../apps/desktop/agent-office.js';

function fixture(){
 const dom=new JSDOM('<body><div id="host"></div></body>',{pretendToBeVisual:true});
 const prior={raf:globalThis.requestAnimationFrame,caf:globalThis.cancelAnimationFrame,performance:globalThis.performance,CSS:globalThis.CSS};
 globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0); globalThis.cancelAnimationFrame=clearTimeout; globalThis.CSS={escape:value=>String(value)};
 const calls=[]; const storage={value:null,getItem(){return this.value},setItem(_,value){this.value=value}};
 const office=createAgentOffice({document:dom.window.document,host:dom.window.document.querySelector('#host'),storage,onSelect:value=>calls.push(value),matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}})});
 return {dom,office,calls,restore(){Object.assign(globalThis,{requestAnimationFrame:prior.raf,cancelAnimationFrame:prior.caf,performance:prior.performance,CSS:prior.CSS})}};
}
test('renders factual sprites and routes child selection to its parent',()=>{const f=fixture();try{f.office.setSnapshot({agents:[{id:'parent',sessionId:'s1',membershipId:'m1',parentId:null,label:'Claude',provider:'claude',kind:'session',state:'running',activity:'reading',zone:'library'},{id:'child',sessionId:'s2',membershipId:'m2',parentId:'parent',label:'Codex helper',provider:'codex',kind:'subagent',state:'queued',activity:'coding',zone:'development'}]});const nodes=f.dom.window.document.querySelectorAll('.office-agent');assert.equal(nodes.length,2);assert.match(nodes[0].getAttribute('aria-label'),/책 읽는 중/);nodes[1].click();assert.deepEqual(f.calls,[{sessionId:null,membershipId:null,parentId:'parent',id:'parent'}]);}finally{f.office.destroy();f.restore();}});
test('collapse persists and destroy removes the office without animation work',()=>{const f=fixture();try{const button=f.dom.window.document.querySelector('.office-controls button:last-child');button.click();assert.equal(f.dom.window.document.querySelector('.agent-office').dataset.collapsed,'true');assert.match(f.dom.window.document.querySelector('.office-controls button:last-child').textContent,/펼치기/);f.office.destroy();assert.equal(f.dom.window.document.querySelector('.agent-office'),null);}finally{f.restore();}});
