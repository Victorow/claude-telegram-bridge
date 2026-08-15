## 1. Session registry: origin & fork tracking

- [ ] 1.1 Add `origin` field (`'interactive' | 'telegram-fork'`) to session entries, defaulting to `'interactive'` when absent (no migration needed for existing entries)
- [ ] 1.2 Add `forkedInto` (nullable session id) to session entries, and a helper to mark a session as forked into a new session id
- [ ] 1.3 Update `resolveTarget` (reply-based, prefix-based, and most-recent paths alike) to follow a resolved session's `forkedInto` pointer to the current fork before returning it
- [ ] 1.4 Regression tests: reply to a pre-fork tracked message resolves to the fork, not the stale original; a session with no `origin` field behaves as `interactive`; prefix/most-recent resolution also follows `forkedInto`

## 2. Input relay: fork-vs-resume decision

- [ ] 2.1 When the resolved target session's origin is `interactive`, invoke `claude --resume <id> --fork-session -p "<prompt>" --output-format json` instead of the current invocation
- [ ] 2.2 Parse the JSON result's `session_id` field to learn the new forked session id; on parse failure or missing field, treat as a headless failure (existing failure-message path) and do not mark anything as forked
- [ ] 2.3 On successful fork: register the new session (origin `telegram-fork`, same cwd/label/owner), mark the original session's `forkedInto`, and send the one-time fork announcement message
- [ ] 2.4 When the resolved target session's origin is already `telegram-fork`, resume it in place exactly as today (no `--fork-session`)
- [ ] 2.5 Regression tests: first reply to an interactive-origin session forks and announces; second reply to the same (now-forked) conversation resumes the fork directly without forking again; a failed fork attempt leaves the registry untouched

## 3. Output relay: origin-aware labeling

- [ ] 3.1 When an owner has both an interactive-origin session and a `telegram-fork` session sharing the same label, append the origin suffix (`· IDE` / `· Telegram`) to the label used in outbound messages
- [ ] 3.2 When no such ambiguity exists (no fork yet, or fork belongs to a different label), behavior is unchanged from today
- [ ] 3.3 Regression tests: labels stay exactly as today with no fork present; origin suffix appears on both sessions' messages once a fork coexists with its original

## 4. End-to-end verification

- [ ] 4.1 Manual test: reply via Telegram to a session with its IDE window still open; confirm a fork announcement arrives, the IDE session is untouched, and a second Telegram reply continues the fork
- [ ] 4.2 Manual test: resume the forked session from the PC (`claude --resume <fork-id>` or the IDE's session picker) and confirm its history includes everything exchanged via Telegram
