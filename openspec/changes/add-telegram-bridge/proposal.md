## Why

Claude Code sessions run unattended on a PC while the user is away from the keyboard. There is no free, safe way today to (a) get notified on a phone when a session finishes and is waiting, or (b) reply from the phone and have that reply become the next instruction in that session. A Telegram bot gives this for free, with no ToS/ban risk (unlike an unofficial WhatsApp client) and no public webhook infrastructure (long polling).

## What Changes

- New standalone project (`claude-telegram-bridge`), independent of any single Claude Code project, installable on any machine.
- A background Node.js service that:
  - Connects to a private Telegram bot via long polling (no public endpoint required).
  - Exposes a single boolean (`enabled`) that turns the whole integration on/off without uninstalling anything, toggleable both from a local config file and from `/on`/`/off` commands sent by the allowlisted chat itself.
  - Listens for Claude Code hook events (`Stop`, `Notification`) forwarded from every linked account/project on the machine, and relays them to Telegram. Notification granularity (only "waiting for you" vs. every intermediate step) is user-configurable.
  - Listens for incoming Telegram messages and turns them into the next turn of a Claude Code session via headless `claude --resume <session-id> -p "<text>"`, then relays the reply back — no PTY/keystroke injection, no live-terminal hacking.
  - Supports multiple Claude accounts/projects running concurrently on the same machine: defaults to the most recently active session, with an optional short prefix (e.g. `proj1: ...`) to target a different one.
  - Only accepts commands from a registered Telegram chat ID; every other sender is ignored.
  - Supports more than one registered person sharing the same bridge: the operator generates a one-time invite code, a new person sends `/register <code>` from their own Telegram to join, and from then on every session is scoped to the owner it belongs to — one owner's messages can never resolve to another owner's Claude Code session, even if both owners' accounts happen to run on the same physical machine.
- A single downloadable, self-contained installer per OS (no separate Node.js install required) that, in at most two user interactions (run it, then confirm/enter the bot token once), wires the required hook block into a Claude Code account's `settings.json` (repeatable per account, non-destructive to existing hooks) and registers the service to run at login (Windows/macOS/Linux).

## Capabilities

### New Capabilities
- `telegram-gateway`: Telegram bot connectivity (long polling), registered-sender authorization, and the on/off boolean that gates all traffic in both directions.
- `user-registration`: One-time invite codes and the `/register` flow that let more than one person share a single bridge, each mapped to their own owner identity.
- `session-registry`: Tracks Claude Code sessions active on the machine (session id, cwd, account label, owner, last-active timestamp) so the bridge knows which session a Telegram message should reach, scoped to the sender's owner.
- `output-relay`: Consumes Claude Code `Stop`/`Notification` hook events and turns them into an outbound Telegram message, respecting the configured notification granularity and the enabled flag.
- `input-relay`: Resolves an inbound Telegram message to a target session (most-recent by default, prefix override otherwise) and continues that session headlessly, returning the result.
- `installer`: Cross-platform setup/uninstall for the hook wiring (per Claude account) and the background service (per machine).

### Modified Capabilities
_None — this is a new, standalone project with no pre-existing specs._

## Impact

- New repository, no changes to `link-your-biz` or any other existing project.
- Touches each linked machine's Claude Code account config (`~/.claude/settings.json` or the account's `CLAUDE_CONFIG_DIR`) to add hook entries — additive only, never overwrites unrelated hooks.
- Introduces a new always-on local process per machine (the bridge) and a new external dependency (a Telegram bot token, stored locally as a secret, never committed).
- Two or more registered owners can share one bridge and, if they choose, the same physical machine — each owner is tied to specific Claude Code account(s), never to "whichever session answers first."
- No changes to any Claude Code session's behavior beyond the additional hook calls and the ability to be resumed headlessly.
