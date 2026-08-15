## 1. Bridge-side: listInvites + invite --json/--list

- [ ] 1.1 Add `listInvites(config)` to `src/registration.js` (import `chatIdForOwner` from `./config.js`): maps `config.invites` to an array with `redeemedChatId` resolved only for labeled + consumed invites
- [ ] 1.2 Regression tests: empty list, mix of pending/consumed, labeled-and-consumed reports `redeemedChatId`, unlabeled-and-consumed reports `redeemedChatId: null`
- [ ] 1.3 Add `--json` and `--list` to `bin/bridge.js`'s `cmdInvite` - preserve the exact existing plain-text path when neither flag is passed
- [ ] 1.4 Manual verification: `node bin/bridge.js invite` (unchanged text output), `node bin/bridge.js invite --json --for-account teste`, `node bin/bridge.js invite --list --json`

## 2. Desktop app: invite section + clipboard

- [ ] 2.1 Add `tauri-plugin-clipboard-manager` dependency (`cargo add` from `desktop/src-tauri`), register `.plugin(tauri_plugin_clipboard_manager::init())`
- [ ] 2.2 Add `"clipboard-manager:allow-write-text"` to `desktop/src-tauri/capabilities/default.json`'s `permissions` array
- [ ] 2.3 Add `create_invite(app, label: Option<String>)` and `list_invites(app)` Rust commands (both via `.output()`, no stdin), register both in `invoke_handler!`
- [ ] 2.4 Verify it compiles (`cargo build` from `desktop/src-tauri`)
- [ ] 2.5 Add the collapsible invite section to `desktop/src/index.html`: toggle button, label input, "Gerar convite" button, generated-code display with "Copiar", invite list container
- [ ] 2.6 Wire it in `desktop/src/main.js`: toggle visibility, call `create_invite`/`list_invites`, render the list, wire "Copiar" to `invoke('plugin:clipboard-manager|write_text', { text: code })`
- [ ] 2.7 Rebuild the sidecar (`npm run prepare-sidecar` from `desktop/`) so it includes the updated `invite` subcommand before manual testing

## 3. Manual end-to-end verification

- [ ] 3.1 Launch the app, open "Convidar alguém", confirm the section expands and shows any pre-existing invites correctly
- [ ] 3.2 Generate an invite with a label, confirm the code appears with a working Copy button (paste somewhere to confirm), and the list updates to include it as pending
- [ ] 3.3 From a second Telegram account (or ask a friend), send `/register <code>` to the bot; confirm the invite list (after reopening/refreshing the section) now shows it as consumed, with the redeeming chat id
- [ ] 3.4 Generate an invite with no label, confirm it still works end-to-end and is listed (without a resolvable `redeemedChatId` once consumed, per Decision 1)
