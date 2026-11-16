import { createReferenceService } from './references.js';
// Local UI routes share the coordinator's authentication and CSRF boundary.
export async function collaborationApi(req,res,url,{store,knowledge,debates,history,mutation,body,json,fail}) {
  if(url.pathname==='/api/references'){
    if(req.method!=='GET'){json(res,405,{error:'GET required'});return true;}
    json(res,200,createReferenceService({store,knowledge,debates}).get({channelId:url.searchParams.get('channel'),roomId:url.searchParams.get('room'),agendaId:url.searchParams.get('agenda')}));return true;
  }
  const settings=url.pathname==='/api/settings';
  const match=url.pathname.match(/^\/api\/rooms\/([^/]+)\/(knowledge|agendas|history)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if(!settings&&!match)return false;
  try {
    if(req.method!=='GET'&&(req.method!=='POST'||!mutation(req))){json(res,403,{error:'CSRF validation failed',code:'CSRF_INVALID'});return true;}
    if(settings){
      const result=req.method==='GET'?knowledge.getSettings():knowledge.setSettings(await body(req));
      json(res,200,result);return true;
    }
    const [,roomId,kind,itemId,action]=match;store.room(roomId);
    if(kind==='history'){
      if(req.method!=='GET')throw Error('history is read-only');
      const input={id:url.searchParams.get('id'),query:url.searchParams.get('query'),offset:Number(url.searchParams.get('offset')||0)};
      if(itemId==='reads')json(res,200,{reads:store.db.prepare('SELECT * FROM context_reads WHERE room_id=? ORDER BY created_at DESC LIMIT 100').all(roomId)});
      else json(res,200,history.resolve(roomId,{...input,kind:itemId==='search'?'history_search':itemId==='read'?'history_read':'history_index'}));
    }else if(kind==='knowledge'){
      if(req.method==='GET')json(res,200,itemId?knowledge.read(roomId,itemId,url.searchParams.has('revision')?Number(url.searchParams.get('revision')):null):knowledge.list(roomId,{scope:url.searchParams.get('scope')||'all',query:url.searchParams.get('query')||'',kind:url.searchParams.get('kind')||'',since:Number(url.searchParams.get('since')||0)}));
      else {
        if(action&&action!=='publish')throw Error('unknown knowledge action');
        const input=await body(req),result=action==='publish'?knowledge.publish(roomId,itemId):itemId?knowledge.update(roomId,itemId,input):knowledge.add(roomId,input);
        try{knowledge.export(roomId);}catch(error){result.exportWarning=error.message;}
        json(res,action==='publish'?200:itemId?200:201,result);
      }
    }else{
      if(req.method==='GET')json(res,200,itemId?debates.get(roomId,itemId):debates.list(roomId));
      else {const input=await body(req);let result;if(!itemId){result=debates.create(roomId,input);}else if(action==='intervene')result=input.action==='interrupt'?await debates.interrupts.request(roomId,itemId,input):debates.reactive.yield(debates.get(roomId,itemId),input);else result=action==='approve'?debates.approve(roomId,itemId,input):debates.action(roomId,itemId,action,input);json(res,itemId?200:201,result);}
    }
  }catch(error){fail(res,error);}
  return true;
}

export function collaborationMcp(action,registration,input,{knowledge,debates,history}) {
  const roomId=registration.room_id;
  if(action==='room_history_index')return history.index(roomId,input,registration);
  if(action==='room_history_search')return history.search(roomId,input,registration);
  if(action==='room_history_read')return history.resolve(roomId,{...input,kind:input.kind||'history_read'},registration);
  if(action==='room_knowledge_list')return knowledge.list(roomId,input,registration);
  if(action==='room_knowledge_read')return knowledge.read(roomId,input.itemId,input.revision||null,registration);
  if(action==='room_knowledge_add')return knowledge.add(roomId,input,registration);
  if(action==='room_review')return debates.recordReview(roomId,registration,input);
  if(action==='room_acknowledge_approval')return debates.ack(roomId,registration,input.noticeId,input.revision);
  return undefined;
}
