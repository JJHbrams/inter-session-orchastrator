import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';

const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const inside=(root,path)=>{const r=relative(resolve(root),resolve(path));return r!==''&&!r.startsWith('..')&&!r.includes(':');};
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const atomic=async(path,value)=>{const temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(value),{flag:'wx'});await rename(temp,path);};

export function createProcessInspector(){
 const command=(file,args)=>execFileSync(file,args,{encoding:'utf8',windowsHide:true}).trim();
 const start=pid=>{if(process.platform==='win32')return command('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${Number(pid)} -ErrorAction Stop).StartTime.ToFileTimeUtc()`]);try{return command('ps',['-o','lstart=','-p',String(pid)]);}catch{return command('cat',[`/proc/${Number(pid)}/stat`]).split(' ')[21];}};
 return {async self(){return {pid:process.pid,start:String(start(process.pid))};},async inspect(pid){if(!Number.isInteger(Number(pid))||Number(pid)<1)return null;try{return {pid:Number(pid),start:String(start(pid))};}catch(error){const text=String(error?.stderr||error?.message||'');if(/no such process|not found|cannot find/i.test(text))return null;throw error;}}};
}

export class ClaudeSessionLease {
 constructor({root,configDirectory=process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),processInspector=createProcessInspector()}={}){this.root=resolve(root||join(configDirectory,'session-rooms-leases'));this.processInspector=processInspector;}
 path(sessionId){return join(this.root,digest(sessionId));}
 file(path){if(!inside(this.root,path))throw Error('lease path escapes root');return join(path,'lease.json');}
 async state(path){try{return await read(this.file(path));}catch{return null;}}
 async acquire(sessionId){const path=this.path(sessionId),token=randomUUID();await mkdir(this.root,{recursive:true});const owner=await this.processInspector.self();const value={sessionId,token,phase:'acquired',owner,createdAt:new Date().toISOString()};try{await mkdir(path);await atomic(this.file(path),value);return {...value,path};}catch(error){if(error?.code!=='EEXIST')throw error;return this.contend(sessionId,path);}}
 async contend(sessionId,path){const current=await this.state(path);if(!current||current.sessionId!==sessionId)return {ok:false,reasonCode:'session_lease_held'};if(current.phase!=='acquired'||current.childPid||current.childStart)return {ok:false,reasonCode:'session_lease_held',owner:current};let actual;try{actual=await this.processInspector.inspect(current.owner?.pid);}catch{return {ok:false,reasonCode:'session_lease_held',owner:current};}if(actual&&String(actual.start)===String(current.owner?.start))return {ok:false,reasonCode:'session_lease_held',owner:current};const tombstone=join(this.root,`.reclaimed-${digest(sessionId)}-${randomUUID()}`);try{await rename(path,tombstone);}catch{return {ok:false,reasonCode:'session_lease_held',owner:current};}const moved=await this.state(tombstone);if(!moved||moved.token!==current.token||moved.phase!=='acquired')return {ok:false,reasonCode:'session_lease_held'};await rm(tombstone,{recursive:true,force:true});return this.acquire(sessionId);}
 async update(lease,patch){const current=await this.state(lease.path);if(!current||current.token!==lease.token)throw Error('lease ownership changed');const next={...current,...patch};await atomic(this.file(lease.path),next);return {...lease,...next};}
 async release(lease){const current=await this.state(lease.path);if(!current||current.token!==lease.token||current.phase!=='closed')return false;if(current.childPid){let child;try{child=await this.processInspector.inspect(current.childPid);}catch{return false;}if(child&&String(child.start)===String(current.childStart))return false;}await rm(lease.path,{recursive:true,force:true});return true;}
}
