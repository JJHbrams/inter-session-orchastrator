import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {CHANNEL_NAV_STORAGE_KEY,UNASSIGNED_CHANNEL_KEY,bindChannelDisclosure,createChannelNav,expandParentForNewRoom,syncRoomChannelOptions} from '../apps/desktop/channel-nav.js';

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

test('room channel choice and option nodes survive repeated unchanged background refreshes',()=>{
 const dom=new JSDOM('<form><select name="channelId"></select></form>'),select=dom.window.document.querySelector('select');
 const channels=[{id:'a',name:'개발'},{id:'b',name:'설계'}];
 syncRoomChannelOptions(select,channels);select.value='b';select.focus();
 const selected=select.selectedOptions[0];
 for(let poll=0;poll<4;poll++)syncRoomChannelOptions(select,channels.map(channel=>({...channel})));
 assert.equal(select.value,'b');assert.equal(select.selectedOptions[0],selected);
 assert.equal(dom.window.document.activeElement,select);
 assert.equal(new dom.window.FormData(select.form).get('channelId'),'b');
});

test('room channel choice follows its stable id through renames, insertion and reordering',()=>{
 const dom=new JSDOM('<select></select>'),select=dom.window.document.querySelector('select');
 syncRoomChannelOptions(select,[{id:'a',name:'개발'},{id:'b',name:'설계'}]);select.value='b';
 syncRoomChannelOptions(select,[{id:'c',name:'새 채널'},{id:'b',name:'이름 변경'},{id:'a',name:'개발'}]);
 assert.equal(select.value,'b');assert.equal(select.selectedOptions[0].textContent,'이름 변경');
 select.value='';syncRoomChannelOptions(select,[{id:'b',name:'이름 변경'}]);assert.equal(select.value,'');
});

test('room channel choice clears only when the selected channel is removed or archived',()=>{
 const dom=new JSDOM('<select></select>'),select=dom.window.document.querySelector('select');
 syncRoomChannelOptions(select,[{id:'a',name:'개발'},{id:'b',name:'설계'}]);select.value='b';
 syncRoomChannelOptions(select,[{id:'a',name:'개발'},{id:'b',name:'설계',archived_at:'2026-11-03T00:00:00Z'}]);
 assert.equal(select.value,'');assert.deepEqual([...select.options].map(option=>option.value),['','a']);
 select.value='a';syncRoomChannelOptions(select,[]);assert.equal(select.value,'');
});
