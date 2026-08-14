## Purpose

Converts an inbound Telegram message into the next turn of the correct Claude Code session, and returns that turn's result to the same chat, without controlling any live terminal.

## ADDED Requirements

### Requirement: Headless continuation
The system SHALL continue the target session by invoking Claude Code in non-interactive mode with the target session's id and working directory, passing the inbound message as the next prompt.

#### Scenario: Message resolves to a known session
- **WHEN** an inbound Telegram message resolves to a registered session id
- **THEN** the system invokes Claude Code headlessly to resume that exact session id in its recorded working directory with the message as input

### Requirement: Single delivery path on success
The system SHALL NOT independently relay a headless turn's output when it completes normally — that turn's own `Stop` hook flows through the existing `output-relay` pipeline, which is the only path that sends the resulting message back to the chat.

#### Scenario: Headless turn completes normally
- **WHEN** the headless continuation finishes and its own `Stop` hook fires
- **THEN** the resulting Telegram message is sent exactly once, via `output-relay`, and `input-relay` sends nothing further for that turn

### Requirement: Failure delivery
The system SHALL send a direct message describing the failure when the headless invocation itself fails to complete a turn, since in that case no `Stop` hook fires and `output-relay` has nothing to relay.

#### Scenario: Headless invocation fails before completing
- **WHEN** the headless continuation exits with an error or times out before its own `Stop` hook fires
- **THEN** `input-relay` sends a direct message describing the failure to the chat that sent the triggering input

### Requirement: No session available
The system SHALL inform the user when no session is registered to receive an inbound message, instead of silently failing.

#### Scenario: No sessions registered
- **WHEN** an inbound message arrives and the registry has no sessions
- **THEN** the system replies that no active session is available instead of attempting to continue one
