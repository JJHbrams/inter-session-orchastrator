export const MAX_ATTACHMENTS=5, MAX_ATTACHMENT_BYTES=10*1024*1024;
const IMAGE_MIMES=new Set(['image/png','image/jpeg','image/gif','image/webp']);
const TEXT_EXTENSIONS=/\.(?:txt|log|json|csv|tsv|ya?ml|xml|js|mjs|cjs|ts|tsx|jsx|css|py|rs|sh|ps1|toml|ini|sql)$/i;
export const attachmentKind=file=>IMAGE_MIMES.has(file.mime)?'image':/\.(?:md|markdown|html?|htm)$/i.test(file.filename||'')?'document':TEXT_EXTENSIONS.test(file.filename||'')||/^text\//.test(file.mime||'')?'text':'file';
export const attachmentPath=(roomId,id)=>`/api/rooms/${encodeURIComponent(roomId)}/attachments/${encodeURIComponent(id)}`;
const sizeLabel=size=>size<1024?`${size} B`:size<1048576?`${Math.ceil(size/1024)} KiB`:`${(size/1048576).toFixed(1)} MiB`;
const element=(doc,tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};

export function renderSharedAttachments({document:doc,roomId,attachments,onOpen}){
 const list=element(doc,'div',undefined,'shared-attachments');
 for(const file of attachments||[]){
  const kind=attachmentKind(file),row=element(doc,'div',undefined,'shared-attachment attachment-file-card'),open=element(doc,'button',undefined,'attachment-open');open.type='button';open.setAttribute('aria-label',`${file.filename||'첨부 파일'} 미리보기`);open.onclick=()=>onOpen(roomId,file);
  if(kind==='image'){const image=element(doc,'img');image.src=attachmentPath(roomId,file.id);image.alt=file.filename||'공유 이미지';image.loading='lazy';open.append(image);}
  else open.append(element(doc,'span',kind==='document'?'MD':kind==='text'?'TXT':'FILE','attachment-file-icon'));
  const info=element(doc,'span',undefined,'attachment-file-info');info.append(element(doc,'strong',file.filename||'첨부 파일'),element(doc,'small',`${sizeLabel(file.size||0)} · ${kind==='file'?'파일 정보':'클릭하여 미리보기'}`));open.append(info);
  const download=element(doc,'a','↓','attachment-download');download.href=attachmentPath(roomId,file.id)+'?download=1';download.download=file.filename||'';download.title='원본 다운로드';download.setAttribute('aria-label',`${file.filename||'첨부 파일'} 다운로드`);row.append(open,download);list.append(row);
 }
 return list;
}

export function createAttachmentViewer({document:doc=globalThis.document,fetcher=globalThis.fetch,authenticate=async()=>{},renderMarkdown,getContext=()=>({}),urlAPI=globalThis.URL}={}){
 let previous=null;
 async function open(roomId,file){
  previous?.close();const d=element(doc,'dialog',undefined,'attachment-preview-dialog reader-dialog'),form=element(doc,'form'),header=element(doc,'header',undefined,'reader-header'),kind=attachmentKind(file),controller=new AbortController();let closed=false,objectURL=null,raw='',mode='rendered';
  previous=d;form.method='dialog';const title=element(doc,'h2',file.filename||'첨부 파일');header.append(element(doc,'p',kind==='image'?'SHARED IMAGE':'SHARED DOCUMENT','reader-eyebrow'),title,element(doc,'p',`${sizeLabel(file.size||0)} · 원본 첨부`,'reader-subtitle'));
  const toolbar=element(doc,'div',undefined,'attachment-preview-toolbar'),body=element(doc,'div',undefined,'attachment-preview-body'),footer=element(doc,'footer',undefined,'reader-footer'),download=element(doc,'a','원본 다운로드','attachment-original');download.href=attachmentPath(roomId,file.id)+'?download=1';download.download=file.filename||'';
  const close=element(doc,'button','닫기');close.type='button';close.onclick=()=>d.close();footer.append(element(doc,'p','미리보기는 원본 파일을 변경하지 않아요.','reader-subtitle'),download,close);form.append(header,toolbar,body,footer);d.append(form);doc.body.append(d);
  d.addEventListener('close',()=>{closed=true;controller.abort();if(objectURL)urlAPI.revokeObjectURL(objectURL);if(previous===d)previous=null;d.remove();});d.setAttribute('aria-label',(file.filename||'첨부 파일')+' 미리보기');d.showModal();close.focus();
  if(kind==='file'){body.append(element(doc,'div','이 형식은 아직 앱 내 미리보기를 지원하지 않아요. 원본을 다운로드해 열어 주세요.','reader-empty'));return d;}
  body.setAttribute('aria-busy','true');body.append(element(doc,'p','첨부를 불러오는 중…','muted'));
  try{
   let response=await fetcher(attachmentPath(roomId,file.id),{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(response.status===401){await authenticate();if(closed)return d;response=await fetcher(attachmentPath(roomId,file.id),{credentials:'same-origin',cache:'no-store',signal:controller.signal});}
   if(!response.ok)throw Error(`첨부를 불러오지 못했어요. (${response.status})`);
   const bytes=await response.arrayBuffer();if(closed)return d;if(bytes.byteLength>MAX_ATTACHMENT_BYTES)throw Error('미리보기 파일 한도를 넘었어요. 원본을 다운로드해 주세요.');body.replaceChildren();
   if(kind==='image'){
    objectURL=urlAPI.createObjectURL(new Blob([bytes],{type:file.mime}));const image=element(doc,'img',undefined,'attachment-full-image');image.src=objectURL;image.alt=file.filename||'공유 이미지';image.onerror=()=>{if(!closed)body.replaceChildren(element(doc,'p','이미지를 표시할 수 없어요. 원본을 다운로드해 확인해 주세요.','form-error'));};body.classList.add('image-preview');body.append(image);
    const zoom=element(doc,'button','원본 크기');zoom.type='button';zoom.setAttribute('aria-pressed','false');zoom.onclick=()=>{const full=body.classList.toggle('natural-size');zoom.textContent=full?'화면에 맞추기':'원본 크기';zoom.setAttribute('aria-pressed',String(full));};toolbar.append(element(doc,'span','이미지 미리보기','reader-subtitle'),zoom);
   }else{
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('UTF-8 텍스트가 아니어서 미리보기를 표시할 수 없어요. 원본을 다운로드해 주세요.');}if(text.includes('\0'))throw Error('바이너리 파일은 원본을 다운로드해 확인해 주세요.');
    raw=text.slice(0,160000);const warning=element(doc,'p',text.length>raw.length?'긴 문서의 앞부분만 표시해요. 전체 내용은 원본을 다운로드해 확인할 수 있어요.':'','attachment-preview-notice');warning.hidden=text.length===raw.length;toolbar.append(warning);
    const paint=()=>{body.replaceChildren();if(kind==='document'&&mode==='rendered'&&renderMarkdown){const rich=element(doc,'div',undefined,'rich-body');rich.append(renderMarkdown(raw,{roomId,...getContext(roomId)}));body.append(rich);}else{const pre=element(doc,'pre');pre.append(element(doc,'code',raw));body.append(pre);}body.scrollTop=0;};
    if(kind==='document'){const toggle=element(doc,'button','원문 보기');toggle.type='button';toggle.setAttribute('aria-pressed','false');toggle.onclick=()=>{mode=mode==='rendered'?'source':'rendered';toggle.textContent=mode==='source'?'문서 보기':'원문 보기';toggle.setAttribute('aria-pressed',String(mode==='source'));paint();};toolbar.append(toggle);}paint();
   }
  }catch(error){if(!closed)body.replaceChildren(element(doc,'p',error.message||'미리보기를 불러오지 못했어요.','form-error'));}
  finally{if(!closed)body.setAttribute('aria-busy','false');}
  return d;
 }
 return {open};
}
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
 return {setRoom(id){if(roomId===id)return;roomId=id;if(!rooms.has(id))rooms.set(id,[]);changed();},add,retry(item){if(item?.status==='failed'&&!item.invalid)uploadItem(item);},remove(item){const items=draft();const i=items.indexOf(item);if(i>=0){items.splice(i,1);item.removed=true;if(item.meta)discard(item.roomId,item.meta.id).catch(()=>{});}changed();},items:draft,hasDrafts(){return [...rooms.values()].some(items=>items.length>0);},readyIds(){return draft().filter(x=>x.status==='ready').map(x=>x.meta.id);},pending(){return draft().some(x=>x.status==='uploading'||x.status==='queued');},hasFailed(){return draft().some(x=>x.status==='failed');},clearSent(items,ownerRoom=roomId){const owned=rooms.get(ownerRoom)||[];for(const item of items){const i=owned.indexOf(item);if(i>=0)owned.splice(i,1);}if(ownerRoom===roomId)changed();}};
}
