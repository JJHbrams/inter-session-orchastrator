const validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value);
export function parseReferenceHash(hash){
 const raw=String(hash||'').replace(/^#/,'');if(!raw||raw.startsWith('message-'))return null;
 const params=new URLSearchParams(raw),channelId=params.get('channel'),roomId=params.get('room'),agendaId=params.get('agenda');
 const keys=['channel','room','agenda'];
 if(!keys.some(key=>params.has(key)))return null;
 if(keys.some(key=>params.has(key)&&(!params.get(key)||params.getAll(key).length!==1)))return {error:'참조 링크 ID가 올바르지 않습니다.'};
 if((agendaId&&!roomId)||![channelId,roomId,agendaId].filter(Boolean).every(validId)||[...params.keys()].some(key=>!['channel','room','agenda'].includes(key)))return {error:'참조 링크 ID가 올바르지 않습니다.'};
 return {channelId:channelId||null,roomId:roomId||null,agendaId:agendaId||null};
}
export function referenceUrl(location,reference){const current=new URL(location.href||String(location),location.origin),url=new URL(current.pathname||'/',current.origin),params=new URLSearchParams();if(reference.channel?.id)params.set('channel',reference.channel.id);if(reference.room?.id)params.set('room',reference.room.id);if(reference.agenda?.id)params.set('agenda',reference.agenda.id);url.hash=params.toString();return url.href;}
export function agentReferenceText(reference){
 const c=reference.channel,r=reference.room,a=reference.agenda,p=reference.paths||{};
 const names=[c?.name,r?.name,a?.title].filter(Boolean).join(' > '),ids=[c&&`channel=${c.id}`,r&&`room=${r.id}`,a&&`agenda=${a.id}`].filter(Boolean).join('; '),observed=[a&&`phase=${a.phase}`,a&&`outcome=${a.outcome}`,a&&`revision=${a.revision}`,`at=${reference.observedAt||'unknown'}`,`export=${reference.exportMtime||'unknown'}`].filter(Boolean).join('; ');
 const files=[];if(a?.file)files.push(`agenda: ${a.file}`);if(r?.index)files.push(`room index: ${r.index}`);if(c?.index)files.push(`channel index: ${c.index}`);if(p.history)files.push(`history index: ${p.history}`);if(p.transcript)files.push(`transcript: ${p.transcript}`);
 const order=a?'안건 파일을 먼저 읽고, 관련 근거와 history 조각을 필요한 만큼만 읽어.':r?'토론장 목차를 먼저 읽고, 관련 history 조각을 필요한 만큼만 읽어.':'채널 목차를 먼저 읽어.';
 return [`참조: ${names}`,`stable IDs: ${ids}`,`observed: ${observed}`,'파일 기준(복사 시점):',...files,`${order} transcript 전체를 처음부터 읽지 마. consensus는 참여자 합의이지 사용자 승인이나 구현 지시가 아니야. 최신 파일은 복사 뒤 바뀔 수 있어. 이미 같은 room으로 provision된 MCP만 사용하고, 새 권한·토큰·설정을 요청하거나 포함하지 마.`].join('\n');
}
export async function copyText(text,clipboard=globalThis.navigator?.clipboard){if(!clipboard?.writeText)throw Error('클립보드를 사용할 수 없습니다.');await clipboard.writeText(text);}
export async function showReferenceDialog({document,location,request,target,clipboard,onError}){try{
 const params=new URLSearchParams();if(target.channel?.id)params.set('channel',target.channel.id);if(target.room?.id)params.set('room',target.room.id);if(target.agenda?.id)params.set('agenda',target.agenda.id);const descriptor=await request('/api/references?'+params),url=referenceUrl(location,target);
 const dialog=document.createElement('dialog'),form=document.createElement('form'),status=document.createElement('p');dialog.className='reference-copy-dialog';status.setAttribute('aria-live','polite');
 const heading=document.createElement('h2');heading.textContent='참조 복사';
 const add=(label,value,rows)=>{const caption=document.createElement('label'),area=document.createElement('textarea');caption.textContent=label;area.value=value;area.readOnly=true;area.rows=rows;caption.append(area);form.append(caption);return area;};
 const browser=add('브라우저 링크',url,2),agent=add('에이전트 참조',descriptor.available?agentReferenceText(descriptor):`참조 링크: ${url}\n내보내기 상태: ${descriptor.warning||'사용할 수 없음'}`,12);
 const makeCopy=(label,value,area)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=async()=>{try{await copyText(value,clipboard);status.textContent=`${label}: 복사됨`;button.textContent='복사됨';}catch{area.focus();area.select();status.textContent=`${label}: 선택해서 복사`;button.textContent='선택해서 복사';}};return button;};
 const close=document.createElement('button');close.type='button';close.textContent='닫기';close.onclick=()=>dialog.close();const note=document.createElement('p');note.className='setting-help';note.textContent=descriptor.available?'브라우저 링크와 파일 기준 참조를 복사해 전달해.':'브라우저 링크는 유효하지만 파일 내보내기는 현재 사용할 수 없어.';
 form.prepend(heading,note);form.append(makeCopy('링크 복사',url,browser),makeCopy('에이전트 참조 복사',agent.value,agent),status,close);dialog.append(form);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();return {dialog,descriptor,url};
 }catch(error){if(onError)onError(error.message);else throw error;return null;}}
