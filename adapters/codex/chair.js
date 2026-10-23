import {spawn} from 'node:child_process';
import {existsSync,readdirSync} from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexChairOutputSchema,validateChairOutput} from '../chair/schema.js';
const imageTypes={"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp"};
const prompt='You are a dedicated discussion chair. Use no tools. Return only the required JSON response in Korean.';
const config=['features.shell_tool=false','features.unified_exec=false','features.hooks=false','features.memories=false','web_search="disabled"'];
export function resolveCodexLauncher({command,platform=process.platform,env=process.env,exists=existsSync,readDir=readdirSync,node=process.execPath}={}){
 if(command)return {command,args:[]};
 if(platform!=='win32')return {command:'codex',args:[]};
 const npmScript=env.APPDATA&&join(env.APPDATA,'npm','node_modules','@openai','codex','bin','codex.js');
 if(npmScript&&exists(npmScript))return {command:node,args:[npmScript]};
 const binRoot=env.LOCALAPPDATA&&join(env.LOCALAPPDATA,'OpenAI','Codex','bin');
 try {for(const entry of readDir(binRoot,{withFileTypes:true}).filter(item=>item.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name))){const native=join(binRoot,entry.name,'codex.exe');if(exists(native))return {command:native,args:[]};}}catch{}
 return {command:'codex',args:[]};
}
function sizeCheckedImages(images=[]){
 if(!Array.isArray(images)||images.length>5)throw Error('좌장 이미지 입력 한도 초과');let total=0;
 for(const image of images){const bytes=Buffer.from(image.base64||'', 'base64');if(!imageTypes[image.mime]||typeof image.base64!=='string')throw Error('지원하지 않는 좌장 이미지');total+=bytes.length;if(bytes.length>5*1024*1024||total>8*1024*1024)throw Error('좌장 이미지 입력 한도 초과');}return images;
}
function eventId(event){return event.thread_id||event.threadId||event.thread?.id||event.session_id||event.sessionId;}
function messageOutput(event){const item=event.item||event;if(item.type!=='agent_message'&&item.type!=='assistant_message')return undefined;const content=item.text||item.content||item.message?.content;if(typeof content==='string')return content;return Array.isArray(content)?content.map(x=>x.text||'').join(''):undefined;}
export function createCodexChairRunner({spawnProcess=spawn,timeoutMs=150000,maxBytes=2_000_000,command=process.env.CODEX_CHAIR_COMMAND,tempRoot=tmpdir(),launcher=resolveCodexLauncher({command})}={}){
 const call=async({nativeId,cwd,body,onStarted,onNativeId,model,effort,images=[],resume=false})=>{
  const parsedImages=sizeCheckedImages(images);const temp=await mkdtemp(join(tempRoot,'chair-codex-'));const schemaPath=join(temp,'output-schema.json');const files=[];
  try {await writeFile(schemaPath,JSON.stringify(codexChairOutputSchema));for(let i=0;i<parsedImages.length;i++){const image=parsedImages[i];const path=join(temp,`image-${i}.${imageTypes[image.mime]}`);await writeFile(path,Buffer.from(image.base64,'base64'));files.push(path);}return await new Promise((resolve,reject)=>{
   let child,buffer='',bytes=0,actualId,started=false,output,settled=false;
   const args=['exec'];if(resume){args.push('resume',nativeId,'-');}else args.push('-');args.push('--json','--output-schema',schemaPath,'--ignore-user-config','--ignore-rules','--skip-git-repo-check');if(!resume)args.push('--sandbox','read-only');else args.push('-c',"sandbox_mode='read-only'");for(const value of config)args.push('-c',value);if(model!=null)args.push('--model',model);if(effort!=null)args.push('-c',`model_reasoning_effort=${JSON.stringify(effort)}`);for(const file of files)args.push('-i',file);
   const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);if(error){child?.kill();reject(error);}else resolve({nativeId:actualId,started,output});};
   const timer=setTimeout(()=>finish(Error('Codex 좌장 응답 제한시간 초과 · 실행 여부 확인 필요')),timeoutMs);
   try{child=spawnProcess(launcher.command,[...launcher.args,...args],{cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}catch(error){finish(error);return;}
   const consume=line=>{if(settled||!line.trim())return;let event;try{event=JSON.parse(line);}catch{return;}const id=eventId(event);const type=event.type||event.event?.type||'';
    if(resume&&id&&id!==nativeId)return finish(Error('Codex 좌장 응답의 대화 ID가 요청과 달라.'));
    if(type==='thread.started'){if(resume&&id!==nativeId)return finish(Error('Codex 좌장 응답의 대화 ID가 요청과 달라.'));if(!id)return finish(Error('Codex 좌장 native ID를 확인하지 못했어.'));actualId=id;if(!started){started=true;try{resume?onStarted?.():onNativeId?.(actualId);}catch(error){return finish(error);}}}
    if(type==='turn.started'&&resume&&!started){actualId=nativeId;started=true;try{onStarted?.();}catch(error){return finish(error);}}
    if(type==='error'||event.error)return finish(Error('Codex 좌장 실행 실패 · '+(event.error?.message||event.message||'provider error')));
    const text=messageOutput(event);if(text!==undefined){try{const parsed=JSON.parse(text);if(!validateChairOutput(parsed))return finish(Error('Codex 좌장 구조화 결과가 유효하지 않아.'));output=parsed;}catch{return finish(Error('Codex 좌장 구조화 결과가 JSON이 아니야.'));}}
   };
   child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>maxBytes)return finish(Error('Codex 좌장 출력 크기 제한 초과'));buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}});child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)finish(Error('Codex 좌장 출력 크기 제한 초과'));});child.on('error',error=>finish(Error('Codex 좌장을 실행하지 못했어 · '+(error.code||'spawn error'))));child.stdin.on('error',()=>{});child.stdin.end(body);child.on('close',code=>{consume(buffer);if(settled)return;if(code!==0)return finish(Error('Codex 좌장이 응답 완료 전에 종료됐어 · exit '+code));if(!actualId||!started||!output)return finish(Error('Codex 좌장 신원·시작·구조화 결과를 확인하지 못했어.'));finish();});
  });} finally {await rm(temp,{recursive:true,force:true});}
 };
 return {initialize:({cwd,model,effort,onNativeId})=>call({cwd,body:prompt,model,effort,onNativeId}),resume:({nativeId,cwd,body,onStarted,model,effort,images=[]})=>{if(!nativeId)throw Error('Codex 좌장 native ID가 필요해.');return call({nativeId,cwd,body,model,effort,onStarted,images,resume:true});}};
}
