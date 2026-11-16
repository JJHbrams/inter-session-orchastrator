import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('reaction tools advertise actor identity and distinct feedback semantics to the model',async()=>{
 const p=spawn(process.execPath,['packages/mcp/server.js'],{env:{...process.env,ROOMS_TOKEN:'test'},stdio:['pipe','pipe','pipe'],shell:false});
 try{
  p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');const [buf]=await once(p.stdout,'data');const tools=JSON.parse(buf).result.tools,react=tools.find(t=>t.name==='room_react');
  assert.deepEqual(react.inputSchema.properties.emoji.enum.slice(0,5),['👍','👎','❓','✅','💡']);assert.equal(react.inputSchema.additionalProperties,false);
  assert.match(react.description,/authenticated session/);assert.match(react.description,/not agreement or completed work/);assert.match(react.description,/named reactor/);assert.match(tools.find(t=>t.name==='room_inbox').description,/prior authored messages/);
 }finally{p.kill();}
});
test('MCP stdio initializes without an SDK',async()=>{const p=spawn(process.execPath,['packages/mcp/server.js'],{env:{...process.env,ROOMS_TOKEN:'test'},stdio:['pipe','pipe','pipe'],shell:false});p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})+'\n');const [buf]=await once(p.stdout,'data');const answer=JSON.parse(buf);assert.equal(answer.result.serverInfo.name,'session-rooms');p.kill();});

test('combined reaction schema and authenticated payload survive the actual stdio MCP path',async()=>{
 let seen;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen={path:req.url,authorization:req.headers.authorization,payload:JSON.parse(body)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({received:true}));});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const p=spawn(process.execPath,['packages/mcp/server.js'],{env:{...process.env,ROOMS_URL:'http://127.0.0.1:'+server.address().port,ROOMS_TOKEN:'transport-test-token'},stdio:['pipe','pipe','pipe'],shell:false});
 const lines=createInterface({input:p.stdout});
 async function request(id,method,params){const next=once(lines,'line');p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');return JSON.parse((await next)[0]);}
 try{
  const listed=await request(1,'tools/list');
  const participate=listed.result.tools.find(t=>t.name==='room_participate').inputSchema;
  assert.equal(participate.additionalProperties,false);
  assert.equal(participate.properties.reaction.additionalProperties,false);
  assert.deepEqual(participate.properties.reaction.required,['messageId','emoji','active']);
  assert.ok(participate.properties.reaction.properties.emoji.enum.includes('👀'));
  const review=listed.result.tools.find(t=>t.name==='room_review').inputSchema;
  assert.ok(review.properties.actionableCorrection.properties.sourceIds);
  const payload={agendaId:'agenda',intentId:'notification',decision:'abstain',sourceIds:['source'],reaction:{messageId:'source',emoji:'✅',active:true}};
  const reply=await request(2,'tools/call',{name:'room_participate',arguments:payload});
  assert.equal(reply.result.isError,undefined);
  assert.deepEqual(seen,{path:'/mcp/room_participate',authorization:'Bearer transport-test-token',payload});
  assert.equal(JSON.parse(reply.result.content[0].text).received,true);
  const postSchema=listed.result.tools.find(t=>t.name==='room_post').inputSchema;assert.equal(postSchema.properties.replyTo.type,'string');
  const post={body:'a correction',replyTo:'original-message',requestKey:'correction'};await request(3,'tools/call',{name:'room_post',arguments:post});assert.deepEqual(seen.payload,post);assert.equal(seen.path,'/mcp/room_post');
 }finally{lines.close();p.kill();await new Promise(ok=>server.close(ok));}
});
