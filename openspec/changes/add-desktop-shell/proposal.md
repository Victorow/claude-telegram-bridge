## Why

Today the only way to run the bridge is a foreground CLI process plus an OS-level scheduled task — both require comfort with a terminal. Some users want a friendlier, purely visual way to install, monitor, and control the bridge (start/stop, see connection status) without ever opening one. This is **phase 1** of a larger desktop-UI effort — GUI onboarding, on/off settings, and invite management are explicit later phases (see Non-Goals in design.md). Phase 1 delivers the minimal walking skeleton: a lightweight, cross-platform app that supervises the existing bridge process and shows whether it's running and connected.

## What Changes

- New `desktop/` directory: a [Tauri](https://tauri.app) application (Rust shell + a plain HTML/CSS/JS webview, no frontend framework yet) that bundles the existing `npm run build:sea` binary as a sidecar process — zero changes to core bridge logic.
- The desktop app registers **itself** (not the raw bridge binary) to start at login, tray-only by default, and is responsible for spawning/supervising the bridge sidecar. This is a separate, mutually-exclusive alternative to the existing CLI + `src/service.js` scheduled-task autostart, not something that runs alongside it.
- A new `status --json` subcommand on `bin/bridge.js`, reusing `loadConfig`/`loadRegistry`, reporting: configured?, enabled, connected owner/chat, session count, most-recent activity timestamp. This is the only new bridge-side code in this phase — the desktop app polls it periodically to render its status view.
- A system tray icon (Start/Stop/Open/Quit) and a minimal status window (running/stopped, connected chat, session count). No onboarding, settings, or invite screens yet.

## Capabilities

### New Capabilities
- `desktop-shell`: the Tauri app itself — sidecar process lifecycle (start/stop/monitor), tray icon, status polling and display, self-registered autostart.

### Modified Capabilities
_None to existing bridge capabilities other than the additive `status` subcommand — no existing behavior changes for the CLI distribution._

## Impact

- New build-time dependency: Rust + the Tauri CLI (build-time only, like `esbuild`/`postject` today — never shipped to end users beyond what Tauri itself bundles).
- No changes to `src/gateway.js`, `src/inputRelay.js`, `src/outputRelay.js`, `src/registry.js`, `src/wizard.js`, or `src/service.js` — this phase only adds one subcommand and one new, entirely separate application.
- Users must choose **one** distribution per machine/bot: the existing CLI + scheduled-task install, or the new desktop app. Running both against the same bot token concurrently causes duplicate long-polling of the same Telegram bot (documented as unsupported, not technically prevented — see design.md Decision 6).
- Desktop app installers are unsigned in this phase, matching the existing CLI binaries — first-run OS warnings (Windows SmartScreen, macOS Gatekeeper) are expected and documented, not solved here.
- Confirmed not feasible, permanently out of scope: automating the Telegram bot-creation step itself (the @BotFather conversation) — doing so would require the user's personal Telegram account login, a materially bigger trust ask than pasting a bot token.
