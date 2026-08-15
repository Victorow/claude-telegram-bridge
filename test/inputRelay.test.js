import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleInboundMessage, relayInboundMessage } from '../src/inputRelay.js';

function fakeChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function baseConfig() {
  return { botToken: 't', owners: { '111': 'caio' }, invites: {}, enabled: true, granularity: 'default' };
}

function registryWithOneSession() {
  return {
    sessions: { abc: { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork', lastActive: 100 } },
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
      abc: { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork', lastActive: 100 },
      def: { sessionId: 'def', cwd: '/p2', label: 'projeto2', owner: 'caio', origin: 'telegram-fork', lastActive: 999 },
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

test(
  'runHeadless invokes a Windows .cmd shim (like the real claude launcher) without ENOENT',
  { skip: process.platform !== 'win32' ? 'Windows-only: reproduces the .cmd shim resolution bug' : false },
  async () => {
    const scriptPath = path.join(os.tmpdir(), `fake-claude-${process.pid}.cmd`);
    fs.writeFileSync(scriptPath, '@echo off\r\nexit /b 0\r\n');
    const registry = {
      sessions: { abc: { sessionId: 'abc', cwd: os.tmpdir(), label: 'projeto1', owner: 'caio', origin: 'telegram-fork', lastActive: 100 } },
      outboundMessages: {},
    };
    const sent = [];
    const send = async (cfg, chatId, text) => sent.push({ chatId, text });

    try {
      const result = await handleInboundMessage(
        baseConfig(),
        registry,
        'caio',
        { text: 'roda os testes', chatId: '111' },
        { send, claudeBin: scriptPath } // no spawnFn override: exercises the real default spawn
      );

      assert.equal(result.handled, 'delegated-to-output-relay');
      assert.equal(sent.length, 0);
    } finally {
      fs.unlinkSync(scriptPath);
    }
  }
);

test('relayInboundMessage reloads the registry at call time instead of using a stale snapshot from before a hook wrote to it', async () => {
  // Simulates the polling loop starting with no sessions yet, then a Stop hook
  // (a separate process) writing a session to disk before the reply arrives.
  const onDisk = { sessions: {}, outboundMessages: {} };
  const loadRegistryFn = () => onDisk;
  let saved = null;
  const saveRegistryFn = (r) => {
    saved = r;
  };

  // Registry mutates on disk "out of band" between bridge startup and the reply.
  onDisk.sessions.abc = { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork', lastActive: 100 };

  let spawnArgs;
  const spawnFn = (bin, args, opts) => {
    spawnArgs = { bin, args, opts };
    const child = fakeChildProcess();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };

  const result = await relayInboundMessage(baseConfig(), 'caio', { text: 'roda os testes', chatId: '111' }, {
    loadRegistryFn,
    saveRegistryFn,
    spawnFn,
  });

  assert.equal(result.handled, 'delegated-to-output-relay');
  assert.equal(spawnArgs.args[1], 'abc');
  assert.ok(saved, 'registry should be saved back after handling');
  assert.ok(saved.sessions.abc, 'saving must not clobber the session the hook wrote');
});

test('the first Telegram reply to an interactive-origin session forks instead of resuming in place', async () => {
  const registry = {
    sessions: { orig: { sessionId: 'orig', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'interactive', lastActive: 100 } },
    outboundMessages: {},
  };
  const sent = [];
  const send = async (cfg, chatId, text) => sent.push({ chatId, text });
  let spawnArgs;
  const spawnFn = (bin, args, opts) => {
    spawnArgs = { bin, args, opts };
    const child = fakeChildProcess();
    setImmediate(() => {
      child.stdout.emit('data', JSON.stringify({ session_id: 'fork1' }));
      child.emit('exit', 0);
    });
    return child;
  };

  const result = await handleInboundMessage(
    baseConfig(),
    registry,
    'caio',
    { text: 'continua', chatId: '111' },
    { spawnFn, send, now: () => 999 }
  );

  assert.equal(result.handled, 'delegated-to-output-relay');
  assert.deepEqual(spawnArgs.args, ['--resume', 'orig', '--fork-session', '-p', 'continua', '--output-format', 'json']);
  assert.equal(registry.sessions.fork1.origin, 'telegram-fork');
  assert.equal(registry.sessions.orig.forkedInto, 'fork1');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /continuação separada/);
});

test('a second Telegram reply to an already-forked session resumes it directly without forking again', async () => {
  const registry = {
    sessions: {
      orig: { sessionId: 'orig', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'interactive', lastActive: 100, forkedInto: 'fork1' },
      fork1: { sessionId: 'fork1', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork', lastActive: 200 },
    },
    outboundMessages: {},
  };
  const sent = [];
  const send = async (cfg, chatId, text) => sent.push({ chatId, text });
  let spawnArgs;
  const spawnFn = (bin, args, opts) => {
    spawnArgs = { bin, args, opts };
    const child = fakeChildProcess();
    setImmediate(() => child.emit('exit', 0));
    return child;
  };

  const result = await handleInboundMessage(baseConfig(), registry, 'caio', { text: 'mais uma', chatId: '111' }, { spawnFn, send });

  assert.equal(result.handled, 'delegated-to-output-relay');
  assert.deepEqual(spawnArgs.args, ['--resume', 'fork1', '-p', 'mais uma']);
  assert.equal(sent.length, 0);
});

test('a fork attempt whose output has no parseable session id fails cleanly and leaves the registry untouched', async () => {
  const registry = {
    sessions: { orig: { sessionId: 'orig', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'interactive', forkedInto: null, lastActive: 100 } },
    outboundMessages: {},
  };
  const sent = [];
  const send = async (cfg, chatId, text) => sent.push({ chatId, text });
  const spawnFn = () => {
    const child = fakeChildProcess();
    setImmediate(() => child.emit('exit', 0)); // exits successfully but never writes usable JSON to stdout
    return child;
  };

  const result = await handleInboundMessage(baseConfig(), registry, 'caio', { text: 'continua', chatId: '111' }, { spawnFn, send });

  assert.equal(result.handled, 'failure');
  assert.equal(Object.keys(registry.sessions).length, 1);
  assert.equal(registry.sessions.orig.forkedInto, null);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Não consegui continuar/);
});
