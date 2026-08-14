import test from 'node:test';
import assert from 'node:assert/strict';
import { handleUpdate, sendMessage, getUpdates } from '../src/gateway.js';

function baseConfig(overrides = {}) {
  return {
    botToken: 'test-token',
    owners: { '111': 'operator' },
    invites: {},
    enabled: true,
    granularity: 'default',
    ...overrides,
  };
}

function textUpdate(chatId, text, extra = {}) {
  return { update_id: 1, message: { chat: { id: chatId }, text, ...extra } };
}

function recordingCallbacks() {
  const calls = { onRegister: [], onToggle: [], onMessage: [] };
  return {
    calls,
    onRegister: async (chatId, code) => calls.onRegister.push({ chatId, code }),
    onToggle: async (chatId, enabled) => calls.onToggle.push({ chatId, enabled }),
    onMessage: async (chatId, ownerId, message) => calls.onMessage.push({ chatId, ownerId, message }),
  };
}

test('unauthorized chat is dropped silently and never reaches routing logic', async () => {
  const config = baseConfig();
  const cb = recordingCallbacks();
  await handleUpdate(config, textUpdate(999, 'projeto1: roda os testes'), cb);
  assert.deepEqual(cb.calls.onMessage, []);
  assert.deepEqual(cb.calls.onToggle, []);
});

test('unauthorized chat sending /on or /off is also dropped silently', async () => {
  const config = baseConfig();
  const cb = recordingCallbacks();
  await handleUpdate(config, textUpdate(999, '/on'), cb);
  await handleUpdate(config, textUpdate(999, '/off'), cb);
  assert.deepEqual(cb.calls.onToggle, []);
});

test('registered owner message is routed to onMessage while enabled', async () => {
  const config = baseConfig();
  const cb = recordingCallbacks();
  await handleUpdate(config, textUpdate(111, 'projeto1: roda os testes'), cb);
  assert.equal(cb.calls.onMessage.length, 1);
  assert.equal(cb.calls.onMessage[0].ownerId, 'operator');
});

test('disabling via /off from a registered owner stops further processing', async () => {
  const config = baseConfig({ enabled: true });
  const cb = recordingCallbacks();
  await handleUpdate(config, textUpdate(111, '/off'), cb);
  assert.deepEqual(cb.calls.onToggle, [{ chatId: '111', enabled: false }]);
});

test('a normal message is ignored while disabled, with no side effects', async () => {
  const config = baseConfig({ enabled: false });
  const cb = recordingCallbacks();
  await handleUpdate(config, textUpdate(111, 'projeto1: roda os testes'), cb);
  assert.deepEqual(cb.calls.onMessage, []);
});

test('/on from a registered owner is processed even while disabled', async () => {
  const config = baseConfig({ enabled: false });
  const cb = recordingCallbacks();
  await handleUpdate(config, textUpdate(111, '/on'), cb);
  assert.deepEqual(cb.calls.onToggle, [{ chatId: '111', enabled: true }]);
});

test('/register is processed even for an unregistered chat', async () => {
  const config = baseConfig();
  const cb = recordingCallbacks();
  await handleUpdate(config, textUpdate(999, '/register ABC123'), cb);
  assert.deepEqual(cb.calls.onRegister, [{ chatId: '999', code: 'ABC123' }]);
});

test('non-text updates are ignored without throwing', async () => {
  const config = baseConfig();
  const cb = recordingCallbacks();
  await handleUpdate(config, { update_id: 1, message: { chat: { id: 111 }, photo: [] } }, cb);
  assert.deepEqual(cb.calls.onMessage, []);
});

test('sendMessage posts to the Telegram API with the bot token in the URL', async () => {
  const originalFetch = global.fetch;
  let capturedUrl;
  let capturedBody;
  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ result: { message_id: 42 } }) };
  };
  try {
    const result = await sendMessage(baseConfig(), '111', 'hello');
    assert.match(capturedUrl, /bottest-token\/sendMessage$/);
    assert.equal(capturedBody.chat_id, '111');
    assert.equal(capturedBody.text, 'hello');
    assert.equal(result.message_id, 42);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getUpdates surfaces a clear error when Telegram responds with a failure status', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
  try {
    await assert.rejects(() => getUpdates(baseConfig(), 0), /getUpdates failed: 401/);
  } finally {
    global.fetch = originalFetch;
  }
});
