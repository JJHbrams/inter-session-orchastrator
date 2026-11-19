import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeAtomicJson} from '../adapters/claude/atomic-file.js';

test('transient sharing failures retry only the same state-file replacement',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'claude-atomic-')),path=join(directory,'state.json');await writeFile(path,'{"state":"old"}');
 let calls=0;const waits=[],sources=[];
 await writeAtomicJson(path,{state:'prepared'},{wait:async ms=>waits.push(ms),move:async(source,target)=>{
  sources.push(source);assert.equal(target,path);calls++;
  if(calls<3){assert.equal(JSON.parse(await readFile(path,'utf8')).state,'old');throw Object.assign(Error('sharing lock'),{code:'EPERM'});}
  await rename(source,target);
 }});
 assert.equal(calls,3);assert.equal(new Set(sources).size,1);assert.equal(waits.length,2);assert.equal(JSON.parse(await readFile(path,'utf8')).state,'prepared');
});
test('persistent file denial is bounded and preserves the previous state',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'claude-atomic-')),path=join(directory,'state.json');await writeFile(path,'{"state":"old"}');let calls=0;
 await assert.rejects(writeAtomicJson(path,{state:'new'},{maxAttempts:3,wait:async()=>{},move:async()=>{calls++;throw Object.assign(Error('denied'),{code:'EACCES'});}}),{code:'EACCES'});
 assert.equal(calls,3);assert.equal(JSON.parse(await readFile(path,'utf8')).state,'old');
});
