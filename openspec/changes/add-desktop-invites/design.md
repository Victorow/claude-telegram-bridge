## Context

See proposal.md - Why. Builds on `add-desktop-shell` (sidecar lifecycle), `add-desktop-onboarding`/`add-desktop-settings` (the established pattern: a bridge-side subcommand backing a one-shot Rust `.output()` call, additive CLI flags that preserve existing behavior when omitted).

Confirmed directly while designing this phase (`cargo add`/`cargo check` against a scratch project, matching the rigor already established in prior phases):
- `tauri-plugin-clipboard-manager` v2.3.2 exists, compiles against this project's Tauri version, and exposes `write_text(text: &str, label: Option<String>)` as `plugin:clipboard-manager|write_text`.
- Unlike `tauri-plugin-opener` (which ships `allow-open` enabled by default), `clipboard-manager`'s default permission set is empty - "the clipboard can be inherently dangerous... interaction needs to be explicitly enabled" per the plugin's own docs. `clipboard-manager:allow-write-text` must be added to `capabilities/default.json` explicitly.

## Goals / Non-Goals

**Goals:**
- Generate an invite (with an optional label) and copy it to the clipboard, from the status view.
- Review previously created invites (code, label, consumed/not, created date) in the same place.
- Zero behavior change to the CLI `invite` subcommand or to invite redemption itself.

**Non-Goals:**
- Revoking/deleting an unconsumed invite - not part of the CLI today either; out of scope for parity.
- Resolving which chat redeemed an *unlabeled* invite - a real but rare edge case (the project's own documented usage always passes `--for-account`); shown simply as "consumed" rather than adding lookup logic for a case that likely doesn't occur in practice.
- Any change to how `/register <code>` works from Telegram - this phase only adds ways to create/view invites.

## Decisions

1. **`listInvites` only resolves `redeemedChatId` for labeled invites, via the existing `chatIdForOwner`.** An invite's `ownerLabel` *is* the resulting owner id once redeemed (see `redeemInvite` in `src/registration.js`), so `chatIdForOwner(config, ownerLabel)` finds the chat directly. An unlabeled invite's owner id is derived at redemption time as `owner-<chatId>` - reverse-parsing that pattern to find the chat id would work but adds real complexity for a shape of invite the project's own README never actually demonstrates (`--for-account <label>` is the only documented usage).

2. **`invite --json`/`--list` are additive flags on the existing subcommand, not a new one.** Mirrors `add-desktop-settings`'s own `settings` subcommand precedent: keep one command per underlying concept, gate machine-readable/list behavior behind flags, so the CLI's plain-text default path is untouched and needs no new tests for its existing behavior.

3. **`create_invite`/`list_invites` use `.output()`, not the stdin-write pattern from `add-desktop-onboarding`.** Neither needs to send a secret to the sidecar (the label is safe to pass as a CLI argument - unlike a bot token, it's not sensitive, and it's the same argument shape the CLI's own `--for-account` already uses). The simpler one-shot pattern already proven in `get_status`/`update_settings` applies directly.

4. **The clipboard plugin's permission is granted narrowly (`allow-write-text` only), not `clipboard-manager:default`.** The app never needs to *read* the clipboard or write images/HTML - granting only what's used matches the plugin's own "explicitly enabled" philosophy instead of taking the broadest available permission set out of convenience.

## Risks

- **Clipboard write fails (e.g., another app holding a clipboard lock, uncommon but real on Windows)** → the Copy button's own error should surface to the user (visible failure) rather than silently doing nothing - same principle already applied in `add-desktop-onboarding`'s error-handling fix.
- **Generating many invites over time with no revoke/cleanup mechanism** → matches the CLI's own existing behavior (invites already accumulate in `config.json` with no expiry); not a new risk introduced by this phase.

## Migration Plan

Additive on top of `add-desktop-shell`/`add-desktop-onboarding`/`add-desktop-settings`. No behavior change for the CLI distribution, `/register`, or existing invites already in `config.json` - `listInvites` reads the exact same `config.invites` shape that already exists.
