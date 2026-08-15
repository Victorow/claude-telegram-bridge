# Desktop Onboarding (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the desktop app complete first-run setup entirely through its own UI (paste a bot token, be guided to @BotFather, confirm) so the desktop distribution never requires a terminal — per `openspec/changes/add-desktop-onboarding/`.

**Architecture:** `src/wizard.js`'s core "given a token, try to detect the chat and save" logic is extracted into a standalone, testable `attemptOnboarding` function, reused by both the existing terminal wizard (unchanged behavior) and a new `bridge onboard --json` subcommand that reads the token from a single stdin line. The desktop app's Rust side gains a `complete_onboarding` command (spawns the sidecar, writes the token to its stdin, collects stdout until the process exits — a pattern already compiled and run successfully against the real, installed toolchain before this plan was written) and a `configured` check that both `get_status` and the startup/tray "Iniciar" path now consult, so `bridge start` is never invoked while unconfigured (it would otherwise hang forever waiting for a `readline` prompt no attached terminal can answer).

**Tech Stack:** Node.js (ESM) for the bridge-side changes; Rust + Tauri v2 (`tauri-plugin-shell`, already a dependency) for the desktop app; plain HTML/CSS/JS for the new onboarding view (no framework, matching Phase 1).

## Global Constraints

- No behavior change to the terminal wizard (`claude-telegram-bridge start`, unconfigured) — same prompts, same error message text, same return shape.
- The bot token is never passed as a CLI argument (only as a single stdin line), to avoid it appearing in process-listing tools (Task Manager, `ps`) even briefly.
- All new user-facing strings (bridge-side and desktop UI) are in Portuguese, matching the rest of the project.
- Every Rust snippet below was compiled (and, for the stdin-write pattern specifically, run in a headless integration test against a real spawned process) against the real, installed toolchain before being written into this plan.

---

### Task 1: Bridge-side shared onboarding logic + subcommand

**Files:**
- Modify: `src/wizard.js`
- Modify: `test/wizard.test.js`
- Modify: `bin/bridge.js`

**Interfaces:**
- Produces: `attemptOnboarding(token, { getUpdatesFn, saveConfigFn })` returning `{ ok: true, chatId, ownerId }` or `{ ok: false, reason: 'empty-token' | 'no-message-yet' }`; a new `onboard` subcommand printing that same shape as JSON. Task 2's Rust code calls this subcommand by name (`onboard`), not the JS function directly.

- [ ] **Step 1: Read the current wizard test file to confirm existing test names**

Run: `node --test test/wizard.test.js` (before any change) to confirm the baseline is green — you'll compare against this after refactoring.

- [ ] **Step 2: Write the failing tests for the extracted function**

Add to `test/wizard.test.js` (check its existing imports first — it very likely already imports helpers like a fake `getUpdatesFn`/`saveConfigFn` from testing the current wizard; add `attemptOnboarding` to the import list from `'../src/wizard.js'`):

```javascript
test('attemptOnboarding reports empty-token without making any network call', async () => {
  const getUpdatesFn = async () => {
    throw new Error('should not be called');
  };
  const result = await attemptOnboarding('   ', { getUpdatesFn, saveConfigFn: () => {} });
  assert.deepEqual(result, { ok: false, reason: 'empty-token' });
});

test('attemptOnboarding reports no-message-yet without saving anything', async () => {
  const getUpdatesFn = async () => [];
  let saved = false;
  const result = await attemptOnboarding('realtoken', { getUpdatesFn, saveConfigFn: () => { saved = true; } });
  assert.deepEqual(result, { ok: false, reason: 'no-message-yet' });
  assert.equal(saved, false);
});

test('attemptOnboarding detects the chat and saves on success', async () => {
  const getUpdatesFn = async () => [{ message: { chat: { id: 555 } } }];
  let savedConfig = null;
  const result = await attemptOnboarding('realtoken', {
    getUpdatesFn,
    saveConfigFn: (cfg) => {
      savedConfig = cfg;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.chatId, '555');
  assert.equal(result.ownerId, 'operator');
  assert.equal(savedConfig.owners['555'], 'operator');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/wizard.test.js`
Expected: FAIL — `attemptOnboarding is not defined` (or an import error), since the function doesn't exist yet.

- [ ] **Step 4: Extract `attemptOnboarding` and refactor `runFirstRunWizard` to use it**

Replace the full contents of `src/wizard.js`:

```javascript
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { configExists, createDefaultConfig, saveConfig } from './config.js';
import { registerOwner } from './registration.js';
import { getUpdates } from './gateway.js';

async function defaultPrompt(question) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Given a bot token, tries once to detect a chat that has messaged that bot
 * and, on success, registers it as the operator and saves the config. Shared
 * by the terminal wizard (which prompts before calling this) and the desktop
 * app's GUI onboarding (which calls this directly, on demand, with no
 * prompting) - see design.md Decision 1 in add-desktop-onboarding.
 */
export async function attemptOnboarding(token, { getUpdatesFn = getUpdates, saveConfigFn = saveConfig } = {}) {
  const trimmedToken = (token ?? '').trim();
  if (!trimmedToken) {
    return { ok: false, reason: 'empty-token' };
  }
  const config = createDefaultConfig(trimmedToken);

  const updates = await getUpdatesFn(config, 0, 5);
  const withChat = [...updates].reverse().find((u) => u.message?.chat?.id != null);
  if (!withChat) {
    return { ok: false, reason: 'no-message-yet' };
  }

  const chatId = String(withChat.message.chat.id);
  registerOwner(config, chatId, 'operator');
  saveConfigFn(config);
  return { ok: true, chatId, ownerId: 'operator' };
}

/**
 * First-run setup: bot token (interaction 1), then a short confirmation once
 * the operator has messaged their own bot (interaction 2) - from which the
 * operator's chat id is auto-detected, so they never need to know or paste
 * their own numeric Telegram id. Skips entirely if config already exists.
 */
export async function runFirstRunWizard({
  prompt = defaultPrompt,
  configExistsFn = configExists,
  saveConfigFn = saveConfig,
  getUpdatesFn = getUpdates,
} = {}) {
  if (configExistsFn()) {
    return { ranWizard: false };
  }

  const token = await prompt('Cole aqui o token do bot (fale com @BotFather no Telegram, envie /newbot): ');
  await prompt('Agora mande qualquer mensagem para o seu bot no Telegram e pressione Enter aqui...');

  const result = await attemptOnboarding(token, { getUpdatesFn, saveConfigFn });
  if (!result.ok) {
    if (result.reason === 'empty-token') {
      throw new Error('Token do bot não pode ser vazio.');
    }
    throw new Error('Não recebi nenhuma mensagem do bot ainda. Mande uma mensagem para ele e rode a instalação de novo.');
  }
  return { ranWizard: true, chatId: result.chatId, ownerId: result.ownerId };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/wizard.test.js`
Expected: PASS — all pre-existing tests (unchanged behavior/messages) plus the 3 new ones.

- [ ] **Step 6: Add the `onboard` subcommand to `bin/bridge.js`**

Add the import alongside the existing `runFirstRunWizard` import:

```javascript
import { runFirstRunWizard, attemptOnboarding } from '../src/wizard.js';
```

Add a helper for reading a single stdin line (near the existing `readStdin` function):

```javascript
async function readStdinLine() {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}
```

This needs `readline` and `readline/promises` are different modules - use the plain callback-style one here since we're consuming it as an async iterator, not calling `.question()`. Add the import at the top of `bin/bridge.js`:

```javascript
import readline from 'node:readline';
```

Add the new command function near `cmdStatus`:

```javascript
async function cmdOnboard() {
  const token = await readStdinLine();
  try {
    const result = await attemptOnboarding(token);
    console.log(JSON.stringify(result));
  } catch (err) {
    // attemptOnboarding's own failure modes (empty token, no message yet) are
    // returned, not thrown - this only catches things like a malformed token
    // rejected outright by Telegram's API. Always print valid JSON so the
    // desktop app's Rust side never has to parse a bare stack trace.
    console.log(JSON.stringify({ ok: false, reason: 'error', message: err.message }));
  }
}
```

Register it in `main()`'s switch, next to `case 'status':`:

```javascript
    case 'onboard':
      return cmdOnboard();
```

Update the usage line:

```javascript
      console.log('Uso: claude-telegram-bridge <start|install|uninstall|invite|status|onboard>');
```

- [ ] **Step 7: Manually verify the subcommand**

Run: `echo faketoken123 | node bin/bridge.js onboard`
Expected: since `faketoken123` isn't a validly-formatted token, Telegram's API rejects it outright (confirmed: a 404) - the `catch` block above turns that into `{"ok":false,"reason":"error","message":"..."}`, valid JSON either way. Confirm it returns immediately rather than hanging.

- [ ] **Step 8: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS — every existing test plus the 3 new ones in `wizard.test.js`.

- [ ] **Step 9: Commit**

```bash
git add src/wizard.js test/wizard.test.js bin/bridge.js
git commit -m "feat: extract attemptOnboarding and add an onboard --json subcommand for the desktop app"
```

---

### Task 2: Desktop app — onboarding view, guarded start, and a simplified get_status

**Files:**
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src/index.html`
- Modify: `desktop/src/main.js`

**Interfaces:**
- Consumes: the `onboard` subcommand from Task 1 (`bridge onboard --json`, token via stdin line).
- Produces: a `complete_onboarding(token)` Tauri command; a redesigned `get_status` that always reports `configured` (previously it only did when a sidecar happened to be running - see Step 2 below); a `spawn_sidecar` that refuses to run while unconfigured.

- [ ] **Step 1: Add the shared stdin-write helper**

In `desktop/src-tauri/src/lib.rs`, add this helper function (this exact pattern — spawn, write a line, collect `CommandEvent::Stdout` until `Terminated` — was compiled *and run* in a headless integration test against a real spawned process before being written here):

```rust
async fn run_sidecar_with_stdin_line(app: &AppHandle, args: &[&str], stdin_line: &str) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(args);
    let (mut rx, mut child) = sidecar.spawn().map_err(|e| e.to_string())?;

    child
        .write(format!("{stdin_line}\n").as_bytes())
        .map_err(|e| e.to_string())?;

    let mut stdout = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => stdout.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    Ok(stdout.trim().to_string())
}
```

- [ ] **Step 2: Add a `complete_onboarding` command**

Add near the other `#[tauri::command]` functions:

```rust
#[tauri::command]
async fn complete_onboarding(app: AppHandle, token: String) -> Result<String, String> {
    run_sidecar_with_stdin_line(&app, &["onboard", "--json"], &token).await
}
```

- [ ] **Step 3: Redesign `get_status` to always report `configured`, separately from `running`**

Phase 1's `get_status` only consulted the bridge's `status --json` when the `start` sidecar happened to be alive (a short-circuit that was needed then to fix the "buttons look like they do nothing" bug). Phase 2 needs `configured` regardless of whether `start` has ever run — so replace the whole function with this simpler version (no more early return):

```rust
#[tauri::command]
async fn get_status(app: AppHandle) -> Result<String, String> {
    let running = {
        let state = app.state::<SidecarState>();
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };

    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(["status", "--json"]);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    let raw = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert("running".to_string(), serde_json::Value::Bool(running));
    }
    Ok(value.to_string())
}
```

This works regardless of `running`, because `status --json` is always a fresh, independent one-shot read of the config/registry files on disk (see Task 1 of `add-desktop-shell`) - it never depended on the `start` sidecar being alive in the first place.

- [ ] **Step 4: Guard `spawn_sidecar` against running while unconfigured**

Replace `spawn_sidecar`'s signature and body to check configuration first. It becomes `async`:

```rust
async fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(["status", "--json"]);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    let raw = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let configured = value.get("configured").and_then(|v| v.as_bool()).unwrap_or(false);
    if !configured {
        return Ok(()); // nothing to do yet - the onboarding view is what's shown while unconfigured
    }

    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(["start"]);
    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    *guard = Some(child);
    drop(guard);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Terminated(_) = event {
                let state = app_handle.state::<SidecarState>();
                if let Ok(mut guard) = state.0.lock() {
                    *guard = None;
                }
                break;
            }
        }
    });

    Ok(())
}
```

- [ ] **Step 5: Update `spawn_sidecar`'s callers for the new `async fn` signature**

`start_bridge` command - replace:

```rust
#[tauri::command]
fn start_bridge(app: AppHandle) -> Result<(), String> {
    spawn_sidecar(&app)
}
```

with:

```rust
#[tauri::command]
async fn start_bridge(app: AppHandle) -> Result<(), String> {
    spawn_sidecar(&app).await
}
```

The `.setup()` closure's startup call - replace:

```rust
            let handle = app.handle().clone();
            if let Err(e) = spawn_sidecar(&handle) {
                eprintln!("failed to spawn bridge sidecar on startup: {e}");
            }
```

with:

```rust
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = spawn_sidecar(&handle).await {
                    eprintln!("failed to spawn bridge sidecar on startup: {e}");
                }
            });
```

The tray "start" menu handler - replace:

```rust
                    "start" => {
                        let _ = spawn_sidecar(app);
                    }
```

with:

```rust
                    "start" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = spawn_sidecar(&app_handle).await;
                        });
                    }
```

Register `complete_onboarding` in the `invoke_handler!` list:

```rust
        .invoke_handler(tauri::generate_handler![start_bridge, stop_bridge, get_status, complete_onboarding])
```

- [ ] **Step 6: Verify it compiles**

```bash
cd desktop/src-tauri
cargo build
cd ../..
```

Expected: `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in ...` with no errors.

- [ ] **Step 7: Build the onboarding view**

Replace `desktop/src/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Claude Telegram Bridge</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="onboarding" hidden>
      <h1>Configurar o bridge</h1>
      <p>1. Fale com o @BotFather no Telegram e crie um bot (envie <code>/newbot</code>).</p>
      <button id="open-botfather">Abrir @BotFather</button>
      <p>2. Cole aqui o token que ele te deu:</p>
      <input id="token-input" type="text" placeholder="123456789:AAExampleTokenTextGoesHere" />
      <p>3. Mande qualquer mensagem para o seu bot no Telegram, depois clique:</p>
      <button id="verify">Verificar</button>
      <p id="onboarding-error"></p>
    </div>

    <div id="status-view" hidden>
      <h1>Claude Telegram Bridge</h1>
      <p id="status">Carregando...</p>
      <button id="start">Iniciar</button>
      <button id="stop">Parar</button>
    </div>

    <script type="module" src="main.js"></script>
  </body>
</html>
```

- [ ] **Step 8: Update the frontend logic**

Replace `desktop/src/main.js`:

```javascript
const { invoke } = window.__TAURI__.core;

const onboardingEl = document.getElementById('onboarding');
const statusViewEl = document.getElementById('status-view');
const statusEl = document.getElementById('status');
const tokenInput = document.getElementById('token-input');
const onboardingErrorEl = document.getElementById('onboarding-error');

function renderStatus(status) {
  const ligado = status.enabled ? 'Ligado' : 'Desligado';
  const chat = status.connectedChatId ?? 'nenhum';
  const rodando = status.running ? 'Rodando' : 'Parado';
  statusEl.textContent = `${rodando} — ${ligado} — chat ${chat} — ${status.sessionCount} sessão(ões)`;
}

function showOnboarding() {
  onboardingEl.hidden = false;
  statusViewEl.hidden = true;
}

function showStatusView() {
  onboardingEl.hidden = true;
  statusViewEl.hidden = false;
}

async function refresh() {
  try {
    const raw = await invoke('get_status');
    const status = JSON.parse(raw);
    if (!status.configured) {
      showOnboarding();
      return;
    }
    showStatusView();
    renderStatus(status);
  } catch (err) {
    statusEl.textContent = `Erro ao consultar status: ${err}`;
  }
}

document.getElementById('open-botfather').addEventListener('click', () => {
  invoke('plugin:opener|open_url', { url: 'https://t.me/BotFather', with: null });
});

document.getElementById('verify').addEventListener('click', async () => {
  onboardingErrorEl.textContent = '';
  const result = await invoke('complete_onboarding', { token: tokenInput.value });
  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    if (parsed.reason === 'empty-token') {
      onboardingErrorEl.textContent = 'Cole o token antes de verificar.';
    } else if (parsed.reason === 'no-message-yet') {
      onboardingErrorEl.textContent = 'Não recebi nenhuma mensagem ainda. Manda uma mensagem pro bot no Telegram e tenta de novo.';
    } else {
      onboardingErrorEl.textContent = `Não consegui verificar: ${parsed.message ?? 'token inválido?'}`;
    }
    return;
  }
  await invoke('start_bridge');
  await refresh();
});

document.getElementById('start').addEventListener('click', () => invoke('start_bridge'));
document.getElementById('stop').addEventListener('click', () => invoke('stop_bridge'));

refresh();
setInterval(refresh, 3000);
```

- [ ] **Step 9: Commit**

```bash
git add desktop/src-tauri/src/lib.rs desktop/src/index.html desktop/src/main.js
git commit -m "feat: add GUI-driven onboarding, guard start against running while unconfigured"
```

---

### Task 3: Manual end-to-end verification

**Files:** none - GUI behavior, config-file state, and OS process behavior can't be driven by `node:test` or `cargo test` (the latter was attempted for this exact stdin-write pattern during planning and hit a Windows DLL-loading issue specific to running Tauri-linked test binaries outside the normal dev/build process - unrelated to code correctness, confirmed by the code compiling cleanly).

**Interfaces:**
- Consumes: the fully wired app from Tasks 1-2.

- [ ] **Step 1: Set aside the existing config temporarily**

```powershell
Rename-Item "$env:USERPROFILE\.claude-telegram-bridge" "$env:USERPROFILE\.claude-telegram-bridge.bak"
```

- [ ] **Step 2: Launch the app and confirm onboarding appears**

```powershell
cd desktop
npm run tauri dev
```

Expected: the onboarding view appears (not the status view), and Task Manager shows no `bridge-*.exe` process running.

- [ ] **Step 3: Confirm the BotFather button**

Click "Abrir @BotFather" - confirm `https://t.me/BotFather` opens in Telegram (or your browser), not inside the app's own window.

- [ ] **Step 4: Confirm the "no message yet" path**

Paste a real bot token (from a real or test bot), click "Verificar" before sending it any message. Expected: "Não recebi nenhuma mensagem ainda..." error, token still in the field.

- [ ] **Step 5: Confirm successful onboarding**

Send a message to that bot on Telegram, click "Verificar" again. Expected: the view switches to the status display, showing the newly-connected chat, and a `bridge-*.exe` process now appears in Task Manager.

- [ ] **Step 6: Restore the original config**

```powershell
cd ..
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude-telegram-bridge"
Rename-Item "$env:USERPROFILE\.claude-telegram-bridge.bak" "$env:USERPROFILE\.claude-telegram-bridge"
```

Relaunch the app (`cd desktop; npm run tauri dev`) and confirm it goes straight to the status view again, showing your real, original configuration.
