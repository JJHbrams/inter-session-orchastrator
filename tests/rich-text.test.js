import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
import {createRenderer} from '../apps/desktop/rich-text.js';

test('renderer preserves static formatting and removes hostile markup',()=>{
 const dom=new JSDOM('<!doctype html>',{url:'http://local.test/'}),purify=createDOMPurify(dom.window);
 const render=createRenderer({parse:s=>s,sanitize:purify.sanitize.bind(purify),document:dom.window.document});
 const holder=dom.window.document.createElement('div');holder.append(render('<h2>Heading</h2><strong>ok</strong><img src="https://bad.test/x"><img src="/api/rooms/r/attachments/a"><a href="javascript:alert(1)">bad</a><svg onload="x()"></svg><p id="clobber" onclick="x()">@alice</p>',{roomId:'r',mentions:['alice']}));
 assert.equal(holder.querySelector('h2').textContent,'Heading');
 assert.equal(holder.querySelector('svg'),null);assert.equal(holder.querySelector('[onclick]'),null);assert.equal(holder.querySelector('[id]'),null);
 assert.equal(holder.querySelectorAll('img').length,1);assert.equal(holder.querySelector('img').getAttribute('src'),'/api/rooms/r/attachments/a');
 assert.equal([...holder.querySelectorAll('a')].find(a=>a.textContent==='bad').hasAttribute('href'),false);assert.equal(holder.querySelector('.mention').textContent,'@alice');
});
