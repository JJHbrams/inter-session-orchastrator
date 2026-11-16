// Killing is only a request. Retry eligibility requires this owned child's close.
export function stopTimedOutChair(child,nativeId,reject,{graceMs=5000}={}) {
 const error=Error('좌장 응답 제한시간 초과 · 실행 여부 확인 필요');
 error.code='CHAIR_TIMEOUT';let done=false;
 const finish=proof=>{if(done)return;done=true;clearTimeout(timer);child?.removeListener('close',closed);if(proof)error.execution=proof;reject(error);};
 const closed=(code,signal)=>finish({nativeId,pid:child.pid,closed:true,code,signal});
 const timer=setTimeout(()=>finish(null),graceMs);
 child?.once('close',closed);
 try{if(!child||child.kill()===false)finish(null);}catch{finish(null);}
}
