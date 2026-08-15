## Purpose

Extends session-registry with session origin tracking and fork-chain redirection, so target resolution never re-targets a session that a still-open interactive process might also be writing to.

## ADDED Requirements

### Requirement: Session origin
The system SHALL record each session's origin as either `interactive` (registered from a real Claude Code hook event, i.e. a genuine interactive process) or `telegram-fork` (created by `input-relay` forking an interactive-origin session). A session with no recorded origin SHALL be treated as `interactive`.

#### Scenario: Session registered from a hook event
- **WHEN** a session is registered or updated via a Claude Code hook event (as today)
- **THEN** its origin is `interactive`

#### Scenario: Session registered as the result of a fork
- **WHEN** `input-relay` forks an interactive-origin session and registers the resulting new session
- **THEN** its origin is `telegram-fork`

#### Scenario: Pre-existing entry with no origin field
- **WHEN** target resolution reads a session entry that predates this change and has no `origin` field
- **THEN** it is treated as `interactive`

### Requirement: Fork-chain redirection
The system SHALL redirect target resolution from an interactive-origin session to its current fork, if one has been recorded, regardless of which resolution path (reply-based, prefix-based, or most-recent) found that session.

#### Scenario: Reply to a notification sent before the fork existed
- **WHEN** an inbound message replies to a tracked outbound message that resolves to an interactive-origin session which has since been forked
- **THEN** the message targets the recorded fork instead of the original session

#### Scenario: Prefix or most-recent resolution finds an already-forked session
- **WHEN** prefix-based or most-recent resolution would otherwise return an interactive-origin session that has since been forked
- **THEN** the resolved target is the recorded fork instead
