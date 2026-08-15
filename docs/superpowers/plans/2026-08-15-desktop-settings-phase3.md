# Desktop Settings (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the desktop app's status view toggle on/off and notification granularity directly, restarting the sidecar so the change takes effect immediately — per `openspec/changes/add-desktop-settings/`.

**Architecture:** A new pure `applySettingsUpdate` function in `src/config.js` backs a new `bridge settings --json` subcommand (mirrors the existing `status`/`onboard` subcommands' shape). `status --json` gains a `granularity` field. The desktop app gets an `update_settings` Rust command that calls `settings --json` via the sidecar, then restarts it (`kill_sidecar` + `spawn_sidecar`, both already built in `add-desktop-shell`/`add-desktop-onboarding`) so the change is picked up. The status view gains an on/off checkbox and a granularity `<select>`.

**Tech Stack:** Node.js (ESM) for the bridge-side changes; Rust + Tauri v2 (`tauri-plugin-shell`, already a dependency — no new crates needed) for the desktop app; plain HTML/CSS/JS (no framework, matching Phases 1-2).

## Global Constraints

- No behavior change to `/on`/`/off` (Telegram) or hand-edited `config.json` — `settings --json` is an additional way to reach the same `enabled`/`granularity` fields, sharing the same `saveConfig`/`validateConfig` path.
- All new user-facing strings are in Portuguese, matching the rest of the project.
- No new Rust dependencies — this phase only composes patterns already compiled and verified in `add-desktop-shell`/`add-desktop-onboarding` (`.output()`, `kill_sidecar`/`spawn_sidecar`, `Option<T>` command parameters).

---

### Task 1: Bridge-side settings subcommand

**Files:**
- Modify: `src/config.js`
- Modify: `src/status.js`
- Modify: `bin/bridge.js`
- Modify: `test/config.test.js`
- Modify: `test/status.test.js`

**Interfaces:**
- Produces: `applySettingsUpdate(config, { enabled, granularity })` (pure, returns a new config object, throws on an invalid `granularity`); a `settings` subcommand printing `{ok: true, enabled, granularity}` or `{ok: false, reason: 'not-configured' | 'error', message?}`. `getStatusSnapshot` now also returns `granularity`. Task 2's Rust code calls the `settings` subcommand by name, not the JS function directly.

- [ ] **Step 1: Write the failing tests for `applySettingsUpdate`**

Add to `test/config.test.js` (add `applySettingsUpdate` to the existing import from `'../src/config.js'`):

```javascript
import {
  getConfigDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  createDefaultConfig,
  validateConfig,
  applySettingsUpdate,
} from '../src/config.js';
```

```javascript
test('applySettingsUpdate with no changes returns an equivalent config', () => {
  const config = createDefaultConfig('123:abc');
  const result = applySettingsUpdate(config, {});
  assert.deepEqual(result, config);
});

test('applySettingsUpdate sets enabled without touching granularity', () => {
  const config = createDefaultConfig('123:abc');
  const result = applySettingsUpdate(config, { enabled: false });
  assert.equal(result.enabled, false);
  assert.equal(result.granularity, 'default');
});

test('applySettingsUpdate sets granularity without touching enabled', () => {
  const config = createDefaultConfig('123:abc');
  const result = applySettingsUpdate(config, { granularity: 'verbose' });
  assert.equal(result.granularity, 'verbose');
  assert.equal(result.enabled, true);
});

test('applySettingsUpdate rejects an invalid granularity', () => {
  const config = createDefaultConfig('123:abc');
  assert.throws(() => applySettingsUpdate(config, { granularity: 'chatty' }), /granularity/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/config.test.js`
Expected: FAIL — `applySettingsUpdate is not a function` (import error).

- [ ] **Step 3: Implement `applySettingsUpdate`**

Add to `src/config.js`, right after `createDefaultConfig`:

```javascript
/** Pure: returns a new config with `enabled`/`granularity` updated where provided, leaving anything not passed untouched. Shared by the `settings` CLI subcommand and (indirectly) the desktop app's update_settings command. */
export function applySettingsUpdate(config, { enabled, granularity } = {}) {
  const updated = { ...config };
  if (enabled !== undefined) {
    updated.enabled = enabled;
  }
  if (granularity !== undefined) {
    if (!['default', 'verbose'].includes(granularity)) {
      throw new Error(`granularity must be "default" or "verbose", got "${granularity}"`);
    }
    updated.granularity = granularity;
  }
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/config.test.js`
Expected: PASS — all existing tests plus the 4 new ones.

- [ ] **Step 5: Write the failing test for `getStatusSnapshot`'s new field**

Add to `test/status.test.js`:

```javascript
test('reports granularity alongside enabled', () => {
  const result = getStatusSnapshot(baseConfig({ granularity: 'verbose' }), emptyRegistry());
  assert.equal(result.granularity, 'verbose');
});
```

- [ ] **Step 6: Run tests to verify it fails**

Run: `node --test test/status.test.js`
Expected: FAIL — `result.granularity` is `undefined`, not `'verbose'`.

- [ ] **Step 7: Add `granularity` to `getStatusSnapshot`**

In `src/status.js`, add one line to the returned object:

```javascript
export function getStatusSnapshot(config, registry) {
  if (!config) {
    return { configured: false };
  }
  const sessions = Object.values(registry?.sessions ?? {});
  return {
    configured: true,
    enabled: config.enabled,
    granularity: config.granularity,
    connectedOwner: 'operator',
    connectedChatId: chatIdForOwner(config, 'operator') ?? null,
    sessionCount: sessions.length,
    lastActivity: sessions.length ? Math.max(...sessions.map((s) => s.lastActive)) : null,
  };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test test/status.test.js`
Expected: PASS — all existing tests plus the new one.

- [ ] **Step 9: Add the `settings` subcommand to `bin/bridge.js`**

Add `applySettingsUpdate` to the existing `config.js` import:

```javascript
import { loadConfig, saveConfig, applySettingsUpdate } from '../src/config.js';
```

Add the command function near `cmdStatus`:

```javascript
function cmdSettings(args) {
  const { values } = parseArgs({
    args,
    options: { 'set-enabled': { type: 'string' }, 'set-granularity': { type: 'string' } },
  });
  const config = loadConfig();
  if (!config) {
    console.log(JSON.stringify({ ok: false, reason: 'not-configured' }));
    return;
  }
  try {
    const updated = applySettingsUpdate(config, {
      enabled: values['set-enabled'] !== undefined ? values['set-enabled'] === 'true' : undefined,
      granularity: values['set-granularity'],
    });
    saveConfig(updated);
    console.log(JSON.stringify({ ok: true, enabled: updated.enabled, granularity: updated.granularity }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, reason: 'error', message: err.message }));
  }
}
```

Register it in `main()`'s switch, next to `case 'onboard':`:

```javascript
    case 'settings':
      return cmdSettings(rest);
```

Update the usage line:

```javascript
      console.log('Uso: claude-telegram-bridge <start|install|uninstall|invite|status|onboard|settings>');
```

- [ ] **Step 10: Manually verify the subcommand**

```bash
node bin/bridge.js settings --json
node bin/bridge.js settings --json --set-enabled false
node bin/bridge.js settings --json
node bin/bridge.js settings --json --set-enabled true --set-granularity verbose
```

Expected: the first call reports your current real `enabled`/`granularity`; the second reports `{"ok":true,"enabled":false,...}` and the third confirms it persisted; the fourth reports both fields updated together. Confirm `~/.claude-telegram-bridge/config.json` reflects each change.

- [ ] **Step 11: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS — every existing test plus the 5 new ones.

- [ ] **Step 12: Commit**

```bash
git add src/config.js src/status.js bin/bridge.js test/config.test.js test/status.test.js
git commit -m "feat: add a settings --json subcommand for on/off and granularity"
```

---

### Task 2: Desktop app — settings controls with restart-on-change

**Files:**
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src/index.html`
- Modify: `desktop/src/main.js`

**Interfaces:**
- Consumes: the `settings` subcommand from Task 1 (`bridge settings --json [--set-enabled ...] [--set-granularity ...]`); the existing `kill_sidecar`/`spawn_sidecar` functions from `add-desktop-shell`.
- Produces: an `update_settings(enabled, granularity)` Tauri command.

- [ ] **Step 1: Add the `update_settings` command**

In `desktop/src-tauri/src/lib.rs`, add near the other `#[tauri::command]` functions:

```rust
#[tauri::command]
async fn update_settings(app: AppHandle, enabled: Option<bool>, granularity: Option<String>) -> Result<String, String> {
    let mut args: Vec<String> = vec!["settings".to_string(), "--json".to_string()];
    if let Some(e) = enabled {
        args.push("--set-enabled".to_string());
        args.push(e.to_string());
    }
    if let Some(g) = granularity {
        args.push("--set-granularity".to_string());
        args.push(g);
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(arg_refs);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    let result = String::from_utf8(output.stdout).map_err(|e| e.to_string())?.trim().to_string();

    kill_sidecar(&app)?;
    spawn_sidecar(&app).await?;

    Ok(result)
}
```

- [ ] **Step 2: Register it in `invoke_handler!`**

Replace:

```rust
        .invoke_handler(tauri::generate_handler![
            start_bridge,
            stop_bridge,
            get_status,
            complete_onboarding
        ])
```

with:

```rust
        .invoke_handler(tauri::generate_handler![
            start_bridge,
            stop_bridge,
            get_status,
            complete_onboarding,
            update_settings
        ])
```

- [ ] **Step 3: Verify it compiles**

```bash
cd desktop/src-tauri
cargo build
cd ../..
```

Expected: `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in ...` with no errors.

- [ ] **Step 4: Add the controls to the status view**

In `desktop/src/index.html`, replace the `status-view` div:

```html
    <div id="status-view" hidden>
      <h1>Claude Telegram Bridge</h1>
      <p id="status">Carregando...</p>
      <button id="start">Iniciar</button>
      <button id="stop">Parar</button>
      <hr />
      <label><input id="enabled-toggle" type="checkbox" /> Integração ligada</label>
      <br />
      <label>
        Granularidade das notificações:
        <select id="granularity-select">
          <option value="default">Padrão</option>
          <option value="verbose">Detalhada</option>
        </select>
      </label>
    </div>
```

- [ ] **Step 5: Wire the controls in the frontend**

In `desktop/src/main.js`, add element references near the existing ones:

```javascript
const enabledToggle = document.getElementById('enabled-toggle');
const granularitySelect = document.getElementById('granularity-select');
```

Update `renderStatus` to also reflect the current settings:

```javascript
function renderStatus(status) {
  const ligado = status.enabled ? 'Ligado' : 'Desligado';
  const chat = status.connectedChatId ?? 'nenhum';
  const rodando = status.running ? 'Rodando' : 'Parado';
  statusEl.textContent = `${rodando} — ${ligado} — chat ${chat} — ${status.sessionCount} sessão(ões)`;
  enabledToggle.checked = status.enabled;
  granularitySelect.value = status.granularity;
}
```

Add change handlers near the existing `start`/`stop` button listeners:

```javascript
enabledToggle.addEventListener('change', async () => {
  await invoke('update_settings', { enabled: enabledToggle.checked, granularity: null });
  await refresh();
});

granularitySelect.addEventListener('change', async () => {
  await invoke('update_settings', { enabled: null, granularity: granularitySelect.value });
  await refresh();
});
```

- [ ] **Step 6: Rebuild the sidecar so it includes the new `settings` subcommand**

```bash
cd desktop
npm run prepare-sidecar
cd ..
```

Required before manual testing — Task 1 changed `bin/bridge.js`, and (per the correction already noted in `add-desktop-onboarding`'s own plan) the bundled sidecar binary is a snapshot that goes stale after any bridge-side change.

- [ ] **Step 7: Run the Node test suite once more (final regression check for this plan)**

Run: `npm test`
Expected: PASS — same count as Task 1 Step 11 (this task only touched Rust/frontend, no new JS tests).

- [ ] **Step 8: Commit**

```bash
git add desktop/src-tauri/src/lib.rs desktop/src/index.html desktop/src/main.js
git commit -m "feat: add on/off and granularity controls to the status view, restarting on change"
```

---

### Task 3: Manual end-to-end verification

**Files:** none — GUI behavior and the sidecar restart timing can't be driven by `node:test`/`cargo test`.

**Interfaces:**
- Consumes: the fully wired app from Tasks 1-2, run against a real, already-configured bridge (no need to reset config for this phase — unlike `add-desktop-onboarding`'s Task 3).

- [ ] **Step 1: Launch the app**

```bash
cd desktop
npm run tauri dev
```

Expected: the status view shows, with the checkbox and select already reflecting your real current `enabled`/`granularity`.

- [ ] **Step 2: Toggle off**

Uncheck "Integração ligada". Expected: a brief status flicker (sidecar restarting), then the status text still shows connected but now reports "Desligado". Confirm in a separate terminal: `node ../bin/bridge.js status` (from inside `desktop/`, adjust path) shows `"enabled":false`.

- [ ] **Step 3: Confirm actually disabled**

Send a message to the bot from Telegram. Expected: no response (matches the existing, already-tested "disabled" behavior in `output-relay`/`telegram-gateway` — this phase doesn't change that logic, only how `enabled` gets set).

- [ ] **Step 4: Toggle back on, then change granularity separately**

Re-check "Integração ligada", confirm it goes back to "Ligado" and messages get relayed again. Then, as a separate action, change the granularity select to "Detalhada". Confirm each change independently triggers exactly one restart (not one for both together, since they're two separate interactions) and both settings persist correctly afterward (`node bin/bridge.js status` shows both the final `enabled` and `granularity` values).
