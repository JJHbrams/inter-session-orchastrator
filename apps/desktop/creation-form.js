// Keep keyboard and pointer submission on one path, and cancellation out of validation.
export function bindCreationForm({dialog,onSubmit,onSuccess,onError=()=>{}}){
 const form=dialog.querySelector('form'),submit=form.querySelector('[type="submit"]'),cancel=form.querySelector('[data-dialog-cancel]');
 const message=dialog.ownerDocument.createElement('p');message.className='form-error';message.setAttribute('role','alert');form.insertBefore(message,form.querySelector('menu'));
 let busy=false,composing=false;
 form.addEventListener('compositionstart',()=>{composing=true});form.addEventListener('compositionend',()=>{composing=false});
 cancel.type='button';cancel.onclick=()=>dialog.close();
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||composing||!form.reportValidity())return;
  for(const input of form.querySelectorAll('input[required]')){if(!input.value.trim()){input.setCustomValidity('이름을 입력해줘.');input.reportValidity();input.addEventListener('input',()=>input.setCustomValidity(''),{once:true});return;}}
  busy=true;submit.disabled=true;form.setAttribute('aria-busy','true');message.textContent='';
  try{const result=await onSubmit();dialog.close();form.reset();try{await onSuccess?.(result)}catch(error){onError(error)}}
  catch(error){message.textContent=error.message;onError(error)}
  finally{busy=false;submit.disabled=false;form.removeAttribute('aria-busy')}
 };
 return {form,get busy(){return busy}};
}
