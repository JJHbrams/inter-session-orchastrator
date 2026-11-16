const RUNNING=new Set(['claimed','submitting','accepted','running']);

export function roomOfficeFallback(room,member){
 const deliveries=(room.deliveries||[]).filter(item=>item.session_id===member.session_id).sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0));
 const current=deliveries[0];
 if(!current)return {state:'idle',activity:'none',zone:'table',detail:'no active room request',source:'room',updatedAt:null};
 if(current.state==='queued')return {state:'queued',activity:'none',zone:'table',detail:'room request queued',source:'room',updatedAt:current.created_at||null};
 if(RUNNING.has(current.state))return {state:'running',activity:'responding',zone:'table',detail:'room request in progress',source:'room',updatedAt:current.created_at||null};
 if(current.state==='completed')return {state:'completed',activity:'none',zone:'table',detail:'room request completed',source:'room',updatedAt:current.created_at||null};
 if(current.state==='failed'||current.state==='blocked')return {state:'failed',activity:'none',zone:'table',detail:'room request failed',source:'room',updatedAt:current.created_at||null};
 return {state:'unknown',activity:'none',zone:'table',detail:'room request needs reconciliation',source:'room',updatedAt:current.created_at||null};
}
