## Why

Phases 1-2 (`add-desktop-shell`, `add-desktop-onboarding`) let a user install, monitor, and first-configure the bridge entirely through the desktop app. The remaining everyday setting a user might want to change - on/off, and notification granularity - still requires either the Telegram `/on`/`/off` commands or hand-editing `config.json`. Phase 3 closes that gap: both become toggleable directly in the status view.

## What Changes

- A new `bridge settings --json [--set-enabled true|false] [--set-granularity default|verbose]` subcommand: with no flags, reports the current `enabled`/`granularity`; with either flag, applies it and saves. Built on a new pure `applySettingsUpdate` function in `src/config.js`.
- `status --json` (and therefore `get_status`) now also reports `granularity`, alongside the `enabled` it already reports.
- A new `update_settings` Tauri command: runs `bridge settings --json` with whichever flags changed, then **restarts the sidecar** (stop + start) so the change takes effect immediately - the running `start` process only ever reads its config once at launch, the same reason `spawn_sidecar` already had to guard against running while unconfigured (see `add-desktop-onboarding` design.md).
- The status view gains an on/off toggle and a granularity selector (default/verbose), directly below the existing status line - no separate settings screen.

## Capabilities

### Modified Capabilities
- `desktop-shell` (from `add-desktop-shell`/`add-desktop-onboarding`): adds settings read/write, the restart-on-change behavior, and the status view's toggle/selector.

### New Capabilities
_None._

## Impact

- No change to how `/on`/`/off` or hand-edited `config.json` behave - `settings --json` is an additional way to reach the same two fields, sharing the same `saveConfig`/validation path.
- Toggling either setting from the desktop app causes a brief (well under a second, matching existing sidecar restart timing already exercised in `add-desktop-onboarding`) interruption of the long-polling connection while the sidecar restarts.
