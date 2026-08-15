# Session Fork Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram-driven session continuation safe when the originating session might still be open interactively, by forking instead of resuming in place, per `openspec/changes/add-session-fork-safety/`.

**Architecture:** `input-relay` forks (`--fork-session --output-format json`) the first time a Telegram reply targets a session whose `origin` is `interactive`, captures the new session id from the JSON result, and registers it as that session's `telegram-fork`. `session-registry` tracks `origin` and a `forkedInto` pointer per session, and redirects target resolution through that pointer. `output-relay` appends an origin suffix to a session's label only when an interactive-origin session and its fork are simultaneously registered under the same label.

**Tech Stack:** Node.js (ESM), `node:test` + `node:assert/strict`, `cross-spawn`, `claude` CLI (`--resume`, `--fork-session`, `--output-format json`).

## Global Constraints

- Node >= 20.19.0 (per `package.json` `engines`) — no syntax beyond what that version supports.
- No new runtime dependencies — this feature only uses the already-added `cross-spawn` package and flags already present on the `claude` CLI (`--fork-session`, `--output-format json`, confirmed via `claude --help` and a live test run).
- All user-facing bridge messages are in Portuguese, matching every existing string in `src/inputRelay.js` and `src/outputRelay.js`.
- `input-relay` must never itself deliver the assistant's reply text on a successful turn — that still flows exclusively through `output-relay`'s `Stop` hook path (base design Decision 15). The only message `input-relay` is allowed to send directly is the one-time fork announcement (and its existing failure messages).
- Every file the repo already has (`.gitignore`, `~/.claude-telegram-bridge/*`) already excludes local secrets/config — this feature must not introduce any new file that could hold a secret.

---

### Task 1: Session registry — origin & fork tracking

**Files:**
- Modify: `src/registry.js`
- Test: `test/registry.test.js`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `upsertSession(registry, { sessionId, cwd, label, owner, origin }, now)` now accepts an optional `origin` (`'interactive' | 'telegram-fork'`, defaults to `'interactive'` for a brand-new entry, preserved across updates otherwise); `markForked(registry, originalSessionId, forkedSessionId)`; `resolveTarget(...)` now follows a resolved session's `forkedInto` pointer before returning it. Tasks 2 and 3 both call `markForked` / read `session.origin` / `session.forkedInto`.

- [ ] **Step 1: Write the failing tests**

Add to `test/registry.test.js`, after the existing `upsertSession updates lastActive...` test (the last test in the file):

```javascript
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
```

Update the import line at the top of `test/registry.test.js` to also pull in `markForked`:

```javascript
import {
  upsertSession,
  recordOutboundMessage,
  resolveTarget,
  sessionsForOwner,
  markForked,
} from '../src/registry.js';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/registry.test.js`
Expected: FAIL — `markForked is not a function` (import error), and/or the origin/fork-redirect assertions fail once the import error is resolved locally in your head (the import failure will stop the whole file, so you'll see a single syntax/reference failure first — that's the correct RED state).

- [ ] **Step 3: Implement the minimal code**

In `src/registry.js`, replace the `upsertSession` function:

```javascript
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
```

Add a new `markForked` function right after `sessionsForOwner`:

```javascript
export function markForked(registry, originalSessionId, forkedSessionId) {
  const original = registry.sessions[originalSessionId];
  if (original) {
    original.forkedInto = forkedSessionId;
  }
  return registry;
}
```

Add a `followFork` helper just above `resolveTarget`, and use it at all three of `resolveTarget`'s return-a-session sites:

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/registry.test.js`
Expected: PASS — all tests, including the 7 new ones.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS — every existing test in every file, since nothing outside `registry.js` calls `upsertSession`/`resolveTarget` with assertions about `origin`/`forkedInto` yet.

- [ ] **Step 6: Commit**

```bash
git add src/registry.js test/registry.test.js
git commit -m "feat: track session origin and fork-chain redirection in session-registry"
```

---

### Task 2: Input relay — fork-vs-resume decision

**Files:**
- Modify: `src/inputRelay.js`
- Test: `test/inputRelay.test.js`

**Interfaces:**
- Consumes: `upsertSession(registry, { sessionId, cwd, label, owner, origin }, now)` and `markForked(registry, originalSessionId, forkedSessionId)` from Task 1.
- Produces: `handleInboundMessage` now forks instead of resuming in place whenever the resolved session's `origin !== 'telegram-fork'`; on a successful fork, the new session is registered with `origin: 'telegram-fork'` and the original's `forkedInto` is set. Task 3 depends on sessions actually carrying the `origin` this task assigns.

This task also updates several **existing** tests: they use hand-built registries with no `origin` field, which after Task 1 defaults to `'interactive'` — meaning, under this task's new behavior, they'd unexpectedly trigger a fork instead of exercising what they were written to test (reply resolution, cwd threading, failure handling). Marking those fixture sessions `origin: 'telegram-fork'` keeps them testing exactly what they did before, while new tests below cover the fork path itself.

- [ ] **Step 1: Write the failing tests**

First, update the shared fixtures and helper at the top of `test/inputRelay.test.js`:

```javascript
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
```

(The only changes here: `fakeChildProcess` now always sets up `child.stdout`, and `registryWithOneSession` now marks its session `origin: 'telegram-fork'` — representing "a session already established as a safe, direct-resume Telegram continuation," which is what every test using this fixture actually exercises.)

Next, in the existing test `'a reply to a tracked message resolves directly to that session, ignoring recency'`, add `origin: 'telegram-fork'` to session `abc` (the one the reply targets):

```javascript
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
```

In the regression test added for the Windows `.cmd` shim fix (`'runHeadless invokes a Windows .cmd shim...'`), mark its session `origin: 'telegram-fork'` too:

```javascript
    const registry = {
      sessions: { abc: { sessionId: 'abc', cwd: os.tmpdir(), label: 'projeto1', owner: 'caio', origin: 'telegram-fork', lastActive: 100 } },
      outboundMessages: {},
    };
```

In the `relayInboundMessage` regression test, mark the session it plants in `onDisk.sessions` the same way:

```javascript
  onDisk.sessions.abc = { sessionId: 'abc', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'telegram-fork', lastActive: 100 };
```

Now add the new fork-specific tests at the end of the file:

```javascript
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
    sessions: { orig: { sessionId: 'orig', cwd: '/p1', label: 'projeto1', owner: 'caio', origin: 'interactive', lastActive: 100 } },
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/inputRelay.test.js`
Expected: FAIL — the three new fork-specific tests fail (`spawnArgs.args` won't match the fork-form array; `registry.sessions.fork1` won't exist), since `handleInboundMessage` doesn't fork yet.

- [ ] **Step 3: Implement the minimal code**

Replace the top of `src/inputRelay.js` (imports and `runHeadless`) with:

```javascript
import crossSpawn from 'cross-spawn';
import { resolveTarget, loadRegistry, saveRegistry, upsertSession, markForked } from './registry.js';
import { sendMessage } from './gateway.js';

function runHeadless({ spawnFn, claudeBin, sessionId, cwd, prompt, fork }) {
  return new Promise((resolve, reject) => {
    const args = fork
      ? ['--resume', sessionId, '--fork-session', '-p', prompt, '--output-format', 'json']
      : ['--resume', sessionId, '-p', prompt];
    let child;
    try {
      child = spawnFn(claudeBin, args, { cwd });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject); // e.g. the claude binary isn't on PATH
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(stderr.trim() || `claude exited with code ${code}`));
    });
  });
}

/** Reads the new session id `--fork-session --output-format json` reports directly in its result, rather than guessing from a later hook event (see design.md Decision 3). Returns null on anything unparseable, which the caller treats as a failed fork. */
function parseForkedSessionId(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return typeof parsed.session_id === 'string' ? parsed.session_id : null;
  } catch {
    return null;
  }
}
```

Replace `handleInboundMessage`'s body:

```javascript
export async function handleInboundMessage(
  config,
  registry,
  ownerId,
  { replyToMessageId, text, chatId },
  { spawnFn = crossSpawn, send = sendMessage, claudeBin = 'claude', now = () => Date.now() } = {}
) {
  const resolution = resolveTarget(registry, ownerId, { replyToMessageId, text });

  if (resolution.noSessions) {
    await send(config, chatId, 'Nenhuma sessão ativa encontrada para você ainda.');
    return { handled: 'no-sessions' };
  }
  if (resolution.noMatch) {
    await send(config, chatId, `Não encontrei esse projeto. Sessões conhecidas: ${resolution.knownLabels.join(', ')}`);
    return { handled: 'no-match' };
  }

  const { session, text: prompt } = resolution;
  const shouldFork = session.origin !== 'telegram-fork';

  try {
    const result = await runHeadless({
      spawnFn,
      claudeBin,
      sessionId: session.sessionId,
      cwd: session.cwd,
      prompt,
      fork: shouldFork,
    });

    if (shouldFork) {
      const forkedSessionId = parseForkedSessionId(result.stdout);
      if (!forkedSessionId) {
        throw new Error('não consegui identificar a sessão criada pelo fork');
      }
      upsertSession(
        registry,
        { sessionId: forkedSessionId, cwd: session.cwd, label: session.label, owner: ownerId, origin: 'telegram-fork' },
        now()
      );
      markForked(registry, session.sessionId, forkedSessionId);
      await send(
        config,
        chatId,
        'Criei uma continuação separada dessa sessão (ela pode ainda estar aberta em outro lugar, como o IDE) — as próximas respostas por aqui vão continuar essa continuação separada.'
      );
    }

    return { handled: 'delegated-to-output-relay' };
  } catch (err) {
    await send(config, chatId, `Não consegui continuar essa sessão: ${err.message}`);
    return { handled: 'failure', error: err.message };
  }
}
```

`relayInboundMessage` at the bottom of the file needs no changes — it already passes `registry`, `ownerId`, and `messageInfo` through untouched, and forwards any extra options (including the now-relevant `now`) via its `...rest` spread.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/inputRelay.test.js`
Expected: PASS — all tests, including the 3 new ones.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/inputRelay.js test/inputRelay.test.js
git commit -m "feat: fork instead of resuming in place on the first Telegram reply to an interactive session"
```

---

### Task 3: Output relay — origin-aware labeling

**Files:**
- Modify: `src/outputRelay.js`
- Test: `test/outputRelay.test.js`

**Interfaces:**
- Consumes: `session.origin` as set by Task 1/2 (`'interactive'` or `'telegram-fork'`), and `sessionsForOwner(registry, ownerId)` (already imported in this file).
- Produces: outbound message labels append `· IDE` / `· Telegram` when an interactive-origin session and its fork share a label for the same owner; unchanged otherwise. Nothing later in this plan depends on this task.

- [ ] **Step 1: Write the failing tests**

Add to `test/outputRelay.test.js`, after the existing `'Stop event includes the label when the owner has more than one session'` test:

```javascript
test('origin suffix is added when an interactive session and its telegram-fork share a label', async () => {
  const registry = {
    sessions: {
      fork1: { sessionId: 'fork1', owner: 'caio', label: 'projeto1', origin: 'telegram-fork', lastActive: 1 },
    },
    outboundMessages: {},
  };
  const h = harness({ registry });
  await h.call({ hook_event_name: 'Stop', session_id: 'abc', cwd: '/p1', last_assistant_message: 'build ok' });
  assert.equal(h.sent[0].text, '[projeto1 · IDE] build ok');
});

test('origin suffix reflects the telegram-fork session when it is the one relaying', async () => {
  const registry = {
    sessions: {
      abc: { sessionId: 'abc', owner: 'caio', label: 'projeto1', origin: 'interactive', lastActive: 1 },
      fork1: { sessionId: 'fork1', owner: 'caio', label: 'projeto1', origin: 'telegram-fork', lastActive: 1 },
    },
    outboundMessages: {},
  };
  const sent = [];
  await handleHookEvent(
    { hook_event_name: 'Stop', session_id: 'fork1', cwd: '/p1', last_assistant_message: 'resposta pelo telegram' },
    {
      owner: 'caio',
      label: 'projeto1',
      config: baseConfig(),
      registry,
      send: async (cfg, chatId, text) => {
        sent.push({ chatId, text });
        return { message_id: 1 };
      },
      persistRegistry: () => {},
      now: () => 1,
    }
  );
  assert.equal(sent[0].text, '[projeto1 · Telegram] resposta pelo telegram');
});

test('no origin suffix is added when only one origin is registered under a label', async () => {
  const h = harness();
  await h.call({ hook_event_name: 'Stop', session_id: 'abc', cwd: '/p1', last_assistant_message: 'build ok' });
  assert.equal(h.sent[0].text, 'build ok'); // single session: no bracketed label at all, matching today's behavior
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/outputRelay.test.js`
Expected: FAIL — the first two new tests fail because the label has no `· IDE` / `· Telegram` suffix yet; the third already passes today (included to lock in the no-regression case going forward).

- [ ] **Step 3: Implement the minimal code**

In `src/outputRelay.js`, add a suffix map and a helper function right after the `VERBOSE_NOTIFICATION_TYPES` constant:

```javascript
const ORIGIN_LABEL_SUFFIX = { interactive: 'IDE', 'telegram-fork': 'Telegram' };

/** Only disambiguates when a same-labeled sibling of a *different* origin exists for this owner — before any fork exists, this returns `label` unchanged. */
function labelWithOriginSuffix(session, label, registry, owner) {
  const sessionOrigin = session.origin || 'interactive';
  const hasDifferentOriginSibling = sessionsForOwner(registry, owner).some(
    (s) => s.sessionId !== session.sessionId && s.label === label && (s.origin || 'interactive') !== sessionOrigin
  );
  if (!hasDifferentOriginSibling) return label;
  return `${label} · ${ORIGIN_LABEL_SUFFIX[sessionOrigin]}`;
}
```

In `handleHookEvent`, replace:

```javascript
  const hasMultipleSessions = sessionsForOwner(registry, owner).length > 1;
  const text = formatMessage(payload, { label: resolvedLabel, hasMultipleSessions });
```

with:

```javascript
  const hasMultipleSessions = sessionsForOwner(registry, owner).length > 1;
  const displayLabel = labelWithOriginSuffix(registry.sessions[payload.session_id], resolvedLabel, registry, owner);
  const text = formatMessage(payload, { label: displayLabel, hasMultipleSessions });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/outputRelay.test.js`
Expected: PASS — all tests, including the 3 new ones.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/outputRelay.js test/outputRelay.test.js
git commit -m "feat: disambiguate notification labels by origin when a session and its fork share a label"
```

---

### Task 4: End-to-end manual verification

**Files:** none (manual verification only — no automated test can drive a real Telegram round-trip or a real `claude` CLI process end-to-end without live credentials).

**Interfaces:**
- Consumes: the fully wired bridge from Tasks 1–3, running via `npm start` against a real, already-configured bot (per the existing `~/.claude-telegram-bridge/config.json`).

- [ ] **Step 1: Restart the bridge**

In the terminal running the bridge, press `Ctrl+C`, then run:

```bash
npm start
```

Expected: since config already exists, the wizard is skipped and it goes straight to `Bridge rodando (Ctrl+C para parar)...`.

- [ ] **Step 2: Trigger a Stop event from an interactive session**

In a separate Claude Code session (IDE or terminal) on any project, let it finish a turn. Confirm a Telegram notification arrives with no origin suffix (only one session registered so far).

- [ ] **Step 3: Reply via Telegram and confirm the fork**

Reply to that notification with any text. Confirm **two** messages arrive: the actual continuation's reply (via the `Stop` hook of the forked headless call), and — right after — the fork announcement ("Criei uma continuação separada...").

- [ ] **Step 4: Confirm the original session is untouched**

Go back to the original interactive session (the one from Step 2) and send it another message directly. Confirm it responds normally, with no sign of the Telegram exchange in its own context — its transcript was never touched by the fork.

- [ ] **Step 5: Reply again via Telegram and confirm no second fork**

Reply to the bridge's latest Telegram message again. Confirm only **one** message arrives this time (the reply) — no second fork announcement, since this conversation is already on its fork.

- [ ] **Step 6: Confirm the fork is reachable from the PC**

Run `claude --resume` (or use the IDE's `/resume` session picker) in the same project directory, and confirm the forked session appears in the list, with its history including everything exchanged via Telegram.

- [ ] **Step 7: Confirm labels are disambiguated**

With both the original interactive session (Step 4) and its fork (Step 3) now both active for the same project, trigger one more Stop event on each (a message in the IDE, a reply on Telegram) and confirm the Telegram notifications now show `[projeto · IDE]` and `[projeto · Telegram]` respectively, instead of a shared, ambiguous label.
