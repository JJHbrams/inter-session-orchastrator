import {RoomHistory} from './history.js';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { Store } from './store.js';
import { KnowledgeStore } from './knowledge.js';
import { DebateCoordinator } from './debate.js';
import { collaborationApi, collaborationMcp } from './collaboration-api.js';
import { ChairCoordinator } from './chair.js';
import { listSessions } from '../../adapters/catalog/index.js';
import { validateWorkspace, workspaceInfo, exportWorkspace, workspaceSignature } from './workspace.js';
import { ParticipantDispatcher } from './participant-dispatcher.js';
import {participantInstructions} from '../../packages/contracts/participant-instructions.js';
import { discover, readOutput, createOrcaParticipantAdapter } from '../../adapters/orca/index.js';
import { createOrcaNativeChatAdapter } from '../../adapters/orca/native-chat.js';
import { createChairRunner } from '../../adapters/chair/index.js';
import { getChairOptions } from '../../adapters/chair/options.js';
import { normalizeChairSettings } from '../../packages/contracts/chair-settings.js';
import {ParticipantSettings} from './participant-settings.js';
import {ParticipantMetadataObserver} from './participant-metadata.js';
import {SessionCreationService} from './session-creation.js';
import {createOrcaSessionCreateAdapter} from '../../adapters/orca/session-create.js';
import {createNativeModelSettings} from '../../adapters/orca/model-settings.js';
import {createReferenceService} from './references.js';
import {AppUpdates} from './app-updates.js';
import {OfficeObserver} from '../../adapters/office/observer.js';
const sourceRoot=resolve(import.meta.dirname,'../..');
/** Each runtime owns its routes, stores and authentication state. Importing performs no I/O. */
function createCoordinator(options={}){
let root=sourceRoot,staticRoot=join(root,'apps','desktop'),port=4318,host='127.0.0.1',dbPath,resourceRoot=root,workspaceRoot=root;
let store,chairs,participants,knowledge,debates,participantSettings,history,references,nativeChatAdapter,metadataObserver,officeObserver,creations,server,secret,csrf,cookieName,updates;
let appVersion=null;
const json=(res,status,data)=>{const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});res.end(body)};
const tokenHash=t=>createHash('sha256').update(t).digest('hex');
function localHost(req){return req.headers.host===`${host}:${port}`;}
function auth(req){const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));const got=Buffer.from(cookies[cookieName]||'');const expected=Buffer.from(secret);return got.length===expected.length&&timingSafeEqual(got,expected);}
function mutation(req){const origin=req.headers.origin; return localHost(req)&&auth(req)&&req.headers['x-csrf-token']===csrf&&(!origin||origin===`http://${host}:${port}`);}
async function body(req,limit=262144){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>limit)throw Error('body too large');chunks.push(c)}let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Error('invalid JSON')}if(!value||Array.isArray(value)||typeof value!=='object')throw Error('JSON object required');return value}
function fail(res,e){const status=['CONFLICT','ACTIVE_CHILD_ROOMS','PROVIDER_IMMUTABLE'].includes(e.code)?409:400,data={error:e.message||'invalid request'};if(e.code)data.code=e.code;if(Number.isInteger(e.activeChildCount))data.activeChildCount=e.activeChildCount;json(res,status,data);}
function nativeChatBinding(binding){try{return JSON.parse(binding?.capabilities||'{}').transport==='orca-native-chat';}catch{return false;}}
function participantAdapterRouter(terminal,native){
 const adapter=binding=>nativeChatBinding(binding)?native:terminal;
 return {
  preflight(binding,session,options={}){return adapter(binding).preflight(binding,session,options);},
  send(binding,session,prompt,requestId,options={}){return adapter(binding).send(binding,session,prompt,requestId,options);},
  reconnect(binding,session){return nativeChatBinding(binding)&&native.reconnect?native.reconnect(binding,session):null;}
 };
}
async function discoverNativeChats(options={}){try{return await nativeChatAdapter.discover(options);}catch(error){return {sessions:[],errors:[{provider:'orca-native-chat',message:error.message||'native chat discovery failed'}]};}}

const attachmentRoute=url=>url.pathname.match(/^\/api\/rooms\/([^/]+)\/attachments\/([^/]+)$/);
function sendAttachment(req,res,roomId,attachmentId,url){
 // Keep this guard local to the byte reader as well as the API dispatcher.
 if(!localHost(req)||!auth(req))return json(res,401,{error:'local authentication required',code:'AUTH_REQUIRED'});
 const file=store.readAttachment(roomId,attachmentId),bytes=Buffer.from(file.base64,'base64');
 const inline=['image/png','image/jpeg','image/gif','image/webp'].includes(file.mime)&&url.searchParams.get('download')!=='1';
 const filename=encodeURIComponent(file.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 res.writeHead(200,{'Content-Type':inline?file.mime:'application/octet-stream','Content-Length':bytes.length,'Content-Disposition':(inline?'inline':'attachment')+"; filename*=UTF-8''"+filename,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox"});
 res.end(bytes);
}

async function mcp(req,res,url){try {
 if(!localHost(req)||(req.headers.origin&&req.headers.origin!==`http://${host}:${port}`))return json(res,403,{error:'Host or Origin validation failed'});
 if(req.method!=='POST')return json(res,405,{error:'POST required'});
 const bearer=(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1],reg=bearer&&store.registration(tokenHash(bearer));if(!reg)return json(res,401,{error:'valid room registration required'});
 const action=url.pathname.split('/').pop(),b=await body(req,action==='room_upload_attachment'?15*1024*1024:262144);
 if(action.startsWith('room_knowledge_')||action.startsWith('room_history_')||action==='room_review'||action==='room_acknowledge_approval'){if(reg.read_only&&!action.startsWith('room_history_')&&!['room_knowledge_list','room_knowledge_read'].includes(action))throw Error('read-only membership is view-only');const result=collaborationMcp(action,reg,b,{knowledge,debates,history});if(result===undefined)throw Error('unknown room tool');if(action==='room_knowledge_add')knowledge.export(reg.room_id);return json(res,200,result);}
 if(action==='room_context')return json(res,200,{...store.room(reg.room_id),agendas:debates.list(reg.room_id).agendas,knowledge:knowledge.list(reg.room_id,{},reg),knowledgeChanges:knowledge.sync(reg.room_id,reg),reactionFeedback:store.reactionFeedback(reg.room_id,reg.session_id),ownIdentity:store.identity(reg)});
 if(action==='room_inbox'){
  const inbox=store.inbox(reg,b.requestId||null),cwd=store.room(reg.room_id).cwd,knowledgeChanges=knowledge.sync(reg.room_id,reg),request=inbox.inbox[0];inbox.participants=store.room(reg.room_id).members.filter(member=>!member.left_at).map(({id,alias,provider,role,read_only})=>({membershipId:id,alias,provider,role,readOnly:!!read_only}));
  return json(res,200,{...inbox,roomId:reg.room_id,cwd,ownIdentity:store.identity(reg),knowledgeChanges,participantInstructions:request?participantInstructions({room_id:reg.room_id,room_cwd:cwd},join(dirname(resolve(dbPath)),'participants',reg.id+'.json'),request.request_id,knowledgeChanges):null});
 }
 if(action==='room_read_attachment')return json(res,200,store.readAttachment(reg.room_id,b.attachmentId,reg.session_id));
 if(reg.read_only)return json(res,403,{error:'read-only membership is view-only'});
 if(action==='room_react')return json(res,200,store.react(reg,b.messageId,b.emoji,b.active));
 if(action==='room_participate')return json(res,201,debates.reactive.decide(reg,b));
 if(action==='room_upload_attachment')return json(res,201,store.uploadAttachment(reg.room_id,b,reg.session_id));
 if(action==='room_post')return json(res,201,store.postWithEvidence({roomId:reg.room_id,senderSessionId:reg.session_id,body:b.body,attachmentIds:b.attachmentIds||[],evidence:b.evidence??null,kind:'post',targets:[],replyTo:b.replyTo||null,requestKey:b.requestKey||null}));
 if(action==='room_reply'){let review;try{review=JSON.parse(b.body)}catch{}if(review?.agendaId&&review?.intentId&&review?.decision==='abstain')return json(res,201,debates.reactive.decide(reg,review));if(review?.agendaId&&review?.roundId&&review?.stance){const bodyAttachmentIds=review.attachmentIds||[],topAttachmentIds=b.attachmentIds;if(topAttachmentIds!==undefined&&!Array.isArray(topAttachmentIds))throw Error('invalid attachment IDs');if(Array.isArray(topAttachmentIds)&&topAttachmentIds.length&&bodyAttachmentIds.length&&JSON.stringify(topAttachmentIds)!==JSON.stringify(bodyAttachmentIds))throw Error('review attachment IDs conflict');const attachmentIds=Array.isArray(topAttachmentIds)&&topAttachmentIds.length?topAttachmentIds:bodyAttachmentIds,bodyEvidence=review.evidence,topEvidence=b.evidence;if(bodyEvidence!==undefined&&topEvidence!==undefined&&(bodyEvidence?.title!==topEvidence?.title||bodyEvidence?.body!==topEvidence?.body))throw Error('review evidence conflict');const evidence=topEvidence===undefined?bodyEvidence:topEvidence;return json(res,201,debates.recordReview(reg.room_id,reg,{...review,attachmentIds,evidence,requestId:b.requestId,actionableCorrection:review.actionableCorrection??null}));}return json(res,201,store.reply(reg,b.requestId,b.body,b.attachmentIds||[],b.evidence??null));}
 if(action==='room_result')return json(res,201,store.result(reg,b.body,b.sourceIds||[],b.attachmentIds||[]));
 if(action==='room_request'){if(!Array.isArray(b.targets))throw Error('targets must be a membership ID list');if(b.agendaId)return json(res,201,debates.reactive.request(reg,{agendaId:b.agendaId,body:b.body,targets:b.targets,sourceIds:b.sourceIds||[],requestId:b.requestKey,replyTo:b.replyTo||null,attachmentIds:b.attachmentIds||[],evidence:b.evidence??null}));debates.reactive.beforeLegacyRequest(reg);return json(res,201,store.postWithEvidence({roomId:reg.room_id,senderSessionId:reg.session_id,body:b.body,attachmentIds:b.attachmentIds||[],evidence:b.evidence??null,kind:b.kind||'followup',targets:b.targets,requestKey:b.requestKey||null,expectedTurnId:b.expectedTurnId||null}));}
 return json(res,404,{error:'unknown room tool'});
 }catch(e){fail(res,e)}}
async function api(req,res,url){try { if(!localHost(req))return json(res,403,{error:'Host validation failed'}); if(req.method==='GET'&&url.pathname==='/api/bootstrap'){const origin=req.headers.origin;if(origin&&origin!==`http://${host}:${port}`)return json(res,403,{error:'Origin validation failed'});res.setHeader('Set-Cookie',`${cookieName}=${secret}; HttpOnly; SameSite=Strict; Path=/`);return json(res,200,{csrf,version:appVersion,limits:{bodyBytes:262144},capabilities:{externalLive:'unverified',desktopShell:'deferred'}})} if(!auth(req))return json(res,401,{error:'local authentication required',code:'AUTH_REQUIRED'}); if(req.method==='GET'&&url.pathname==='/api/updates/status')return json(res,200,updates.status()); if(await collaborationApi(req,res,url,{store,knowledge,debates,history,mutation,body,json,fail}))return; const attachment=attachmentRoute(url);if(req.method==='GET'&&attachment)return sendAttachment(req,res,attachment[1],attachment[2],url); if(req.method==='GET'&&url.pathname==='/api/rooms')return json(res,200,{rooms:store.rooms()}); if(req.method==='GET'&&url.pathname==='/api/channels')return json(res,200,{channels:store.channels()}); if(req.method==='GET'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/sessions\/[^/]+\/output$/)){
 const bits=url.pathname.split('/'),roomId=bits[3],sessionId=bits[5];
 const permitted=()=>store.db.prepare('SELECT b.* FROM bindings b JOIN memberships m ON m.session_id=b.session_id WHERE m.room_id=? AND m.session_id=? AND m.left_at IS NULL AND b.active=1').get(roomId,sessionId);
 const binding=permitted();if(!binding||JSON.parse(binding.capabilities).rawInspect!==true)return json(res,403,{error:'active room membership and rawInspect capability required'});
 const output=await readOutput(binding);const after=permitted();if(!after||after.id!==binding.id||JSON.parse(after.capabilities).rawInspect!==true)return json(res,403,{error:'room membership or binding changed during inspection'});return json(res,200,output);
 } if(req.method==='GET'&&url.pathname==='/api/sessions/catalog'){
 const registered=store.db.prepare('SELECT s.*,b.handle,b.incarnation,b.mode,b.ownership,b.verified_at,b.capabilities FROM sessions s JOIN bindings b ON b.session_id=s.id AND b.active=1').all();
 const catalog=await (options.sessionCatalog||listSessions)({query:url.searchParams.get('query')||'',provider:url.searchParams.get('provider')||'',includeInternal:url.searchParams.get('includeInternal')==='1',registeredSessionIds:registered.filter(s=>s.ownership!=='owned').map(s=>s.native_id)});
 const native=await discoverNativeChats({provider:url.searchParams.get('provider')||undefined});
 const norm=p=>String(p||'').replaceAll('\\','/').replace(/^\/\/\?\/([a-z]:\/)/i,'$1').replace(/^\/\/\?\/UNC\//i,'//').replace(/\/+$/,'').toLowerCase();
 const terminalSessions=catalog.sessions.map(item=>{const exact=registered.filter(s=>s.provider===item.provider&&s.native_id===item.sessionId&&norm(s.cwd)===norm(item.cwd));const bound=exact.length===1?exact[0]:null;return {...item,nativeTitle:item.title,title:bound?.alias?bound.alias+' · '+(bound.display_name||item.title):item.title,nativeId:item.sessionId,host:bound?.host||'orca/local',profile:bound?.profile||'default',modelSettings:bound?store.participantModelState(bound.id,bound.incarnation):null,registeredSessionId:bound?.id||null,handle:bound?.handle||null,incarnation:bound?.incarnation||null,live:!!(bound?.handle&&bound?.incarnation),automaticInput:!!(bound?.verified_at&&bound?.handle&&bound?.incarnation),blockedReason:bound?.handle?null:'이력 목록이야. 실행 중인 세션과 연결하려면 원래 세션의 정확한 연결을 확인해줘.'};});
 const query=(url.searchParams.get('query')||'').trim().toLowerCase(),nativeSessions=(native.sessions||[]).map(item=>{const prior=terminalSessions.find(existing=>existing.provider===item.provider&&existing.nativeId===item.nativeId&&norm(existing.cwd)===norm(item.cwd));return {...item,title:item.title||prior?.title||item.nativeId,nativeTitle:item.title||prior?.nativeTitle||item.nativeId,live:true};}).filter(item=>!query||[item.title,item.nativeId,item.cwd,item.provider].some(value=>String(value||'').toLowerCase().includes(query))),nativeKeys=new Set(nativeSessions.map(item=>`${item.provider}\u0000${item.nativeId}\u0000${norm(item.cwd)}`));
 return json(res,200,{...catalog,sessions:[...terminalSessions.filter(item=>!nativeKeys.has(`${item.provider}\u0000${item.nativeId}\u0000${norm(item.cwd)}`)),...nativeSessions],errors:[...(catalog.errors||[]),...(native.errors||[])]});
 } if(req.method==='GET'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/office$/)){if(req.headers.origin&&req.headers.origin!==`http://${host}:${port}`)return json(res,403,{error:'Origin validation failed',code:'ORIGIN_INVALID'});const roomId=url.pathname.split('/')[3];return json(res,200,await officeObserver.observe(store.room(roomId)));} if(req.method==='GET'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/workspace$/))return json(res,200,workspaceInfo(store,url.pathname.split('/')[3])); if(req.method==='GET'&&url.pathname.startsWith('/api/rooms/')){const roomId=url.pathname.split('/')[3];observeCreations(roomId);return json(res,200,{...metadataObserver.decorate(store.room(roomId)),sessionCreations:creations.forRoom(roomId),agendas:debates.list(roomId).agendas});} if(req.method==='GET'&&url.pathname==='/api/discovery'){const terminal=await (options.discoverSessions||discover)(),native=await discoverNativeChats();return json(res,200,{...terminal,sessions:[...(terminal.sessions||[]),...(native.sessions||[])],errors:[...(terminal.errors||[]),...(native.errors||[])]});} if(req.headers.origin&&req.headers.origin!==`http://${host}:${port}`)return json(res,403,{error:'Origin validation failed',code:'ORIGIN_INVALID'}); if(!mutation(req))return json(res,403,{error:'CSRF validation failed',code:'CSRF_INVALID'});
 const upload=url.pathname.match(/^\/api\/rooms\/([^/]+)\/attachments$/);
 const b=await body(req,req.method==='POST'&&upload?15*1024*1024:262144);
 if(req.method==='POST'&&url.pathname==='/api/updates/check')return json(res,200,await updates.check());
 if(req.method==='POST'&&url.pathname==='/api/updates/preferences')return json(res,200,await updates.preferences(b));
 if(req.method==='POST'&&url.pathname==='/api/updates/prompt')return json(res,200,await updates.prompt(b));
 if(req.method==='POST'&&url.pathname==='/api/updates/prepare')return json(res,200,await updates.prepare(b));
 if(req.method==='POST'&&url.pathname==='/api/updates/cancel')return json(res,200,await updates.cancel(b));
 if(req.method==='POST'&&url.pathname==='/api/updates/acknowledge-install-result')return json(res,200,await updates.acknowledgeInstallResult(b));
 const startsExternal=/^\/api\/(?:chair\/|sessions\/native-chat$|rooms\/[^/]+\/(?:sessions\/[^/]+\/metadata$|sessions\/create$|session-creations\/[^/]+\/reconcile$|sessions\/[^/]+\/settings\/|deliveries\/[^/]+\/retry$|chair(?:\/reconcile)?$))/;
 if(updates?.fence&&startsExternal.test(url.pathname))throw Object.assign(Error('Update preparation is in progress'),{code:'UPDATE_BUSY'});
 const creationRoute=url.pathname.match(/^\/api\/rooms\/([^/]+)\/sessions\/create$/);
 if(req.method==='POST'&&creationRoute){if(updates?.fence)throw Object.assign(Error('Update preparation is in progress'),{code:'UPDATE_BUSY'});const roomId=creationRoute[1],result=creations.create(roomId,b);track(Promise.resolve(result).then(created=>{if(created?.sessionId)metadataObserver.observe(created.sessionId,{force:true});}));const created=creations.forRoom(roomId).find(item=>item.requestKey===String(b.requestKey||'').trim());return json(res,created?.status==='ready'?201:202,created);}
 const reconcileCreation=url.pathname.match(/^\/api\/rooms\/([^/]+)\/session-creations\/([^/]+)\/reconcile$/);
 if(req.method==='POST'&&reconcileCreation){const [,roomId,id]=reconcileCreation;if(!creations.get(roomId,id))throw Error('session creation not found');track(Promise.resolve(creations.reconcile(roomId,id)).then(created=>{if(created?.sessionId)metadataObserver.observe(created.sessionId,{force:true});}));return json(res,202,creations.get(roomId,id));}
 const metadataRoute=url.pathname.match(/^\/api\/rooms\/([^/]+)\/sessions\/([^/]+)\/metadata$/);
 if(req.method==='POST'&&metadataRoute){const [,roomId,sessionId]=metadataRoute;if(!store.room(roomId).members.some(member=>member.session_id===sessionId&&!member.left_at))throw Error('active membership required');metadataObserver.observe(sessionId,{force:true});return json(res,202,{status:'pending'});}

 if(req.method==='POST'&&upload)return json(res,201,store.uploadAttachment(upload[1],b));
 if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/attachments\/[^/]+\/discard$/)){const bits=url.pathname.split('/');return json(res,200,store.discardAttachment(bits[3],bits[5]));}

 if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/workspace$/)){const roomId=url.pathname.split('/')[3];store.setWorkspace(roomId,validateWorkspace(b.cwd));return json(res,200,exportWorkspace(store,roomId));}
 if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/workspace\/export$/))return json(res,200,exportWorkspace(store,url.pathname.split('/')[3]));
 const settingsRoute=url.pathname.match(/^\/api\/rooms\/([^/]+)\/sessions\/([^/]+)\/settings\/(inspect|apply|reconcile)$/);if(req.method==='POST'&&settingsRoute){if(updates?.fence)throw Object.assign(Error('Update preparation is in progress'),{code:'UPDATE_BUSY'});return json(res,200,await participantSettings.run(settingsRoute[1],settingsRoute[2],settingsRoute[3],b));}
 if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/sessions\/[^/]+\/automation$/)){const parts=url.pathname.split('/');return json(res,200,store.setAutomation(parts[3],parts[5],b.enabled));}
 if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/deliveries\/[^/]+\/retry$/)){const parts=url.pathname.split('/');return json(res,200,await participants.retry(parts[3],parts[5],{composerConfirmation:b.composerConfirmation||null}));}
 if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/deliveries\/[^/]+\/rebind$/)){const parts=url.pathname.split('/');return json(res,200,store.rebindQueuedDelivery(parts[3],parts[5],b.bindingId));}
 if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/chair\/reconcile$/))return json(res,200,chairs.reconcile(url.pathname.split('/')[3],b.runId));
 if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/chair$/)){if(updates?.fence)throw Object.assign(Error('Update preparation is in progress'),{code:'UPDATE_BUSY'});const roomId=url.pathname.split('/')[3];const room=store.room(roomId);if(room.archived_at||room.paused_at)throw Error('토론장을 재개한 뒤 좌장을 만들어줘.');track(chairs.create(roomId).catch(e=>console.error('Chair initialization failed: '+e.message)));return json(res,202,store.chair(roomId));}
 if(req.method==='POST'&&url.pathname.match(/^\/api\/channels\/[^/]+\/rename$/))return json(res,200,store.renameChannel(url.pathname.split('/')[3],b.name)); if(req.method==='POST'&&url.pathname.match(/^\/api\/channels\/[^/]+\/(archive|restore)$/)){const bits=url.pathname.split('/'),channel=bits[3];return json(res,200,bits[4]==='archive'?store.archiveChannel(channel):store.restoreChannel(channel));} if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/rename$/))return json(res,200,store.renameRoom(url.pathname.split('/')[3],b.name)); if(req.method==='POST'&&url.pathname==='/api/channels')return json(res,201,store.createChannel(b.name)); if(req.method==='POST'&&url.pathname==='/api/rooms')return json(res,201,store.createRoom(b.name,b.channelId||null,validateWorkspace(b.cwd||workspaceRoot))); if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/limits$/)){store.limits(url.pathname.split('/')[3],b.requestBudget,b.roundBudget);return json(res,200,{ok:true});} if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/role$/)){store.role(url.pathname.split('/')[3],b.sessionId,b.role);return json(res,200,{ok:true});} if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/(archive|restore|pause|resume)$/)){const bits=url.pathname.split('/'),action=bits[4];if(action==='archive')store.archiveRoom(bits[3]);else if(action==='restore')return json(res,200,store.restoreRoom(bits[3]));else store.pause(bits[3],action==='pause');return json(res,200,{ok:true});} if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/decisions\/[^/]+\/confirm$/)){store.confirmDecision(url.pathname.split('/')[3],url.pathname.split('/')[5]);return json(res,200,{ok:true});}
 if(req.method==='POST'&&url.pathname==='/api/sessions/native-chat'){const verified=await nativeChatAdapter.verify({provider:b.provider,nativeId:b.nativeId,cwd:b.cwd,handle:b.handle||null,incarnation:b.incarnation||null});if(!verified?.verified)throw Error(verified?.reason||verified?.reasonCode||'native chat verification failed');verified.capabilities={...verified.capabilities,automaticInput:b.automaticInput===true};const registered=store.registerSession(verified);metadataObserver.observe(registered.session.id,{force:true});return json(res,201,registered);}
 if(req.method==='POST'&&url.pathname==='/api/sessions'){if(b.capabilities?.transport==='orca-native-chat')throw Error('native chat invitations must use /api/sessions/native-chat');return json(res,201,store.registerSession(b));} if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/join$/)){const member=store.join(url.pathname.split('/')[3],b.sessionId,b.readOnly!==false);metadataObserver.observe(b.sessionId,{force:true});return json(res,201,member);} if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/leave$/)){store.leave(url.pathname.split('/')[3],b.sessionId);return json(res,200,{ok:true});} if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/provision$/)){const token=randomBytes(24).toString('base64url');store.provision(url.pathname.split('/')[3],b.sessionId,tokenHash(token));return json(res,201,{token,config:{url:`http://${host}:${port}`,token},warning:'Save this private config only for the selected participant.'});} if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/messages\/[^/]+\/reactions$/)){const bits=url.pathname.split('/');return json(res,200,store.setReaction(bits[3],bits[5],b.emoji,b.active));} if(req.method==='POST'&&url.pathname.match(/^\/api\/rooms\/[^/]+\/messages$/))return json(res,201,store.post({roomId:url.pathname.split('/')[3],body:b.body,attachmentIds:b.attachmentIds||[],kind:b.kind,targets:b.targets||[],routingMode:b.routingMode||null,requestKey:b.requestKey||null,replyTo:b.replyTo||null,expectedTurnId:b.expectedTurnId||null})); return json(res,404,{error:'not found'});
 }catch(e){fail(res,e)}}
async function staticFile(req,res,path){
 const brandTypes={'/assets/brand/session-rooms.svg':'image/svg+xml','/assets/brand/session-rooms.ico':'image/x-icon',...Object.fromEntries([16,24,32,48,64,128,180,192,256,512].map(size=>[`/assets/brand/session-rooms-${size}.png`,'image/png']))};
 const brandPath=path==='/favicon.ico'?'/assets/brand/session-rooms.ico':path;
 if(brandTypes[brandPath]){try{const data=await readFile(join(staticRoot,brandPath.slice(1)));res.writeHead(200,{'Content-Type':brandTypes[brandPath],'Content-Length':data.length,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'none'; style-src 'none'; sandbox"});return res.end(data)}catch{return json(res,404,{error:'not found'})}}
 if(path==='/reference-links.js'){try{const data=await readFile(join(staticRoot,'reference-links.js'));res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});return res.end(data)}catch{return json(res,404,{error:'not found'})}}
 const vendor={'/vendor/marked.js':'node_modules/marked/lib/marked.esm.js','/vendor/purify.js':'node_modules/dompurify/dist/purify.es.mjs','/vendor/pixi.mjs':'apps/desktop/vendor/pixi.mjs'}[path];
 if(vendor){try{const data=await readFile(join(root,vendor));res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});return res.end(data);}catch{return json(res,404,{error:'Run npm ci to install the local renderer dependencies'});}}
if(path==='/mentions.js'){const data=await readFile(join(root,'packages/contracts/mentions.js'));res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff'});return res.end(data)}const clean=path==='/'?'index.html':path.replace(/^\//,'');if(!['index.html','app.js','app-updates-ui.js','creation-form.js','directory-picker.js','session-location.js','new-session-dialog.js','agenda-ui.js','participant-settings-ui.js','session-inspector.js','chair-settings.js','delivery-status.js','session-choice.js','api-client.js','layout.js','rich-text.js','attachments.js','channel-nav.js','style.css','agent-office.js','office-controller.js','office-pixi-scene.js','office-pixi-model.js','office-seat-frames.js','office-action-frames.js','office-sprites.js','office.css','assets/office/office-background.png','assets/office/office-meeting-background.png','assets/office/meeting-seats.png','assets/office/claude-seated.png','assets/office/codex-seated.png','assets/office/claude-travel.png','assets/office/codex-travel.png','assets/office/work-torsos.png','assets/office/claude-sprites.png','assets/office/codex-sprites.png','assets/providers/claude.png','assets/providers/codex.png','assets/providers/antigravity.png'].includes(clean))return json(res,404,{error:'not found'});try{const full=resolve(staticRoot,clean);if(!full.startsWith(staticRoot))throw Error();if((await stat(full)).isDirectory())throw Error();const data=await readFile(full);const type=full.endsWith('.js')?'text/javascript':full.endsWith('.css')?'text/css':full.endsWith('.png')?'image/png':'text/html';res.writeHead(200,{'Content-Type':type+(type==='image/png'?'':'; charset=utf-8'),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'"});res.end(data)}catch{json(res,404,{error:'not found'})}}
async function chairSettingsApi(req,res,url){if(!url.pathname.startsWith('/api/chair/')&&!url.pathname.match(/^\/api\/rooms\/[^/]+\/chair(?:\/settings)?$/))return false;if(!localHost(req)||!auth(req)){json(res,401,{error:'local authentication required',code:'AUTH_REQUIRED'});return true}try{if(req.method==='GET'&&url.pathname==='/api/chair/options'){json(res,200,getChairOptions());return true}if(req.method!=='POST'||!mutation(req)){json(res,403,{error:'CSRF validation failed',code:'CSRF_INVALID'});return true}if(updates?.fence)throw Object.assign(Error('Update preparation is in progress'),{code:'UPDATE_BUSY'});const input=await body(req),bits=url.pathname.split('/'),roomId=bits[3];if(bits[5]==='settings'){const chair=store.chair(roomId);normalizeChairSettings(input,{current:chair,options:getChairOptions()});json(res,200,{chair:store.updateChairSettings(roomId,input,getChairOptions())});return true}const room=store.room(roomId);if(room.archived_at||room.paused_at)throw Error('토론장을 재개한 뒤 좌장을 만들어줘.');const settings=normalizeChairSettings(input,{options:getChairOptions()});track(chairs.create(roomId,settings).catch(e=>console.error('Chair initialization failed: '+e.message)));json(res,202,store.chair(roomId));return true}catch(error){fail(res,error);return true}}
 root=resolve(options.resourceRoot||sourceRoot); resourceRoot=root;
 staticRoot=join(root,'apps','desktop');
 port=Number(options.port??process.env.PORT??4318); host='127.0.0.1';
 dbPath=resolve(options.dbPath||process.env.ROOMS_DB||join(root,'.local','rooms.sqlite'));
 workspaceRoot=resolve(options.workspaceRoot||((options.dbPath||process.env.ROOMS_DB)?dirname(dbPath):root));
 secret=options.secret||process.env.ROOMS_BOOTSTRAP_SECRET||randomBytes(32).toString('base64url'); csrf=randomBytes(20).toString('base64url'); cookieName=`rooms_session_${port}`;
 const privateDir=resolve(options.privateDir||join(dirname(dbPath),'participants'));
 const configuredKnowledgeRoot=options.knowledgeRoot||process.env.ROOMS_KNOWLEDGE_ROOT;
 const knowledgeRoot=configuredKnowledgeRoot?resolve(configuredKnowledgeRoot):null;
 const scheduler=options.scheduler!==false, updateScheduling=options.updateScheduling===true, pending=new Set();
 const requestedPort=port;
 let timer=null,started=false,closing=false,startPromise=null,closePromise=null,actualKnowledgeRoot=knowledgeRoot;
 const log=options.log||console;
 const track=p=>{const task=Promise.resolve(p).catch(e=>{if(!closing)log.error?.(e.message||e)});pending.add(task);task.finally(()=>pending.delete(task));return task};
 const creationObservedAt=new Map();
 const observeCreations=roomId=>{for(const created of creations.forRoom(roomId)){if(created.status!=='pending'||!created.handle||Date.now()-(creationObservedAt.get(created.id)||0)<3000)continue;creationObservedAt.set(created.id,Date.now());track(creations.observePending(roomId,created.id).then(value=>{if(value?.sessionId)metadataObserver.observe(value.sessionId,{force:true});}));}};
 const tick=()=>{
  try{const revision=JSON.stringify({knowledge:knowledge.db.prepare('SELECT revision FROM knowledge_clock WHERE id=1').get().revision,changes:store.db.prepare('PRAGMA data_version').get(),events:store.db.prepare('SELECT count(*) n FROM events').get().n,messages:store.db.prepare('SELECT count(*) n FROM messages').get().n,reactions:store.db.prepare('SELECT count(*) n FROM reactions').get().n});if(revision!==tick.revision){knowledge.exportAll(knowledge.getSettings().storageRoot);tick.revision=revision}}
  catch(e){log.error?.('Knowledge export failed: '+e.message)}
  if(!updates?.fence)track(participants.tick());
  if(updateScheduling)track(updates.tick());
  for(const room of store.rooms()){
   if(!updates?.fence){observeCreations(room.id);track(debates.tick(room.id)); if(store.chair(room.id)?.status==='ready')track(chairs.tick(room.id));}
   if(room.cwd)try{const signature=workspaceSignature(store.room(room.id));if(tick.exported.get(room.id)!==signature){exportWorkspace(store,room.id);tick.exported.set(room.id,signature)}}
   catch(e){if(tick.exported.get(room.id)!==e.message){tick.exported.set(room.id,e.message);log.error?.('Workspace export failed: '+e.message)}}
  }
 };
 tick.revision=-1;tick.exported=new Map();
 const makeServer=()=>http.createServer((req,res)=>{
  if(closing)return json(res,503,{error:'coordinator is closing',code:'CLOSING'});
  const operation=(async()=>{
   let url;try{url=new URL(req.url,`http://${host}:${port}`)}catch{return json(res,400,{error:'invalid request URL'})}
   if(await chairSettingsApi(req,res,url))return;
   if(url.pathname.startsWith('/mcp/'))return mcp(req,res,url);
   if(url.pathname.startsWith('/api/'))return api(req,res,url);
   return staticFile(req,res,url.pathname);
  })().catch(error=>{log.error?.(error.message);if(!res.headersSent)json(res,500,{error:'request failed'});else res.destroy()});
  track(operation);
 });
 const runtime={
  async start(){
   if(closePromise)await closePromise;
   if(closing){const error=Error('Coordinator shutdown must finish before restart');error.code='CLOSING';throw error}
   if(started)return runtime.info();
   if(startPromise)return startPromise;
   startPromise=(async()=>{
    port=requestedPort;closing=false;
    try{const value=(await readFile(join(resourceRoot,'VERSION'),'utf8')).trim();appVersion=/^\d+\.\d+\.\d+$/.test(value)?value:null}catch{appVersion=null}
    mkdirSync(dirname(dbPath),{recursive:true});mkdirSync(privateDir,{recursive:true});
    if(knowledgeRoot)mkdirSync(knowledgeRoot,{recursive:true});
    try{
     store=new Store(dbPath);knowledge=new KnowledgeStore(store,knowledgeRoot?{defaultRoot:knowledgeRoot}:{});
     actualKnowledgeRoot=knowledge.getSettings().storageRoot;
     history=new RoomHistory(store,knowledge);knowledge.history=history;
     chairs=new ChairCoordinator(store,{history,runner:options.chairRunner||createChairRunner(),cwdForRoom:roomId=>store.chair(roomId)?.cwd||store.room(roomId).cwd||join(dirname(dbPath),'chairs',roomId)});
     debates=new DebateCoordinator(store,{chairs,knowledge});
     nativeChatAdapter=options.nativeChatAdapter||createOrcaNativeChatAdapter();
     metadataObserver=new ParticipantMetadataObserver(store,{adapter:options.metadataAdapter||nativeChatAdapter,track});
     officeObserver=options.officeObserver||new OfficeObserver({officeRoots:options.officeRoots,clock:options.officeClock});
     const observeCreated=async({provider,cwd,handle})=>{if(!handle)return null;const found=await nativeChatAdapter.discover({provider,cwd,handle,timeoutMs:750});const exact=(found.sessions||[]).filter(item=>item.provider===provider&&item.handle===handle&&item.cwd===cwd&&item.verified&&item.nativeId);return exact.length===1?exact[0]:null;};
     creations=new SessionCreationService(store,{launcher:options.sessionLauncher||createOrcaSessionCreateAdapter({observe:observeCreated}),observe:observeCreated});
     participants=new ParticipantDispatcher(store,{adapter:participantAdapterRouter(options.participantAdapter||createOrcaParticipantAdapter(),nativeChatAdapter),privateDir,baseUrl:''});
     participantSettings=new ParticipantSettings(store,{adapter:options.settingsAdapter||createNativeModelSettings()});
     const activeUpdateOperations=()=>!!updates?.fence||!!chairs?.busy?.size||!!store.db.prepare("SELECT 1 FROM deliveries WHERE state NOT IN ('completed','cancelled','blocked','failed') LIMIT 1").get()||!!store.db.prepare("SELECT 1 FROM session_creations WHERE status IN ('pending','unknown') LIMIT 1").get()||!!store.db.prepare("SELECT 1 FROM chair_runs WHERE status NOT IN ('completed','failed','cancelled') LIMIT 1").get()||!!store.db.prepare("SELECT 1 FROM session_controls WHERE state='active' LIMIT 1").get();
     updates=options.updatesService||new AppUpdates({profileDir:dirname(dbPath),currentVersion:appVersion||'0.0.0',fetcher:options.updateFetch,now:options.updateNow,desktopHost:options.desktopHost===true,activeOperations:activeUpdateOperations});await updates.load?.();
     participants.debates=debates;participants.knowledge=knowledge;
     server=makeServer();
     await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,host,()=>{server.off('error',fail);ok()})});
     port=server.address().port;cookieName=`rooms_session_${port}`;participants.baseUrl=`http://${host}:${port}`;
     started=true;if(scheduler){timer=setInterval(tick,2000);timer.unref()}
     return runtime.info();
    }catch(error){if(server?.listening)await new Promise(ok=>server.close(ok));if(store?.db?.isOpen)store.db.close();throw error}
   })();
   try{return await startPromise}finally{startPromise=null}
  },
  info(){if(started)actualKnowledgeRoot=knowledge.getSettings().storageRoot;return {host,port,baseUrl:`http://${host}:${port}/`,dbPath,privateDir,knowledgeRoot:actualKnowledgeRoot}},
  get server(){return server},get store(){return store},get participants(){return participants},get knowledge(){return knowledge},get debates(){return debates},get updates(){return updates},
  async close({timeoutMs=5000}={}){
   if(startPromise)try{await startPromise}catch{return}
   if(closePromise)return closePromise;
   if(!started)return;
   closePromise=(async()=>{
    closing=true;metadataObserver?.close();await officeObserver?.close();await updates?.close();if(timer)clearInterval(timer);timer=null;
    const stopped=server.listening?new Promise((ok,fail)=>server.close(e=>e?fail(e):ok())):Promise.resolve();
    const deadline=Date.now()+timeoutMs;
    while(pending.size&&Date.now()<deadline)await Promise.race([Promise.allSettled([...pending]),new Promise(r=>setTimeout(r,25))]);
    if(pending.size){stopped.catch(()=>{});const error=Error('Coordinator has active operations');error.code='BUSY';throw error}
    await stopped;actualKnowledgeRoot=knowledge.getSettings().storageRoot;store.db.close();started=false;closing=false;
   })();
   try{await closePromise}finally{closePromise=null}
  }
 };
 return runtime;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const coordinator=createCoordinator({updateScheduling:process.env.ROOMS_DISABLE_UPDATES!=='1'});coordinator.start().then(info=>console.log(`Session Rooms listening at ${info.baseUrl.slice(0,-1)}`)).catch(error=>{console.error('Session Rooms failed to bind: '+error.code);process.exitCode=1})}
export {createCoordinator};
