## Purpose

Lets a user set up or tear down the bridge — the hook wiring for one Claude Code account, and the background service for one machine — safely and repeatably, on Windows, macOS, or Linux.

## ADDED Requirements

### Requirement: Zero-prerequisite standalone artifact
The system SHALL be distributed as a self-contained executable per supported OS (Windows, macOS, Linux) that does not require a separately installed Node.js runtime or any other tool on the target machine.

#### Scenario: Machine with no Node.js installed
- **WHEN** a user downloads and runs the installer artifact for their OS on a machine without Node.js installed
- **THEN** the bridge runs correctly without the user installing any additional runtime

### Requirement: Guided first run within two interactions
The system SHALL complete full setup — bot token, chat allowlist, hook wiring, and background service registration — in at most two user interactions: running the installer, and confirming or entering the bot token when prompted.

#### Scenario: First run on a fresh machine
- **WHEN** a user runs the installer artifact for the first time and no configuration exists yet
- **THEN** the installer prompts once for the bot token and allowed chat ID, then completes hook wiring and service registration without further prompts or manual steps

#### Scenario: Second run, configuration already present
- **WHEN** the installer runs again on a machine that already has valid configuration
- **THEN** it does not re-prompt and proceeds directly to (re-)applying hook wiring and service registration

### Requirement: Idempotent hook installation
The system SHALL add its required hook entries to a Claude Code account's settings without removing or overwriting any pre-existing, unrelated hook entries.

#### Scenario: Account has no existing hooks
- **WHEN** the installer runs against a Claude Code account with no hooks configured
- **THEN** it adds only the entries required by this bridge

#### Scenario: Account has other hooks already
- **WHEN** the installer runs against a Claude Code account with pre-existing hooks unrelated to this bridge
- **THEN** those pre-existing entries remain unchanged after installation

#### Scenario: Installer runs twice
- **WHEN** the installer runs a second time against an account already configured
- **THEN** it does not create duplicate hook entries

### Requirement: Per-account repeatability
The system SHALL support running the installer independently for each of several Claude Code accounts on the same machine, each pointed at the same running bridge.

#### Scenario: Second account installed
- **WHEN** the installer runs for a second Claude Code account on a machine that already has one account configured
- **THEN** both accounts' sessions are able to register with and be relayed by the same bridge instance

### Requirement: Reversible install
The system SHALL provide an uninstall path that removes exactly the hook entries and service registration this installer added.

#### Scenario: Uninstall requested
- **WHEN** uninstall is run for an account previously configured by this installer
- **THEN** only this bridge's hook entries are removed and any unrelated hooks remain intact
