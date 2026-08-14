## 1. Project setup

- [x] 1.1 Initialize the Node.js project (package.json, `"type": "module"`, minimum Node version matching engines), no framework dependencies
- [x] 1.2 Add `.gitignore` covering local secrets/config (bot token, chat allowlist, session registry file) and `node_modules`
- [x] 1.3 Create the local config file format (e.g. `config.local.json` or `.env`) holding: bot token, registered owners (chat id → owner id), `enabled` boolean, notification granularity
- [x] 1.4 Add a config loader with runtime validation (fail fast with a clear error if required fields are missing/malformed)

## 2. Telegram gateway

- [x] 2.1 Implement a minimal `getUpdates` long-polling loop over `fetch` (no SDK dependency)
- [x] 2.2 Implement outbound `sendMessage` call
- [x] 2.3 Enforce the chat-id allowlist on every inbound update before it reaches any other component
- [x] 2.4 Enforce the `enabled` boolean on both inbound and outbound paths (except `/on`, which must work while disabled — see spec fix)
- [x] 2.5 Implement `/on` and `/off` command handling (allowlisted senders only) that flips `enabled` and sends an acknowledgement reply (ack sending wired in `bridge.js`, tasks 2.6/2.7 test the decision logic; the reply itself is exercised end-to-end in Fase 6)
- [x] 2.6 Add contract test: unauthorized chat ID is dropped silently and never reaches routing logic, including `/on`/`/off`
- [x] 2.7 Add contract test: toggling `enabled` to false (via config or `/off`) stops outbound sends and inbound processing; `/on` resumes both without a restart

## 3. Session registry

- [x] 3.1 Define the registry file schema (session id, cwd, account label, owner, last-active timestamp) plus a bounded outbound-message-tracking table (Telegram message id → session id, pruned to a recent window)
- [x] 3.2 Implement per-session-id keyed read/update so concurrent writers from different accounts don't clobber unrelated entries
- [x] 3.3 Implement "resolve target session" logic scoped to the requesting owner first, then in order: reply-based match (via the outbound-message-tracking table) → `<label>: ` prefix override → most-recent default; unmatched prefix replies with that owner's own known labels (prefix parsing only kicks in with 2+ sessions, so a single-session owner's message is never misread as a failed label match)
- [x] 3.4 Add regression tests for: single session, multiple sessions no prefix, matching prefix, non-matching prefix, reply matches a tracked message, reply to an untracked/pruned message falls back to prefix/most-recent, reply to a message belonging to another owner falls back instead of leaking, two owners on the same machine (owner A's prefix never resolves to owner B's session, and owner A's default-most-recent ignores owner B's more recent activity)

## 4. Output relay

- [x] 4.1 Implement the hook-invoked handler (originally a standalone `bin/hook.js`, later consolidated into `bin/bridge.js hook` — see Fase 9 packaging note) that reads the Claude Code hook JSON payload from stdin; `owner` arrives as a CLI arg baked in by the installer (fixed per account), while `label` defaults to `path.basename(cwd)` computed live per session (so one account's install covers every project it opens, each with its own label) and accepts an optional `--label` override
- [x] 4.2 On `Stop` events: use the payload's `last_assistant_message` field directly (confirmed via official docs to be preferred over parsing `transcript_path`, which is written asynchronously) and send it via the gateway
- [x] 4.3 On `Notification` events: send `notification_message` via the gateway, filtered by `notification_type` per the granularity tier (see 4.4)
- [x] 4.4 Implement the configurable granularity switch: `Notification` is wired with a broad matcher and filtered in-code by `notification_type` against a default vs. verbose type set, so toggling `granularity` in config takes effect immediately without reinstalling hooks. **Scope note:** no additional hook event type (e.g. `PostToolUse`) is wired in this version, so "verbose" currently only widens which `Notification` sub-types relay — it does not yet add intermediate tool-use output. Flagged as a scope boundary, not silently expanded or hidden.
- [x] 4.5 Make the hook script fail open: any internal error is logged locally (`log.js` → `bridge.log`) and the process always exits 0, never exit code 2 (which would tell Claude Code not to stop)
- [x] 4.6 Prefix the outbound message with the session's label whenever its owner has more than one registered session
- [x] 4.7 Record every sent message's Telegram message id against its session id in the outbound-message-tracking table
- [x] 4.8 Add regression test: hook event received while `enabled` is false produces no outbound message (session is still tracked)
- [x] 4.9 Add regression test: owner with two sessions gets labeled messages; owner with one session does not require a label

## 5. Installer (ships with the first usable slice: gateway + registry + output-relay)

- [x] 5.1 Write the hook-block JSON fragment this bridge needs (`Stop`, `Notification`) — `src/installer.js` `buildHookEntry`
- [x] 5.2 Implement idempotent merge into a target `settings.json` (add missing entries, never remove/duplicate existing unrelated ones) — `mergeHooksIntoSettings`/`removeHooksFromSettings`
- [x] 5.3 Implement the first-run setup wizard (`src/wizard.js`): prompts once for the bot token, then waits for one message from the operator to auto-detect their chat id (no need to know/paste a numeric Telegram id) — ≤2 interactions total, skips entirely when config already exists
- [x] 5.4 Auto-detect/wire the default Claude Code account (`~/.claude`, or `CLAUDE_CONFIG_DIR` if set) automatically on every `bridge start` (`ensureAccountInstalled` in `bin/bridge.js`) — idempotent, also self-heals if hooks were removed by hand
- [x] 5.5 Implement `bridge install [--owner <id>] [--settings-path <path>]` as the explicit/advanced path for additional accounts
- [x] 5.6 Implement `bridge uninstall [--owner <id>] [--settings-path <path>]` that removes exactly the entries this installer added
- [x] 5.7 Implement background service registration for Windows (schtasks), macOS (launchd plist), and Linux (systemd user unit) in `src/service.js`, triggered once right after the first-run wizard completes (not on every subsequent manual `start`); `bridge start` itself is the "run in foreground" mode
- [x] 5.8 Add regression tests: fresh settings.json, settings.json with pre-existing unrelated hooks, running installer twice, uninstall, wizard skips re-prompting when config already exists — `test/installer.test.js`, `test/wizard.test.js`, `test/service.test.js`
- [x] 5.9 *(added while implementing)* CLI entry point `bin/bridge.js` wiring `start`/`install`/`uninstall`/`invite` together — smoke-tested manually against a temp settings dir (never the real `~/.claude`)
- [x] 5.10 *(added while implementing, ahead of Fase 9)* Consolidated the standalone `bin/hook.js` into a `hook` subcommand of `bin/bridge.js`: a Node SEA binary can only embed one main script, so the hook handler and the CLI needed to live in the same entry point before packaging — see design.md Decision 20

## 6. End-to-end validation of the read-only slice

- [ ] 6.1 Manually verify: a real Claude Code turn ending produces a Telegram message
- [ ] 6.2 Manually verify: a permission-needed Notification produces a Telegram message
- [ ] 6.3 Manually verify: disabling the integration stops messages; re-enabling resumes them

## 7. Input relay

- [x] 7.1 On inbound Telegram message (post-allowlist, post-enabled check), resolve target session via the registry (reply-match → prefix → most-recent)
- [x] 7.2 Invoke Claude Code headlessly (`claude --resume <session-id> -p "<text>"`) in the resolved cwd
- [x] 7.3 On success (the headless turn's own `Stop` hook fires), send nothing directly — rely entirely on `output-relay` for delivery
- [x] 7.4 On failure (non-zero exit, crash, or timeout before a `Stop` hook could fire), send a direct error message to the originating chat
- [x] 7.5 Handle "no sessions registered" by replying with a clear message instead of attempting a call
- [x] 7.6 Add regression tests: message resolves to a known session, message resolves to none, headless call failure surfaces an error message instead of hanging, **a successful headless turn produces exactly one Telegram message, not two**

## 8. User registration & ownership isolation

- [x] 8.1 Auto-register the operator's own chat as an owner at the end of the first-run wizard (no `/register` needed for the operator) — `src/wizard.js` calls `registerOwner` directly
- [x] 8.2 Implement invite-code generation (`bridge invite [--for-account <label>]`): random single-use code, not yet consumed — `src/registration.js` `createInvite`
- [x] 8.3 Implement `/register <code>` handling: validate code exists and is unconsumed, register the sending chat as a new owner, mark the code consumed; reply clearly on invalid/already-used codes — `redeemInvite` + wired in `telegram-gateway`'s `onRegister` dispatch (`bin/bridge.js`)
- [x] 8.4 Extend the installer so installing a second (or later) Claude Code account can be tied to a specific registered owner, not just the operator — `bridge install --owner <id> --settings-path <path>`
- [x] 8.5 Tag every hook event's registry entry with the owner configured for that account at install time, so `session-registry` can enforce scoping (task 3.3) — `--owner` baked into the hook `args` by the installer, read by `bin/hook.js`
- [x] 8.6 Regression coverage: operator auto-registered without `/register` (`registration.test.js`), valid code registers and is then rejected on reuse (`registration.test.js`), unknown code rejected (`registration.test.js`), owner scoping never crosses owners (`registry.test.js`, `inputRelay.test.js`). **Honesty note:** these are per-module tests that together cover the whole chain; there is no single test that drives register → real hook event → real Telegram message → routed reply through every module at once end-to-end.

## 9. Packaging: zero-prerequisite standalone binaries

- [x] 9.1 Build a Node.js Single Executable Application (SEA) for Windows, macOS, and Linux from the same source — `scripts/build-sea.mjs`. **Correction found while implementing:** ESM entry-point support in Node's own SEA tooling is too recent/inconsistent to rely on for a build step run on whatever Node version a contributor happens to have, so the script bundles `bin/bridge.js` + all of `src/` into one CommonJS file with esbuild (build-time-only devDependency) before handing it to `--experimental-sea-config`/`postject`. See design.md for the decision and the `import.meta.url` fix this required in `bin/bridge.js`.
- [ ] 9.2 Verify each built binary runs the full first-run wizard and starts the bridge on a clean machine with no Node.js installed. **Done for Windows only** (built and smoke-tested on this machine: `install` and `hook` subcommands run correctly from the packaged `.exe`, ~89 MB). **Not done for macOS/Linux** — this machine can't build or run those binaries; they can only be verified once the GitHub Actions workflow (9.3) actually runs on those runners. Leaving this unchecked rather than claiming untested platforms work.
- [x] 9.3 Set up a GitHub Actions workflow that builds all three binaries on each tagged release and attaches them to GitHub Releases — `.github/workflows/release.yml` (matrix build + `npm test` gate + publish job). **Not yet run** — no tag has been pushed and the repo isn't on GitHub yet.
- [x] 9.4 Document the plain npm/CLI install path as a documented fallback for advanced users or unsupported platforms/architectures — covered in README (Fase 10)

## 10. Docs and hardening pass

- [x] 10.1 Write README: download-and-run quick start (≤2 clicks), BotFather steps, `/on`/`/off`, inviting a second owner, per-account install for advanced/multi-account/multi-owner setups, uninstall
- [x] 10.2 Document the token-leak/rotation guidance and invite-code guidance from design.md's risks section
- [x] 10.3 Confirm no secret ever gets written under `openspec/` or committed to git (spot-check `.gitignore` coverage), and that the wizard never logs or echoes the token — verified by grep: no token in any `console.*`/`appendLog` call anywhere in `src/`/`bin/`; noted one residual low-probability risk (a raw `fetch` network error could theoretically include a URL) in the README rather than silently ignoring it
- [x] 10.4 Run `openspec validate --strict` on this change and fix any reported issues
