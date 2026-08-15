## Why

Phases 1-3 (`add-desktop-shell`, `add-desktop-onboarding`, `add-desktop-settings`) let the desktop distribution be installed, configured, monitored, and adjusted entirely without a terminal. The one remaining CLI-only action is inviting another person to share the bridge (`claude-telegram-bridge invite --for-account <label>`), part of the multi-owner sharing feature from the original `add-telegram-bridge` design (each invited person's messages stay strictly isolated to their own Claude Code sessions). Phase 4 closes this last gap: generating and reviewing invites from the status view.

## What Changes

- A new `listInvites(config)` function in `src/registration.js`: turns `config.invites` into an array of `{code, ownerLabel, consumed, createdAt, redeemedChatId}` - `redeemedChatId` is only resolved for labeled, already-consumed invites (looked up via the existing `chatIdForOwner`); unlabeled invites just report consumed/not, without attempting to reverse-engineer which chat used them.
- The existing `invite` subcommand gains `--json` and `--list` flags. With neither flag, its behavior is byte-for-byte unchanged (prints the code and instructions as plain text). `--json` returns machine-readable output instead of text; `--list --json` returns the full invite list instead of creating a new one.
- Two new Tauri commands: `create_invite(label)` and `list_invites()`, both one-shot calls to the sidecar (the same `.output()` pattern already used by `get_status`/`update_settings` - no new Rust risk there).
- A new `tauri-plugin-clipboard-manager` dependency, backing a real "Copiar" button next to a freshly generated code - confirmed to need an explicit capability grant (`clipboard-manager:allow-write-text`), unlike `opener`/`shell` which came enabled by default.
- The status view gains a collapsible "Convidar alguém" section: an optional label field, a "Gerar convite" button, the generated code with its Copy button, and a list of previously created invites with their status.

## Capabilities

### Modified Capabilities
- `desktop-shell` (from `add-desktop-shell`/`add-desktop-onboarding`/`add-desktop-settings`): adds the invite section, its two backing commands, and the clipboard plugin.

### New Capabilities
_None._

## Impact

- No behavior change to the CLI's `invite` subcommand when called without `--json`/`--list` - purely additive flags.
- No behavior change to invite redemption (`/register <code>` from Telegram) - this phase only adds ways to *create* and *view* invites, never changes how they're consumed.
- New Rust dependency: `tauri-plugin-clipboard-manager` (confirmed to exist and compile against the project's current Tauri version before this spec was written).
