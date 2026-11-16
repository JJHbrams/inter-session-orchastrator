import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../services/coordinator/store.js';
import {KnowledgeStore} from '../services/coordinator/knowledge.js';
import {createReferenceService} from '../services/coordinator/references.js';

function fixture(t,{unassigned=false,symlinkHistory=false}={}){
 const root=mkdtempSync(join(tmpdir(),'room-reference-')),store=new Store();t.after(()=>store.db.close());
 const channel=store.createChannel('개발'),room=store.createRoom('회의',unassigned?null:channel.id);
 const agenda={id:'agenda-2',title:'배포 결정',phase:'completed',outcome:'consensus',revision:2};
 const knowledge=new KnowledgeStore(store,{defaultRoot:root}),base=unassigned?join(root,'rooms',room.id):join(root,'channels',channel.id,'rooms',room.id);
 mkdirSync(join(base,'agendas'),{recursive:true});
 if(symlinkHistory){const outside=mkdtempSync(join(tmpdir(),'room-reference-outside-'));writeFileSync(join(outside,'index.md'),'outside history');symlinkSync(outside,join(base,'history'),process.platform==='win32'?'junction':'dir');}
 else {mkdirSync(join(base,'history'));writeFileSync(join(base,'history','index.md'),'history chunks');}
 writeFileSync(join(base,'manifest.json'),JSON.stringify({owner:'inter-session-rooms-knowledge/v1',roomId:room.id,channelId:room.channel_id}));
 writeFileSync(join(base,'index.md'),'room index');writeFileSync(join(base,'transcript.md'),'conversation');
 writeFileSync(join(base,'agendas',agenda.id+'.md'),`# ${agenda.title}\n\n- id: ${agenda.id}\n- 결론 revision: 2\n`);
 if(!unassigned)writeFileSync(join(root,'channels',channel.id,'index.md'),'channel index');
 const service=createReferenceService({store,knowledge,debates:{list:id=>({agendas:id===room.id?[agenda]:[]})}});
 return {root,base,store,knowledge,channel,room,agenda,service,query:{roomId:room.id,agendaId:agenda.id}};
}

test('references resolve all scopes and retain stable paths through renames',t=>{
 const f=fixture(t),a=f.service.get(f.query);assert.equal(a.available,true);assert.equal(a.agenda.revision,2);
 assert.equal(a.agenda.file,join(f.base,'agendas',f.agenda.id+'.md'));
 assert.equal(f.service.get({channelId:f.channel.id}).channel.index,join(f.root,'channels',f.channel.id,'index.md'));
 assert.equal(f.service.get({roomId:f.room.id}).room.index,join(f.base,'index.md'));
 f.store.renameRoom(f.room.id,'새 회의');f.store.renameChannel(f.channel.id,'새 채널');
 const b=f.service.get(f.query);assert.equal(b.room.name,'새 회의');assert.equal(b.channel.name,'새 채널');assert.equal(b.agenda.file,a.agenda.file);
});

test('unassigned rooms and normalized configured roots remain readable',t=>{
 const f=fixture(t,{unassigned:true});
 for(const root of [f.root.replaceAll('\\','/'),f.root+'/']){
  f.store.db.prepare("UPDATE knowledge_settings SET value=? WHERE key='storageRoot'").run(root);
  const result=f.service.get(f.query);assert.equal(result.available,true);assert.equal(Boolean(result.channel),false);assert.equal(result.agenda.file,join(f.base,'agendas',f.agenda.id+'.md'));
 }
});

test('references reject wrong hierarchy, unknown agendas and traversal without creating exports',t=>{
 const f=fixture(t),other=f.store.createChannel('다른 채널');
 for(const q of [{channelId:other.id,roomId:f.room.id},{roomId:f.room.id,agendaId:'unknown'},{roomId:'../outside'},{channelId:f.channel.id,agendaId:f.agenda.id}])assert.equal(f.service.get(q).available,false);
 const absent=join(f.root,'not-exported');f.store.db.prepare("UPDATE knowledge_settings SET value=? WHERE key='storageRoot'").run(absent);
 const result=f.service.get(f.query);assert.equal(result.available,false);assert.equal(result.room.id,f.room.id);assert.equal(existsSync(absent),false);
});

test('exact agenda metadata rejects revision prefixes and foreign IDs, without rewriting files',t=>{
 const f=fixture(t),file=join(f.base,'agendas',f.agenda.id+'.md');
 for(const content of [`- id: ${f.agenda.id}\n- 결론 revision: 20\n`,`- id: ${f.agenda.id}-foreign\n- 결론 revision: 2\n`]){
  writeFileSync(file,content);assert.equal(f.service.get(f.query).available,false);assert.equal(readFileSync(file,'utf8'),content);
 }
});

test('a manifest alone cannot advertise missing room documents as available',t=>{
 const f=fixture(t);
 for(const file of [join(f.base,'index.md'),join(f.base,'history','index.md'),join(f.base,'transcript.md')]){
  const original=readFileSync(file);rmSync(file);assert.equal(f.service.get({roomId:f.room.id}).available,false);writeFileSync(file,original);
 }
});

test('a symlinked history directory cannot expose files outside the configured root',t=>{
 const f=fixture(t,{symlinkHistory:true});const result=f.service.get(f.query);assert.equal(result.available,false);assert.equal(result.paths,undefined);
});
