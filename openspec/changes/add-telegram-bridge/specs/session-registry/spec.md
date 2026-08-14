## Purpose

Maintains a live record of Claude Code sessions running on the machine so the bridge can decide which session an outbound notification came from and which session an inbound message should reach — strictly within the sessions the requesting owner is allowed to see. Target resolution is tried in this order: reply-based match, then label prefix, then most-recent.

## ADDED Requirements

### Requirement: Session registration
The system SHALL record a session's identifier, working directory, account label, owner, and last-active timestamp whenever that session emits a relevant Claude Code hook event.

#### Scenario: New session emits first hook event
- **WHEN** a Claude Code hook event is received for a session id not yet known to the registry
- **THEN** the registry creates an entry with that session id, cwd, account label, the owner configured for that account at install time, and the current timestamp

#### Scenario: Existing session emits another event
- **WHEN** a hook event is received for a session id already in the registry
- **THEN** the registry updates that entry's last-active timestamp instead of creating a duplicate entry

### Requirement: Owner scoping
The system SHALL scope every target-resolution operation (reply-based, prefix-based, and default alike) to sessions owned by the requesting chat's registered owner, and SHALL NEVER resolve a message to a session owned by a different owner.

#### Scenario: Two owners, same machine, no prefix collision risk
- **WHEN** owner A sends a message with no prefix and owner B also has one or more sessions registered
- **THEN** the message resolves only among owner A's own sessions, regardless of how recently owner B's sessions were active

#### Scenario: Prefix matches another owner's label
- **WHEN** owner A sends a message whose prefix matches a label that exists only among owner B's sessions
- **THEN** the system treats it as a non-matching prefix for owner A and replies with the list of owner A's own known labels

### Requirement: Reply-based override
The system SHALL treat an inbound message that is a Telegram reply to a message this bridge previously sent for a specific session as targeting that same session, taking precedence over label-prefix and most-recent resolution.

#### Scenario: Reply to a tracked notification
- **WHEN** an inbound message is a Telegram reply to a message the bridge sent for a known session, and that session belongs to the requesting owner
- **THEN** the message targets that exact session, regardless of any label prefix in the text or of recency

#### Scenario: Reply to an untracked or foreign-owner message
- **WHEN** an inbound message replies to a message that is no longer tracked, or was sent for a session belonging to a different owner
- **THEN** the system falls back to label-prefix resolution, then to most-recent, as specified below

### Requirement: Default target resolution
The system SHALL resolve an inbound message with no reply match and no explicit target prefix to the most recently active session owned by the requesting owner.

#### Scenario: Single active session
- **WHEN** exactly one session is registered for the requesting owner
- **THEN** an inbound message with no reply match and no prefix targets that session

#### Scenario: Multiple active sessions, no prefix
- **WHEN** more than one session is registered for the requesting owner and the inbound message has no reply match and no target prefix
- **THEN** the message targets the session with the most recent last-active timestamp

### Requirement: Prefix-based override
The system SHALL let an inbound message name a specific session's label as a short prefix, and route it to that session instead of the default, when there is no reply match.

#### Scenario: Prefix matches a known label
- **WHEN** an inbound message has no reply match and starts with "<label>: " where a session with that label exists among the requesting owner's sessions
- **THEN** the message targets that session's session id and cwd, regardless of recency

#### Scenario: Prefix matches no known label
- **WHEN** an inbound message has no reply match and starts with a prefix that does not match any of the requesting owner's registered labels
- **THEN** the system replies with the list of the requesting owner's currently known labels instead of guessing a target
