import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from './config.js';

const MAX_TRACKED_OUTBOUND_MESSAGES = 200;

export function getRegistryPath() {
  return path.join(getConfigDir(), 'registry.json');
}

export function loadRegistry() {
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) {
    return { sessions: {}, outboundMessages: {} };
  }
  const raw = fs.readFileSync(registryPath, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return { sessions: parsed.sessions || {}, outboundMessages: parsed.outboundMessages || {} };
  } catch (err) {
    throw new Error(`Registry file at ${registryPath} is not valid JSON: ${err.message}`);
  }
}

export function saveRegistry(registry) {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getRegistryPath(), JSON.stringify(registry, null, 2));
}

/** Records or refreshes a session. Keyed by sessionId so concurrent accounts never clobber each other's entries. */
export function upsertSession(registry, { sessionId, cwd, label, owner, origin }, now = Date.now()) {
  const existing = registry.sessions[sessionId];
  registry.sessions[sessionId] = {
    sessionId,
    cwd: cwd ?? existing?.cwd,
    label: label ?? existing?.label,
    owner: owner ?? existing?.owner,
    origin: origin ?? existing?.origin ?? 'interactive',
    forkedInto: existing?.forkedInto ?? null,
    lastActive: now,
  };
  return registry;
}

export function sessionsForOwner(registry, ownerId) {
  return Object.values(registry.sessions).filter((s) => s.owner === ownerId);
}

/** Records that `originalSessionId` was forked into `forkedSessionId` (see input-relay's fork-vs-resume decision). Target resolution follows this pointer so a reply to a pre-fork notification still lands on the current fork. */
export function markForked(registry, originalSessionId, forkedSessionId) {
  const original = registry.sessions[originalSessionId];
  if (original) {
    original.forkedInto = forkedSessionId;
  }
  return registry;
}

/** Tracks which session an outbound message belongs to, so a later reply can be matched back. Pruned to a bounded recent window. */
export function recordOutboundMessage(registry, messageId, sessionId, now = Date.now()) {
  registry.outboundMessages[String(messageId)] = { sessionId, sentAt: now };
  const entries = Object.entries(registry.outboundMessages);
  if (entries.length > MAX_TRACKED_OUTBOUND_MESSAGES) {
    entries
      .sort((a, b) => a[1].sentAt - b[1].sentAt)
      .slice(0, entries.length - MAX_TRACKED_OUTBOUND_MESSAGES)
      .forEach(([id]) => delete registry.outboundMessages[id]);
  }
  return registry;
}

const PREFIX_PATTERN = /^([^\s:]+):\s*(.*)$/s;

/**
 * Resolves which session an inbound message targets, scoped to the requesting
 * owner. Precedence: reply-based match -> label prefix -> most-recent.
 *
 * Prefix parsing is only attempted when the owner has more than one session:
 * with a single session there is nothing to disambiguate, so a message that
 * merely happens to contain a colon (e.g. "note: buy milk") is never
 * misread as a failed label match.
 */
/** Follows a session's `forkedInto` pointer to the current fork, if any, so resolution never returns a session that's since been superseded by a fork. */
function followFork(registry, session) {
  let current = session;
  while (current?.forkedInto && registry.sessions[current.forkedInto]) {
    current = registry.sessions[current.forkedInto];
  }
  return current;
}

export function resolveTarget(registry, ownerId, { replyToMessageId, text }) {
  const ownerSessions = sessionsForOwner(registry, ownerId);

  if (replyToMessageId != null) {
    const tracked = registry.outboundMessages[String(replyToMessageId)];
    if (tracked) {
      const session = registry.sessions[tracked.sessionId];
      if (session && session.owner === ownerId) {
        return { session: followFork(registry, session), text };
      }
    }
    // Untracked, pruned, or belongs to another owner: fall through to prefix/most-recent.
  }

  if (ownerSessions.length > 1) {
    const match = text.match(PREFIX_PATTERN);
    if (match) {
      const [, label, rest] = match;
      const session = ownerSessions.find((s) => s.label === label);
      if (session) {
        return { session: followFork(registry, session), text: rest };
      }
      return { noMatch: true, knownLabels: ownerSessions.map((s) => s.label) };
    }
  }

  if (ownerSessions.length === 0) {
    return { noSessions: true };
  }

  const mostRecent = ownerSessions.reduce((a, b) => (b.lastActive > a.lastActive ? b : a));
  return { session: followFork(registry, mostRecent), text };
}
