import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
test('MCP stdio initializes without an SDK',async()=>{const p=spawn(process.execPath,['packages/mcp/server.js'],{env:{...process.env,ROOMS_TOKEN:'test'},stdio:['pipe','pipe','pipe'],shell:false});p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})+'\n');const [buf]=await once(p.stdout,'data');const answer=JSON.parse(buf);assert.equal(answer.result.serverInfo.name,'session-rooms');p.kill();});
