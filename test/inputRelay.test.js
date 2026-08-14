import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { handleInboundMessage } from '../src/inputRelay.js';

function fakeChildProcess() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function baseConfig() {
  return { botToken: 't', owners: { '111': 'caio' }, invites: {}, enabled: true, granularity: 'default' };
}

function registryWithOneSession() {
  return {
    sessions: { abc: { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio', lastActive: 100 } },
    outboundMessages: {},
  };
}

test('resolves to a known session, invokes claude --resume, and sends nothing on success', async () => {
  const sent = [];
  const send = async (cfg, chatId, text) => sent.push({ chatId, text });
  let spawnArgs;
  const spawnFn = (bin, args, opts) => {
    spawnArgs = { bin, args, opts };
    const child = fakeChildProcess();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };

  const result = await handleInboundMessage(
    baseConfig(),
    registryWithOneSession(),
    'caio',
    { text: 'roda os testes', chatId: '111' },
    { spawnFn, send }
  );

  assert.equal(result.handled, 'delegated-to-output-relay');
  assert.equal(sent.length, 0); // single delivery path: output-relay handles the reply, not input-relay
  assert.equal(spawnArgs.bin, 'claude');
  assert.deepEqual(spawnArgs.args, ['--resume', 'abc', '-p', 'roda os testes']);
  assert.equal(spawnArgs.opts.cwd, '/p1');
});

test('no sessions registered replies clearly instead of attempting a call', async () => {
  const sent = [];
  const send = async (cfg, chatId, text) => sent.push({ chatId, text });
  const spawnFn = () => {
    throw new Error('should not be called');
  };

  const result = await handleInboundMessage(
    baseConfig(),
    { sessions: {}, outboundMessages: {} },
    'caio',
    { text: 'oi', chatId: '111' },
    { spawnFn, send }
  );

  assert.equal(result.handled, 'no-sessions');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Nenhuma sessão ativa/);
});

test('a non-matching prefix replies with known labels instead of guessing', async () => {
  const registry = {
    sessions: {
      abc: { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio', lastActive: 100 },
      def: { sessionId: 'def', cwd: '/p2', label: 'projeto2', owner: 'caio', lastActive: 200 },
    },
    outboundMessages: {},
  };
  const sent = [];
  const send = async (cfg, chatId, text) => sent.push({ chatId, text });

  const result = await handleInboundMessage(baseConfig(), registry, 'caio', { text: 'projeto9: roda', chatId: '111' }, { send });

  assert.equal(result.handled, 'no-match');
  assert.match(sent[0].text, /projeto1/);
  assert.match(sent[0].text, /projeto2/);
});

test('a failed headless call surfaces an error message instead of hanging', async () => {
  const sent = [];
  const send = async (cfg, chatId, text) => sent.push({ chatId, text });
  const spawnFn = () => {
    const child = fakeChildProcess();
    setImmediate(() => {
      child.stderr.emit('data', 'session not found');
      child.emit('exit', 1);
    });
    return child;
  };

  const result = await handleInboundMessage(
    baseConfig(),
    registryWithOneSession(),
    'caio',
    { text: 'roda', chatId: '111' },
    { spawnFn, send }
  );

  assert.equal(result.handled, 'failure');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /session not found/);
});

test('a crash before exit (spawn error, e.g. claude not on PATH) also surfaces an error message', async () => {
  const sent = [];
  const send = async (cfg, chatId, text) => sent.push({ chatId, text });
  const spawnFn = () => {
    const child = fakeChildProcess();
    setImmediate(() => child.emit('error', new Error('ENOENT: claude not found')));
    return child;
  };

  const result = await handleInboundMessage(
    baseConfig(),
    registryWithOneSession(),
    'caio',
    { text: 'roda', chatId: '111' },
    { spawnFn, send }
  );

  assert.equal(result.handled, 'failure');
  assert.match(sent[0].text, /claude not found/);
});

test('a reply to a tracked message resolves directly to that session, ignoring recency', async () => {
  const registry = {
    sessions: {
      abc: { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio', lastActive: 100 },
      def: { sessionId: 'def', cwd: '/p2', label: 'projeto2', owner: 'caio', lastActive: 999 },
    },
    outboundMessages: { '501': { sessionId: 'abc', sentAt: 100 } },
  };
  let spawnArgs;
  const spawnFn = (bin, args, opts) => {
    spawnArgs = { args, opts };
    const child = fakeChildProcess();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };

  await handleInboundMessage(baseConfig(), registry, 'caio', { replyToMessageId: '501', text: 'continua', chatId: '111' }, { spawnFn });

  assert.equal(spawnArgs.args[1], 'abc');
  assert.equal(spawnArgs.opts.cwd, '/p1');
});
