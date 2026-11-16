export function sessionLocation(member={}){
 const cwd=typeof member.cwd==='string'?member.cwd.trim():'';
 const project=cwd.replaceAll('\\','/').replace(/\/+$/,'').split('/').pop()||member.projectName||(typeof member.project==='string'?member.project:member.project?.name)||'';
 return {label:project?`프로젝트 · ${project}`:'작업 폴더 미확인',path:cwd||project||'작업 폴더를 아직 확인하지 못했어요.'};
}
