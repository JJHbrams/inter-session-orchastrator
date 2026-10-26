import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {CHANNEL_NAV_STORAGE_KEY,UNASSIGNED_CHANNEL_KEY,bindChannelDisclosure,createChannelNav,expandParentForNewRoom} from '../apps/desktop/channel-nav.js';

function disclosure(state,key='channel-a'){
 const dom=new JSDOM('<button type="button" aria-controls="children"><span class="channel-chevron"></span>개발</button><div id="children"></div>');
 const button=dom.window.document.querySelector('button'),group=dom.window.document.querySelector('#children');
 bindChannelDisclosure({button,group,state,key});
 return {button,group};
}

test('a channel disclosure changes only its own child group and persists by stable channel id',()=>{
 const dom=new JSDOM('',{url:'https://rooms.test'}),state=createChannelNav(dom.window.localStorage);
 const first=disclosure(state,'channel-a'),second=disclosure(state,'channel-b');
 first.button.click();
 assert.equal(first.group.hidden,true);assert.equal(first.button.getAttribute('aria-expanded'),'false');assert.equal(first.button.querySelector('.channel-chevron').textContent,'▸');
 assert.equal(second.group.hidden,false);assert.equal(second.button.getAttribute('aria-expanded'),'true');
 assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(CHANNEL_NAV_STORAGE_KEY)),{'channel-a':false});
 const reloaded=disclosure(createChannelNav(dom.window.localStorage),'channel-a');
 assert.equal(reloaded.group.hidden,true);
});

test('the native button remains the sole disclosure action while menu invocation events do not change state',()=>{
 const dom=new JSDOM('',{url:'https://rooms.test'}),view=disclosure(createChannelNav(dom.window.localStorage));
 view.button.dispatchEvent(new dom.window.MouseEvent('contextmenu',{button:2,bubbles:true}));
 assert.equal(view.group.hidden,false);
 view.button.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}));
 assert.equal(view.group.hidden,false);
 view.button.click();
 assert.equal(view.group.hidden,true);
 view.button.click();
 assert.equal(view.group.hidden,false);
});

test('malformed or denied local storage falls back to in-memory default-expanded state',()=>{
 const malformed={getItem:()=>'{bad json',setItem:()=>{throw Error('denied');}},state=createChannelNav(malformed);
 assert.equal(state.expanded('channel-a'),true);state.toggle('channel-a');assert.equal(state.expanded('channel-a'),false);
 const unassigned=disclosure(state,UNASSIGNED_CHANNEL_KEY);
 assert.equal(unassigned.group.hidden,false);unassigned.button.click();assert.equal(unassigned.group.hidden,true);
});

test('creating a room reopens its assigned or unassigned parent without changing another collapsed group',()=>{
 const state=createChannelNav({getItem:()=>null,setItem:()=>{}});
 state.setExpanded('channel-a',false);state.setExpanded(UNASSIGNED_CHANNEL_KEY,false);state.setExpanded('channel-b',false);
 expandParentForNewRoom(state,'channel-a');
 assert.equal(state.expanded('channel-a'),true);assert.equal(state.expanded(UNASSIGNED_CHANNEL_KEY),false);assert.equal(state.expanded('channel-b'),false);
 expandParentForNewRoom(state,null);
 assert.equal(state.expanded(UNASSIGNED_CHANNEL_KEY),true);assert.equal(state.expanded('channel-b'),false);
});
