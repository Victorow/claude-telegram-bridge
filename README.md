# claude-telegram-bridge

Get notified on your phone when a [Claude Code](https://claude.com/claude-code) session finishes or needs you — and reply from Telegram to continue it. Free, self-hosted, no public server required.

- **Free and official**: uses your own Telegram bot (via [@BotFather](https://t.me/BotFather)), not an unofficial WhatsApp client — no ToS/ban risk.
- **No public endpoint needed**: long-polling only. Works from behind a home router with nothing exposed.
- **A single on/off switch**: toggle from local config or straight from the chat (`/on`, `/off`).
- **Multiple projects, one chat**: reply to a project's last message to continue that exact one, or use `label: your message` to target a project directly.
- **Multiple people, one bridge**: invite others with a one-time code; everyone only ever sees their own sessions.

## Quick start (≤2 clicks)

1. Download the binary for your OS from [Releases](../../releases) and run it: `claude-telegram-bridge start` (or double-click the `.exe` on Windows).
2. On first run it asks for a bot token, then waits for you to send it any message on Telegram — that's it. It auto-detects your chat, wires the Claude Code hooks it needs, and registers itself to start at login.

### Getting a bot token (one-time, before step 1)

1. Open Telegram, search for **@BotFather**, send `/newbot`.
2. Pick a name and a username for your bot (must end in `bot`).
3. BotFather replies with a token that looks like `123456789:AAExampleTokenTextGoesHere`. Copy it — that's what the wizard asks for.

## Everyday use

- When a Claude Code session finishes or needs your attention, you get a Telegram message. If a project's label isn't obvious, the message is prefixed with it, e.g. `[my-project] ...`.
- **Reply** to that message to continue that exact session — no need to type anything else first.
- Starting a new thread with no reply targets your most recently active session by default, or a specific one with `label: your message`.
- `/off` disables everything (no messages sent, no messages processed) until you send `/on` — this works even while disabled, so you're never locked out.
- **If the session you're replying to might still be open** in a terminal or IDE, the first reply forks it into a separate continuation instead of writing into that same open session (which Claude Code doesn't support safely). You'll get a one-time notice with the forked session's id and a way to reopen it later from your PC — after that, replying keeps extending that same fork, and the original stays completely untouched.

## Inviting someone else

```
claude-telegram-bridge invite --for-account amigo
```

Send the printed code to them. They message your bot with `/register <code>` from their own Telegram account — that's their whole setup. From then on, their messages only ever reach their own Claude Code sessions, never yours, even if you're both running on the same computer.

## Multiple accounts / advanced install

The quick start wires hooks into your default Claude Code account (`~/.claude`, or `CLAUDE_CONFIG_DIR` if you use that). For an additional account (yours or an invited owner's):

```
claude-telegram-bridge install --owner amigo --settings-path /path/to/that/account/.claude/settings.json
```

To remove hooks for an account:

```
claude-telegram-bridge uninstall --owner amigo --settings-path /path/to/that/account/.claude/settings.json
```

This never touches any other hook already configured for that account.

## Running from source (fallback for unsupported platforms/architectures)

If there's no pre-built binary for your OS/CPU, or you'd rather not run a downloaded executable:

```
git clone <this-repo>
cd claude-telegram-bridge
npm ci
npm start          # same as: node bin/bridge.js start
```

Everything else (config, hooks, invites) works identically — the packaged binary is the same source, just bundled with the Node runtime embedded so you don't need Node installed separately.

## Security notes

- The bridge's config (bot token, registered owners) lives at `~/.claude-telegram-bridge/config.json` (override with `BRIDGE_CONFIG_DIR`) and is never committed to git — check `.gitignore` if you fork this.
- **If your bot token leaks**, anyone with it can message your bot, but they still can't act as an authorized sender unless their chat is already registered — rotate the token via @BotFather regardless, out of caution.
- **Invite codes are single-use**: once redeemed, an intercepted code is worthless. Still, share them over a reasonably private channel.
- Every hook script fails open: if something goes wrong internally, it's logged to `bridge.log` in the same config directory and the Claude Code turn it's attached to is never blocked or altered.
- The bot token is never included in any log message or error text raised by this bridge's own code. As a residual, low-probability risk: a lower-level network failure from Node's `fetch` could theoretically surface a URL in its error details on some platforms — this isn't specifically guarded against yet.

## Development

```
npm ci
npm test          # tests use Node's built-in test runner
npm run build:sea # builds a self-contained binary for your current OS into dist/
```

No test ever touches your real `~/.claude` or Telegram — everything is dependency-injected against temp directories and mocked `fetch`.

## How it works (short version)

- **Output**: Claude Code's own `Stop`/`Notification` hooks call this bridge, which relays the message via the Telegram Bot API.
- **Input**: an incoming Telegram message resumes the right session headlessly (`claude --resume <id> -p "<text>"`); the resulting reply flows back through the same `Stop` hook path, not a second direct message. The first reply to a session that might still be open interactively forks it (`--fork-session`) instead of resuming in place, so it's never writing into a transcript another process might also be writing to; later replies extend that same fork directly.
- **Isolation**: every session is tagged with an owner at install time; routing (reply, prefix, or most-recent) only ever considers sessions owned by whoever sent the message.

Full design rationale and the complete spec live in `openspec/changes/add-telegram-bridge/` (the original design) and `openspec/changes/add-session-fork-safety/` (the forking behavior above).
