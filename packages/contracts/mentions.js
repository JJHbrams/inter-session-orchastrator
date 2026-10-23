// Shared by the browser preview and authoritative room routing. No Node APIs.
export const ALL_MENTION = 'to_all';

export function resolveMentionTargets(aliases, members, chairSessionId) {
  const active = members.filter(member => !member.left_at), chosen = new Map();
  for (const alias of aliases) {
    if (alias === ALL_MENTION) {
      for (const member of active) {
        if (!member.read_only && member.role !== 'chair' && (!chairSessionId || member.session_id !== chairSessionId)) chosen.set(member.id, member);
      }
      continue;
    }
    const matches = active.filter(member => member.alias === alias);
    if (matches.length !== 1 || matches[0].read_only) {
      const error = new Error(matches.length === 1 ? `read-only alias cannot receive execution: @${alias}` : `unknown, ambiguous, or departed alias: @${alias}`);
      error.code = matches.length === 1 ? 'MENTION_READ_ONLY' : 'MENTION_UNKNOWN';
      error.alias = alias;
      throw error;
    }
    chosen.set(matches[0].id, matches[0]);
  }
  return [...chosen.values()];
}

export function mentionSpans(body, includeEmpty = false) {
  if (typeof body !== 'string') return [];
  const result = [];
  for (let i = 0; i < body.length;) {
    if (body[i] === '`' || body.startsWith('~~~', i)) {
      const char = body[i];
      let end = i;
      while (body[end] === char) end++;
      const marker = body.slice(i, end), close = body.indexOf(marker, end);
      i = close < 0 ? body.length : close + marker.length;
      continue;
    }
    if (body[i] === '@' && (!body[i-1] || !/[\p{L}\p{N}_@\\]/u.test(body[i-1]))) {
      const match = body.slice(i+1).match(/^[\p{L}\p{N}_-]+/u);
      if (match || includeEmpty) {
        const alias = match?.[0] || '';
        result.push({alias, start:i, end:i+1+alias.length});
        i += 1 + alias.length;
        continue;
      }
    }
    i++;
  }
  return result;
}
export const parseAliases = body => [...new Set(mentionSpans(body).map(span => span.alias))];
export const mentionAt = (body, caret) => mentionSpans(body.slice(0, caret), true).findLast(span => span.end === caret) || null;
