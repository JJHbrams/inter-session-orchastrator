import {randomUUID} from 'node:crypto';

// A terminal key or an accepted request is not proof that one native task stopped.
export class ParticipantInterrupts {
 constructor(store,{adapter=null,timeoutMs=15000}={}){
  this.store=store;this.adapter=adapter;this.timeoutMs=timeoutMs;
  store.db.exec(`CREATE TABLE IF NOT EXISTS participant_interrupt_requests(
   id TEXT PRIMARY KEY,room_id TEXT NOT NULL,agenda_id TEXT NOT NULL,membership_id TEXT NOT NULL,
   delivery_id TEXT NOT NULL,fence INTEGER NOT NULL,binding_id TEXT NOT NULL,incarnation TEXT NOT NULL,
   native_id TEXT NOT NULL,native_task_id TEXT,status TEXT NOT NULL,reason TEXT NOT NULL,
   proof_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
   UNIQUE(delivery_id,fence))`);
  store.db.prepare("UPDATE participant_interrupt_requests SET status='unknown',error='restart requires exact task reconciliation' WHERE status='interrupt_requested'").run();
 }
 capability(){return {hardInterrupt:this.adapter?.capabilities?.hardInterrupt===true&&typeof this.adapter.inspectTask==='function'&&typeof this.adapter.interruptExact==='function',reason:'Exact native task identity and confirmed termination are required.'};}
 target(roomId,agendaId,membershipId,deliveryId,fence){
  const db=this.store.db,agenda=db.prepare('SELECT phase FROM agendas WHERE id=? AND room_id=?').get(agendaId,roomId);
  if(!agenda||['completed','cancelled','paused'].includes(agenda.phase))throw Error('interrupt agenda is inactive');
  const row=db.prepare(`SELECT d.*,mb.session_id,b.id binding_id,b.incarnation,b.handle,b.active,s.native_id,
   w.fence writer_fence,w.unresolved_delivery_id FROM deliveries d
   JOIN memberships mb ON mb.id=d.membership_id JOIN sessions s ON s.id=mb.session_id
   JOIN bindings b ON b.id=d.binding_id JOIN writers w ON w.session_id=mb.session_id
   JOIN agenda_messages am ON am.message_id=d.message_id AND am.agenda_id=?
   WHERE d.id=? AND mb.id=? AND mb.room_id=? AND mb.left_at IS NULL AND mb.read_only=0`).get(agendaId,deliveryId,membershipId,roomId);
  if(!row||!row.active||row.unresolved_delivery_id!==deliveryId||row.writer_fence!==fence||!['accepted','running','unknown','submitting'].includes(row.state))throw Error('interrupt target or writer fence changed');
  const current=db.prepare('SELECT id FROM bindings WHERE session_id=? AND active=1').get(row.session_id);
  if(current?.id!==row.binding_id)throw Error('interrupt binding changed');
  return row;
 }
 matches(proof,target,fence){return proof&&proof.deliveryId===target.id&&proof.requestId===target.request_id&&proof.nativeId===target.native_id&&proof.bindingId===target.binding_id&&proof.incarnation===target.incarnation&&proof.fence===fence&&typeof proof.nativeTaskId==='string'&&!!proof.nativeTaskId;}
 row(id){return this.store.db.prepare('SELECT * FROM participant_interrupt_requests WHERE id=?').get(id);}
 save(id,status,{proof=null,error=null,taskId=null}={}){this.store.db.prepare('UPDATE participant_interrupt_requests SET status=?,proof_json=?,error=?,native_task_id=COALESCE(?,native_task_id),updated_at=? WHERE id=?').run(status,proof?JSON.stringify(proof):null,error,taskId,new Date().toISOString(),id);return this.row(id);}
 async request(roomId,agendaId,{membershipId,deliveryId,fence,reason=''}={}){
  if(!Number.isInteger(fence)||fence<1||typeof reason!=='string'||reason.length>800)throw Error('invalid exact interrupt request');
  const old=this.store.db.prepare('SELECT * FROM participant_interrupt_requests WHERE delivery_id=? AND fence=?').get(deliveryId,fence);
  if(old){if(old.room_id!==roomId||old.agenda_id!==agendaId||old.membership_id!==membershipId)throw Error('interrupt request is outside this scope');return old;}
  const target=this.target(roomId,agendaId,membershipId,deliveryId,fence);
  const id=randomUUID(),timestamp=new Date().toISOString();
  const inserted=this.store.db.prepare('INSERT OR IGNORE INTO participant_interrupt_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,roomId,agendaId,membershipId,deliveryId,fence,target.binding_id,target.incarnation,target.native_id,null,'interrupt_requested',reason,null,null,timestamp,timestamp);
  if(!inserted.changes)return this.store.db.prepare('SELECT * FROM participant_interrupt_requests WHERE delivery_id=? AND fence=?').get(deliveryId,fence);
  if(!this.capability().hardInterrupt)return this.save(id,'unsupported',{error:'This adapter cannot prove exact native task termination. Use cooperative yield.'});
  let invoked=false;
  try{
   const task=await this.bounded(this.adapter.inspectTask({...target,fence}));
   if(!this.matches(task,target,fence)||task.running!==true)throw Error('native task identity was not verified');
   const current=this.target(roomId,agendaId,membershipId,deliveryId,fence);
   if(current.binding_id!==target.binding_id||current.incarnation!==target.incarnation||current.native_id!==target.native_id)throw Error('native task binding changed');
   this.save(id,'interrupt_requested',{taskId:task.nativeTaskId});
   invoked=true;const proof=await this.bounded(this.adapter.interruptExact({...task,roomId,agendaId,reason}));
   if(!this.matches(proof,target,fence)||proof.nativeTaskId!==task.nativeTaskId||proof.terminated!==true||proof.closed!==true)return this.save(id,'unknown',{proof,error:'interrupt receipt does not confirm exact task termination'});
   return this.store.tx(()=>{
    const current=this.target(roomId,agendaId,membershipId,deliveryId,fence);
    if(current.binding_id!==target.binding_id||current.incarnation!==target.incarnation)throw Error('late termination proof belongs to an old binding');
    this.store.db.prepare("UPDATE deliveries SET state='cancelled',outcome='interrupted',blocked_reason='exact native task termination confirmed' WHERE id=?").run(deliveryId);
    this.store.db.prepare("UPDATE attempts SET state='cancelled' WHERE delivery_id=? AND fence=?").run(deliveryId,fence);
    this.store.db.prepare('UPDATE writers SET unresolved_delivery_id=NULL WHERE session_id=? AND unresolved_delivery_id=? AND fence=?').run(target.session_id,deliveryId,fence);
    this.store.event(roomId,'participant.interrupted',{agendaId,deliveryId,fence,interruptId:id});
    return this.save(id,'stopped',{proof});
   });
  }catch(error){return this.save(id,invoked?'unknown':'rejected',{error:error.message});}
 }
 async bounded(operation){let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('exact task interruption timed out')),this.timeoutMs);})]);}finally{clearTimeout(timer);}}
}
