## Purpose

Connects the bridge to a single private Telegram bot over long polling, and acts as the single choke point that decides whether any message may flow in either direction — enforcing the enabled/disabled switch and the sender allowlist.

## ADDED Requirements

### Requirement: Long-polling connectivity
The system SHALL connect to Telegram using the Bot API long-polling method and SHALL NOT require any inbound public endpoint.

#### Scenario: Bot starts without public networking
- **WHEN** the bridge service starts
- **THEN** it begins polling Telegram for updates using only outbound HTTPS connections, with no listening port opened

### Requirement: Enable/disable switch
The system SHALL provide a single boolean toggle that, when off, blocks all outbound Telegram messages and ignores all inbound Telegram messages, except the `/on` command itself (see Chat-based enable/disable control), which must remain processable precisely so the integration can be re-enabled from chat.

#### Scenario: Integration disabled
- **WHEN** the enabled flag is set to false
- **THEN** Claude Code output events are not sent to Telegram and any incoming Telegram message other than `/on` from a registered owner is ignored without side effects

#### Scenario: Integration re-enabled
- **WHEN** the enabled flag is set back to true
- **THEN** outbound relaying and inbound message handling resume without requiring a service restart

### Requirement: Sender allowlist
The system SHALL only act on messages from Telegram chat IDs that are registered owners (see `user-registration`), and SHALL silently ignore all others.

#### Scenario: Unauthorized sender
- **WHEN** a Telegram message arrives from a chat ID that is not a registered owner
- **THEN** the system does not process it as a command and does not reveal the bot's association with any Claude Code session

#### Scenario: Registered owner
- **WHEN** a Telegram message arrives from a chat ID that completed registration (the operator's own chat, auto-registered at install, or a chat that later completed `/register`)
- **THEN** the system treats it as an authorized sender, subject to the further per-owner scoping enforced by `session-registry`

### Requirement: Chat-based enable/disable control
The system SHALL let an allowlisted sender toggle the `enabled` flag by sending `/off` or `/on`, in addition to editing local config, and SHALL acknowledge the new state back to the chat. Both commands SHALL be evaluated against the allowlist only (never against the current `enabled` value), since `/on` must work precisely when the integration is currently disabled.

#### Scenario: Disable from chat
- **WHEN** an allowlisted sender sends `/off`
- **THEN** the system sets `enabled` to false and replies confirming the integration is now disabled

#### Scenario: Re-enable from chat while disabled
- **WHEN** an allowlisted sender sends `/on` while `enabled` is currently false
- **THEN** the system sets `enabled` to true and replies confirming the integration is now enabled, even though it did not process other messages while disabled

#### Scenario: Unauthorized sender attempts the command
- **WHEN** a chat ID not in the allowlist sends `/on` or `/off`
- **THEN** the flag is not changed, consistent with the sender allowlist requirement above
