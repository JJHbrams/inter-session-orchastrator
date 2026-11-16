const TAGS=['h1','h2','h3','h4','p','br','strong','em','del','ul','ol','li','code','pre','blockquote','table','thead','tbody','tr','th','td','details','summary','a','img'];
const ATTRS=['href','title','target','rel','src','alt','width','height','open'];

// Keep the native textarea responsible for editing, selection, and IME. This
// inert backdrop paints only the backgrounds of resolved mention ranges.
export function createMentionInput({textarea,getSpans}){
  const doc=textarea.ownerDocument,win=doc.defaultView;
  const editor=doc.createElement('div'),backdrop=doc.createElement('div'),content=doc.createElement('div');
  editor.className='mention-editor';backdrop.className='mention-backdrop';backdrop.setAttribute('aria-hidden','true');
  backdrop.append(content);textarea.before(editor);editor.append(backdrop,textarea);
  let signature;
  function sync(){backdrop.scrollTop=textarea.scrollTop;backdrop.scrollLeft=textarea.scrollLeft;}
  function measure(){
    const style=win.getComputedStyle(textarea);
    for(const key of ['font','lineHeight','letterSpacing','wordSpacing','padding','textAlign','tabSize','direction'])backdrop.style[key]=style[key];
    backdrop.style.borderWidth=style.borderWidth;
    backdrop.style.width=(textarea.clientWidth+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth))+'px';
    sync();
  }
  function render(){
    const value=textarea.value,ranges=getSpans(value),next=JSON.stringify([value,ranges]);
    if(next!==signature){
      signature=next;content.replaceChildren();let last=0;
      for(const {start,end} of ranges){
        content.append(value.slice(last,start));const mark=doc.createElement('span');mark.className='mention';mark.textContent=value.slice(start,end);content.append(mark);last=end;
      }
      content.append(value.slice(last)+'\n');
    }
    measure();
  }
  textarea.addEventListener('input',render);textarea.addEventListener('scroll',sync);
  textarea.addEventListener('compositionend',render);
  if(win.ResizeObserver)new win.ResizeObserver(measure).observe(textarea);
  win.addEventListener('resize',measure);render();
  return {render};
}

function safeHref(value,roomPath,baseURI){
  if(!value) return false;
  if(value.startsWith('#')||(roomPath&&value.startsWith(roomPath))) return true;
  try { return ['http:','https:','mailto:'].includes(new URL(value,baseURI||'http://localhost/').protocol); } catch { return false; }
}

export function createReferenceMap(members=[],messages=[]){
 const references=new Map(),authors=new Map(members.filter(m=>m.alias).map(m=>[m.session_id,m]));
 const add=(id,reference)=>{if(typeof id!=='string'||!id)return;const key=id.toLowerCase(),old=references.get(key);if(references.has(key)&&(old?.id!==reference.id||old?.kind!==reference.kind))references.set(key,null);else if(!references.has(key))references.set(key,reference);};
 for(const member of members){if(!member.alias)continue;for(const id of [member.id,member.session_id,member.native_id])add(id,{id:member.session_id,alias:member.alias,kind:'person'});}
 for(const message of messages){const author=authors.get(message.sender_session_id);if(!author)continue;const ref={id:message.id,alias:author.alias,kind:'message'};add(message.id,ref);if(/^[a-f0-9-]{36}$/i.test(message.id))add(message.id.slice(0,8),ref);}
 return references;
}

function decorateReferences(fragment,references,doc){
 if(!references?.size)return;
 const walker=doc.createTreeWalker(fragment,doc.defaultView?.NodeFilter?.SHOW_TEXT||4),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
 for(const node of nodes){
  if(node.parentElement?.closest('pre,code,a'))continue;
  const value=node.nodeValue,pattern=/(?<![\p{L}\p{N}_/\\#@-])@?([a-f0-9]{8}(?:-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?)(?![a-z0-9_-])/giu;
  const replacement=doc.createDocumentFragment();let last=0,changed=false;
  for(const match of value.matchAll(pattern)){
   const ref=references.get(match[1].toLowerCase());if(!ref)continue;
   let before=value.slice(last,match.index);const alias=ref.alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');before=before.replace(new RegExp('(^|[^\\p{L}\\p{N}_@])'+alias+'\\s+$','u'),'$1');replacement.append(before);
   const label=doc.createElement(ref.kind==='message'?'a':'span');label.className='mention';label.textContent='@'+ref.alias+(ref.kind==='message'?'의 발언':'');
   if(ref.kind==='message'){label.href='#message-'+ref.id;label.title='발언 원문 · '+ref.id;}
   replacement.append(label);last=match.index+match[0].length;
   if(ref.kind==='message'){const suffix=/^(를|는|가|와)(?=$|[\s,.;:!?])/u.exec(value.slice(last));if(suffix){replacement.append(({를:'을',는:'은',가:'이',와:'과'})[suffix[1]]);last+=suffix[1].length;}}
   changed=true;
  }
  if(changed){replacement.append(value.slice(last));node.replaceWith(replacement);}
 }
}

export function createRenderer({parse,sanitize,document:doc=globalThis.document}={}){
  if(!parse||!sanitize||!doc) throw Error('A parser, purifier, and document are required.');
  return function renderMarkdown(source,{roomId,mentions=[],references=null}={}){
    const roomPath=roomId?`/api/rooms/${roomId}/attachments/`:'';
    const html=parse(String(source||''));
    const fragment=sanitize(html,{RETURN_DOM_FRAGMENT:true,ALLOWED_TAGS:TAGS,ALLOWED_ATTR:ATTRS,FORBID_TAGS:['style','script','form','iframe','object','svg','math'],FORBID_ATTR:['id','name','srcdoc','style']});
    for(const element of fragment.querySelectorAll('*')) for(const attr of [...element.attributes]) if(/^on/i.test(attr.name)||['id','name','srcdoc','style'].includes(attr.name)||!ATTRS.includes(attr.name)) element.removeAttribute(attr.name);
    for(const element of fragment.querySelectorAll('a,img')){
      if(element.tagName==='IMG'){
        const src=element.getAttribute('src')||'';
        if(!roomPath||!src.startsWith(roomPath)){ const link=doc.createElement('a');link.textContent=element.alt||'첨부 이미지';if(safeHref(src,roomPath,doc.baseURI)){link.href=src;link.target='_blank';link.rel='noopener noreferrer';} element.replaceWith(link); continue; }
      } else {
        const href=element.getAttribute('href')||'';
        if(!safeHref(href,roomPath,doc.baseURI)) element.removeAttribute('href');
        else if(!href.startsWith('#')&&!href.startsWith(roomPath)){ element.target='_blank';element.rel='noopener noreferrer'; }
      }
    }
    decorateReferences(fragment,references,doc);
    const walker=doc.createTreeWalker(fragment,doc.defaultView?.NodeFilter?.SHOW_TEXT||4);
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const node of nodes){
      if(node.parentElement?.closest('pre,code,a,.mention'))continue;
      const value=node.nodeValue; const pattern=/(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_-]+)/gu;let match,last=0,changed=false;const replacement=doc.createDocumentFragment();
      
      
      while((match=pattern.exec(value))){const prefix=match[1],alias=match[2],start=match.index+prefix.length;const known=mentions.includes(alias);replacement.append(value.slice(last,start));const span=doc.createElement('span');span.className=known?'mention':'mention unknown';span.textContent='@'+alias;replacement.append(span);last=start+alias.length+1;changed=true;}
      if(changed){replacement.append(value.slice(last));node.replaceWith(replacement);}
    }
    return fragment;
  };
}
