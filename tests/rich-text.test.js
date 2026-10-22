import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
import {createRenderer} from '../apps/desktop/rich-text.js';
import {marked} from 'marked';

test('real Markdown parser formats tables/code and purifier blocks executable HTML and remote images',()=>{
 const dom=new JSDOM('<!doctype html>',{url:'http://local.test/'}),purify=createDOMPurify(dom.window),doc=dom.window.document;
 const render=createRenderer({parse:s=>marked.parse(s,{gfm:true}),sanitize:purify.sanitize.bind(purify),document:doc}),holder=doc.createElement('div');
 holder.append(render('## 제목\n\n**강조**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\n@alice <script>x()</script>\n```\n\n<p onclick="x()" style="display:none">@alice</p><iframe srcdoc="x"></iframe><form><input name="body"></form><math><mtext>x</mtext></math><img src="data:image/svg+xml,x"><img src="https://remote.test/pixel"><a href="java&#x73;cript:alert(1)">bad</a>',{roomId:'r',mentions:['alice']}));
 assert.equal(holder.querySelector('h2').textContent,'제목');assert.equal(holder.querySelector('strong').textContent,'강조');assert.equal(holder.querySelectorAll('td').length,2);assert.ok(holder.querySelector('pre code').textContent.includes('<script>'));
 assert.equal(holder.querySelectorAll('script,iframe,form,input,math,svg,img,[style],[onclick],[name]').length,0);assert.equal(holder.querySelector('a').hasAttribute('href'),false);assert.equal(holder.querySelectorAll('.mention').length,1);
});

test('renderer preserves static formatting and removes hostile markup',()=>{
 const dom=new JSDOM('<!doctype html>',{url:'http://local.test/'}),purify=createDOMPurify(dom.window);
 const render=createRenderer({parse:s=>s,sanitize:purify.sanitize.bind(purify),document:dom.window.document});
 const holder=dom.window.document.createElement('div');holder.append(render('<h2>Heading</h2><strong>ok</strong><img src="https://bad.test/x"><img src="/api/rooms/r/attachments/a"><a href="javascript:alert(1)">bad</a><svg onload="x()"></svg><p id="clobber" onclick="x()">@alice</p>',{roomId:'r',mentions:['alice']}));
 assert.equal(holder.querySelector('h2').textContent,'Heading');
 assert.equal(holder.querySelector('svg'),null);assert.equal(holder.querySelector('[onclick]'),null);assert.equal(holder.querySelector('[id]'),null);
 assert.equal(holder.querySelectorAll('img').length,1);assert.equal(holder.querySelector('img').getAttribute('src'),'/api/rooms/r/attachments/a');
 assert.equal([...holder.querySelectorAll('a')].find(a=>a.textContent==='bad').hasAttribute('href'),false);assert.equal(holder.querySelector('.mention').textContent,'@alice');
});
