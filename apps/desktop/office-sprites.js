/** Original pixel sprite sheets, generated from the approved office concept. */
export function createOfficeSprite(document,provider='other',activity='none',state='idle',seed=''){
 const el=document.createElement('span');el.classList.add('office-sprite-art','office-atlas',`office-sprite-${provider}`,`office-task-${activity}`);el.setAttribute('aria-hidden','true');
 const pose=state==='completed'?7:({reading:3,research:3,coding:4,terminal:5,responding:6,synthesis:6,delegating:6}[activity]??0),cadence=.72+(String(seed).split('').reduce((n,c)=>n+c.charCodeAt(0),0)%28)/100;
 el.dataset.pose=String(pose);el.style.setProperty('--task-cadence',`${cadence}s`);el.style.backgroundImage=`url('/assets/office/${provider==='claude'?'claude':'codex'}-sprites.png')`;el.style.backgroundPosition=`${(pose%4)*100/3}% ${pose>=4?100:0}%`;return el;
}
