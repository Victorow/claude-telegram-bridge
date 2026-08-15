## Purpose

Extends input-relay so a Telegram-driven continuation never writes into a transcript that a still-open interactive process might also be writing to, by forking once per interactive-origin session instead of always resuming in place.

## MODIFIED Requirements

### Requirement: Headless continuation
The system SHALL continue the target session by invoking Claude Code in non-interactive mode with the target session's id and working directory, passing the inbound message as the next prompt. When the target session's origin is `interactive`, the system SHALL invoke it with `--fork-session`, producing a new session id instead of writing into the original transcript. When the target session's origin is already `telegram-fork`, the system SHALL resume it in place, exactly as before this change.

#### Scenario: Message resolves to an interactive-origin session
- **WHEN** an inbound Telegram message resolves to a session whose origin is `interactive`
- **THEN** the system invokes Claude Code headlessly with `--resume`, `--fork-session`, and `--output-format json`, using that session's recorded working directory and the message as input

#### Scenario: Message resolves to an already-forked session
- **WHEN** an inbound Telegram message resolves (after fork-chain redirection) to a session whose origin is `telegram-fork`
- **THEN** the system resumes that exact session id in place, without `--fork-session`

## ADDED Requirements

### Requirement: Fork registration
The system SHALL, on a successful fork, extract the new session id from the headless call's JSON result, register it in `session-registry` with origin `telegram-fork` (same working directory, label, and owner as the original), and record it as the original session's fork.

#### Scenario: Fork completes successfully
- **WHEN** a headless `--fork-session` invocation completes and its JSON result includes a `session_id`
- **THEN** that session id is registered with origin `telegram-fork`, and the original session's entry records it as its fork

#### Scenario: Fork invocation fails or returns no session id
- **WHEN** a headless `--fork-session` invocation fails, or its output cannot be parsed for a `session_id`
- **THEN** the system treats it as a failed continuation (per the existing failure-delivery requirement) and does not register anything or mark the original session as forked

### Requirement: Fork announcement
The system SHALL send one explicit Telegram message announcing that a fork was created, including the forked session's exact id, separate from the continuation's own reply, the first time a given interactive-origin session is forked.

#### Scenario: First fork of a session
- **WHEN** a session is forked for the first time
- **THEN** a Telegram message is sent to the requesting chat stating that a separate continuation was created and including its exact session id, sent as soon as the headless call completes and the new session id is known — the continuation's own reply (sent by its `Stop` hook, which runs before that headless process exits) typically arrives first, and this announcement immediately after

#### Scenario: The fork's id is the only way to find it afterward
- **WHEN** a session created by forking (headless/print mode) is checked against the `/resume` picker
- **THEN** it does not appear there (confirmed: Claude Code does not generate the metadata record the picker indexes by for headless-created sessions), so the id included in the fork announcement is required, not cosmetic, for resuming it later from the PC

#### Scenario: Both a terminal and a VS Code way to reopen the fork
- **WHEN** the fork announcement is sent
- **THEN** it includes both the CLI form (`claude --resume <id>`) and the VS Code URI form (`vscode://anthropic.claude-code/open?session=<id>`, confirmed via the official VS Code extension docs), since either may be the user's active interface

#### Scenario: Later replies on an already-forked conversation
- **WHEN** an inbound message resolves to a session that was already forked in a previous exchange
- **THEN** no additional fork announcement is sent
