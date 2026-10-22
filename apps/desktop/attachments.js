export const MAX_ATTACHMENTS=5, MAX_ATTACHMENT_BYTES=10*1024*1024;
const key=()=>crypto.randomUUID();
export function createAttachmentComposer({upload,discard=async()=>{},render=()=>{},onChange=()=>{}}={}){
 const rooms=new Map();let roomId;
 const draft=()=>rooms.get(roomId)||[];
 const changed=()=>{render(draft());onChange(draft());};
 async function uploadItem(item){
  item.status='uploading';changed();
  try{item.meta=await upload(item.roomId,item.file,item.requestKey);item.status='ready';item.error='';if(item.removed)discard(item.roomId,item.meta.id).catch(()=>{});}
  catch(error){item.status='failed';item.error=error.message||'업로드 실패';}
  changed();
 }
 function add(files){const items=draft();for(const file of [...files]){if(items.filter(x=>!x.invalid).length>=MAX_ATTACHMENTS){if(!items.some(x=>x.invalid==='count'))items.push({status:'failed',invalid:'count',file,error:'파일은 최대 5개까지 첨부할 수 있어. 추가 파일을 제거해줘.',roomId,requestKey:key()});break;}if(file.size>MAX_ATTACHMENT_BYTES){items.push({status:'failed',invalid:'size',file,error:'파일 하나는 10MiB까지 가능해.',roomId,requestKey:key()});continue;}const item={file,status:'queued',roomId,requestKey:key()};items.push(item);uploadItem(item);}changed();}
 return {setRoom(id){if(roomId===id)return;roomId=id;if(!rooms.has(id))rooms.set(id,[]);changed();},add,retry(item){if(item?.status==='failed'&&!item.invalid)uploadItem(item);},remove(item){const items=draft();const i=items.indexOf(item);if(i>=0){items.splice(i,1);item.removed=true;if(item.meta)discard(item.roomId,item.meta.id).catch(()=>{});}changed();},items:draft,readyIds(){return draft().filter(x=>x.status==='ready').map(x=>x.meta.id);},pending(){return draft().some(x=>x.status==='uploading'||x.status==='queued');},hasFailed(){return draft().some(x=>x.status==='failed');},clearSent(items,ownerRoom=roomId){const owned=rooms.get(ownerRoom)||[];for(const item of items){const i=owned.indexOf(item);if(i>=0)owned.splice(i,1);}if(ownerRoom===roomId)changed();}};
}
