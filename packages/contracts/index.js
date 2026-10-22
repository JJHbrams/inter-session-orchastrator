import { createHash, randomUUID } from 'node:crypto';

export const MODES = Object.freeze(['live_attach', 'read_only', 'resume', 'fork', 'new']);
export const DELIVERY_STATES = Object.freeze(['queued', 'claimed', 'submitting', 'accepted', 'running', 'completed', 'failed', 'blocked', 'unknown', 'cancelled']);
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
