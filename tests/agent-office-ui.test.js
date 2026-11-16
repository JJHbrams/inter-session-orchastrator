import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAgentOffice} from '../apps/desktop/agent-office.js';

function fixture({ready = Promise.resolve()} = {}) {
  const dom = new JSDOM('<body><div class="workspace"><div id="host"></div></div></body>');
  const calls = [], storage = {value: null, getItem() { return this.value; }, setItem(_, value) { this.value = value; }};
  const fakeScene = ({host}) => ({readyPromise: ready, setSnapshot: value => calls.push(['snapshot', value]), setRoom: value => calls.push(['room', value]), setConnection: value => calls.push(['connection', value]), setPresentation: value => calls.push(['presentation', value]), destroy: () => calls.push(['destroy'])});
  const media = {matches: false, addEventListener(_, listener) { this.listener = listener; }, removeEventListener() { this.removed = true; }};
  const office = createAgentOffice({document: dom.window.document, host: dom.window.document.querySelector('#host'), storage, matchMedia: () => media, sceneFactory: fakeScene});
  return {dom, calls, storage, media, office};
}

test('queues snapshot and room state until the async Pixi scene is ready', async () => {
  let resolve; const f = fixture({ready: new Promise(done => { resolve = done; })});
  f.office.setSnapshot({agents: [{id: 'a'}]}); f.office.setRoom('room-1'); f.office.setConnection(false);
  assert.equal(f.calls.length, 0);
  resolve(); await f.office.readyPromise;
  assert.deepEqual(f.calls.slice(1, 4), [['snapshot', {agents: [{id: 'a'}]}], ['room', 'room-1'], ['connection', false]]);
  assert.match(f.dom.window.document.querySelector('.office-header small').textContent, /연결 확인 중/);
  f.office.destroy();
});

test('forwards presentation preferences and keeps card aria state accurate', async () => {
  const f = fixture(); await f.office.readyPromise;
  const buttons = f.dom.window.document.querySelectorAll('.office-controls button');
  buttons[0].click(); assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  buttons[2].click(); assert.equal(buttons[2].getAttribute('aria-expanded'), 'false');
  assert.deepEqual(JSON.parse(f.storage.value), {expanded: false, collapsed: true});
  f.media.matches = true; f.media.listener();
  assert.ok(f.calls.some(([method, value]) => method === 'presentation' && value.collapsed && value.reducedMotion));
  f.office.destroy();
});
