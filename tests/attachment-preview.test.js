import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {createRenderer} from '../apps/desktop/rich-text.js';
import {createAttachmentViewer,renderSharedAttachments,attachmentKind} from '../apps/desktop/attachments.js';
const settle=()=>new Promise(r=>setImmediate(r));
function fixture(fetcher){const dom=new JSDOM('<body></body>',{url:'http://localhost/'}),document=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};const calls=[],revoked=[],created=[],renderMarkdown=createRenderer({document,parse:source=>marked.parse(source),sanitize:DOMPurify(dom.window).sanitize});let auth=0;const viewer=createAttachmentViewer({document,fetcher:async(path,options)=>{calls.push({path,options});return fetcher(path,options)},authenticate:async()=>{auth++},renderMarkdown,urlAPI:{createObjectURL:blob=>{created.push(blob);return 'blob:test'},revokeObjectURL:url=>revoked.push(url)}});return {dom,document,viewer,calls,revoked,created,auth:()=>auth};}
const textResponse=text=>new Response(text);

test('Markdown and hostile HTML preview render safely, preserve source and keep a separate exact download',async()=>{
 const raw='# 주장\n\n| 근거 | 상태 |\n|---|---|\n| 코드 | 확인 |\n\n<script>bad()</script><img src="https://evil.test/x" onerror="bad()"><form><input></form>';
 const f=fixture(()=>textResponse(raw));await f.viewer.open('room',{id:'file',filename:'source.md',size:120});const d=f.document.querySelector('dialog');assert.equal(d.querySelector('h1').textContent,'주장');assert.ok(d.querySelector('table'));assert.equal(d.querySelector('script,form form,iframe,input,img'),null);assert.equal(f.calls[0].path,'/api/rooms/room/attachments/file');assert.equal(f.calls[0].options.credentials,'same-origin');assert.equal(d.querySelector('a[download]').getAttribute('href'),'/api/rooms/room/attachments/file?download=1');
 d.querySelector('.attachment-preview-toolbar button').click();assert.equal(d.querySelector('pre code').textContent,raw);d.querySelector('.attachment-preview-toolbar button').click();assert.ok(d.querySelector('.rich-body table'));d.querySelector('footer button').click();assert.equal(f.document.querySelector('dialog'),null);f.dom.window.close();
});

test('image preview uses a revocable blob and can switch between fitted and original size',async()=>{
 const f=fixture(()=>new Response(new Uint8Array([137,80,78,71])));await f.viewer.open('room',{id:'img',filename:'plot.png',mime:'image/png'});const d=f.document.querySelector('dialog');assert.equal(d.querySelector('img').getAttribute('src'),'blob:test');assert.equal(f.created.length,1);d.querySelector('.attachment-preview-toolbar button').click();assert.equal(d.querySelector('.image-preview').classList.contains('natural-size'),true);d.close();assert.deepEqual(f.revoked,['blob:test']);f.dom.window.close();
});

test('expired local auth refreshes once and retries only the same attachment GET',async()=>{
 let count=0;const f=fixture(()=>++count===1?new Response('',{status:401}):textResponse('本文'));await f.viewer.open('r',{id:'id',filename:'note.txt'});assert.equal(f.auth(),1);assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.path==='/api/rooms/r/attachments/id'&&!c.options.method));assert.equal(f.document.querySelector('pre').textContent,'本文');f.dom.window.close();
});

test('unsupported formats and untrusted filenames stay literal and do not execute or fetch',async()=>{
 const f=fixture(()=>assert.fail('unsupported preview must not fetch')),file={id:'x',filename:'<script>bad</script>.pdf'};const list=renderSharedAttachments({document:f.document,roomId:'r',attachments:[file],onOpen:(room,item)=>f.viewer.open(room,item)});f.document.body.append(list);list.querySelector('button').click();await settle();assert.equal(f.document.querySelector('script'),null);assert.match(f.document.querySelector('h2').textContent,/<script>/);assert.match(f.document.querySelector('.reader-empty').textContent,/아직/);assert.equal(attachmentKind({filename:'x.svg',mime:'image/svg+xml'}),'file');f.dom.window.close();
});

test('closing a pending preview aborts it and late content never replaces the next document',async()=>{
 let resolve;const f=fixture(path=>path.endsWith('/old')?new Promise(r=>{resolve=r}):textResponse('# 새 자료'));const old=f.viewer.open('r',{id:'old',filename:'old.md'});await settle();await f.viewer.open('r',{id:'new',filename:'new.md'});assert.equal(f.calls[0].options.signal.aborted,true);resolve(textResponse('# 이전 자료'));await old;assert.equal(f.document.querySelectorAll('dialog').length,1);assert.equal(f.document.querySelector('h1').textContent,'새 자료');f.dom.window.close();
});

test('long text is explicitly partial and invalid UTF-8 does not pretend to be a rendered document',async()=>{
 const f=fixture(()=>textResponse('가'.repeat(160010)));await f.viewer.open('r',{id:'long',filename:'long.txt'});assert.equal(f.document.querySelector('pre code').textContent.length,160000);assert.equal(f.document.querySelector('.attachment-preview-notice').hidden,false);f.dom.window.close();
 const g=fixture(()=>new Response(new Uint8Array([0xff,0xfe])));await g.viewer.open('r',{id:'bad',filename:'bad.md'});assert.match(g.document.querySelector('.form-error').textContent,/UTF-8/);assert.equal(g.document.querySelector('pre'),null);g.dom.window.close();
});
