// Explicit local helper: private token config stays outside messages and argv.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
let args=process.argv.slice(2),config={};
function option(name){const i=args.indexOf(name);if(i<0)return;const value=args[i+1];if(value===undefined)throw Error(name+' needs a value');args.splice(i,2);return value;}
const configPath=option('--config');if(configPath)config=JSON.parse(await readFile(configPath,'utf8'));
const requestedId=option('--request-id'),bodyFile=option('--body-file');
const output=option('--output'),requestedKey=option('--request-key'),attachmentOption=option('--attachments');
const attachmentIds=attachmentOption===undefined?undefined:attachmentOption.split(',').filter(Boolean);
const [action='inbox',...rest]=args,url=config.url||process.env.ROOMS_URL||'http://127.0.0.1:4318',token=config.token||process.env.ROOMS_TOKEN;
if(!token)throw Error('ROOMS_TOKEN is required');
const target=new URL(url);
if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password)throw Error('Participant configuration must point to loopback HTTP');
let body={},route=action;
if(action==='context')route='room_context';
if(action==='knowledge'){route='room_knowledge_list';body={query:rest.join(' ')};}
if(action==='knowledge-read'){route='room_knowledge_read';body={itemId:rest[0],...(rest[1]?{revision:Number(rest[1])}:{})};}
if(action==='ack'){route='room_acknowledge_approval';body={noticeId:rest[0],revision:Number(rest[1])};}
if(action==='review'||action==='knowledge-add'){
 const raw=rest[0]?.startsWith('{')?rest.join(' '):await readFile(rest[0],'utf8');
 body=JSON.parse(raw);route=action==='review'?'room_review':'room_knowledge_add';
}
if(action==='inbox'){route='room_inbox';if(requestedId)body={requestId:requestedId};}
if(action==='post'){route='room_post';body={body:rest.join(' '),attachmentIds:attachmentIds||[]};}
if(action==='reply'){route='room_reply';body={requestId:rest[0],body:bodyFile?await readFile(bodyFile,'utf8'):rest.slice(1).join(' '),attachmentIds:attachmentIds||[]};}
if(action==='react'){route='room_react';body={messageId:rest[0],emoji:rest[1],active:rest[2]==='true'};if(rest[2]!=='true'&&rest[2]!=='false')throw Error('react requires active true or false');}
if(action==='result'||action==='request'){
 const data=rest[0]?.startsWith('{')?JSON.parse(rest.join(' ')):JSON.parse(await readFile(rest[0],'utf8'));
 route=action==='result'?'room_result':'room_request';
 body=action==='result'?{body:data.body,sourceIds:data.sourceIds||[],attachmentIds:attachmentIds||data.attachmentIds||[]}:
  {body:data.body,targets:data.targets,kind:data.kind||'followup',requestKey:requestedKey||data.requestKey||createHash('sha256').update(JSON.stringify(data)).digest('hex'),expectedTurnId:data.expectedTurnId||null,attachmentIds:attachmentIds||data.attachmentIds||[]};
}
if(action==='upload'){
 if(!rest[0])throw Error('upload requires a file path');
 const info=await stat(rest[0]);if(!info.isFile()||info.size>10*1024*1024)throw Error('upload needs a regular file up to 10 MiB');
 const bytes=await readFile(rest[0]),filename=basename(rest[0]);route='room_upload_attachment';
 body={filename,base64:bytes.toString('base64'),requestKey:requestedKey||createHash('sha256').update(filename).update(bytes).digest('hex')};
}
if(action==='read'){if(!rest[0])throw Error('read requires an attachment ID');route='room_read_attachment';body={attachmentId:rest[0]};}
const response=await fetch(url.replace(/\/$/,'')+'/mcp/'+route,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
const result=await response.json();
if(!response.ok){console.error(result.error||'request failed');process.exitCode=1;}
else if(action==='read'&&output){
 if(typeof result.base64!=='string')throw Error('attachment bytes missing');
 await writeFile(output,Buffer.from(result.base64,'base64'));
 const {base64,...metadata}=result;console.log(JSON.stringify({...metadata,saved:true},null,2));
}else console.log(JSON.stringify(result,null,2));
