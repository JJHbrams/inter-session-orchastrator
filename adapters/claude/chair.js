import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const question={type:'object',additionalProperties:false,required:['targetMembershipIds','body'],properties:{targetMembershipIds:{type:'array',items:{type:'string'},minItems:1,maxItems:20},body:{type:'string',minLength:1,maxLength:8000}}};
const proposal={type:'object',additionalProperties:false,required:['body','sourceIds'],properties:{body:{type:'string',minLength:1,maxLength:8000},sourceIds:{type:'array',items:{type:'string'},maxItems:100}}};
const schema=JSON.stringify({type:'object',additionalProperties:false,required:['speech','questions','proposal'],properties:{speech:{type:'string',minLength:1,maxLength:8000},questions:{type:'array',items:question,maxItems:5},proposal:{anyOf:[{type:'null'},proposal]}}});
export function createClaudeChairRunner({spawnProcess=spawn,timeoutMs=150000,maxBytes=2_000_000,command=process.env.CLAUDE_CHAIR_COMMAND||'C:/Users/jhjang/.local/bin/claude.exe'}={}) {
  const call=async({flag,nativeId,cwd,prompt,onStarted})=>{
    await mkdir(cwd,{recursive:true});
    return new Promise((resolve,reject)=>{
      let child,buffer='',bytes=0,started=false,confirmed=false,output,successful=false,settled=false;
      const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){child?.kill();reject(error);}else resolve({nativeId,started,output});};
      const timer=setTimeout(()=>finish(Error('좌장 응답 제한시간 초과 · 실행 여부 확인 필요')),timeoutMs);
      try {
        child=spawnProcess(command,[flag,nativeId,'--print','--output-format','stream-json','--verbose','--include-partial-messages','--json-schema',schema,'--safe-mode','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--permission-mode','manual'],{cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
      } catch(error){finish(error);return;}
      const consume=line=>{
        if(settled||!line.trim())return;
        let event;try{event=JSON.parse(line);}catch{return;}
        const eventId=event.session_id||event.sessionId;
        if(eventId){if(eventId!==nativeId)return finish(Error('좌장 응답의 대화 ID가 요청과 달라.'));confirmed=true;}
        if(event.is_error)return finish(Error('Claude 좌장 실행 실패 · '+(event.subtype||'provider error')));
        if(!started&&(event.type==='assistant'||event.type==='stream_event'&&event.event?.type==='message_start')){
          if(!confirmed)return finish(Error('좌장 신원 확인 전에 응답이 도착했어.'));
          started=true;try{onStarted?.();}catch(error){return finish(error);}
        }
        if(event.type==='result'){
          if(event.subtype&&event.subtype!=='success')return finish(Error('Claude 좌장 실행 실패 · '+event.subtype));
          successful=true;output=event.structured_output;
        }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>maxBytes)return finish(Error('좌장 출력 크기 제한 초과'));buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}});
      child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)finish(Error('좌장 출력 크기 제한 초과'));});
      child.on('error',error=>finish(Error('Claude 좌장을 실행하지 못했어 · '+(error.code||'spawn error'))));
      child.stdin.on('error',()=>{});child.stdin.end(prompt);
      child.on('close',code=>{consume(buffer);if(settled)return;if(code!==0)return finish(Error('Claude 좌장이 응답 완료 전에 종료됐어 · exit '+code));if(!confirmed||!successful||!started||!output)return finish(Error('좌장 신원·모델 응답·구조화 결과를 확인하지 못했어.'));finish();});
    });
  };
  return {initialize:({nativeId,cwd})=>call({flag:'--session-id',nativeId,cwd,prompt:'You are a dedicated discussion chair. Tools are disabled. Coordinate only through the supplied JSON schema. Initialize now with a short Korean greeting in speech, questions:[], proposal:null. Do not ask any questions yet.'}),resume:({nativeId,cwd,body,onStarted})=>call({flag:'--resume',nativeId,cwd,prompt:body,onStarted})};
}
