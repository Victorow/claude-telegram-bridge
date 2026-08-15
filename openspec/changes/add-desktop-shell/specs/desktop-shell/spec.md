## Purpose

A cross-platform, lightweight desktop application that supervises the existing bridge binary as a sidecar process, replacing the CLI + scheduled-task distribution for users who choose it, and giving them a status view and start/stop control without a terminal.

## ADDED Requirements

### Requirement: Sidecar process supervision
The system SHALL spawn the existing bridge binary as a child ("sidecar") process when the desktop app starts, and SHALL be able to stop and restart it on user command.

#### Scenario: App launches
- **WHEN** the desktop app starts
- **THEN** it spawns the bridge sidecar (equivalent to `start`) as a supervised child process

#### Scenario: User stops the bridge from the tray
- **WHEN** the user selects "Parar" from the tray menu
- **THEN** the sidecar process is terminated and the status view reflects "parado"

#### Scenario: User starts the bridge again from the tray
- **WHEN** the user selects "Iniciar" from the tray menu after stopping
- **THEN** a new sidecar process is spawned

### Requirement: Status reporting
The bridge binary SHALL expose a `status --json` subcommand reporting whether it is configured, enabled, which chat/owner is connected (the operator's, since that's who installed and runs this distribution), the **total** session count across all registered owners (not scoped to just the operator — phase 1 has no per-owner breakdown view), and the most recent activity timestamp across all sessions — without requiring a running polling loop to answer it.

#### Scenario: Bridge not yet configured
- **WHEN** `status --json` runs and no config exists
- **THEN** it reports an unconfigured state instead of erroring

#### Scenario: Bridge configured and has active sessions
- **WHEN** `status --json` runs against an existing config and registry
- **THEN** it reports enabled/disabled, the operator's connected owner/chat, the total session count across all owners, and the most recent activity timestamp across all sessions

### Requirement: Status view
The desktop app SHALL poll a Rust-side `get_status` command on an interval and render whether the bridge is running, connected, and how many sessions are active. `get_status` first checks whether the sidecar process is currently tracked as alive (a Rust-side fact the bridge binary itself has no way to know, since `status --json` is a stateless one-shot read); only when it is does `get_status` additionally shell out to `status --json` and merge its fields in, augmented with `running: true`. This distinction exists because the CLI's own `status --json` (the Requirement above) is a pure disk snapshot — asking it "am I running" would be meaningless from inside a fresh, separate process it can't see its own supervisor from.

#### Scenario: Sidecar running and connected
- **WHEN** the sidecar process is alive and `status --json` reports a connected chat
- **THEN** the status view shows "rodando" and the connected chat/session info

#### Scenario: Sidecar not running
- **WHEN** the sidecar process is not alive (never started, explicitly stopped, or exited/crashed on its own)
- **THEN** the status view shows "parado" without attempting to call `status --json`

#### Scenario: Sidecar exits on its own without going through "Parar"
- **WHEN** the sidecar process terminates unexpectedly (crash, killed externally) rather than via the app's own stop path
- **THEN** the app detects this (via the sidecar's terminated event) and subsequent status polls report it as not running, instead of remaining stuck showing "rodando" for a process that no longer exists

### Requirement: Self-registered autostart
The desktop app SHALL register itself (not the raw bridge binary) to launch at login, tray-only, as the sole autostart mechanism for this distribution.

#### Scenario: First successful run
- **WHEN** the desktop app completes its first successful run
- **THEN** it registers itself for autostart at login

#### Scenario: Coexistence with the CLI distribution
- **WHEN** a machine has both the CLI + scheduled-task distribution and the desktop app installed against the same bot token
- **THEN** this is an unsupported configuration (documented, not technically prevented) — the two would compete for the same long-polling connection
