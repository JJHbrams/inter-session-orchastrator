import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const key=id=>createHash('sha256').update(String(id)).digest('hex');
const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}};

export class ClaudeSessionLease {
  constructor({root,processInspector}={}){this.root=root||join(process.env.USERPROFILE||process.cwd(),'.claude','session-rooms-leases');this.processInspector=processInspector||{async self(){return {pid:process.pid,start:String(process.pid)};},async inspect(){return null;}};}
  path(sessionId){return join(this.root,key(sessionId));}
  async acquire(sessionId){const path=this.path(sessionId),token=randomUUID();await mkdir(this.root,{recursive:true});try{await mkdir(path);const owner={sessionId,token,phase:'acquired',owner:await this.processInspector.self()};await writeFile(join(path,'lease.json'),JSON.stringify(owner));return {...owner,path};}catch(error){if(error?.code!=='EEXIST')throw error;const owner=await read(join(path,'lease.json'));if(!owner||owner.phase==='acquired'){try{await rm(path,{recursive:true,force:true});return this.acquire(sessionId);}catch{}}return {ok:false,reasonCode:'session_lease_held',owner,path};}}
  async update(lease,patch){const current=await read(join(lease.path,'lease.json'));if(!current||current.token!==lease.token)throw Error('lease ownership changed');const next={...current,...patch};await writeFile(join(lease.path,'lease.json'),JSON.stringify(next));return {...lease,...next};}
  async release(lease){const current=await read(join(lease.path,'lease.json'));if(!current||current.token!==lease.token||current.phase!=='closed')return false;await rm(lease.path,{recursive:true,force:true});return true;}
}
