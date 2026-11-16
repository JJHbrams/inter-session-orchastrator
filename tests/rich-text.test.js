import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import createDOMPurify from 'dompurify';
import {createRenderer,createMentionInput,createReferenceMap} from '../apps/desktop/rich-text.js';
import {mentionSpans} from '../packages/contracts/mentions.js';
import {marked} from 'marked';

test('mention input paints resolved ranges without replacing native editing or interpreting HTML',()=>{
 const dom=new JSDOM('<form><label>Message<textarea id="draft"></textarea></label></form>'),doc=dom.window.document,textarea=doc.querySelector('textarea');
 const aliases=new Set(['수아','마야','유리아']);
 const source='@수아 @마야 @유리아 @미등록 email@수아 `@마야` \\@유리아 <img src=x onerror=bad()>\n끝';
 textarea.value=source;textarea.setSelectionRange(3,7);
 const input=createMentionInput({textarea,getSpans:value=>mentionSpans(value).filter(span=>aliases.has(span.alias))});
 const backdrop=doc.querySelector('.mention-backdrop');
 assert.deepEqual([...backdrop.querySelectorAll('.mention')].map(x=>x.textContent),['@수아','@마야','@유리아']);
 assert.equal(backdrop.getAttribute('aria-hidden'),'true');assert.equal(backdrop.querySelector('img'),null);
 assert.equal(textarea.value,source);assert.equal(doc.querySelector('#draft'),textarea);assert.equal(textarea.form,doc.querySelector('form'));
 assert.equal(textarea.selectionStart,3);assert.equal(textarea.selectionEnd,7);
 textarea.value='수정 @수아';textarea.dispatchEvent(new dom.window.Event('input'));
 assert.equal(backdrop.querySelector('.mention').textContent,'@수아');
 aliases.delete('수아');input.render();assert.equal(backdrop.querySelector('.mention'),null);
 textarea.scrollTop=20;textarea.dispatchEvent(new dom.window.Event('scroll'));assert.equal(backdrop.scrollTop,20);
});

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

const peer={id:'11111111-1111-4111-8111-111111111111',session_id:'22222222-2222-4222-8222-222222222222',native_id:'33333333-3333-4333-8333-333333333333',alias:'노아'},post={id:'860a2cc0-c7ff-4a6d-b1a4-86c6144f2926',sender_session_id:peer.session_id};
function referenceRender(source,messages=[post]){const dom=new JSDOM('<!doctype html>',{url:'http://local.test/'}),purify=createDOMPurify(dom.window),holder=dom.window.document.createElement('div'),render=createRenderer({parse:s=>marked.parse(s),sanitize:purify.sanitize.bind(purify),document:dom.window.document});holder.append(render(source,{roomId:'r',mentions:[peer.alias],references:createReferenceMap([peer],messages)}));return holder;}

test('known routing identities display aliases and message IDs become exact original links',()=>{
 const source=`노아 ${post.id.slice(0,8)}와 ${post.id}, @${peer.id}, ${peer.session_id}, ${peer.native_id} 참고`;
 const rendered=referenceRender(source),links=[...rendered.querySelectorAll('a')];
 assert.equal(links.length,2);assert.ok(links.every(a=>a.getAttribute('href')==='#message-'+post.id&&a.textContent==='@노아의 발언'&&a.title.includes(post.id)));
 assert.equal(rendered.querySelectorAll('.mention').length,5);assert.ok(!rendered.textContent.includes('노아 @노아'));assert.ok(!rendered.textContent.includes(peer.session_id));assert.ok(source.includes(post.id));
 assert.ok(rendered.textContent.includes('@노아의 발언과 '));assert.ok(referenceRender(post.id.slice(0,8)+'를 참고').textContent.includes('@노아의 발언을 참고'));
});

test('reference presentation preserves code, existing links, file paths and longer hashes',()=>{
 const short=post.id.slice(0,8),source='`'+post.id+'` [original](#message-'+post.id+') /data/'+short+' '+short+'abcd foreign aaaaaaaa';
 const rendered=referenceRender(source);assert.equal(rendered.querySelector('code').textContent,post.id);assert.equal(rendered.querySelector('a').getAttribute('href'),'#message-'+post.id);assert.equal(rendered.querySelector('a').textContent,'original');assert.ok(rendered.textContent.includes('/data/'+short+' '+short+'abcd foreign aaaaaaaa'));assert.equal(rendered.querySelectorAll('.mention').length,0);
});

test('ambiguous short source IDs remain unchanged while full IDs stay resolvable',()=>{
 const other={...post,id:post.id.replace('c7ff','9999')},rendered=referenceRender(post.id.slice(0,8)+' '+post.id,[post,other]);assert.ok(rendered.textContent.startsWith('860a2cc0 '));assert.equal(rendered.querySelectorAll('a').length,1);assert.equal(rendered.querySelector('a').getAttribute('href'),'#message-'+post.id);
});
