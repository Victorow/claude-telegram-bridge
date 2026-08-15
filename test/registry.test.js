import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertSession,
  recordOutboundMessage,
  resolveTarget,
  sessionsForOwner,
  markForked,
} from '../src/registry.js';

function emptyRegistry() {
  return { sessions: {}, outboundMessages: {} };
}

test('single active session: message with no prefix targets it regardless of accidental colons', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  const result = resolveTarget(registry, 'caio', { text: 'note: buy milk' });
  assert.equal(result.session.sessionId, 'abc');
  assert.equal(result.text, 'note: buy milk');
});

test('multiple sessions, no prefix: resolves to the most recently active one', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'def', cwd: '/p2', label: 'projeto2', owner: 'caio' }, 200);
  const result = resolveTarget(registry, 'caio', { text: 'continua' });
  assert.equal(result.session.sessionId, 'def');
});

test('matching prefix overrides recency', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'def', cwd: '/p2', label: 'projeto2', owner: 'caio' }, 200);
  const result = resolveTarget(registry, 'caio', { text: 'projeto1: roda os testes' });
  assert.equal(result.session.sessionId, 'abc');
  assert.equal(result.text, 'roda os testes');
});

test('non-matching prefix returns the list of known labels instead of guessing', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'def', cwd: '/p2', label: 'projeto2', owner: 'caio' }, 200);
  const result = resolveTarget(registry, 'caio', { text: 'projeto9: roda os testes' });
  assert.equal(result.noMatch, true);
  assert.deepEqual(result.knownLabels.sort(), ['projeto1', 'projeto2']);
});

test('reply to a tracked message targets that session regardless of recency or prefix', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'def', cwd: '/p2', label: 'projeto2', owner: 'caio' }, 200);
  recordOutboundMessage(registry, '501', 'abc', 150);
  const result = resolveTarget(registry, 'caio', { replyToMessageId: '501', text: 'roda de novo' });
  assert.equal(result.session.sessionId, 'abc');
});

test('reply to an untracked message falls back to prefix/most-recent', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  const result = resolveTarget(registry, 'caio', { replyToMessageId: '999', text: 'oi' });
  assert.equal(result.session.sessionId, 'abc');
});

test('reply to a message belonging to a different owner falls back instead of leaking', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'xyz', cwd: '/friend', label: 'projeto1', owner: 'amigo' }, 300);
  recordOutboundMessage(registry, '700', 'xyz', 300); // sent for "amigo"'s session
  const result = resolveTarget(registry, 'caio', { replyToMessageId: '700', text: 'roda' });
  assert.notEqual(result.session?.sessionId, 'xyz');
  assert.equal(result.session.sessionId, 'abc');
});

test('two owners on the same machine: default resolution never crosses owners', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'xyz', cwd: '/friend', label: 'projeto9', owner: 'amigo' }, 999999);
  const result = resolveTarget(registry, 'caio', { text: 'oi' });
  assert.equal(result.session.sessionId, 'abc');
  assert.deepEqual(sessionsForOwner(registry, 'caio').map((s) => s.sessionId), ['abc']);
});

test("prefix matching another owner's label is treated as non-matching for the requester", () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'other', cwd: '/p2', label: 'projeto2', owner: 'caio' }, 150);
  upsertSession(registry, { sessionId: 'xyz', cwd: '/friend', label: 'especial', owner: 'amigo' }, 200);
  const result = resolveTarget(registry, 'caio', { text: 'especial: roda' });
  assert.equal(result.noMatch, true);
  assert.deepEqual(result.knownLabels.sort(), ['projeto1', 'projeto2']);
});

test('no sessions registered for the owner is reported explicitly', () => {
  const registry = emptyRegistry();
  const result = resolveTarget(registry, 'caio', { text: 'oi' });
  assert.equal(result.noSessions, true);
});

test('outbound message tracking is pruned to a bounded window', () => {
  const registry = emptyRegistry();
  for (let i = 0; i < 250; i++) {
    recordOutboundMessage(registry, String(i), 'abc', i);
  }
  const remaining = Object.keys(registry.outboundMessages);
  assert.ok(remaining.length <= 200);
  assert.ok(!remaining.includes('0')); // oldest entries pruned first
  assert.ok(remaining.includes('249')); // most recent kept
});

test('upsertSession updates lastActive without creating a duplicate entry', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'abc' }, 200);
  assert.equal(Object.keys(registry.sessions).length, 1);
  assert.equal(registry.sessions.abc.lastActive, 200);
  assert.equal(registry.sessions.abc.label, 'projeto1'); // preserved when not passed again
});

test('a session with no origin field defaults to interactive', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  assert.equal(registry.sessions.abc.origin, 'interactive');
});

test('a session registered with an explicit origin keeps it', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'fork1', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork' }, 100);
  assert.equal(registry.sessions.fork1.origin, 'telegram-fork');
});

test('updating a session again without an origin preserves its existing origin', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'fork1', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork' }, 100);
  upsertSession(registry, { sessionId: 'fork1' }, 200);
  assert.equal(registry.sessions.fork1.origin, 'telegram-fork');
});

test('markForked records which session an original was forked into', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'orig', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  markForked(registry, 'orig', 'fork1');
  assert.equal(registry.sessions.orig.forkedInto, 'fork1');
});

test('reply to a message from a session that has since been forked resolves to the fork', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'orig', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  recordOutboundMessage(registry, '501', 'orig', 150);
  upsertSession(registry, { sessionId: 'fork1', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork' }, 200);
  markForked(registry, 'orig', 'fork1');
  const result = resolveTarget(registry, 'caio', { replyToMessageId: '501', text: 'continua' });
  assert.equal(result.session.sessionId, 'fork1');
});

test('prefix resolution follows a fork pointer instead of returning the stale original', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'orig', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'fork1', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork' }, 50);
  markForked(registry, 'orig', 'fork1');
  const result = resolveTarget(registry, 'caio', { text: 'projeto1: oi' });
  assert.equal(result.session.sessionId, 'fork1');
});

test('most-recent resolution follows a fork pointer instead of returning the stale original', () => {
  const registry = emptyRegistry();
  upsertSession(registry, { sessionId: 'orig', cwd: '/p1', label: 'projeto1', owner: 'caio' }, 100);
  upsertSession(registry, { sessionId: 'fork1', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork' }, 50);
  markForked(registry, 'orig', 'fork1');
  const result = resolveTarget(registry, 'caio', { text: 'oi' });
  assert.equal(result.session.sessionId, 'fork1');
});
