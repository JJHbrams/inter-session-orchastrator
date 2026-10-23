import { spawnSync } from 'node:child_process';

const ORCA = 'C:/Users/jhjang/AppData/Local/Programs/orca/resources/bin/orca.exe';

function json(result) {
  const text = String(result?.stdout || '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function command(run, args) {
  const result = run(ORCA, args, { timeout: 15_000, encoding: 'utf8' });
  const body = json(result);
  if (result?.status && result.status !== 0) {
    const error = new Error(body?.error?.message || body?.message || result.stderr || 'orca command failed');
    error.code = body?.error?.code || body?.code || 'ORCA_COMMAND_FAILED';
    error.receipt = body;
    throw error;
  }
  return body ?? result?.stdout ?? '';
}

function valueAt(object, names) {
  if (!object || typeof object !== 'object') return undefined;
  for (const name of names) if (object[name] !== undefined) return object[name];
  for (const value of Object.values(object)) {
    const found = valueAt(value, names);
    if (found !== undefined) return found;
  }
  return undefined;
}

function screenText(reading) {
  if (typeof reading === 'string') return reading;
  return reading?.screen || reading?.text || reading?.terminal?.screen || '';
}

function emptyComposer(provider, screen) {
  const trimmed = String(screen || '').trim();
  if (!trimmed) return false;
  const codex = ['› Ask Codex to do anything', '› Ask a follow-up question', '›'];
  const claude = ['❯'];
  return (provider === 'codex' ? codex : provider === 'claude' ? claude : []).some(prompt => trimmed === prompt);
}

function validReceipt(receipt, binding, session) {
  const provider = valueAt(receipt, ['provider']);
  const incarnation = valueAt(receipt, ['processIncarnation', 'process_incarnation', 'incarnation']);
  const stage = valueAt(receipt, ['stage', 'status']);
  return provider === session.provider && incarnation === binding.incarnation && ['input_accepted', 'turn_started'].includes(stage);
}

export function createOrcaParticipantAdapter({ run = spawnSync } = {}) {
  const show = binding => command(run, ['terminal', 'show', binding.handle, '--json']);
  const read = binding => command(run, ['terminal', 'read', binding.handle, '--screen', '--wait', '--for', 'tui-idle', '--timeout-ms', '1', '--json']);

  return {
    async preflight(binding, session) {
      if (!binding?.handle || !binding?.incarnation || !['codex', 'claude'].includes(session?.provider)) {
        return { ok: false, reason: 'unverified native terminal identity' };
      }
      const shown = show(binding);
      const incarnation = valueAt(shown, ['processIncarnation', 'process_incarnation', 'incarnation']);
      const provider = valueAt(shown, ['provider']);
      if (provider !== session.provider || incarnation !== binding.incarnation) return { ok: false, reason: 'terminal identity changed', shown };
      const before = read(binding);
      const draft = valueAt(before, ['draft']);
      if (draft !== undefined && String(draft).length) return { ok: false, reason: 'composer has a draft', before };
      if (!emptyComposer(session.provider, screenText(before))) return { ok: false, reason: 'composer is not exactly empty and idle', before };
      return { ok: true, shown, before };
    },

    async send(binding, session, prompt, hostRequestId, { observeOnly = false } = {}) {
      if (observeOnly) return this.observe(binding, session, hostRequestId);
      const first = await this.preflight(binding, session);
      if (!first.ok) return first;
      // Recheck immediately before submit.  Orca exposes no atomic draft CAS, so a
      // human may still type after this check; callers must report that residual race.
      const final = await this.preflight(binding, session);
      if (!final.ok) return final;
      const receipt = command(run, ['terminal', 'send', binding.handle, '--text', prompt, '--enter', '--wait-submit', '1', '--retry-request', hostRequestId, '--json']);
      if (!validReceipt(receipt, binding, session)) return { ok: false, reason: 'uncorrelated or incomplete host receipt', receipt };
      return { ok: true, receipt, stage: valueAt(receipt, ['stage', 'status']) };
    },

    async observe(binding, session, hostRequestId) {
      const receipt = command(run, ['terminal', 'send', binding.handle, '--retry-request', hostRequestId, '--json']);
      if (!validReceipt(receipt, binding, session)) return { ok: false, reason: 'host receipt remains unknown', receipt };
      return { ok: true, receipt, stage: valueAt(receipt, ['stage', 'status']) };
    }
  };
}
