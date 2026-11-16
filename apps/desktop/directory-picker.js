export function attachDirectoryPicker(input,{getBridge=()=>input.ownerDocument.defaultView?.sessionRoomsDesktop}={}){
 const document=input.ownerDocument,view=document.defaultView,row=document.createElement('span'),button=document.createElement('button'),status=document.createElement('span');
 row.className='directory-input';input.replaceWith(row);row.append(input,button);button.type='button';button.className='directory-picker-button';button.setAttribute('aria-label','작업 폴더 선택');button.title='탐색기로 작업 폴더 선택';button.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 7V5h6l2 2h10v12H3V7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
 status.className='directory-picker-status';status.setAttribute('role','status');row.after(status);
 const available=typeof getBridge()?.chooseDirectory==='function';button.disabled=!available;if(!available)button.title='폴더 선택은 데스크톱 앱에서 사용할 수 있어요. 경로를 직접 입력할 수도 있어요.';
 button.onclick=async()=>{
  if(button.disabled)return;button.disabled=true;status.textContent='';
  try{const result=await getBridge().chooseDirectory({defaultPath:input.value.trim()||undefined});if(result&&!result.cancelled&&typeof result.path==='string'&&result.path){input.value=result.path;input.dispatchEvent(new view.Event('input',{bubbles:true}));input.dispatchEvent(new view.Event('change',{bubbles:true}));}}
  catch(error){status.textContent=error.message||'폴더를 선택하지 못했어요. 경로를 직접 입력해줘.'}
  finally{button.disabled=false}
 };
 return button;
}
