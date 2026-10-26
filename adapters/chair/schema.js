const attachments={type:'array',items:{type:'string'},maxItems:5};
const question={type:'object',additionalProperties:false,required:['targetMembershipIds','body'],properties:{targetMembershipIds:{type:'array',items:{type:'string'},minItems:1,maxItems:20},body:{type:'string',minLength:1,maxLength:8000},attachmentIds:attachments}};
const proposal={type:'object',additionalProperties:false,required:['body','sourceIds'],properties:{body:{type:'string',minLength:1,maxLength:8000},sourceIds:{type:'array',items:{type:'string'},maxItems:100},attachmentIds:attachments}};
const reaction={type:'object',additionalProperties:false,required:['messageId','emoji','active'],properties:{messageId:{type:'string'},emoji:{enum:['👍','👎','❓','✅','💡','❤️','👀']},active:{type:'boolean'}}};
export const chairOutputSchema={type:'object',additionalProperties:false,required:['speech','questions','proposal'],properties:{speech:{type:'string',minLength:1,maxLength:8000},attachmentIds:attachments,questions:{type:'array',items:question,maxItems:5},proposal:{anyOf:[{type:'null'},proposal]},reactions:{type:'array',items:reaction,maxItems:20}}};
const debate={type:'object',additionalProperties:false,required:['agendaId','phase','conclusionRevision','sourceIds','unresolved'],properties:{agendaId:{type:'string',minLength:1},phase:{enum:['plan','refine','final']},conclusionRevision:{type:'integer',minimum:1},sourceIds:{type:'array',items:{type:'string'},maxItems:100},unresolved:{type:'array',items:{type:'string'},maxItems:50},outcome:{enum:['consensus','qualified','disputed','insufficient_evidence','limit_reached']}}};
chairOutputSchema.properties.debate=debate;
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
export const codexChairOutputSchema={...chairOutputSchema,required:['speech','attachmentIds','questions','proposal','reactions','debate'],properties:{...chairOutputSchema.properties,attachmentIds:nullable(attachments),reactions:nullable({type:'array',items:reaction,maxItems:20}),debate:nullable(debate),questions:{type:'array',maxItems:5,items:{...question,required:['targetMembershipIds','body','attachmentIds'],properties:{...question.properties,attachmentIds:nullable(attachments)}}},proposal:{anyOf:[{type:'null'},{...proposal,required:['body','sourceIds','attachmentIds'],properties:{...proposal.properties,attachmentIds:nullable(attachments)}}]}}};
const strings=(value,max)=>Array.isArray(value)&&value.length<=max&&value.every(item=>typeof item==='string');
export function validateChairOutput(output){
 if(!output||typeof output!=='object'||Array.isArray(output)||typeof output.speech!=='string'||!output.speech||output.speech.length>8000||!Array.isArray(output.questions)||output.questions.length>5)return false;
 if(output.attachmentIds!==undefined&&output.attachmentIds!==null&&!strings(output.attachmentIds,5))return false;
 if(output.reactions!==undefined&&output.reactions!==null&&(!Array.isArray(output.reactions)||output.reactions.length>20||!output.reactions.every(r=>r&&typeof r.messageId==='string'&&['👍','👎','❓','✅','💡','❤️','👀'].includes(r.emoji)&&typeof r.active==='boolean')))return false;
 if(!output.questions.every(q=>q&&strings(q.targetMembershipIds,20)&&q.targetMembershipIds.length&&typeof q.body==='string'&&q.body.length>0&&q.body.length<=8000&&(q.attachmentIds===undefined||q.attachmentIds===null||strings(q.attachmentIds,5))))return false;
 const d=output.debate;
 if(d!==undefined&&d!==null&&(!d||typeof d.agendaId!=='string'||!['plan','refine','final'].includes(d.phase)||!Number.isInteger(d.conclusionRevision)||d.conclusionRevision<1||!strings(d.sourceIds,100)||!strings(d.unresolved,50)||!!(d.outcome&&!['consensus','qualified','disputed','insufficient_evidence','limit_reached'].includes(d.outcome))))return false;
 const p=output.proposal;
 return p===null||(p&&typeof p.body==='string'&&p.body.length>0&&p.body.length<=8000&&strings(p.sourceIds,100)&&(p.attachmentIds===undefined||p.attachmentIds===null||strings(p.attachmentIds,5)));
}
