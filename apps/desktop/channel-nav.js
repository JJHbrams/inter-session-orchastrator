export const CHANNEL_NAV_STORAGE_KEY='session-rooms.channel-nav.v1';
export const UNASSIGNED_CHANNEL_KEY='__unassigned__';

function readStoredState(storage){
 try{
  const raw=storage?.getItem(CHANNEL_NAV_STORAGE_KEY);
  if(!raw)return {};
  const parsed=JSON.parse(raw);
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return {};
  return Object.fromEntries(Object.entries(parsed).filter(([,value])=>typeof value==='boolean'));
 }catch{return {};}
}

export function createChannelNav(storage){
 let target=storage;
 if(target===undefined){try{target=globalThis.localStorage;}catch{target=null;}}
 const states=new Map(Object.entries(readStoredState(target)));
 const persist=()=>{
  try{target?.setItem(CHANNEL_NAV_STORAGE_KEY,JSON.stringify(Object.fromEntries(states)));}catch{}
 };
 return {
  expanded(key){return states.get(key)!==false;},
  setExpanded(key,expanded){if(expanded)states.delete(key);else states.set(key,false);persist();return expanded;},
  toggle(key){return this.setExpanded(key,!this.expanded(key));},
  expand(key){return this.setExpanded(key,true);}
 };
}

export function expandParentForNewRoom(state,channelId){
 return state.expand(channelId||UNASSIGNED_CHANNEL_KEY);
}

export function bindChannelDisclosure({button,group,state,key}){
 const update=()=>{
  const expanded=state.expanded(key);
  button.setAttribute('aria-expanded',String(expanded));
  button.querySelector('.channel-chevron').textContent=expanded?'▾':'▸';
  group.hidden=!expanded;
 };
 button.addEventListener('click',()=>{state.toggle(key);update();});
 update();
 return update;
}
