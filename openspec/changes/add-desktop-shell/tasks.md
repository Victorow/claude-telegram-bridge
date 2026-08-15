## 1. Bridge-side: status subcommand

- [ ] 1.1 Implement `status --json` subcommand in `bin/bridge.js`, reusing `loadConfig`/`loadRegistry`, reporting: configured?, enabled, connected owner/chat, session count, most-recent activity timestamp
- [ ] 1.2 Regression tests for the status subcommand's output shape (not-configured vs configured, enabled vs disabled, zero vs multiple sessions)

## 2. Desktop app scaffold

- [ ] 2.1 Scaffold the Tauri project under `desktop/` (Rust shell, plain HTML/CSS/JS webview, no framework)
- [ ] 2.2 Bundle the existing `build:sea` binary as a Tauri sidecar per platform
- [ ] 2.3 Implement sidecar lifecycle: spawn on app start, kill on stop/quit, track alive/dead state
- [ ] 2.4 Tray icon with Start/Stop/Open/Quit
- [ ] 2.5 Status window polling `status --json` on an interval and rendering: running/stopped, connected chat, session count
- [ ] 2.6 Self-registered autostart (tray-only launch at login), documented as replacing (not supplementing) `src/service.js`'s scheduled-task registration

## 3. Manual end-to-end verification

- [ ] 3.1 Fresh machine/profile: install desktop app, confirm tray icon appears, sidecar spawns, status view reflects real config/registry state
- [ ] 3.2 Stop/start from tray, confirm sidecar process lifecycle matches
- [ ] 3.3 Log out/log back in (or restart), confirm autostart brings the tray app back without manual action
- [ ] 3.4 Confirm running the plain CLI `start` concurrently against the same bot is documented as unsupported (README note), not silently allowed to look fine
