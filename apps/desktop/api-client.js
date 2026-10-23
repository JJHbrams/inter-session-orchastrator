// Only retry a mutation after the server explicitly rejected it before processing.
// An interrupted network request may already have committed, so its caller keeps
// the same idempotency key for a deliberate retry.
export function createApiClient({fetcher=fetch,onConnection=()=>{},timeoutMs=15000}={}) {
  let csrf,authenticating;
  const wire=async(path,options={})=>{
    try {
      const response=await fetcher(path,{credentials:'same-origin',cache:'no-store',...options,
        signal:options.signal||AbortSignal.timeout(timeoutMs),
        headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{}),...options.headers}});
      const data=await response.json();
      return {response,data};
    } catch(cause) {
      onConnection('offline');
      const error=Error('로컬 서버에 연결할 수 없어. 입력은 그대로 남아 있어. 연결이 돌아오면 대화 기록을 확인한 뒤 다시 보내줘.');
      error.cause=cause;error.code='NETWORK_UNCERTAIN';throw error;
    }
  };
  const authenticate=()=>{
    if(!authenticating)authenticating=(async()=>{
      onConnection('reconnecting');
      const {response,data}=await wire('/api/bootstrap');
      if(!response.ok||typeof data.csrf!=='string')throw Error(data.error||'로컬 인증을 갱신하지 못했어.');
      csrf=data.csrf;onConnection('online');return data;
    })().finally(()=>{authenticating=null;});
    return authenticating;
  };
  const request=async(path,options={})=>{
    if(path==='/api/bootstrap')return authenticate();
    if(!csrf)await authenticate();
    let result=await wire(path,options);
    if(result.response.status===401&&result.data.code==='AUTH_REQUIRED'||result.response.status===403&&result.data.code==='CSRF_INVALID') {
      await authenticate();result=await wire(path,options);
    }
    if(!result.response.ok){const error=Error(result.data.error||'요청을 처리하지 못했어.');error.status=result.response.status;error.code=result.data.code;throw error;}
    onConnection('online');return result.data;
  };
  return {request,authenticate};
}
