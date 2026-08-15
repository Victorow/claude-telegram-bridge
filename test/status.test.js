import test from 'node:test';
import assert from 'node:assert/strict';
import { getStatusSnapshot } from '../src/status.js';

function baseConfig(overrides = {}) {
  return { botToken: 't', owners: { '111': 'operator' }, invites: {}, enabled: true, granularity: 'default', ...overrides };
}

function emptyRegistry() {
  return { sessions: {}, outboundMessages: {} };
}

test('reports unconfigured when there is no config yet', () => {
  const result = getStatusSnapshot(null, emptyRegistry());
  assert.deepEqual(result, { configured: false });
});

test('reports enabled, connected chat, and zero sessions when nothing is registered yet', () => {
  const result = getStatusSnapshot(baseConfig(), emptyRegistry());
  assert.equal(result.configured, true);
  assert.equal(result.enabled, true);
  assert.equal(result.connectedChatId, '111');
  assert.equal(result.sessionCount, 0);
  assert.equal(result.lastActivity, null);
});

test('reports disabled state accurately', () => {
  const result = getStatusSnapshot(baseConfig({ enabled: false }), emptyRegistry());
  assert.equal(result.enabled, false);
});

test('counts sessions across all owners and reports the most recent activity', () => {
  const registry = {
    sessions: {
      a: { sessionId: 'a', owner: 'operator', lastActive: 100 },
      b: { sessionId: 'b', owner: 'amigo', lastActive: 300 },
      c: { sessionId: 'c', owner: 'operator', lastActive: 200 },
    },
    outboundMessages: {},
  };
  const result = getStatusSnapshot(baseConfig(), registry);
  assert.equal(result.sessionCount, 3);
  assert.equal(result.lastActivity, 300);
});

test('reports no connected chat id when the operator has not registered one yet', () => {
  const result = getStatusSnapshot(baseConfig({ owners: {} }), emptyRegistry());
  assert.equal(result.connectedChatId, null);
});

test('reports granularity alongside enabled', () => {
  const result = getStatusSnapshot(baseConfig({ granularity: 'verbose' }), emptyRegistry());
  assert.equal(result.granularity, 'verbose');
});
