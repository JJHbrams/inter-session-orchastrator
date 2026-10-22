import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,LAYOUT_KEY,clampLayout,loadLayout,resetLayout} from '../apps/desktop/layout.js';
test('layout clamps malformed values and reset clears storage',()=>{const small=clampLayout({sidebar:9999,upper:9999,participants:9999,composer:9999},{width:800,height:720});assert.ok(small.sidebar<=280);assert.ok(small.upper+small.participants+small.composer<=550);assert.deepEqual(clampLayout([],{}),DEFAULTS);const storage={getItem:()=>'{bad',removeItem(){this.removed=true;}};assert.deepEqual(loadLayout(storage,{width:1280,height:720}),DEFAULTS);assert.deepEqual(resetLayout(storage),DEFAULTS);assert.equal(storage.removed,true);assert.equal(LAYOUT_KEY,'session-rooms-layout-v1');});
