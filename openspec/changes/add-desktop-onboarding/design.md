## Context

See proposal.md - Why. Builds directly on `openspec/changes/add-desktop-shell/`, whose design already confirmed `src/wizard.js`'s `runFirstRunWizard` is dependency-injected (a promising sign for reuse) but didn't yet build the GUI-driven flow itself — that was explicitly deferred as "phase 2."

Confirmed directly while designing this phase (reading `tauri-plugin-shell`'s actual source, `src/index.crates.io.../tauri-plugin-shell-2.3.5/src/process/mod.rs`):
- `CommandChild::write(&mut self, buf: &[u8])` exists and can send bytes to a spawned sidecar's stdin.
- There is **no** way to close only the child's stdin while keeping the process alive to read its stdout — `CommandChild` exposes only `write`, `kill`, `pid`, `code`, `success`. `Command::output()` doesn't accept input either.
- Consequence: the bridge-side `onboard` subcommand cannot use `bin/bridge.js`'s existing `readStdin()` (which awaits full stream close) — it must instead read a single **line** (resolves on `\n`, no stream closure needed), which `child.write(token + "\n")` satisfies cleanly.

## Goals / Non-Goals

**Goals:**
- A first-run experience for the desktop distribution that never requires a terminal.
- Zero behavior change to the terminal wizard (`claude-telegram-bridge start`, unconfigured) — same prompts, same error messages, same flow.
- The bot token never appears as a CLI argument (avoiding process-listing exposure) — passed via a single stdin line instead.
- Guard every path that could invoke `bridge start` (app startup, tray "Iniciar", and — once built — the webview's own start button) against doing so while unconfigured, since that would hang forever on a `readline` prompt with no attached terminal.

**Non-Goals:**
- On/off toggle and granularity settings from the UI — phase 3.
- Invite generation/management from the UI — phase 4.
- Automating the @BotFather conversation itself — confirmed not feasible (see `add-desktop-shell`'s design.md Context), permanently out of scope.
- A dedicated "onboarding succeeded" screen — the status view itself, showing the newly-connected chat, already confirms success.

## Decisions

1. **Extract `attemptOnboarding(token, deps)` out of `runFirstRunWizard`, rather than writing a second, parallel implementation.** The terminal wizard and the GUI path need the exact same core logic (validate token, check for a message, register + save) with two different "how do we get the token and tell the user to check Telegram" front-ends. Sharing the core avoids the two paths silently drifting apart, and the terminal wizard's own tests continue to pass unchanged since its observable behavior doesn't move.

2. **The `onboard` subcommand reads the token as a single stdin line (via `node:readline`'s async iterator, which resolves on the first `\n`), not via `bin/bridge.js`'s existing full-stream `readStdin()`.** Confirmed (Context above) that the Rust side cannot cleanly close only stdin while keeping the sidecar alive to capture output — a line-based read sidesteps that entirely, since `child.write(token + "\n")` naturally terminates the read without needing to close anything.

3. **The token is passed via stdin, not as a CLI argument.** A CLI argument would appear (however briefly) in that process's command-line as seen by Task Manager/`ps` on the same machine. This is a narrower, lower-severity concern than the shell-injection risk fixed in `add-session-fork-safety` (that one involved *remote, attacker-controlled* text; this is the user's own already-known secret, exposed at most for the duration of one short-lived local subprocess) — but avoiding it costs nothing once the line-based stdin read (Decision 2) is in place anyway.

4. **Both app startup and the tray's "Iniciar" call a guard that checks `status --json`'s `configured` field before invoking `bridge start`.** Without this, either path would spawn a sidecar that hangs indefinitely on a `readline` prompt no terminal will ever answer, since the desktop app provides no TTY.

5. **No separate "onboarding succeeded" view.** Once `complete_onboarding` reports success, the same window simply re-renders using the existing (Phase 1) status logic, which already shows the newly-registered chat — building a distinct transient screen for this would duplicate what the status view already communicates.

## Risks

- **`onboard` is called twice concurrently (e.g., a very fast double-click on "Verificar")** → out of scope for this phase's concurrency guarantees, matching the base project's existing acceptance of low-probability races at this event rate; each attempt is independent and idempotent from the config's perspective (only a successful one ever writes to disk).
- **The Rust-side stdin-write-then-collect-stdout pattern is new to this codebase** (Phase 1 only ever used `.output()`, which doesn't need manual stdin handling) → will be compiled and verified against the real, installed toolchain before being written into the implementation plan, matching the rigor `add-desktop-shell` already established.

## Migration Plan

Additive on top of `add-desktop-shell`. No existing behavior changes for the CLI distribution, and no changes for desktop app users who are already configured (their app already skips onboarding, since `status --json` already reports `configured: true`).
