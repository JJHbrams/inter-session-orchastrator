import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,LAYOUT_KEY,clampLayout,layoutLimits,loadLayout,saveLayout,resetLayout} from '../apps/desktop/layout.js';
test('restore rejects malformed storage and nonnumeric dimensions without losing defaults',()=>{
 for(const value of [null,[],42,'bad',{}, {upper:null,chair:'1000',composer:Infinity,sidebar:NaN}])assert.deepEqual(clampLayout(value),DEFAULTS);
 assert.deepEqual(loadLayout({getItem:()=>'{bad'}),DEFAULTS);
 assert.deepEqual(loadLayout({getItem(){throw Error('unavailable');}}),DEFAULTS);
});
test('panel dimensions fit measured header space and protect the conversation',()=>{
 for(const viewport of [{width:1280,height:720,availableHeight:630},{width:1600,height:1000,availableHeight:910},{width:760,height:900,availableHeight:655}]){
  for(const preferred of ['upper','participants','composer',undefined]){
   const value=clampLayout(Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,1e6])),viewport,preferred);
   assert.ok(Object.values(value).every(Number.isFinite));
   assert.ok(value.upper+value.participants+value.composer<=layoutLimits(viewport).budget);
   assert.ok(value.upper>=120&&value.participants>=82&&value.composer>=174);
   assert.ok(value.sidebar<=420&&value.chair<=420&&value.inspector<=520);
  }
 }
 const value=clampLayout({sidebar:420,chair:420},{width:900,height:720});
 assert.ok(value.chair<=layoutLimits({width:900,sidebar:value.sidebar}).ranges.chair[1]);
});
test('saved sizes round trip, reset clears preferences, storage denial is harmless',()=>{
 const storage={value:null,getItem(){return this.value},setItem(key,value){assert.equal(key,LAYOUT_KEY);this.value=value;},removeItem(){this.value=null;}};
 const value=clampLayout({...DEFAULTS,chair:250,upper:260},{width:1600,height:1000});
 saveLayout(value,storage);assert.deepEqual(loadLayout(storage,{width:1600,height:1000}),value);
 assert.deepEqual(resetLayout(storage),DEFAULTS);assert.equal(storage.value,null);
 const denied={setItem(){throw Error('denied')},removeItem(){throw Error('denied')}};
 assert.doesNotThrow(()=>saveLayout(value,denied));assert.doesNotThrow(()=>resetLayout(denied));
});
