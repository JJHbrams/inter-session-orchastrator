import {ClaudeSessionLease} from '../../adapters/claude/session-lease.js';
const inspector={async self(){return {pid:process.pid,start:'worker'};},async inspect(pid){return {pid:Number(pid),start:'worker'};}};
const lease=new ClaudeSessionLease({root:process.env.LEASE_ROOT,processInspector:inspector});
process.send?.({ready:true});
process.on('message',async message=>{if(message!=='go')return;const result=await lease.acquire(process.env.LEASE_SESSION);process.send?.({ok:!!result.token,reason:result.reasonCode});if(result.token)setTimeout(async()=>{await lease.update(result,{phase:'closed'});await lease.release({...result,phase:'closed'});process.exit(0);},200);else process.exit(0);});
