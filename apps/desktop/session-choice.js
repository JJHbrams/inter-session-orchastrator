const normalized = path => String(path||'').replaceAll('\\','/').replace(/^\/\/\?\/([a-z]:\/)/i,'$1').replace(/^\/\/\?\/UNC\//i,'//').replace(/\/+$/,'').toLowerCase();
export function matchingRuntimeSessions(sessions,provider,cwd){return sessions.filter(s=>s.provider===provider&&normalized(s.cwd)===normalized(cwd)&&s.handle&&s.incarnation);}
export function verifiedRuntimeBinding(exact,selected,confirmed){const binding=exact||(confirmed?selected:null);return !!(binding?.handle&&binding?.incarnation);}
