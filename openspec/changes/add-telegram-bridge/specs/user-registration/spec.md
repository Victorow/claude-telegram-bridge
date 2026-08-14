## Purpose

Lets more than one person share a single bridge instance: the operator (whoever installed the bridge) can invite others, and each invited person's Telegram chat becomes its own owner, fully isolated from everyone else's Claude Code sessions.

## ADDED Requirements

### Requirement: Operator auto-registration
The system SHALL automatically register the operator's own chat as an owner during the first-run wizard, with no separate `/register` step required.

#### Scenario: First-run wizard completes
- **WHEN** the first-run wizard finishes (bot token and chat ID confirmed)
- **THEN** that chat ID is registered as an owner without the operator needing to send `/register`

### Requirement: Invite code generation
The system SHALL let the operator generate a single-use invite code, optionally tied to a specific Claude Code account/label that the invited person will be installing.

#### Scenario: Operator generates a code
- **WHEN** the operator runs the invite-generation command
- **THEN** the system produces a code that has not been issued before and is not yet consumed

### Requirement: Registration via invite code
The system SHALL let an unregistered chat join as a new owner by sending `/register <code>` with a valid, unused invite code, and SHALL reject invalid or already-used codes without registering anything.

#### Scenario: Valid, unused code
- **WHEN** an unregistered chat sends `/register` with a code that exists and has not yet been consumed
- **THEN** that chat is registered as a new owner and the code is marked consumed so it cannot be reused

#### Scenario: Already-used code
- **WHEN** any chat sends `/register` with a code that has already been consumed
- **THEN** no new owner is registered and the system replies that the code is no longer valid

#### Scenario: Unknown or malformed code
- **WHEN** any chat sends `/register` with a code that was never issued
- **THEN** no new owner is registered and the system replies that the code is invalid

### Requirement: One owner per registered chat
The system SHALL map each successfully registered chat to exactly one owner identity, used by `session-registry` to scope all subsequent routing for messages from that chat.

#### Scenario: Registered chat sends a later message
- **WHEN** a chat that completed registration earlier sends any subsequent message
- **THEN** the system attributes that message to the same owner it was registered under, without repeating registration
