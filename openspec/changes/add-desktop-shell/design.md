## Context

See proposal.md - Why. This is phase 1 of "a desktop app with a UI, as user-friendly as possible" — explicitly scoped down to a walking skeleton (process supervision + status) so later phases (GUI onboarding, settings, invites) build on a working foundation rather than shipping all four screens unverified at once.

Confirmed while investigating the existing codebase:
- `src/wizard.js`'s `runFirstRunWizard` is already fully dependency-injected (`prompt`, `configExistsFn`, `saveConfigFn`, `getUpdatesFn`), so a future GUI-driven onboarding phase can swap `prompt` for a GUI form callback without touching wizard logic — not built in this phase, but confirms the path is open.
- `bin/bridge.js` already exposes clean, independent subcommands (`start`, `install`, `uninstall`, `invite`) that a future phase can shell out to exactly as the CLI does today.
- Telegram bot creation itself cannot be automated without the user's personal account login (confirmed: the Bot API has no "create a bot" endpoint; only a human conversation with @BotFather can do it) — permanently out of scope, not a phase-1 limitation.

## Goals / Non-Goals

**Goals:**
- A cross-platform (Windows/macOS/Linux), extremely lightweight desktop app that supervises the existing bridge binary as a sidecar — no rewrite of any bridge logic.
- A status view showing whether the bridge is running and connected, refreshed periodically.
- Start/stop control from a tray icon, and a self-registered autostart that replaces (not supplements) the existing scheduled-task mechanism for users who choose this distribution.

**Non-Goals (explicit later phases, not this one):**
- GUI-driven first-run onboarding (token entry, BotFather guidance) — phase 2.
- On/off and granularity settings from the UI — phase 3.
- Invite generation/management from the UI — phase 4.
- Automating Telegram bot creation itself — permanently out of scope (see Context).
- Code signing / notarization — matches the existing CLI binaries' current state; a possible future improvement, not required now.

## Decisions

1. **Tauri over Electron**, given the explicit "extremely lightweight" requirement: Tauri's Rust shell + OS-native webview avoids bundling a second Chromium, keeping the installed app in the tens of MB instead of 100+.

2. **The existing `build:sea` binary is bundled as a Tauri sidecar**, invoked with the same subcommands the CLI already uses (`start`, and this phase's new `status --json`) — zero changes to core bridge logic, only an additive subcommand.

3. **No frontend framework for phase 1.** A status view with a couple of buttons doesn't need one; introducing one is deferred to whichever later phase first needs real form state/reactivity (onboarding is the likely candidate).

4. **The desktop app owns its own autostart registration (of itself, not the raw bridge binary), independent of `src/service.js`.** Because it's the one responsible for spawning the sidecar as a supervised child, autostarting the raw binary separately would create two unrelated processes with no supervision relationship between them.

5. **`status --json` is a new subcommand, not a Rust-side direct read of `config.json`/`registry.json`.** Keeping the shape/parsing logic in the already-tested JS side (reusing `loadConfig`/`loadRegistry` verbatim) avoids duplicating that knowledge in Rust and keeps it covered by the existing test patterns.

6. **Running the CLI's `start` and the desktop app concurrently against the same bot token is an unsupported configuration, documented rather than technically prevented.** Detecting "another process is already long-polling this same token" reliably and cross-platform is nontrivial (Telegram has no built-in single-consumer enforcement) and out of proportion for a phase whose goal is the walking skeleton; revisit with active detection only if this proves to be a real support burden.

## Risks

- **Desktop app crashes or is force-quit without cleanly stopping the sidecar** → the sidecar is an independent OS process once spawned; if the parent dies uncleanly, the child may keep running detached. Mitigation: verified manually in phase 1 (kill the parent, confirm child state) rather than solved with process-group/job-object plumbing not yet justified at this stage — flagged as a known follow-up if it proves to be a real problem.
- **User runs both distributions against the same bot** → documented as unsupported (Decision 6); revisit with active detection only if this becomes a real support burden.
- **Unsigned installers trigger OS warnings** → matches the existing CLI binaries' current, accepted state; not solved in this phase.

## Migration Plan

Purely additive — a new `desktop/` application and one new CLI subcommand. No existing capability's behavior changes for anyone continuing to use the CLI + scheduled-task distribution.
