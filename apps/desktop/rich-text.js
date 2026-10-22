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

export function createRenderer({parse,sanitize,document:doc=globalThis.document}={}){
  if(!parse||!sanitize||!doc) throw Error('A parser, purifier, and document are required.');
  return function renderMarkdown(source,{roomId,mentions=[]}={}){
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
    const walker=doc.createTreeWalker(fragment,doc.defaultView?.NodeFilter?.SHOW_TEXT||4);
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const node of nodes){
      if(node.parentElement?.closest('pre,code,a'))continue;
      const value=node.nodeValue; const pattern=/(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_-]+)/gu;let match,last=0,changed=false;const replacement=doc.createDocumentFragment();
      
      
      while((match=pattern.exec(value))){const prefix=match[1],alias=match[2],start=match.index+prefix.length;const known=mentions.includes(alias);replacement.append(value.slice(last,start));const span=doc.createElement('span');span.className=known?'mention':'mention unknown';span.textContent='@'+alias;replacement.append(span);last=start+alias.length+1;changed=true;}
      if(changed){replacement.append(value.slice(last));node.replaceWith(replacement);}
    }
    return fragment;
  };
}
