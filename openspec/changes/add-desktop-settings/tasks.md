## 1. Bridge-side: settings subcommand

- [ ] 1.1 Add `applySettingsUpdate(config, { enabled, granularity })` to `src/config.js` - pure function, validates `granularity` is `'default'`/`'verbose'` if provided, returns an updated config object
- [ ] 1.2 Add `settings` subcommand to `bin/bridge.js`: no flags reports current state; `--set-enabled`/`--set-granularity` apply and save via `applySettingsUpdate` + `saveConfig`
- [ ] 1.3 Add `granularity` to `getStatusSnapshot`'s output (`src/status.js`)
- [ ] 1.4 Regression tests: `applySettingsUpdate` (no-op with no args, sets enabled, sets granularity, rejects invalid granularity); `getStatusSnapshot` includes `granularity`
- [ ] 1.5 Manual verification: `node bin/bridge.js settings --json`, `node bin/bridge.js settings --json --set-enabled false`, confirm `config.json` updates and output reflects it

## 2. Desktop app: settings controls + restart-on-change

- [ ] 2.1 Add `update_settings(app, enabled: Option<bool>, granularity: Option<String>)` Rust command: builds the appropriate `settings --json` args, runs it via `.output()`, then calls `kill_sidecar` + `spawn_sidecar` to restart
- [ ] 2.2 Register `update_settings` in `invoke_handler!`
- [ ] 2.3 Add the on/off toggle and granularity selector to the status view in `desktop/src/index.html`, wired to `update_settings` in `desktop/src/main.js`, refreshing status afterward
- [ ] 2.4 Verify it compiles (`cargo build` from `desktop/src-tauri`)
- [ ] 2.5 Rebuild the sidecar (`npm run prepare-sidecar` from `desktop/`) so the bundled binary includes the new `settings` subcommand before manual testing

## 3. Manual end-to-end verification

- [ ] 3.1 Launch the app against a real configured bridge, confirm the toggle/selector show the current real values
- [ ] 3.2 Toggle off, confirm the sidecar restarts (brief status flicker) and `config.json`'s `enabled` is now `false`
- [ ] 3.3 Confirm `/on` no longer needed from Telegram - the bridge is genuinely off (send a message, confirm no response, per the existing disabled behavior)
- [ ] 3.4 Toggle back on, then separately change granularity to verbose - confirm each control's own change independently persists and triggers exactly one restart (the two controls fire `update_settings` independently, one per interaction, not a shared "save" step)
