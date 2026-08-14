import test from 'node:test';
import assert from 'node:assert/strict';
import { handleHookEvent, shouldRelay, formatMessage } from '../src/outputRelay.js';

function baseConfig(overrides = {}) {
  return { botToken: 't', owners: { '111': 'caio' }, invites: {}, enabled: true, granularity: 'default', ...overrides };
}

function emptyRegistry() {
  return { sessions: {}, outboundMessages: {} };
}

function harness({ config = baseConfig(), registry } = {}) {
  const sent = [];
  const persisted = [];
  const send = async (cfg, chatId, text) => {
    sent.push({ chatId, text });
    return { message_id: sent.length };
  };
  const persistRegistry = (reg) => persisted.push(JSON.parse(JSON.stringify(reg)));
  return {
    sent,
    persisted,
    call: (payload, extra = {}) =>
      handleHookEvent(payload, {
        owner: 'caio',
        label: 'projeto1',
        config,
        registry: registry ?? emptyRegistry(),
        send,
        persistRegistry,
        now: () => 1000,
        ...extra,
      }),
  };
}

test('Stop event sends last_assistant_message as-is when the owner has one session', async () => {
  const h = harness();
  await h.call({ hook_event_name: 'Stop', session_id: 'abc', cwd: '/p1', last_assistant_message: 'build ok' });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].text, 'build ok');
});

test('label defaults to the basename of cwd when not explicitly overridden', async () => {
  const registry = { sessions: { existing: { sessionId: 'existing', owner: 'caio', label: 'projeto2', lastActive: 1 } }, outboundMessages: {} };
  const h = harness({ registry });
  await handleHookEvent(
    { hook_event_name: 'Stop', session_id: 'abc', cwd: '/home/caio/meu-projeto', last_assistant_message: 'ok' },
    { owner: 'caio', config: baseConfig(), registry, send: async (c, chatId, text) => { h.sent.push({ chatId, text }); return { message_id: 1 }; }, persistRegistry: () => {}, now: () => 1 }
  );
  assert.equal(h.sent[0].text, '[meu-projeto] ok');
});

test('Stop event includes the label when the owner has more than one session', async () => {
  const registry = { sessions: { existing: { sessionId: 'existing', owner: 'caio', label: 'projeto2', lastActive: 1 } }, outboundMessages: {} };
  const h = harness({ registry });
  await h.call({ hook_event_name: 'Stop', session_id: 'abc', cwd: '/p1', last_assistant_message: 'build ok' });
  assert.equal(h.sent[0].text, '[projeto1] build ok');
});

test('no message is sent while disabled, but the session is still tracked', async () => {
  const registry = emptyRegistry();
  const h = harness({ config: baseConfig({ enabled: false }), registry });
  const result = await h.call({ hook_event_name: 'Stop', session_id: 'abc', cwd: '/p1', last_assistant_message: 'build ok' });
  assert.equal(h.sent.length, 0);
  assert.equal(result.reason, 'disabled');
  assert.ok(registry.sessions.abc);
});

test('Notification with a default-tier type is relayed', async () => {
  const h = harness();
  await h.call({ hook_event_name: 'Notification', session_id: 'abc', cwd: '/p1', notification_type: 'permission_prompt', notification_message: 'needs permission for Bash' });
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].text, /needs permission for Bash/);
});

test('Notification with a verbose-only type is filtered out by default granularity', async () => {
  const h = harness();
  const result = await h.call({ hook_event_name: 'Notification', session_id: 'abc', cwd: '/p1', notification_type: 'agent_completed', notification_message: 'sub-agent done' });
  assert.equal(h.sent.length, 0);
  assert.equal(result.reason, 'granularity-filtered');
});

test('Notification with a verbose-only type is relayed once granularity is verbose', async () => {
  const h = harness({ config: baseConfig({ granularity: 'verbose' }) });
  await h.call({ hook_event_name: 'Notification', session_id: 'abc', cwd: '/p1', notification_type: 'agent_completed', notification_message: 'sub-agent done' });
  assert.equal(h.sent.length, 1);
});

test('recorded outbound message id ties back to the session id', async () => {
  const registry = emptyRegistry();
  const h = harness({ registry });
  await h.call({ hook_event_name: 'Stop', session_id: 'abc', cwd: '/p1', last_assistant_message: 'ok' });
  assert.deepEqual(registry.outboundMessages['1'], { sessionId: 'abc', sentAt: 1000 });
});

test('missing config (bridge not set up yet) fails open without throwing', async () => {
  const h = harness({ config: null });
  const result = await h.call({ hook_event_name: 'Stop', session_id: 'abc', cwd: '/p1', last_assistant_message: 'ok' });
  assert.equal(result.reason, 'not-configured');
  assert.equal(h.sent.length, 0);
});

test('missing owner argument fails open without throwing', async () => {
  const h = harness();
  const result = await handleHookEvent(
    { hook_event_name: 'Stop', session_id: 'abc', cwd: '/p1', last_assistant_message: 'ok' },
    { owner: undefined, label: 'projeto1', config: baseConfig(), registry: emptyRegistry(), send: h.call, now: () => 1 }
  );
  assert.equal(result.reason, 'no-owner');
});

test('shouldRelay: Stop always relays regardless of granularity', () => {
  assert.equal(shouldRelay({ hook_event_name: 'Stop' }, baseConfig({ granularity: 'default' })), true);
});

test('formatMessage returns null for an unhandled hook event type', () => {
  assert.equal(formatMessage({ hook_event_name: 'PostToolUse' }, {}), null);
});
