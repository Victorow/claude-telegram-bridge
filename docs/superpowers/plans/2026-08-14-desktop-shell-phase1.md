# Desktop Shell (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the walking skeleton of a lightweight, cross-platform desktop app (Tauri) that supervises the existing bridge binary as a sidecar process, with a tray icon and a status view — per `openspec/changes/add-desktop-shell/`.

**Architecture:** A Tauri (Rust shell + plain HTML/CSS/JS webview) app under `desktop/` bundles the existing `npm run build:sea` binary as an external "sidecar" process. The Rust side spawns/kills that sidecar and exposes three commands to the webview (`start_bridge`, `stop_bridge`, `get_status`); the only new bridge-side (Node) code is a `status --json` subcommand the sidecar answers with, reusing already-tested config/registry loading. Every piece of Rust code in this plan has already been written and compiled successfully against the real, currently-installed toolchain (Rust 1.97.1, Tauri 2.11.5, tauri-plugin-shell 2.3.5, tauri-plugin-autostart 2.5.1) before this plan was written — this is not speculative Rust.

**Tech Stack:** Node.js (ESM) for the bridge-side addition; Rust + Tauri v2 + `tauri-plugin-shell` + `tauri-plugin-autostart` for the desktop app; plain HTML/CSS/JS for the webview frontend (no framework).

## Global Constraints

- Node >= 20.19.0 (per `package.json` `engines`), matching the rest of the project.
- No changes to `src/gateway.js`, `src/inputRelay.js`, `src/outputRelay.js`, `src/registry.js`, `src/wizard.js`, or `src/service.js` in this plan.
- All new user-facing strings (bridge-side) are in Portuguese, matching the rest of the codebase. The desktop UI's own labels (Iniciar/Parar/Abrir/Sair) follow the same convention.
- Building the desktop app requires the Rust toolchain (`rustup`) and, on Windows, the MSVC C++ Build Tools (`Microsoft.VisualStudio.2022.BuildTools` with the `Microsoft.VisualStudio.Workload.VCTools` workload) — both already installed and verified on this machine as of this plan.
- The desktop app is a **separate, alternative** distribution to the CLI + scheduled-task install — nothing in this plan changes how the existing CLI distribution behaves.

> **Post-execution correction:** Task 2 Step 7's `cargo build` does **not** actually succeed on its own — Tauri's `build.rs` validates that `externalBin`'s target file exists on disk at `cargo build` time, not just at bundling time, so it fails with `resource path 'binaries\bridge-<triple>.exe' doesn't exist` until Task 3's `prepare-sidecar.mjs` has been run at least once. In practice, do Task 3 Steps 1-3 (write and run the script) before attempting Task 2 Step 7's build verification. Both tasks were still committed separately, split by file — this only affects the order verification actually happens in, not what ends up in which commit.

---

### Task 1: Bridge-side status snapshot

**Files:**
- Create: `src/status.js`
- Create: `test/status.test.js`
- Modify: `bin/bridge.js`

**Interfaces:**
- Consumes: `chatIdForOwner` (from `src/config.js`, already exists) — no new dependency.
- Produces: `getStatusSnapshot(config, registry)` returning a plain object; Task 2/3's Rust code calls this indirectly via the CLI's `status --json` subcommand (spawned as the sidecar), not directly.

- [ ] **Step 1: Write the failing tests**

Create `test/status.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/status.test.js`
Expected: FAIL — `Cannot find module '../src/status.js'` (the file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/status.js`:

```javascript
import { chatIdForOwner } from './config.js';

/**
 * A point-in-time snapshot of the bridge's configuration and activity,
 * with no dependency on a running polling loop - used by `status --json`
 * (see bin/bridge.js) so the desktop app's sidecar can answer it as a
 * quick one-shot call, whether or not the long-running `start` process
 * happens to be alive at the same moment.
 */
export function getStatusSnapshot(config, registry) {
  if (!config) {
    return { configured: false };
  }
  const sessions = Object.values(registry?.sessions ?? {});
  return {
    configured: true,
    enabled: config.enabled,
    connectedOwner: 'operator',
    connectedChatId: chatIdForOwner(config, 'operator') ?? null,
    sessionCount: sessions.length,
    lastActivity: sessions.length ? Math.max(...sessions.map((s) => s.lastActive)) : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/status.test.js`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Wire the `status` subcommand into `bin/bridge.js`**

In `bin/bridge.js`, add the import alongside the existing ones (near the top, with the other `src/*.js` imports):

```javascript
import { getStatusSnapshot } from '../src/status.js';
```

Add a new function near `cmdInvite` (same style — thin wrapper around already-tested `src/` logic):

```javascript
function cmdStatus() {
  const config = loadConfig();
  const registry = loadRegistry();
  console.log(JSON.stringify(getStatusSnapshot(config, registry)));
}
```

`loadRegistry` needs to be imported too — add it to the existing `config.js`/registry-related imports at the top of the file:

```javascript
import { loadRegistry } from '../src/registry.js';
```

In `main()`'s switch statement, add a new case right before `default:` (around line 167):

```javascript
    case 'status':
      return cmdStatus();
    default:
```

Update the usage line (around line 168) to mention it:

```javascript
      console.log('Uso: claude-telegram-bridge <start|install|uninstall|invite|status>');
```

- [ ] **Step 6: Manually verify the subcommand end-to-end**

Run: `node bin/bridge.js status`
Expected: a single line of JSON — either `{"configured":false}` (if `~/.claude-telegram-bridge/config.json` doesn't exist on this machine) or a populated object matching the real config/registry state. Confirm the output is valid JSON (e.g. pipe it through `node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))"` or just eyeball it).

- [ ] **Step 7: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS — every existing test, plus the 5 new ones in `status.test.js`.

- [ ] **Step 8: Commit**

```bash
git add src/status.js test/status.test.js bin/bridge.js
git commit -m "feat: add a status --json subcommand for the upcoming desktop app to poll"
```

---

### Task 2: Desktop app scaffold (Tauri shell + tray + sidecar wiring)

**Files:**
- Create: `desktop/` (scaffolded by `create-tauri-app`, then modified — see steps)
- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/tauri.conf.json`
- Replace: `desktop/src-tauri/src/lib.rs`
- Replace: `desktop/src/index.html`, `desktop/src/main.js`

**Interfaces:**
- Consumes: nothing from Task 1 directly at the Rust-compile level — it calls the bridge sidecar as an external process (`status --json`, `start`), not as a library.
- Produces: a Tauri app that compiles and links (`cargo build` succeeds) with three invokable commands (`start_bridge`, `stop_bridge`, `get_status`) and a tray icon. Task 3 depends on this existing so it has something to bundle a real sidecar binary into.

- [ ] **Step 1: Scaffold the project**

From the repo root:

```bash
npm create tauri-app@latest desktop -- --yes --template vanilla --manager npm
```

Expected: a new `desktop/` directory appears with `src-tauri/` (Rust) and `src/` (webview) subfolders.

- [ ] **Step 2: Add the shell and autostart plugins**

```bash
cd desktop/src-tauri
cargo add tauri-plugin-shell tauri-plugin-autostart
cd ../..
```

Expected output includes lines like `Adding tauri-plugin-shell v2.3.5 to dependencies` and `Adding tauri-plugin-autostart v2.5.1 to dependencies`.

- [ ] **Step 3: Enable the tray-icon feature**

In `desktop/src-tauri/Cargo.toml`, change:

```toml
tauri = { version = "2", features = [] }
```

to:

```toml
tauri = { version = "2", features = ["tray-icon"] }
```

- [ ] **Step 4: Replace the Rust entry point**

Replace the full contents of `desktop/src-tauri/src/lib.rs` with:

```rust
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct SidecarState(Mutex<Option<CommandChild>>);

fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
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
    let (_rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    *guard = Some(child);
    Ok(())
}

fn kill_sidecar(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn start_bridge(app: AppHandle) -> Result<(), String> {
    spawn_sidecar(&app)
}

#[tauri::command]
fn stop_bridge(app: AppHandle) -> Result<(), String> {
    kill_sidecar(&app)
}

#[tauri::command]
async fn get_status(app: AppHandle) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(["status", "--json"]);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(SidecarState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_bridge, stop_bridge, get_status])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = spawn_sidecar(&handle) {
                eprintln!("failed to spawn bridge sidecar on startup: {e}");
            }
            if let Err(e) = app.autolaunch().enable() {
                eprintln!("failed to register autostart: {e}");
            }

            let start_i = MenuItem::with_id(app, "start", "Iniciar", true, None::<&str>)?;
            let stop_i = MenuItem::with_id(app, "stop", "Parar", true, None::<&str>)?;
            let open_i = MenuItem::with_id(app, "open", "Abrir", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&start_i, &stop_i, &open_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "start" => {
                        let _ = spawn_sidecar(app);
                    }
                    "stop" => {
                        let _ = kill_sidecar(app);
                    }
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let _ = kill_sidecar(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Update `tauri.conf.json`**

Replace the full contents of `desktop/src-tauri/tauri.conf.json` with:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Claude Telegram Bridge",
  "version": "0.1.0",
  "identifier": "com.claudetelegrambridge.desktop",
  "build": {
    "frontendDist": "../src"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "Claude Telegram Bridge",
        "width": 420,
        "height": 320,
        "visible": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/bridge"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 6: Write the webview frontend**

Replace `desktop/src/index.html` with:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Claude Telegram Bridge</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1>Claude Telegram Bridge</h1>
    <p id="status">Carregando...</p>
    <button id="start">Iniciar</button>
    <button id="stop">Parar</button>
    <script type="module" src="main.js"></script>
  </body>
</html>
```

Replace `desktop/src/main.js` with:

```javascript
const { invoke } = window.__TAURI__.core;

const statusEl = document.getElementById('status');

function render(status) {
  if (!status.configured) {
    statusEl.textContent = 'Bridge ainda não configurado.';
    return;
  }
  const ligado = status.enabled ? 'Ligado' : 'Desligado';
  const chat = status.connectedChatId ?? 'nenhum';
  statusEl.textContent = `${ligado} — chat ${chat} — ${status.sessionCount} sessão(ões)`;
}

async function refreshStatus() {
  try {
    const raw = await invoke('get_status');
    render(JSON.parse(raw));
  } catch (err) {
    statusEl.textContent = `Erro ao consultar status: ${err}`;
  }
}

document.getElementById('start').addEventListener('click', () => invoke('start_bridge'));
document.getElementById('stop').addEventListener('click', () => invoke('stop_bridge'));

refreshStatus();
setInterval(refreshStatus, 3000);
```

- [ ] **Step 7: Verify it compiles**

```bash
cd desktop/src-tauri
cargo build
cd ../..
```

Expected: `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in ...` with no errors (a linker informational note is fine — this exact code has already been verified to produce only that note, no errors).

- [ ] **Step 8: Commit**

```bash
git add desktop
git commit -m "feat: scaffold the Tauri desktop shell (tray icon, sidecar wiring, status polling)"
```

---

### Task 3: Bundle the real bridge binary as the sidecar

**Files:**
- Create: `desktop/scripts/prepare-sidecar.mjs`
- Modify: `desktop/package.json`

**Interfaces:**
- Consumes: `npm run build:sea` (already exists at the repo root, produces `dist/claude-telegram-bridge(.exe)`).
- Produces: `desktop/src-tauri/binaries/bridge-<host-triple>(.exe)`, matching what `tauri.conf.json`'s `externalBin: ["binaries/bridge"]` (Task 2) expects to find when building/running the app.

- [ ] **Step 1: Write the sidecar-preparation script**

Create `desktop/scripts/prepare-sidecar.mjs`:

```javascript
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootDir = path.dirname(desktopDir);
const binariesDir = path.join(desktopDir, 'src-tauri', 'binaries');

function hostTriple() {
  const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const match = output.match(/host:\s*(\S+)/);
  if (!match) {
    throw new Error('Could not determine the current Rust host target triple from `rustc -vV`');
  }
  return match[1];
}

function main() {
  console.log('Building the bridge sidecar binary (npm run build:sea)...');
  execFileSync('npm', ['run', 'build:sea'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const triple = hostTriple();
  const isWindows = process.platform === 'win32';
  const sourceName = isWindows ? 'claude-telegram-bridge.exe' : 'claude-telegram-bridge';
  const targetName = isWindows ? `bridge-${triple}.exe` : `bridge-${triple}`;

  fs.mkdirSync(binariesDir, { recursive: true });
  fs.copyFileSync(path.join(rootDir, 'dist', sourceName), path.join(binariesDir, targetName));
  fs.chmodSync(path.join(binariesDir, targetName), 0o755);

  console.log(`Sidecar ready at ${path.join(binariesDir, targetName)}`);
}

main();
```

- [ ] **Step 2: Wire it as an npm script**

In `desktop/package.json`, add a new entry to `"scripts"`:

```json
"prepare-sidecar": "node scripts/prepare-sidecar.mjs"
```

- [ ] **Step 3: Run it and verify the file lands correctly**

```bash
cd desktop
npm run prepare-sidecar
```

Expected: it runs the root project's SEA build, then prints `Sidecar ready at ...\src-tauri\binaries\bridge-x86_64-pc-windows-msvc.exe` (on this machine — the exact triple was confirmed earlier as `x86_64-pc-windows-msvc`).

Confirm the file exists:

```bash
ls -la src-tauri/binaries/
cd ..
```

Expected: a `bridge-x86_64-pc-windows-msvc.exe` file, several MB in size (it's the full self-contained Node binary).

- [ ] **Step 4: Verify the whole app still builds with the real sidecar present**

```bash
cd desktop/src-tauri
cargo build
cd ../..
```

Expected: same clean `Finished` output as Task 2 Step 7 — the presence of the real sidecar binary shouldn't change compilation, only runtime behavior (which Task 4 verifies manually).

- [ ] **Step 5: Add a `.gitignore` entry for the built sidecar**

The sidecar binary is a build artifact (rebuilt by `prepare-sidecar.mjs`), not source — it shouldn't be committed. Add to `desktop/src-tauri/.gitignore` (append if the file already has other entries from the scaffold):

```
binaries/
```

- [ ] **Step 6: Commit**

```bash
git add desktop/scripts desktop/package.json desktop/src-tauri/.gitignore
git commit -m "feat: add a script to bundle the real bridge binary as the Tauri sidecar"
```

---

### Task 4: Manual end-to-end verification

**Files:** none — this task is entirely manual. Nothing here can be verified by an automated test: it requires actually launching a GUI application, observing a tray icon, and confirming OS-level autostart registration, none of which `node:test` or `cargo test` can drive.

**Interfaces:**
- Consumes: the fully assembled app from Tasks 1–3.

- [ ] **Step 1: Run the app in dev mode**

```bash
cd desktop
npm install
npm run tauri dev
```

Expected: a window titled "Claude Telegram Bridge" opens, and a tray icon appears in the system tray. **This will visibly open a real window on screen** — expected, not a bug.

- [ ] **Step 2: Confirm the sidecar auto-starts**

With the app running, check that a `claude-telegram-bridge`-equivalent process is alive (e.g. Task Manager, or `tasklist | grep -i bridge` in another terminal) without clicking anything.

- [ ] **Step 3: Confirm the status view reflects reality**

Compare what the window shows against a manual `node bin/bridge.js status` run from the main repo (same machine, same `~/.claude-telegram-bridge` config) — they should agree (enabled state, chat id, session count).

- [ ] **Step 4: Stop and start from the tray menu**

Right-click the tray icon, select "Parar" — confirm the sidecar process disappears from Task Manager and the window's status updates to reflect it (may take up to ~3s due to the polling interval). Select "Iniciar" — confirm a new sidecar process appears.

- [ ] **Step 5: Confirm "Abrir" and "Sair" behave correctly**

Close the window (don't quit) — confirm the app and its tray icon are still present, and "Abrir" from the tray brings the window back. Select "Sair" — confirm both the window, the tray icon, and the sidecar process all go away.

- [ ] **Step 6: Confirm autostart was registered**

On Windows, check `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` (e.g. via `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"`) for an entry pointing at the desktop app's executable. Log out and back in (or restart) and confirm the tray icon reappears without manually launching anything.

- [ ] **Step 7: Confirm the CLI and desktop app are not run together against the same bot**

Document (in `desktop/README.md`, create if it doesn't exist) that running the CLI's `start` and this desktop app at the same time against the same bot token is unsupported — they'd both long-poll the same Telegram bot concurrently. This is a documentation step, not a technical guard (see design.md Decision 6).
