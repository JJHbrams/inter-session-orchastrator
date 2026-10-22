import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../services/coordinator/store.js';

function registered(s, mode='live_attach') { return s.registerSession({provider:'codex',host:'test',nativeId:'native-1',cwd:'C:/work',profile:'default',mode,verified:mode!=='read_only',capabilities:{followup:true}}); }
test('same payload idempotency returns the frozen recipient snapshot',()=>{const s=new Store();const r=s.createRoom('r');const {session}=registered(s);const m=s.join(r.id,session.id,false);const first=s.post({roomId:r.id,body:'hello',kind:'followup',requestKey:'k',targets:[m.id]});const same=s.post({roomId:r.id,body:'hello',kind:'followup',requestKey:'k',targets:[m.id]});assert.equal(first.message.id,same.message.id);assert.equal(first.deliveries.length,1);assert.throws(()=>s.post({roomId:r.id,body:'different',kind:'followup',requestKey:'k',targets:[m.id]}),/idempotency conflict/);});
test('unresolved session writer blocks another room before external submission',()=>{const s=new Store();const a=s.createRoom('a'),b=s.createRoom('b');const {session}=registered(s);const ma=s.join(a.id,session.id,false),mb=s.join(b.id,session.id,false);const da=s.post({roomId:a.id,body:'a',kind:'followup',targets:[ma.id]}).deliveries[0];const db=s.post({roomId:b.id,body:'b',kind:'followup',targets:[mb.id]}).deliveries[0];const claim=s.claim(da.id);s.fence(da.id,claim.fence);assert.throws(()=>s.claim(db.id),/unresolved submission/);});
test('restart changes in-flight deliveries to unknown without resending',()=>{const s=new Store();const r=s.createRoom('r');const {session}=registered(s);const m=s.join(r.id,session.id,false);const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0];const c=s.claim(d.id);s.fence(d.id,c.fence);s.recover();assert.equal(s.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'unknown');});
test('registration scope rejects cross room reply and revokes on leave',()=>{const s=new Store();const a=s.createRoom('a'),b=s.createRoom('b');const {session}=registered(s);s.join(a.id,session.id,false);s.join(b.id,session.id,false);s.provision(a.id,session.id,'h');const reg=s.registration('h');assert.equal(reg.room_id,a.id);assert.throws(()=>s.reply(reg,'not-in-room','x'),/not addressed/);s.leave(a.id,session.id);assert.equal(s.registration('h'),undefined);});
test('cooperative inbox offers one request and exact reply is atomic and idempotent',()=>{const s=new Store();const r=s.createRoom('r');const {session}=registered(s);const m=s.join(r.id,session.id,false);s.provision(r.id,session.id,'token');const reg=s.registration('token');const d=s.post({roomId:r.id,body:'question',kind:'followup',targets:[m.id]}).deliveries[0];const offer=s.inbox(reg);assert.equal(offer.inbox[0].request_id,d.request_id);assert.equal(s.inbox(reg).inbox.length,0);const reply=s.reply(reg,d.request_id,'answer');assert.equal(s.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'completed');assert.equal(s.reply(reg,d.request_id,'answer').message.id,reply.message.id);assert.throws(()=>s.reply(reg,d.request_id,'changed'),/conflict/);});
test('paused room stops queued cooperative offers without deleting them',()=>{const s=new Store();const r=s.createRoom('r');const {session}=registered(s);const m=s.join(r.id,session.id,false);s.provision(r.id,session.id,'t');s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]});s.pause(r.id,true);assert.equal(s.inbox(s.registration('t')).inbox.length,0);});

test('pause between reservation and submission prevents the external side-effect fence',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);
  const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0],c=s.claim(d.id);
  s.pause(r.id);assert.throws(()=>s.fence(d.id,c.fence),/eligible/);
  assert.equal(s.db.prepare('SELECT count(*) n FROM attempts').get().n,0);
});
test('new runtime binding invalidates a queued request before it is offered',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);
  const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0];registered(s);
  assert.throws(()=>s.claim(d.id),/binding or policy changed/);
});
test('a cooperative offer blocks other rooms and stays fenced across restart recovery',()=>{
  const s=new Store(),a=s.createRoom('a'),b=s.createRoom('b'),{session}=registered(s);
  const ma=s.join(a.id,session.id,false),mb=s.join(b.id,session.id,false);s.provision(a.id,session.id,'a');s.provision(b.id,session.id,'b');
  s.post({roomId:a.id,body:'a',kind:'followup',targets:[ma.id]});s.post({roomId:b.id,body:'b',kind:'followup',targets:[mb.id]});
  const offer=s.inbox(s.registration('a')).inbox[0];assert.equal(s.inbox(s.registration('b')).inbox.length,0);
  s.recover();assert.equal(s.inbox(s.registration('a')).inbox.length,0);assert.equal(s.inbox(s.registration('b')).inbox.length,0);
  s.reply(s.registration('a'),offer.request_id,'late exact reply');assert.equal(s.inbox(s.registration('b')).inbox.length,1);
});
test('stale execution evidence cannot advance delivery or clear another writer',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);
  const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0],c=s.claim(d.id),a=s.fence(d.id,c.fence);
  s.db.prepare('UPDATE writers SET fence=fence+1 WHERE session_id=?').run(session.id);
  assert.throws(()=>s.evidence(a.id,'reply','isolated-test','proof'),/stale attempt/);
  assert.equal(s.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'submitting');
});
test('chair rounds are bounded, replay does not spend another round, and empty rounds cannot bypass the limit',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);s.role(r.id,session.id,'chair');s.limits(r.id,20,1);
  const args={roomId:r.id,senderSessionId:session.id,body:'ask',kind:'followup',requestKey:'round-one',targets:[m.id]};
  const first=s.post(args);assert.equal(s.post(args).message.id,first.message.id);
  assert.throws(()=>s.post({...args,requestKey:'round-two'}),/round budget/);
});
test('leaving before submission cancels reservations and permits an explicit rejoin',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);
  const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0];s.claim(d.id);s.leave(r.id,session.id);
  assert.equal(s.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'cancelled');
  assert.equal(s.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(session.id).unresolved_delivery_id,null);
  assert.equal(s.join(r.id,session.id,false).id,m.id);
});
test('archiving stops new requests while preserving a late correlated reply',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);s.provision(r.id,session.id,'token');
  s.post({roomId:r.id,body:'question',kind:'followup',targets:[m.id]});const offered=s.inbox(s.registration('token')).inbox[0];s.archiveRoom(r.id);
  assert.throws(()=>s.post({roomId:r.id,body:'new',kind:'followup',targets:[m.id]}),/archived/);
  assert.ok(s.reply(s.registration('token'),offered.request_id,'finished before archive was observed').message.reply_to);
});
test('Windows path separators and case do not create a second session identity',()=>{
  const s=new Store(),first=registered(s);
  const same=s.registerSession({provider:'CODEX',host:'TEST',nativeId:'native-1',cwd:'c:\\WORK\\',profile:'default',mode:'read_only'});
  assert.equal(first.session.id,same.session.id);
  assert.equal(s.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
});
