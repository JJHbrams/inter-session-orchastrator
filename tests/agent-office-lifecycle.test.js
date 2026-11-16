import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createAgentOffice} from '../apps/desktop/agent-office.js';

test('room reset clears the shell immediately and destroy detaches scene and listeners', async () => {
  const dom = new JSDOM('<body><div id="host"></div></body>');
  const calls = [], media = {matches: false, addEventListener(_, listener) { this.listener = listener; }, removeEventListener() { calls.push(['media-remove']); }};
  const sceneFactory = () => ({readyPromise: Promise.resolve(), setSnapshot: value => calls.push(['snapshot', value]), setRoom: value => calls.push(['room', value]), setConnection: value => calls.push(['connection', value]), setPresentation: value => calls.push(['presentation', value]), destroy: () => calls.push(['destroy'])});
  const office = createAgentOffice({document: dom.window.document, host: dom.window.document.querySelector('#host'), matchMedia: () => media, sceneFactory});
  await office.readyPromise;
  office.setSnapshot({agents: [{id: 'active'}]}); office.setRoom('next-room');
  assert.equal(dom.window.document.querySelector('.office-empty').hidden, false);
  assert.match(dom.window.document.querySelector('.office-header small').textContent, /^0명$/);
  office.destroy();
  assert.ok(calls.some(([name]) => name === 'destroy'));
  assert.ok(calls.some(([name]) => name === 'media-remove'));
  assert.equal(dom.window.document.querySelector('.agent-office'), null);
});
