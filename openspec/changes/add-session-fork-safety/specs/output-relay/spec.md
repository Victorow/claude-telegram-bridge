## Purpose

Extends output-relay's label formatting so an interactive-origin session and its Telegram fork, once both registered under the same label, are distinguishable in outbound messages instead of sharing an ambiguous label.

## MODIFIED Requirements

### Requirement: Session label in multi-session messages
The system SHALL include the session's label in an outbound relay message whenever the owner has more than one registered session, so the origin of concurrent responses is distinguishable without opening each session. When an owner has both an interactive-origin session and a `telegram-fork` session sharing the same label, the system SHALL additionally append an origin suffix (`· IDE` for `interactive`, `· Telegram` for `telegram-fork`) to that label, so the two are distinguishable from each other, not just from other projects.

#### Scenario: Owner has two or more sessions, no shared label
- **WHEN** a Stop or Notification event is relayed for an owner with more than one registered session, and no other session shares that session's label
- **THEN** the outbound message text includes that session's label, unchanged from today

#### Scenario: An interactive-origin session and its fork share a label
- **WHEN** a Stop or Notification event is relayed for a session whose label is also used by another session of a different origin (interactive vs. telegram-fork) for the same owner
- **THEN** the outbound message text includes that label with the origin suffix for that session's own origin

#### Scenario: Owner has exactly one session
- **WHEN** a Stop or Notification event is relayed for an owner who has only one registered session
- **THEN** the label may be omitted since there is no ambiguity to resolve
