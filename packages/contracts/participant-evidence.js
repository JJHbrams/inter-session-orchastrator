import { createHash } from 'node:crypto';

export const MAX_EVIDENCE_TITLE_LENGTH = 120;
export const MAX_EVIDENCE_BODY_LENGTH = 32000;

export function participantEvidence(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid evidence');
  const { title, body } = value;
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_EVIDENCE_TITLE_LENGTH) throw Error('invalid evidence title');
  if (typeof body !== 'string' || !body.length || body.length > MAX_EVIDENCE_BODY_LENGTH) throw Error('invalid evidence body');
  return { title: title.trim(), body };
}

export function evidenceFilename(title) {
  const label=title.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'').trim().slice(0,80)||'evidence';
  return `${label}-${createHash('sha256').update(title).digest('hex').slice(0, 8)}.md`;
}
