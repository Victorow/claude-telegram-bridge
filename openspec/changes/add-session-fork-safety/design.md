## Context

See proposal.md - Why. Builds directly on `openspec/changes/add-telegram-bridge/design.md`, which established headless resume as the only supported way to deliver Telegram input into a session (Decision 4), specifically to avoid PTY/keystroke injection. That design didn't anticipate resuming a session id that a still-open interactive process (IDE extension or terminal) might also be writing to concurrently.

Confirmed directly (official docs + GitHub issues #20992, #26964) that concurrent writers to the same session transcript can interleave/truncate the JSONL file or contaminate an unrelated session's file — a real, documented risk, not a hypothetical. Reproduced the triggering scenario manually: an interactive IDE session left open, replied to via Telegram, resuming the same session id.

Also confirmed directly (via `claude --help` and a live test run):
- `--fork-session` (used with `--resume`) creates a new session id instead of writing back into the original.
- `--output-format json` (with `--print`) returns the resulting `session_id` directly in the result payload — no need to correlate it via a later hook event.
- There is no hook or API that tells the bridge whether a session's originating interactive process is still open.

## Goals / Non-Goals

**Goals:**
- Eliminate any possibility of the bridge corrupting a session's on-disk transcript, unconditionally — not dependent on a liveness guess.
- Preserve today's single-continuation experience once a conversation has become Telegram-only (no repeated forking on every reply).
- Make forking visible: the user is told, once, when and why it happened, and given what they need (the exact session id) to resume the forked conversation from the PC afterward — the `/resume` picker won't list it (see Decision 6), so the id itself is the only way back to it.
- Leave the original interactive session's transcript completely untouched after a fork.

**Non-Goals:**
- Detecting whether the original session's interactive process is still actually running — rejected; no reliable cross-platform signal exists (Decision 1).
- Merging the two lines back into one later — once forked, they stay two independent sessions; there is no "un-fork."
- True live keystroke/PTY injection into an open interactive session — already rejected in the base design; still out of scope here.

## Decisions

1. **Always fork on the first Telegram-driven continuation of an interactive-origin session; never try to detect liveness first.** Detecting "is the original process still attached" would need a signal Claude Code doesn't expose. A false negative (assuming closed when it's still open) reintroduces the exact corruption this change exists to remove; a false positive (forking when unnecessary) only costs one extra session file and one clarifying message. That asymmetry makes always-fork the only option with a zero-corruption guarantee.

2. **Fork exactly once per interactive-origin session; every later Telegram reply resumes the resulting fork directly, without forking again.** Once a session's origin is `telegram-fork`, nothing else concurrently owns that transcript, so resuming it in place is exactly as safe as today's behavior.

3. **The new session id is read directly from `--output-format json`'s `session_id` field, not inferred from a later hook event.** Hook-correlation would have to guess which of possibly several new sessions corresponds to this particular fork — fragile under concurrent activity. Reading it from the headless call's own result is unambiguous and needs no extra round-trip.

4. **`session-registry` stores a `forkedInto` pointer on the original session's entry**, so a reply to a notification sent *before* the fork existed still resolves correctly. Reply-based resolution already finds the original session id first; following `forkedInto` if present redirects that reply to the current fork instead of re-forking the (possibly still-live) original again.

5. **Labels gain an origin suffix (`· IDE` / `· Telegram`) only once both an interactive-origin session and its fork are simultaneously registered for the same owner and label.** Before any fork exists, behavior is identical to today. This mirrors the existing `hasMultipleSessions` gating already used for label prefixing — the disambiguation appears exactly when it's needed, not before.

6. **The fork is announced with one explicit Telegram message the moment it happens**, separate from the turn's own reply, and that message includes the forked session's exact id. Silently forking would leave the user unable to tell, from the chat alone, that they're now on a different session than the one the original notification came from. Including the id is not cosmetic: confirmed directly (manual test, plus Claude Code's own docs and GitHub issues #37474/#44969) that a session created in headless/print mode — which forking uses — never appears in the `/resume` picker, because it lacks the `ai-title` record the picker indexes by. It remains fully resumable by exact id (`claude --resume <id>`), so without the id in the announcement, the only way to find it afterward would be reading the bridge's own `registry.json` by hand.

## Risks

- **A fork is created but the headless call that produced it then fails** → the registry is only updated (marking `forkedInto`, registering the new session) after the JSON result is successfully parsed and a session id extracted; a failure before that point leaves the original session's state untouched.
- **Two Telegram replies for the same original session arrive close together, both before the first fork completes** → out of scope for this change's concurrency guarantees, matching the base design's existing acceptance of same-key races at low event rate; a documented follow-up, not silently assumed safe.
- **User expects one shared conversation and is surprised by two** → mitigated by the explicit fork announcement (Decision 6) and origin-labeled notifications (Decision 5), not by hiding the fork.

## Migration Plan

Additive on top of the shipped `add-telegram-bridge` capabilities — no existing behavior changes until a user replies via Telegram to a session for the first time. Existing registry entries need no migration: a missing `origin` field is treated as `interactive`, the safe default that triggers a fork on first use exactly like a freshly-registered session would.
