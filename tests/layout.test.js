import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,LAYOUT_KEY,clampLayout,layoutLimits,loadLayout,mentionMenuGeometry,saveLayout,resetLayout} from '../apps/desktop/layout.js';
test('restore rejects malformed storage and nonnumeric dimensions without losing defaults',()=>{
 for(const value of [null,[],42,'bad',{}, {composer:Infinity,sidebar:NaN}])assert.deepEqual(clampLayout(value),DEFAULTS);
 assert.deepEqual(loadLayout({getItem:()=>'{bad'}),DEFAULTS);
 assert.deepEqual(loadLayout({getItem(){throw Error('unavailable');}}),DEFAULTS);
});
test('legacy removed layout keys are ignored while supported preferences load',()=>{
 assert.deepEqual(clampLayout({sidebar:260,chair:320,upper:280,participants:140,composer:240,inspector:300}),{sidebar:260,composer:240,inspector:300});
});
test('panel dimensions fit measured header space and protect the conversation',()=>{
 for(const viewport of [{width:1280,height:720,availableHeight:630},{width:1600,height:1000,availableHeight:910},{width:760,height:900,availableHeight:655}]){
  for(const preferred of ['composer',undefined]){
   const value=clampLayout(Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,1e6])),viewport,preferred);
   assert.ok(Object.values(value).every(Number.isFinite));
   assert.ok(value.composer<=layoutLimits(viewport).budget);
   assert.ok(value.composer>=174);
   assert.ok(value.sidebar<=420&&value.inspector<=520);
  }
 }
});
test('composer limit leaves conversation space after the automatic session panel',()=>{
 const viewport={width:1280,height:720,availableHeight:630,sessionHeight:275};
 assert.equal(layoutLimits(viewport).budget,243);
 assert.equal(clampLayout({composer:1e6},viewport,'composer').composer,243);
});
test('saved sizes round trip, reset clears preferences, storage denial is harmless',()=>{
 const storage={value:null,getItem(){return this.value},setItem(key,value){assert.equal(key,LAYOUT_KEY);this.value=value;},removeItem(){this.value=null;}};
 const value=clampLayout({...DEFAULTS,composer:260},{width:1600,height:1000});
 saveLayout(value,storage);assert.deepEqual(loadLayout(storage,{width:1600,height:1000}),value);
 assert.deepEqual(resetLayout(storage),DEFAULTS);assert.equal(storage.value,null);
 const denied={setItem(){throw Error('denied')},removeItem(){throw Error('denied')}};
 assert.doesNotThrow(()=>saveLayout(value,denied));assert.doesNotThrow(()=>resetLayout(denied));
});
test('mention menu stays in the viewport and prefers the space above its composer',()=>{
 const lower=mentionMenuGeometry({left:320,top:1165,bottom:1220},{width:300,height:230},{width:1280,height:1399});
 assert.deepEqual(lower,{left:320,top:929,maxHeight:230});
 const narrow=mentionMenuGeometry({left:740,top:50,bottom:95},{width:300,height:230},{width:760,height:900});
 assert.equal(narrow.left,452);assert.equal(narrow.top,101);assert.equal(narrow.maxHeight,230);
 const tall=mentionMenuGeometry({left:-20,top:70,bottom:100},{width:270,height:2000},{width:431,height:300});
 assert.deepEqual(tall,{left:8,top:62,maxHeight:230});
});
