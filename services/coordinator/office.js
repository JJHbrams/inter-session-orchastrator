export function roomOfficeFallback(room,member){
 if(member.left_at)return {state:'left',activity:'none',zone:'door',detail:'member left the room',source:'room',updatedAt:member.left_at};
 if(member.read_only)return {state:'idle',activity:'none',zone:'table',detail:'read-only room member',source:'room',updatedAt:null};
 const deliveries=(room.deliveries||[]).filter(item=>item.membership_id===member.id&&['followup','steer'].includes(item.kind));
 const states=['running','unknown','submitting','accepted','claimed','queued','blocked'];
 const current=states.map(state=>deliveries.filter(item=>item.state===state).at(-1)).find(Boolean)||deliveries.at(-1)||null;
 if(!current)return {state:'idle',activity:'none',zone:'table',detail:'no active room request',source:'room',updatedAt:null};
 if(current.state==='queued')return {state:'queued',activity:'none',zone:'table',detail:'room request queued',source:'room',updatedAt:current.created_at||null};
 if(['claimed','submitting','accepted'].includes(current.state))return {state:'waiting',activity:'none',zone:'table',detail:'room request delivery pending',source:'room',updatedAt:current.created_at||null};
 if(current.state==='running')return {state:'running',activity:'responding',zone:'table',detail:'room request running',source:'room',updatedAt:current.created_at||null};
 if(current.state==='completed')return {state:'completed',activity:'none',zone:'table',detail:'room request completed',source:'room',updatedAt:current.created_at||null};
 if(current.state==='failed')return {state:'failed',activity:'none',zone:'table',detail:'room request failed',source:'room',updatedAt:current.created_at||null};
 if(current.state==='blocked')return {state:'waiting',activity:'none',zone:'table',detail:'room request blocked',source:'room',updatedAt:current.created_at||null};
 return {state:'unknown',activity:'none',zone:'table',detail:'room request needs reconciliation',source:'room',updatedAt:current.created_at||null};
}
