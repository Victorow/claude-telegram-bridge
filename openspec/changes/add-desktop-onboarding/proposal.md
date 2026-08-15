## Why

Phase 1 (`add-desktop-shell`) built the desktop app's walking skeleton — process supervision, tray icon, status view — but still requires a working `~/.claude-telegram-bridge/config.json` to exist before it's useful, meaning a brand-new user still has to run the terminal wizard once. Phase 2 closes that gap: a GUI-driven first-run flow (paste a bot token, be guided to @BotFather, confirm) so the desktop distribution never requires a terminal at all.

## What Changes

- The desktop app checks `status --json` at startup; if unconfigured, it shows an onboarding view instead of the status view, in the same window.
- Onboarding: a button that opens `https://t.me/BotFather` (via the already-present `tauri-plugin-opener`), a field to paste the bot token, and a "Verificar" button. Clicking it calls a new `complete_onboarding` Tauri command, which runs a new `bridge onboard --json` subcommand (token passed via a single line on stdin, not argv, to avoid it appearing in process listings) that attempts to detect a chat exactly like the terminal wizard does, just as a single non-blocking attempt instead of a `readline` prompt.
- On success: config is saved, and the view switches to the existing status display (Phase 1) — no separate "success" screen.
- On failure (no message received yet): a clear error message, token preserved, "Verificar" can be retried.
- Neither the app's own startup nor the tray's "Iniciar" button ever invoke `bridge start` while unconfigured — both check `status --json` first, since `start` would otherwise hang forever waiting for a terminal `readline` prompt that a background sidecar process can never receive.
- `src/wizard.js` is refactored to extract the "given a token, attempt to detect the chat and save" logic into a new, independently reusable, independently tested function (`attemptOnboarding`) — the terminal wizard's own observable behavior and error messages are unchanged.

## Capabilities

### Modified Capabilities
- `desktop-shell` (from `add-desktop-shell`): adds the onboarding view, the `complete_onboarding` command, and the startup/tray guard against invoking `start` while unconfigured.

### New Capabilities
_None — this extends the existing `desktop-shell` capability; the CLI-facing wizard behavior is unchanged, just internally refactored._

## Impact

- No changes to the terminal wizard's observable behavior, prompts, or error messages — `runFirstRunWizard` is refactored internally, not replaced.
- New subcommand `bridge onboard --json` (stdin-fed), alongside the existing `status --json`.
- The desktop app can now be used start-to-finish (first run through daily use) without ever opening a terminal, completing the goal stated in `add-desktop-shell`'s proposal.
