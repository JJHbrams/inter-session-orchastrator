import {randomUUID} from 'node:crypto';
import {writeFile,rename,unlink} from 'node:fs/promises';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Replace only our own state file. Transient Windows sharing locks must not trigger a send retry. */
export async function writeAtomicJson(path,value,{write=writeFile,move=rename,wait=pause,maxAttempts=8}={}) {
 const temp=path+'.'+randomUUID()+'.tmp';
 await write(temp,JSON.stringify(value),{flag:'wx',mode:0o600});
 try {
  for(let attempt=0;;attempt++){
   try { await move(temp,path);return; }
   catch(error){
    if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt+1>=maxAttempts)throw error;
    await wait(Math.min(5*2**attempt,160));
   }
  }
 } catch(error) { await unlink(temp).catch(()=>{});throw error; }
}
