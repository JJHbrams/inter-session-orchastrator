// Local, explicit pull/reply helper for a room-scoped participant token.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
let args=process.argv.slice(2), config={}; const ci=args.indexOf('--config'); if(ci>=0){config=JSON.parse(await readFile(args[ci+1],'utf8'));args.splice(ci,2);} const [action='inbox', ...rest]=args; const url=config.url||process.env.ROOMS_URL||'http://127.0.0.1:4318'; const token=config.token||process.env.ROOMS_TOKEN;
if(!token) throw new Error('ROOMS_TOKEN is required');
const target=new URL(url);if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password)throw Error('Participant configuration must point to loopback HTTP');
let body=action==='reply'?{requestId:rest.shift(),body:rest.join(' ')}:action==='post'?{body:rest.join(' ')}:{};
if(action==='result'){const json=rest[0]?.startsWith('{')?JSON.parse(rest.join(' ')):JSON.parse(await readFile(rest[0],'utf8'));body={body:json.body,sourceIds:json.sourceIds||[]};}
if(action==='request'){const json=JSON.parse(await readFile(rest[0],'utf8'));body={body:json.body,targets:json.targets,kind:json.kind||'followup',requestKey:json.requestKey||createHash('sha256').update(JSON.stringify(json)).digest('hex'),expectedTurnId:json.expectedTurnId||null};}
const route=action==='inbox'?'room_inbox':action==='reply'?'room_reply':action==='post'?'room_post':action==='result'?'room_result':action==='request'?'room_request':action;
const r=await fetch(`${url}/mcp/${route}`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}); console.log(JSON.stringify(await r.json(),null,2)); if(!r.ok)process.exitCode=1;
