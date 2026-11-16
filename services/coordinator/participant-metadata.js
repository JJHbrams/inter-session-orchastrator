// Passive metadata reads never open a model picker or claim the session writer.
export class ParticipantMetadataObserver {
 constructor(store,{adapter,track=promise=>promise,retryMs=30000,clock=Date.now}={}){this.store=store;this.adapter=adapter;this.track=track;this.retryMs=retryMs;this.clock=clock;this.lookups=new Map();this.closed=false;}
 observe(sessionId,{force=false,revision=0}={}){
  if(this.closed||typeof this.adapter?.readMetadata!=='function')return Promise.resolve({saved:false,reasonCode:'metadata_unavailable'});
  const row=this.store.db.prepare('SELECT s.provider,s.host,s.native_id,s.cwd,s.profile,b.* FROM sessions s JOIN bindings b ON b.session_id=s.id AND b.active=1 WHERE s.id=?').get(sessionId);
  if(!row?.verified_at||JSON.parse(row.capabilities||'{}').transport!=='orca-native-chat')return Promise.resolve({saved:false,reasonCode:'native_metadata_unavailable'});
  const key=JSON.stringify([row.id,row.handle,row.incarnation,revision]),prior=this.lookups.get(sessionId);
  if(prior?.key===key&&(prior.status==='pending'||!force&&this.clock()-prior.attemptAt<this.retryMs))return prior.promise;
  const expected={...row,nativeId:row.native_id},entry={key,handle:row.handle,incarnation:row.incarnation,status:'pending',reasonCode:null,attemptAt:this.clock()};
  this.lookups.set(sessionId,entry);
  const job=(async()=>{try{
   const observation=await this.adapter.readMetadata(expected,expected);
   if(this.closed||!this.store.db.isOpen)return {saved:false,reasonCode:'closing'};
   const result=observation?.ok?this.store.recordParticipantMetadata(sessionId,expected,observation):{saved:false,reasonCode:observation?.reasonCode||'metadata_read_failed'};
   entry.status=result.saved?'ready':'failed';entry.reasonCode=result.reasonCode||null;return result;
  }catch(error){entry.status='failed';entry.reasonCode=error.code||'metadata_read_failed';return {saved:false,reasonCode:entry.reasonCode}}})();
  entry.promise=job;this.track(job);return job;
 }
 decorate(room){return {...room,members:room.members.map(member=>{
  if(JSON.parse(member.capabilities||'{}').transport!=='orca-native-chat'||member.left_at)return member;
  const observed=member.modelSettings?.observed,observedAt=Date.parse(observed?.observedAt)||0;
  const replyAt=room.messages.filter(message=>message.sender_session_id===member.session_id&&message.reply_request_id).reduce((latest,message)=>Math.max(latest,Date.parse(message.created_at)||0),0);
  if(!observed||replyAt>observedAt||this.clock()-observedAt>60000)this.observe(member.session_id,{revision:replyAt});
  const entry=this.lookups.get(member.session_id),lookup=entry?.handle===member.handle&&entry?.incarnation===member.incarnation?{status:entry.status,reasonCode:entry.reasonCode}:null;
  return {...member,modelSettings:{...member.modelSettings,lookup}};
 })};}
 close(){this.closed=true;}
}
