import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../apps/desktop/api-client.js';
const answer=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});

test('restart authentication retries a rejected mutation once with identical payload',async()=>{
  const seen=[];let boots=0,posts=0;
  const client=createApiClient({fetcher:async(path,opt)=>{seen.push([path,opt]);if(path==='/api/bootstrap')return answer(200,{csrf:'epoch-'+ ++boots});return ++posts===1?answer(401,{code:'AUTH_REQUIRED'}):answer(201,{id:'same-message'});}});
  await client.authenticate();const body=JSON.stringify({body:'draft',requestKey:'frozen-key'});
  assert.deepEqual(await client.request('/messages',{method:'POST',body}),{id:'same-message'});
  assert.equal(boots,2);assert.equal(posts,2);
  const sent=seen.filter(x=>x[0]==='/messages').map(x=>x[1]);assert.equal(sent[0].body,sent[1].body);assert.equal(sent[1].headers['X-CSRF-Token'],'epoch-2');
});

test('network ambiguity never replays a mutation; a later GET can reconnect',async()=>{
  let posts=0,fail=true;const states=[];
  const client=createApiClient({onConnection:x=>states.push(x),fetcher:async(path)=>{if(path==='/api/bootstrap')return answer(200,{csrf:'token'});if(path==='/messages'){posts++;if(fail)throw Error('socket reset');}return answer(200,{ok:true});}});
  await assert.rejects(client.request('/messages',{method:'POST',body:'{"requestKey":"same"}'}),{code:'NETWORK_UNCERTAIN'});
  assert.equal(posts,1);fail=false;await client.request('/rooms');assert.equal(states.at(-1),'online');assert.ok(states.includes('offline'));
});

test('concurrent bootstrap is shared; foreign Origin rejection is never retried',async()=>{
  let boots=0,denied=0;
  const client=createApiClient({fetcher:async(path)=>{if(path==='/api/bootstrap'){boots++;return answer(200,{csrf:'token'});}denied++;return answer(403,{error:'Origin rejected',code:'ORIGIN_INVALID'});}});
  const results=await Promise.allSettled([client.request('/a'),client.request('/b')]);
  assert.equal(boots,1);assert.equal(denied,2);assert.ok(results.every(x=>x.status==='rejected'));
});

test('stale CSRF recovers once, repeated authentication denial terminates',async()=>{
  let boot=0,calls=0;
  const client=createApiClient({fetcher:async(path)=>path==='/api/bootstrap'?answer(200,{csrf:'token'+ ++boot}):(calls++,answer(403,{code:'CSRF_INVALID',error:'stale token'}))});
  await assert.rejects(client.request('/limits',{method:'POST',body:'{}'}),/stale token/);assert.equal(boot,2);assert.equal(calls,2);
});
