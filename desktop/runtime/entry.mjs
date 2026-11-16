import { mkdirSync } from 'node:fs';
import { resolve, parse, join, isAbsolute } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createCoordinator } from '../../services/coordinator/server.js';

function argument(name){const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1]||null}
function absoluteDirectory(value,label){if(!value||!isAbsolute(value))throw Error(`${label} must be an absolute non-root directory`);const path=resolve(value);if(parse(path).root===path)throw Error(`${label} must be an absolute non-root directory`);return path}
const profile=absoluteDirectory(argument('--profile'),'--profile');
const guardianPid=Number(argument('--guardian-pid'));
if(!Number.isInteger(guardianPid)||guardianPid<1||process.ppid!==guardianPid)throw Error('desktop runtime must be started by its guardian');
const knowledgeArgument=argument('--knowledge-root');
const knowledgeRoot=knowledgeArgument?absoluteDirectory(knowledgeArgument,'--knowledge-root'):join(profile,'knowledge');
mkdirSync(profile,{recursive:true});
const coordinator=createCoordinator({port:0,dbPath:join(profile,'rooms.sqlite'),privateDir:join(profile,'participants'),knowledgeRoot,workspaceRoot:profile,secret:randomBytes(32).toString('base64url'),desktopHost:true,updateScheduling:process.env.ROOMS_DISABLE_UPDATES!=='1',log:{error:message=>process.stderr.write(`${message}\n`)}});
const info=await coordinator.start();
const ready={type:'ready',protocol:'session-rooms-desktop/v1',pid:process.pid,instanceId:randomUUID(),baseUrl:info.baseUrl,dataDir:profile,dbPath:info.dbPath};
process.stdout.write(JSON.stringify(ready)+'\n');
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;try{await coordinator.close();process.stdout.write(JSON.stringify({type:'closed',protocol:'session-rooms-desktop/v1',pid:process.pid})+'\n');process.exitCode=0}catch(error){process.stderr.write(`${error.code||'ERROR'}: ${error.message}\n`);stopping=false}}
let buffered='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffered+=chunk;let index;while((index=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,index);buffered=buffered.slice(index+1);try{if(JSON.parse(line).type==='shutdown')shutdown()}catch{}}});process.stdin.on('end',shutdown);
