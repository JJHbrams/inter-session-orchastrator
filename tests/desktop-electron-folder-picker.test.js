import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createDirectoryPickerHandler } from '../desktop/shells/electron/directory-picker.mjs';

const origin = 'http://127.0.0.1:43125';
const sender = { getURL: () => `${origin}/rooms` };
const mainFrame = { url: `${origin}/rooms` };
const activeWindow = { webContents: { ...sender, mainFrame } };
const event = { sender: activeWindow.webContents, senderFrame: mainFrame };
const directory = path => ({ isDirectory: () => path === 'C:\\Rooms' || path === 'C:\\Chosen' });
function handler({ showOpenDialog = async () => ({ canceled: false, filePaths: ['C:\\Chosen'] }), getActiveWindow = () => activeWindow, getTrustedOrigin = () => origin, stat = async path => directory(path) } = {}) {
  return createDirectoryPickerHandler({ getActiveWindow, getTrustedOrigin, showOpenDialog, stat });
}

test('picks one existing absolute directory with fixed options', async () => {
  let received;
  const pick = handler({ showOpenDialog: async (_window, options) => { received = options; return { canceled: false, filePaths: ['C:\\Chosen'] }; } });
  assert.deepEqual(await pick(event, { defaultPath: 'C:\\Rooms' }), { cancelled: false, path: 'C:\\Chosen' });
  assert.deepEqual(received, { properties: ['openDirectory'], defaultPath: 'C:\\Rooms' });
});

test('returns no path when the dialog is cancelled', async () => {
  assert.deepEqual(await handler({ showOpenDialog: async () => ({ canceled: true, filePaths: ['C:\\Chosen'] }) })(event), { cancelled: true, path: null });
});

test('rejects untrusted senders, frames, origins, and malformed requests', async () => {
  const pick = handler();
  await assert.rejects(() => pick({ ...event, sender: {} }), /UNTRUSTED_SENDER/);
  await assert.rejects(() => pick({ ...event, senderFrame: { url: `${origin}/iframe` } }), /UNTRUSTED_SENDER/);
  await assert.rejects(() => pick({ ...event, senderFrame: { url: `${origin}/rooms` } }), /UNTRUSTED_SENDER/);
  const badOriginFrame = { url: `${origin}/rooms` };
  const badOriginWindow = { webContents: { mainFrame: badOriginFrame, getURL: () => 'https://example.test/' } };
  await assert.rejects(() => handler({ getActiveWindow: () => badOriginWindow })({ sender: badOriginWindow.webContents, senderFrame: badOriginFrame }), /UNTRUSTED_SENDER/);
  await assert.rejects(() => pick(event, { defaultPath: 'C:\\Rooms', unexpected: true }), /INVALID_REQUEST/);
  await assert.rejects(() => pick(event, { defaultPath: 42 }), /INVALID_REQUEST/);
});

test('omits an invalid or missing default path but still opens the chooser', async () => {
  for (const defaultPath of ['relative', 'C:\\Missing']) {
    let received;
    const pick = handler({ showOpenDialog: async (_window, options) => { received = options; return { canceled: true, filePaths: [] }; } });
    assert.deepEqual(await pick(event, { defaultPath }), { cancelled: true, path: null });
    assert.deepEqual(received, { properties: ['openDirectory'] });
  }
});

test('allows only one outstanding native selection', async () => {
  let unblockStat;
  const waiting = new Promise(resolve => { unblockStat = resolve; });
  const pick = handler({ stat: async path => { await waiting; return directory(path); } });
  const first = pick(event, { defaultPath: 'C:\\Rooms' });
  await assert.rejects(() => pick(event, { defaultPath: 'C:\\Rooms' }), /DIRECTORY_PICKER_BUSY/);
  unblockStat();
  await first;
});

test('clears the dialog guard when the native picker fails', async () => {
  const pick = handler({ showOpenDialog: async () => { throw new Error('DIALOG_CLOSED'); } });
  await assert.rejects(() => pick(event), /DIALOG_CLOSED/);
  await assert.rejects(() => pick(event), /DIALOG_CLOSED/);
});

test('sandboxed preload exposes only the directory picker bridge', async () => {
  const preload = await readFile(new URL('../desktop/shells/electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('sessionRoomsDesktop'/);
  assert.match(preload, /chooseDirectory: options => ipcRenderer\.invoke\('session-rooms:choose-directory', options\)/);
  assert.doesNotMatch(preload, /\b(fs|nodeIntegration)\b|ipcRenderer\.(send|on|removeListener)/);
});

async function rendererSmokeResult(chooseDirectory) {
  const main = await readFile(new URL('../desktop/shells/electron/main.mjs', import.meta.url), 'utf8');
  const script = main.match(/executeJavaScript\(`([\s\S]*?)`\); \}/)?.[1];
  assert.ok(script, 'renderer smoke script must be present');
  const evaluatedScript = Function('pixiSmokeInPage', `return \`${script}\``)(async () => ({officePixiReady:true,officeIdleAnimated:true,officePixiFrames:true,officeChairCrowned:true,officeChairFacingParticipants:true,officeSeatedParticipants:true,officeSceneTransitions:true,officeEntryAnimated:true,officeExitAnimated:true,officeWorkSeated:true,officeIdleRegistrationStable:true,officeWorkHeadScaleStable:true,officeFloorCollisionFree:true,officeObjectOcclusion:true,officeDockTransitions:true,officeCrownAnchored:true,officeObservedLayout:true}));
  return vm.runInNewContext(evaluatedScript, {
    document: { readyState: 'complete', querySelector: () => ({children:[{}]}) },
    setTimeout, clearTimeout,
    Image: class { constructor(){this.naturalWidth=2048;} set src(_value){queueMicrotask(()=>this.onload?.());} },
    fetch: async () => ({ ok: true }),
    window: { sessionRoomsDesktop: { chooseDirectory } }
  });
}

test('renderer smoke accepts Electron-wrapped invalid-request errors only', async () => {
  const main = await readFile(new URL('../desktop/shells/electron/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /renderer\?\.officeCrownAnchored&&renderer\?\.officeObservedLayout/);
  const wrapped = await rendererSmokeResult(async () => { throw new Error("Error invoking remote method 'session-rooms:choose-directory': Error: DIRECTORY_PICKER_INVALID_REQUEST"); });
  assert.equal(wrapped.officeCrownAnchored, true);
  assert.equal(wrapped.officeObservedLayout, true);
  assert.equal(wrapped.folderPickerGuarded, true);
  const untrusted = await rendererSmokeResult(async () => { throw new Error("Error invoking remote method 'session-rooms:choose-directory': Error: DIRECTORY_PICKER_UNTRUSTED_SENDER"); });
  assert.equal(untrusted.folderPickerGuarded, false);
});
