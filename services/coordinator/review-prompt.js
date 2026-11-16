import {REVIEW_CONVERSATION} from '../../packages/contracts/dialogue-language.js';
// Aggregating several valid messages must not overflow the ordinary message limit.
// Full originals stay in the room; this envelope tells recipients how to retrieve them.
export function reviewPrompt(payload,limit=8000){
 const encode=value=>JSON.stringify(value);

 const contextReference={tool:'room_history_read',kind:'agenda_read',id:payload.agendaId,agendaId:payload.agendaId,conclusionRevision:payload.conclusionRevision,candidateField:'agendas[].current_conclusion',argumentsField:'agendas[].arguments'};
 const expectedResponse='Use room_history_read with kind agenda_read for the exact agenda ID and verify its revision. Read the full candidate and argument messages by exact IDs using kind history_read, following end offsets until sufficient. Legacy room_context is only a fallback. Use room_read_attachment for original file bytes. Return an explicit stance and source IDs; references are not read acknowledgements. '+REVIEW_CONVERSATION;
 const refs={...payload,referencesOnly:true,contextReference,expectedResponse,arguments:payload.arguments.map(({body,...rest})=>({...rest,bodyOmitted:true}))};
 delete refs.candidate;refs.candidateOmitted=true;
 let encoded=encode(refs);if(encoded.length<=limit)return encoded;
 // File metadata is already present once in attachmentRefs. Keep per-argument
 // file identities without repeating timestamps/owners/hashes for every reference.
 const lean={...refs,arguments:refs.arguments.map(argument=>({...argument,...(Array.isArray(argument.attachments)?{attachments:argument.attachments.map(file=>({id:file.id}))}:{})}))};
 encoded=encode(lean);if(encoded.length<=limit)return encoded;
 const compact={type:payload.type,agendaId:payload.agendaId,roundId:payload.roundId,conclusionRevision:payload.conclusionRevision,referencesOnly:true,contextReference,argumentMessageIds:payload.arguments.map(x=>x.id),attachmentsInContext:true,expectedResponse};
 encoded=encode(compact);if(encoded.length<=limit)return encoded;
 // UUIDs in a comma-separated list retain every ID with less envelope overhead.
 compact.argumentMessageIds=compact.argumentMessageIds.join(',');compact.argumentIdEncoding='comma-separated';
 encoded=encode(compact);if(encoded.length>limit)throw Error('Review references exceed the supported message limit');
 return encoded;
}
