## 1. Bridge-side: shared onboarding logic + subcommand

- [ ] 1.1 Extract `attemptOnboarding(token, { getUpdatesFn, saveConfigFn })` out of `src/wizard.js`, returning `{ ok: true, chatId, ownerId }` or `{ ok: false, reason: 'empty-token' | 'no-message-yet' }` - no network/disk access beyond what's already injected
- [ ] 1.2 Refactor `runFirstRunWizard` to call `attemptOnboarding` internally, preserving its exact existing prompts, error messages, and return shape
- [ ] 1.3 Regression tests for `attemptOnboarding`: empty token, no message received, successful detection - and confirm all existing `wizard.test.js` tests still pass unchanged
- [ ] 1.4 Add a line-based stdin reader (`node:readline` async iterator, resolves on first line) and a new `onboard` subcommand in `bin/bridge.js` that reads the token this way, calls `attemptOnboarding`, and prints the JSON result
- [ ] 1.5 Manual verification: `echo "faketoken" | node bin/bridge.js onboard` (or platform equivalent) prints valid JSON with `ok: false, reason: 'no-message-yet'` (assuming no real message pending for that fake token) without hanging

## 2. Desktop app: onboarding view + guarded start

- [ ] 2.1 Verify (compile a scratch Tauri project first, matching Phase 1's rigor) the spawn-then-write-stdin-then-collect-stdout pattern for a one-shot subcommand call, since `.output()` doesn't support providing input
- [ ] 2.2 Implement `complete_onboarding(token)` Rust command using the verified pattern, spawning `bridge onboard --json` and writing `token + "\n"` to its stdin
- [ ] 2.3 Add a startup/tray guard: read `status --json`'s `configured` field before ever spawning `start` (both in `.setup()` and the tray's "Iniciar" handler) - refuse (no-op or surface to the view) instead of spawning when unconfigured
- [ ] 2.4 Build the onboarding view (BotFather button via `tauri-plugin-opener`, token field, "Verificar" button, error display) and the startup logic that picks onboarding vs. status based on the initial `status --json` check
- [ ] 2.5 Wire successful onboarding to transition into the existing status view and only then spawn `start`

## 3. Manual end-to-end verification

- [ ] 3.1 Fresh/reset config (temporarily move `~/.claude-telegram-bridge` aside): launch the app, confirm the onboarding view appears, not status
- [ ] 3.2 Click "Abrir @BotFather", confirm it opens outside the app's own window
- [ ] 3.3 Paste a real token, click "Verificar" before sending any Telegram message, confirm the clear "no message yet" error and that the token is still in the field
- [ ] 3.4 Send a message to the bot, click "Verificar" again, confirm it switches to the status view showing the newly-connected chat
- [ ] 3.5 Confirm `bridge start` was never invoked before that point (no hung sidecar process visible in Task Manager while onboarding was showing)
- [ ] 3.6 Restore the original `~/.claude-telegram-bridge` afterward
