const MAX_VALUE_LENGTH=200;
export const CHAIR_PROVIDERS=Object.freeze(['claude','codex']);
export const EFFORTS=Object.freeze(['low','medium','high','xhigh','max','ultra']);
const clean=(value,name,{nullable=true}={})=>{
  if(value===undefined)return undefined;
  if(value===null||value===''){if(nullable)return null;throw Error(`${name} is required`);}
  if(typeof value!=='string'||value.length>MAX_VALUE_LENGTH||/[\r\n]/.test(value)||!value.trim())throw Error(`invalid ${name}`);
  return value.trim();
};
export function normalizeChairSettings(input={}, {current=null, options}={}){
  if(!input||Array.isArray(input)||typeof input!=='object')throw Error('invalid chair settings');
  const provider=clean(input.provider,'provider');
  const savedProvider=current?.provider||'claude';
  if(current&&provider!==undefined&&provider!==savedProvider) { const error=Error('chair provider is immutable');error.code='PROVIDER_IMMUTABLE';throw error; }
  const resolvedProvider=provider??savedProvider;
  if(!CHAIR_PROVIDERS.includes(resolvedProvider))throw Error('invalid chair provider');
  const model=clean(input.model,'model'),effort=clean(input.effort,'effort');
  const result={provider:resolvedProvider,model:model===undefined?(current?.model??null):model,effort:effort===undefined?(current?.effort??null):effort};
  if(!options)return result;
  const p=options.providers.find(x=>x.id===resolvedProvider);if(!p)throw Error('chair provider unavailable');
  const found=result.model===null?null:p.models.find(x=>x.id===result.model);
  if(result.model!==null&&!found&&!p.allowCustomModel)throw Error('unsupported chair model');
  if(result.effort!==null){
    const allowed=found?.efforts;
    if(!allowed)throw Error('provider-error: this model has no verified effort levels');
    if(!allowed.includes(result.effort))throw Error('unsupported chair effort');
  }
  return result;
}
