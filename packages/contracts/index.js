import { createHash, randomUUID } from 'node:crypto';

export const MODES = Object.freeze(['live_attach', 'read_only', 'resume', 'fork', 'new']);
export const DELIVERY_STATES = Object.freeze(['queued', 'claimed', 'submitting', 'accepted', 'running', 'completed', 'failed', 'blocked', 'unknown', 'cancelled']);
// Supported values remain stable for existing clients; the default palette is separate.
export const REACTION_EMOJIS = Object.freeze(['👍', '👎', '❓', '✅', '💡', '❤️', '👀']);
export const DEFAULT_REACTION_EMOJIS = Object.freeze(['👍', '👎', '❓', '✅', '👀', '💡']);
export const REACTION_MEANINGS = Object.freeze({
  '👍': { label: '좋아요', hint: 'Positive feedback or conversational agreement, not formal consensus or user approval.' },
  '👎': { label: '반대', hint: 'Clarify the reason for disagreement if it is not already given.' },
  '❓': { label: '모르겠음', hint: 'Ask which part is unclear and explain before proceeding; this is a clarification request, not an uncertainty vote.' },
  '✅': { label: '확인', hint: 'Received or understood, not agreement or completed work.' },
  '💡': { label: '아이디어 있음', hint: 'Ask this reactor for their concrete idea if it is not already explained.' },
  '❤️': { label: '공감', hint: 'Legacy positive reaction.' },
  '👀': { label: '검토 중', hint: 'Currently checking this message. Not understood, finished, or agreed. Remove your own reaction when finished; no reply or automatic wake is required.' }
});
export const identityKey = ({ provider, host, nativeId, cwd, profile }) => {
  let path = cwd.replaceAll('\\', '/').replace(/\/+$/, '');
  if (/^[a-z]:\//i.test(path) || path.startsWith('//')) path = path.toLowerCase();
  return [provider.toLowerCase(), host.toLowerCase(), nativeId, path, profile].join('\u001f');
};
export const hashPayload = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const id = () => randomUUID();
export function requireText(value, name, max = 8000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is required`);
  return value.trim();
}
export function exactIdentity(value) {
  for (const key of ['provider', 'host', 'nativeId', 'cwd', 'profile']) requireText(value?.[key], `identity.${key}`, 1024);
  return value;
}

// Mentions are deliberately conservative: code, escaped @ signs, and email addresses
// remain ordinary text. The resolver supplies the currently valid alias allowlist.
export { parseAliases, mentionSpans, resolveMentionTargets } from './mentions.js';
export { CHAIR_PROVIDERS, EFFORTS, normalizeChairSettings } from './chair-settings.js';
export { OFFICE_STATES, OFFICE_ACTIVITIES, OFFICE_ZONES, officeAgent } from './office-state.js';
