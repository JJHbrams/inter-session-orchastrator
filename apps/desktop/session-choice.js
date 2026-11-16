const normalized = path => String(path||'').replaceAll('\\','/').replace(/^\/\/\?\/([a-z]:\/)/i,'$1').replace(/^\/\/\?\/UNC\//i,'//').replace(/\/+$/,'').toLowerCase();
export function matchingRuntimeSessions(sessions,provider,cwd){return sessions.filter(s=>!isNativeChatSession(s)&&s.provider===provider&&normalized(s.cwd)===normalized(cwd)&&s.handle&&s.incarnation);}
export function verifiedRuntimeBinding(exact,selected,confirmed){const binding=exact||(confirmed?selected:null);return !!(binding?.handle&&binding?.incarnation);}
export const isNativeChatSession=session=>session?.capabilities?.transport==='orca-native-chat';
export function nativeChatInvitation(session){if(!isNativeChatSession(session))return null;const {provider,nativeId,cwd,handle,incarnation}=session;return provider&&nativeId&&cwd&&handle?{provider,nativeId,cwd,handle,incarnation:incarnation||null}:null;}
export function mergeNativeCatalogSessions(terminalSessions,nativeSessions,query=''){
 const match=(a,b)=>a.provider===b.provider&&a.nativeId===b.nativeId&&normalized(a.cwd)===normalized(b.cwd),needle=String(query).trim().toLowerCase(),native=(nativeSessions||[]).map(item=>{const prior=(terminalSessions||[]).find(existing=>match(existing,item));return {...item,title:item.title||prior?.title||item.nativeId,nativeTitle:item.title||prior?.nativeTitle||item.nativeId,live:true};}).filter(item=>!needle||[item.title,item.nativeId,item.cwd,item.provider].some(value=>String(value||'').toLowerCase().includes(needle)));
 return [...(terminalSessions||[]).filter(item=>!native.some(candidate=>match(item,candidate))),...native];
}
