## Purpose

Turns Claude Code's own hook events into an outbound Telegram message, at a granularity the user controls, without requiring any change to how Claude Code sessions are normally used.

## ADDED Requirements

### Requirement: Turn-completion notification
The system SHALL send a Telegram message summarizing the assistant's last response whenever a session's Stop hook fires while the integration is enabled.

#### Scenario: Session finishes a turn
- **WHEN** a Stop hook event is received for a registered session and the integration is enabled
- **THEN** a Telegram message containing that turn's final assistant response is sent to the allowlisted chat

### Requirement: Attention notification
The system SHALL send a Telegram message when a session raises a Notification hook event, such as waiting on a permission decision or going idle.

#### Scenario: Session needs permission
- **WHEN** a Notification hook event is received for a registered session and the integration is enabled
- **THEN** a Telegram message describing what the session is waiting on is sent to the allowlisted chat

### Requirement: Configurable granularity
The system SHALL let the user choose, per install, whether only Stop/Notification events are relayed or whether intermediate tool-use output is also relayed.

#### Scenario: Default granularity
- **WHEN** no granularity is configured
- **THEN** only Stop and Notification events produce Telegram messages

#### Scenario: Verbose granularity enabled
- **WHEN** verbose granularity is configured
- **THEN** intermediate hook events configured for verbose mode also produce Telegram messages

### Requirement: No relay while disabled
The system SHALL NOT send any Telegram message for any hook event while the enabled flag is false.

#### Scenario: Hook fires while disabled
- **WHEN** any hook event is received and the enabled flag is false
- **THEN** no Telegram message is sent and the event is discarded

### Requirement: Outbound message tracking
The system SHALL record, for every message it sends that relates to a specific session, which Telegram message id it was sent as and which session it relates to, so a later reply to that message can be matched back to the same session by `session-registry`.

#### Scenario: Notification sent for a session
- **WHEN** the system sends a Stop or Notification relay message for a session
- **THEN** it records that outbound message's id against that session id for later reply matching

### Requirement: Session label in multi-session messages
The system SHALL include the session's label in an outbound relay message whenever the owner has more than one registered session, so the origin of concurrent responses is distinguishable without opening each session.

#### Scenario: Owner has two or more sessions
- **WHEN** a Stop or Notification event is relayed for an owner who has more than one registered session
- **THEN** the outbound message text includes that session's label

#### Scenario: Owner has exactly one session
- **WHEN** a Stop or Notification event is relayed for an owner who has only one registered session
- **THEN** the label may be omitted since there is no ambiguity to resolve
