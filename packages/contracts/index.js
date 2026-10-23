import { createHash, randomUUID } from 'node:crypto';

export const MODES = Object.freeze(['live_attach', 'read_only', 'resume', 'fork', 'new']);
export const DELIVERY_STATES = Object.freeze(['queued', 'claimed', 'submitting', 'accepted', 'running', 'completed', 'failed', 'blocked', 'unknown', 'cancelled']);
// The first five are offered to new clients. The final two remain readable and removable
// so existing rooms retain their historical reaction meaning.
export const REACTION_EMOJIS = Object.freeze(['👍', '👎', '❓', '✅', '💡', '❤️', '👀']);
export const DEFAULT_REACTION_EMOJIS = Object.freeze(REACTION_EMOJIS.slice(0, 5));
export const REACTION_MEANINGS = Object.freeze({
  '👍': { label: '좋아요', hint: 'Positive quality feedback, not formal approval.' },
  '👎': { label: '반대', hint: 'Clarify the reason for disagreement if it is not already given.' },
  '❓': { label: '모르겠음', hint: 'Ask which part is unclear and explain before proceeding; this is a clarification request, not an uncertainty vote.' },
  '✅': { label: '확인', hint: 'Received or understood, not agreement or completed work.' },
  '💡': { label: '아이디어 있음', hint: 'Ask this reactor for their concrete idea if it is not already explained.' },
  '❤️': { label: '공감', hint: 'Legacy positive reaction.' },
  '👀': { label: '확인 중', hint: 'Legacy checking reaction.' }
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
