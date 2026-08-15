## Context

See proposal.md - Why. Builds on `add-desktop-shell` (sidecar lifecycle, status polling) and `add-desktop-onboarding` (the pattern of a bridge-side subcommand backing a Tauri command, and the fact that the running `start` sidecar only ever reads `config.json` once, at launch - already the reason `spawn_sidecar` had to check `configured` before starting).

Also directly relevant: during this session, a real bug was found and fixed (`add-desktop-onboarding`'s hook-duplication fix) where installing hooks for the same owner via two different binaries created two independent entries instead of one being replaced. That fix (owner-based, not command-based, matching in `installer.js`) is unrelated to this phase's own work but is why hook installation is now safe to call repeatedly through either distribution without accumulating duplicates - relevant background, not a dependency of this phase's own changes.

## Goals / Non-Goals

**Goals:**
- Toggle on/off and notification granularity from the status view, with no separate settings screen.
- The change takes effect immediately - never requiring the user to notice and manually restart.

**Non-Goals:**
- Invite generation/management from the UI - phase 4.
- Any new settings beyond the two the CLI/Telegram paths already expose (`enabled`, `granularity`) - no new configuration surface introduced by this phase.

## Decisions

1. **Restart the sidecar (stop + start) after any settings change, rather than teaching the running polling loop to reload `config.json` mid-flight.** The alternative - making `runPollingLoop` re-read config on some interval or signal - would be a materially larger, more invasive change to core bridge logic shared with the CLI distribution, for a benefit (avoiding a sub-second connection blip) not worth that risk. Restart reuses `spawn_sidecar`/`kill_sidecar`, already built and exercised in `add-desktop-shell`/`add-desktop-onboarding`.

2. **A new `settings` subcommand, not a direct Rust-side edit of `config.json`.** Matches the same reasoning as `add-desktop-shell` Decision 5 (`status`) and `add-desktop-onboarding` Decision 2 (`onboard`): keep the config file's shape/validation logic (`validateConfig` in `src/config.js`) in the one place that already owns and tests it, rather than duplicating that knowledge in Rust.

3. **`applySettingsUpdate` is a pure function taking a config object and returning an updated one, not a function that loads/saves itself.** Mirrors `attemptOnboarding`'s shape from `add-desktop-onboarding` - easy to unit test without touching disk, with the subcommand wrapper (`cmdSettings`) doing the load/save I/O.

## Risks

- **A settings change is submitted while the sidecar is already mid-restart from a previous change** → out of scope for this phase's concurrency guarantees, matching the project's existing acceptance of low-probability races at this event rate (same class of risk already accepted for rapid-fire onboarding clicks in `add-desktop-onboarding`).
- **The brief restart drops an in-flight long-poll** → acceptable; Telegram's long-polling reconnects on the next `getUpdates` call same as any other restart (e.g. the existing tray "Parar"/"Iniciar" already does this).

## Migration Plan

Additive on top of `add-desktop-shell`/`add-desktop-onboarding`. No behavior change for the CLI distribution or for `/on`/`/off`/hand-edited config - `settings --json` is a new, independent way to reach the same two fields.
