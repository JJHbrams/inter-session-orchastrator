import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EFFORTS } from '../../packages/contracts/chair-settings.js';
const claudeModels=Object.freeze([
  {id:'sonnet',label:'Sonnet',efforts:['low','medium','high','xhigh','max']},
  {id:'opus',label:'Opus',efforts:['low','medium','high','xhigh','max']},
  {id:'haiku',label:'Haiku',efforts:['low','medium','high']},
  {id:'fable',label:'Fable',efforts:['low','medium','high','xhigh','max']}
]);
function codexModels(){
  try{
    const parsed=JSON.parse(readFileSync(join(homedir(),'.codex','models_cache.json'),'utf8'));
    if(!Array.isArray(parsed.models))throw Error('models cache has no models');
    return {models:parsed.models.filter(x=>typeof x?.slug==='string').map(x=>({id:x.slug,label:x.slug,efforts:(x.supported_reasoning_levels||[]).map(y=>y?.effort).filter(e=>EFFORTS.includes(e))})),source:'local models_cache.json'};
  }catch(error){return {models:[],source:'local models_cache.json unavailable'};}
}
export function getChairOptions(){
 const codex=codexModels();
 return {providers:[
  {id:'claude',label:'Claude',models:claudeModels,efforts:['low','medium','high','xhigh','max'],allowCustomModel:true,source:'Claude CLI aliases'},
  {id:'codex',label:'Codex',models:codex.models,efforts:EFFORTS,allowCustomModel:false,source:codex.source}
 ],defaults:{provider:'claude',model:null,effort:null}};
}
