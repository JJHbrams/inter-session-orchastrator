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
