/** Owns room-scoped read-only polling; late responses never cross room boundaries. */
export function createOfficeController({document,office,request,intervalMs=2000}) {
 let roomId=null,generation=0,controller=null,timer=null,destroyed=false;
 const schedule=()=>{clearTimeout(timer);if(!destroyed&&roomId)timer=setTimeout(refresh,intervalMs)};
 async function refresh(){
  if(destroyed||!roomId)return;
  if(document.hidden){schedule();return}
  const expected=roomId,revision=generation;
  controller?.abort();const active=new AbortController();controller=active;
  try{const snapshot=await request(`/api/rooms/${encodeURIComponent(expected)}/office`,{signal:active.signal});
   if(!destroyed&&!active.signal.aborted&&revision===generation&&roomId===expected&&snapshot.roomId===expected){office.setSnapshot(snapshot);office.setConnection(true)}
  }catch(error){if(!destroyed&&!active.signal.aborted&&revision===generation&&error.name!=='AbortError')office.setConnection(false)}
  finally{if(controller===active)controller=null;if(!destroyed&&revision===generation)schedule()}
 }
 const visible=()=>{if(!document.hidden){clearTimeout(timer);refresh()}};
 document.addEventListener('visibilitychange',visible);
 return {setRoom(id){if(id===roomId)return;generation++;controller?.abort();controller=null;clearTimeout(timer);roomId=id||null;office.setRoom(roomId);if(roomId)refresh()},refresh,destroy(){destroyed=true;generation++;controller?.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible)}};
}
