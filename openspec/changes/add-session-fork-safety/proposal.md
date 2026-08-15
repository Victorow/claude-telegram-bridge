## Why

Replying from Telegram resumes the target session headlessly (`claude --resume <id> -p "<text>"`), writing new turns into that session's on-disk transcript. If the session's originating interactive process (an IDE window or terminal) is still open at the same time, that process may also be writing to the exact same transcript file concurrently. This is not a hypothetical: Claude Code's own GitHub issues (#20992, #26964) document interleaved/truncated JSONL writes and cross-session contamination when the same session id is resumed concurrently from more than one process. The bridge today has no guard against this at all — confirmed by reproducing the exact scenario (an IDE session left open, replied to via Telegram) during manual testing.

## What Changes

- `input-relay` forks instead of resuming in place, the first time a Telegram reply targets a session that originated from a real interactive process (`claude --resume <id> --fork-session -p "<text>" --output-format json`). This creates a brand-new session id with its own transcript file, decoupled from whatever the original process might still be writing — eliminating the corruption risk entirely, for every case, without needing to know whether the original process is actually still open.
- Every subsequent Telegram reply on that conversation resumes the resulting fork directly (no repeated forking) — once a session is Telegram-forked, nothing else concurrently writes its transcript, so resuming it in place is exactly as safe as today's behavior.
- `session-registry` tracks each session's origin (`interactive` vs `telegram-fork`) and, on an interactive session, which fork (if any) has since taken over — so a reply to a notification sent *before* the fork existed still redirects to the current fork instead of re-forking the original again.
- `output-relay` disambiguates notifications with an origin suffix (e.g. "· IDE" / "· Telegram") only once both an interactive-origin session and its fork are simultaneously registered for the same owner and label — unchanged otherwise.
- The bridge sends one explicit Telegram message the moment a fork is created, so it is never silent or surprising.

## Capabilities

### Modified Capabilities
- `session-registry`: origin tracking (`interactive` / `telegram-fork`) and fork-chain redirection during target resolution
- `input-relay`: fork-vs-resume decision, capturing the new session id, registering the fork, sending the fork announcement
- `output-relay`: origin-aware label disambiguation when a session and its fork coexist

### New Capabilities
_None — this extends existing capabilities from `add-telegram-bridge`._

## Impact

- Depends on the `claude` CLI's `--fork-session` and `--output-format json` flags — confirmed present in the currently installed CLI version via `claude --help` and a live test run; no new package dependency.
- A session that has never been replied to via Telegram behaves exactly as it does today.
- Once a session is forked, the IDE/terminal conversation and the Telegram conversation become two distinct, independently resumable sessions rather than one shared (and unsafely shared, at that) line — trading an unsafe illusion of continuity for an honest, safe pair of continuities. The fork itself never appears in the `/resume` picker (confirmed: Claude Code documents that sessions created in headless/print mode, which forking uses, don't get the metadata record the picker needs) but remains fully resumable from the PC by its exact id via `claude --resume <id>` — which is why the fork announcement includes that id directly.
