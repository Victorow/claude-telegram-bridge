# Claude Telegram Bridge — Desktop App (Phase 1)

A lightweight [Tauri](https://tauri.app) app that supervises the same bridge from the repo root as a background ("sidecar") process, with a tray icon and a status window — no terminal required. See `openspec/changes/add-desktop-shell/` for the full design.

This is phase 1: process supervision (start/stop/status) only. GUI-driven onboarding, on/off settings, and invite management are later phases, not yet built.

## Development

```
npm install
npm run prepare-sidecar   # builds the bridge binary (npm run build:sea at the repo root) and bundles it as the Tauri sidecar
npm run tauri dev         # opens the app - a real window and tray icon appear
```

Re-run `prepare-sidecar` whenever the bridge source (`../src/**`, `../bin/bridge.js`) changes — it isn't rebuilt automatically.

## Do not run alongside the CLI distribution

This app and the CLI's `claude-telegram-bridge start` (with its scheduled-task autostart) are **alternative, mutually exclusive** ways to run the bridge — not two things meant to run together. Both would long-poll the same Telegram bot token concurrently, competing for the same updates. Pick one per machine/bot.

## Autostart

On first successful run, this app registers **itself** (not the raw bridge binary) to launch at login, minimized to the tray. It's the one responsible for spawning the bridge sidecar as a supervised child process, so autostarting the raw binary separately would create two unrelated, unsupervised processes.
