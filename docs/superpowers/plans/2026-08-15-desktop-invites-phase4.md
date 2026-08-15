# Desktop Invites (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the desktop app's status view generate and review invite codes, closing the last CLI-only action in the base multi-owner sharing feature — per `openspec/changes/add-desktop-invites/`.

**Architecture:** A new pure `listInvites` function in `src/registration.js` backs new `--list`/`--json` flags on the existing `invite` subcommand (unchanged plain-text behavior when neither flag is passed). Two new Tauri commands (`create_invite`, `list_invites`) call it via the same one-shot `.output()` pattern already used by `get_status`/`update_settings`. A new `tauri-plugin-clipboard-manager` dependency (confirmed to exist and compile against this project's Tauri version before this plan was written) backs a real "Copiar" button.

**Tech Stack:** Node.js (ESM) for the bridge-side changes; Rust + Tauri v2 (`tauri-plugin-shell`, already present; `tauri-plugin-clipboard-manager`, new) for the desktop app; plain HTML/CSS/JS (no framework, matching Phases 1-3).

## Global Constraints

- No behavior change to the CLI's `invite` subcommand when called without `--json`/`--list`.
- No behavior change to invite redemption (`/register <code>` from Telegram).
- `tauri-plugin-clipboard-manager`'s default permission set is empty (confirmed) - `clipboard-manager:allow-write-text` must be added explicitly to `desktop/src-tauri/capabilities/default.json`, granting only what's used (not `clipboard-manager:default`).
- All new user-facing strings are in Portuguese, matching the rest of the project.

---

### Task 1: Bridge-side — listInvites + invite --json/--list

**Files:**
- Modify: `src/registration.js`
- Modify: `test/registration.test.js`
- Modify: `bin/bridge.js`

**Interfaces:**
- Produces: `listInvites(config)` returning `Array<{code, ownerLabel, consumed, createdAt, redeemedChatId}>`; `invite --list --json` printing `{ok: true, invites: [...]}`; `invite --json [--for-account <label>]` printing `{ok: true, code}` (or `{ok: false, reason: 'not-configured'}` if unconfigured). Task 2's Rust code calls the `invite` subcommand by name, not the JS function directly.

- [ ] **Step 1: Write the failing tests**

Add `listInvites` to the existing import in `test/registration.test.js`:

```javascript
import { registerOwner, createInvite, redeemInvite, listInvites } from '../src/registration.js';
```

Add these tests at the end of the file:

```javascript
test('listInvites returns an empty array when no invites exist', () => {
  const config = baseConfig();
  assert.deepEqual(listInvites(config), []);
});

test('listInvites reports each invite\'s code, label, consumed state, and creation time', () => {
  const config = baseConfig();
  createInvite(config, { ownerLabel: 'amigo', now: () => 1000, randomBytes: () => 'code1' });
  createInvite(config, { now: () => 2000, randomBytes: () => 'code2' });
  const result = listInvites(config);
  const byCode = Object.fromEntries(result.map((i) => [i.code, i]));
  assert.equal(byCode.code1.ownerLabel, 'amigo');
  assert.equal(byCode.code1.consumed, false);
  assert.equal(byCode.code1.createdAt, 1000);
  assert.equal(byCode.code2.ownerLabel, null);
});

test('listInvites resolves the redeeming chat id for a labeled, consumed invite', () => {
  const config = baseConfig();
  const code = createInvite(config, { ownerLabel: 'amigo', randomBytes: () => 'code1' });
  redeemInvite(config, '777', code);
  const result = listInvites(config);
  assert.equal(result[0].consumed, true);
  assert.equal(result[0].redeemedChatId, '777');
});

test('listInvites does not attempt to resolve a redeeming chat id for an unlabeled invite', () => {
  const config = baseConfig();
  const code = createInvite(config, { randomBytes: () => 'code1' });
  redeemInvite(config, '777', code);
  const result = listInvites(config);
  assert.equal(result[0].consumed, true);
  assert.equal(result[0].redeemedChatId, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/registration.test.js`
Expected: FAIL — `listInvites is not a function` (import error).

- [ ] **Step 3: Implement `listInvites`**

In `src/registration.js`, add the import and function:

```javascript
import { chatIdForOwner } from './config.js';
```

Add at the end of the file:

```javascript
/** Turns config.invites into a displayable list. redeemedChatId is only resolved for labeled, consumed invites (an invite's ownerLabel *is* the resulting owner id once redeemed - see redeemInvite above) - an unlabeled invite's derived owner id (`owner-<chatId>`) is left alone rather than reverse-parsed, since --for-account is the project's only documented usage. */
export function listInvites(config) {
  return Object.entries(config.invites).map(([code, invite]) => ({
    code,
    ownerLabel: invite.ownerLabel,
    consumed: invite.consumed,
    createdAt: invite.createdAt,
    redeemedChatId: invite.consumed && invite.ownerLabel ? (chatIdForOwner(config, invite.ownerLabel) ?? null) : null,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/registration.test.js`
Expected: PASS — all existing tests plus the 4 new ones.

- [ ] **Step 5: Add `--json`/`--list` to `bin/bridge.js`'s `cmdInvite`**

Add `listInvites` to the existing import:

```javascript
import { redeemInvite, createInvite, listInvites } from '../src/registration.js';
```

Replace `cmdInvite`:

```javascript
function cmdInvite(args) {
  const { values } = parseArgs({
    args,
    options: {
      'for-account': { type: 'string' },
      json: { type: 'boolean' },
      list: { type: 'boolean' },
    },
  });
  const config = loadConfig();
  if (!config) {
    if (values.json || values.list) {
      console.log(JSON.stringify({ ok: false, reason: 'not-configured' }));
    } else {
      console.error('Rode "start" pelo menos uma vez antes de convidar alguém.');
      process.exitCode = 1;
    }
    return;
  }

  if (values.list) {
    console.log(JSON.stringify({ ok: true, invites: listInvites(config) }));
    return;
  }

  const code = createInvite(config, { ownerLabel: values['for-account'] || null });
  saveConfig(config);
  if (values.json) {
    console.log(JSON.stringify({ ok: true, code }));
  } else {
    console.log(`Código de convite: ${code}`);
    console.log(`Peça para a pessoa mandar "/register ${code}" para o bot.`);
  }
}
```

- [ ] **Step 6: Manually verify all three paths**

```bash
node bin/bridge.js invite
node bin/bridge.js invite --json --for-account teste
node bin/bridge.js invite --list --json
```

Expected: the first prints the exact same two lines of plain text as before this change; the second prints `{"ok":true,"code":"..."}`; the third prints `{"ok":true,"invites":[...]}` including the invite just created (`ownerLabel: "teste"`, `consumed: false`).

- [ ] **Step 7: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS — every existing test plus the 4 new ones.

- [ ] **Step 8: Commit**

```bash
git add src/registration.js test/registration.test.js bin/bridge.js
git commit -m "feat: add invite --json/--list for the desktop app, unchanged plain-text default"
```

---

### Task 2: Desktop app — invite section + clipboard

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/capabilities/default.json`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src/index.html`
- Modify: `desktop/src/main.js`

**Interfaces:**
- Consumes: the `invite --json`/`--list` flags from Task 1.
- Produces: `create_invite(label)` and `list_invites()` Tauri commands.

- [ ] **Step 1: Add the clipboard plugin dependency**

```bash
cd desktop/src-tauri
cargo add tauri-plugin-clipboard-manager
cd ../..
```

Expected: `Adding tauri-plugin-clipboard-manager v2.3.2 to dependencies`.

- [ ] **Step 2: Grant the clipboard write permission**

In `desktop/src-tauri/capabilities/default.json`, add to the `permissions` array:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "clipboard-manager:allow-write-text"
  ]
}
```

- [ ] **Step 3: Register the plugin and add the two commands**

In `desktop/src-tauri/src/lib.rs`, add near the other `#[tauri::command]` functions:

```rust
#[tauri::command]
async fn create_invite(app: AppHandle, label: Option<String>) -> Result<String, String> {
    let mut args: Vec<String> = vec!["invite".to_string(), "--json".to_string()];
    if let Some(l) = label {
        args.push("--for-account".to_string());
        args.push(l);
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(arg_refs);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_invites(app: AppHandle) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(["invite", "--list", "--json"]);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}
```

Register the plugin, right after the existing `.plugin(tauri_plugin_shell::init())` line:

```rust
        .plugin(tauri_plugin_clipboard_manager::init())
```

Add both commands to `invoke_handler!`:

```rust
        .invoke_handler(tauri::generate_handler![
            start_bridge,
            stop_bridge,
            get_status,
            complete_onboarding,
            update_settings,
            create_invite,
            list_invites
        ])
```

- [ ] **Step 4: Verify it compiles**

```bash
cd desktop/src-tauri
cargo build
cd ../..
```

Expected: `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in ...` with no errors.

- [ ] **Step 5: Add the invite section to the status view**

In `desktop/src/index.html`, add as the last child inside the `status-view` div — after the granularity `<select>`'s closing `</label>`, right before `status-view`'s own closing `</div>`:

```html
      <hr />
      <button id="toggle-invites">Convidar alguém</button>
      <div id="invites-section" hidden>
        <label>
          Rótulo (opcional):
          <input id="invite-label" type="text" placeholder="amigo" />
        </label>
        <button id="generate-invite">Gerar convite</button>
        <p id="new-invite-code"></p>
        <ul id="invites-list"></ul>
      </div>
```

- [ ] **Step 6: Wire the invite section in the frontend**

In `desktop/src/main.js`, add element references near the existing ones:

```javascript
const toggleInvitesButton = document.getElementById('toggle-invites');
const invitesSection = document.getElementById('invites-section');
const inviteLabelInput = document.getElementById('invite-label');
const generateInviteButton = document.getElementById('generate-invite');
const newInviteCodeEl = document.getElementById('new-invite-code');
const invitesListEl = document.getElementById('invites-list');
```

Add this near the bottom of the file, before the final `refresh(); setInterval(refresh, 3000);` lines:

```javascript
async function renderInvitesList() {
  const raw = await invoke('list_invites');
  const parsed = JSON.parse(raw);
  invitesListEl.innerHTML = '';
  for (const invite of parsed.invites ?? []) {
    const li = document.createElement('li');
    const label = invite.ownerLabel ? ` (${invite.ownerLabel})` : '';
    const status = invite.consumed
      ? `Usado${invite.redeemedChatId ? ` — chat ${invite.redeemedChatId}` : ''}`
      : 'Pendente';
    li.textContent = `${invite.code}${label} — ${status}`;
    invitesListEl.appendChild(li);
  }
}

toggleInvitesButton.addEventListener('click', async () => {
  const opening = invitesSection.hidden;
  invitesSection.hidden = !opening;
  if (opening) {
    await renderInvitesList();
  }
});

generateInviteButton.addEventListener('click', async () => {
  const label = inviteLabelInput.value.trim() || null;
  const raw = await invoke('create_invite', { label });
  const parsed = JSON.parse(raw);
  if (!parsed.ok) {
    newInviteCodeEl.textContent = 'Não consegui gerar o convite.';
    return;
  }
  newInviteCodeEl.innerHTML = '';
  const codeSpan = document.createElement('span');
  codeSpan.textContent = `Código: ${parsed.code} `;
  const copyButton = document.createElement('button');
  copyButton.textContent = 'Copiar';
  copyButton.addEventListener('click', () => invoke('plugin:clipboard-manager|write_text', { text: parsed.code }));
  newInviteCodeEl.appendChild(codeSpan);
  newInviteCodeEl.appendChild(copyButton);
  inviteLabelInput.value = '';
  await renderInvitesList();
});
```

- [ ] **Step 7: Rebuild the sidecar so it includes the updated `invite` subcommand**

```bash
cd desktop
npm run prepare-sidecar
cd ..
```

Required — Task 1 changed `bin/bridge.js`, and (per the recurring correction already noted in `add-desktop-onboarding`'s and `add-desktop-settings`'s own plans) the bundled sidecar binary goes stale after any bridge-side change.

- [ ] **Step 8: Run the Node test suite once more (final regression check for this plan)**

Run: `npm test`
Expected: PASS — same count as Task 1 Step 7 (this task only touched Rust/frontend/Cargo.toml, no new JS tests).

- [ ] **Step 9: Commit**

```bash
git add desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock desktop/src-tauri/capabilities/default.json desktop/src-tauri/src/lib.rs desktop/src/index.html desktop/src/main.js
git commit -m "feat: add invite generation and review to the status view, with real clipboard copy"
```

---

### Task 3: Manual end-to-end verification

**Files:** none — GUI behavior and clipboard interaction can't be driven by `node:test`/`cargo test`.

**Interfaces:**
- Consumes: the fully wired app from Tasks 1-2, run against a real, already-configured bridge.

- [ ] **Step 1: Launch the app**

```bash
cd desktop
npm run tauri dev
```

- [ ] **Step 2: Open the invites section**

Click "Convidar alguém". Expected: the section expands, showing any invites already created via the CLI in earlier phases (if any), otherwise an empty list.

- [ ] **Step 3: Generate a labeled invite**

Type a label (e.g. `teste`), click "Gerar convite". Expected: the code appears with a "Copiar" button, and the list below now includes it as "Pendente".

- [ ] **Step 4: Confirm the Copy button works**

Click "Copiar", then paste (Ctrl+V) into any text field outside the app. Expected: the exact invite code pastes correctly.

- [ ] **Step 5: Redeem the invite for real**

From a second Telegram account (or ask someone else), send `/register <code>` to the bot. Reopen or re-click "Convidar alguém" (or generate another invite, which also refreshes the list) to see the updated list. Expected: that invite now shows "Usado — chat <id>".

- [ ] **Step 6: Generate an unlabeled invite**

Click "Gerar convite" with the label field empty. Expected: it still works end-to-end (code generated, listed as pending with no label shown).
