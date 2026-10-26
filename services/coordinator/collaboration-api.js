// Local UI routes share the coordinator's authentication and CSRF boundary.
export async function collaborationApi(req,res,url,{store,knowledge,debates,mutation,body,json,fail}) {
  const settings=url.pathname==='/api/settings';
  const match=url.pathname.match(/^\/api\/rooms\/([^/]+)\/(knowledge|agendas)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if(!settings&&!match)return false;
  try {
    if(req.method!=='GET'&&(req.method!=='POST'||!mutation(req))){json(res,403,{error:'CSRF validation failed',code:'CSRF_INVALID'});return true;}
    if(settings){
      const result=req.method==='GET'?knowledge.getSettings():knowledge.setSettings(await body(req));
      json(res,200,result);return true;
    }
    const [,roomId,kind,itemId,action]=match;store.room(roomId);
    if(kind==='knowledge'){
      if(req.method==='GET')json(res,200,itemId?knowledge.read(roomId,itemId,url.searchParams.has('revision')?Number(url.searchParams.get('revision')):null):knowledge.list(roomId,{scope:url.searchParams.get('scope')||'all',query:url.searchParams.get('query')||'',kind:url.searchParams.get('kind')||'',since:Number(url.searchParams.get('since')||0)}));
      else {
        if(action&&action!=='publish')throw Error('unknown knowledge action');
        const input=await body(req),result=action==='publish'?knowledge.publish(roomId,itemId):itemId?knowledge.update(roomId,itemId,input):knowledge.add(roomId,input);
        try{knowledge.export(roomId);}catch(error){result.exportWarning=error.message;}
        json(res,action==='publish'?200:itemId?200:201,result);
      }
    }else{
      if(req.method==='GET')json(res,200,itemId?debates.get(roomId,itemId):debates.list(roomId));
      else {const input=await body(req);const result=!itemId?debates.create(roomId,input):action==='approve'?debates.approve(roomId,itemId,input):debates.action(roomId,itemId,action,input);json(res,itemId?200:201,result);}
    }
  }catch(error){fail(res,error);}
  return true;
}

export function collaborationMcp(action,registration,input,{knowledge,debates}) {
  const roomId=registration.room_id;
  if(action==='room_knowledge_list')return knowledge.list(roomId,input,registration);
  if(action==='room_knowledge_read')return knowledge.read(roomId,input.itemId,input.revision||null,registration);
  if(action==='room_knowledge_add')return knowledge.add(roomId,input,registration);
  if(action==='room_review')return debates.recordReview(roomId,registration,input);
  if(action==='room_acknowledge_approval')return debates.ack(roomId,registration,input.noticeId,input.revision);
  return undefined;
}
