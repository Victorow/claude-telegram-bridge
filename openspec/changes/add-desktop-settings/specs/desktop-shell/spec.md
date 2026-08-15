## Purpose

Extends the desktop-shell capability (from `add-desktop-shell`/`add-desktop-onboarding`) with on/off and notification-granularity controls directly in the status view.

## ADDED Requirements

### Requirement: Settings read/write subcommand
The bridge binary SHALL expose a `settings --json` subcommand that reports the current `enabled` and `granularity` values with no flags, and applies/saves either or both when given `--set-enabled true|false` and/or `--set-granularity default|verbose`.

#### Scenario: Reading current settings
- **WHEN** `settings --json` runs with no flags
- **THEN** it reports the current `enabled` and `granularity` values without changing anything

#### Scenario: Changing enabled
- **WHEN** `settings --json --set-enabled false` runs
- **THEN** `enabled` is saved as `false`, and the reported result reflects it

#### Scenario: Changing granularity
- **WHEN** `settings --json --set-granularity verbose` runs
- **THEN** `granularity` is saved as `"verbose"`, and the reported result reflects it

### Requirement: Status reports granularity
`status --json` (and therefore the desktop app's `get_status`) SHALL include the current `granularity` alongside the fields it already reports.

#### Scenario: Status includes granularity
- **WHEN** `status --json` runs against a configured bridge
- **THEN** the result includes `granularity` with the value currently saved in `config.json`

### Requirement: Settings changes restart the sidecar
The desktop app SHALL restart the `start` sidecar (stop, then start) immediately after successfully applying a settings change, so the change takes effect without the user needing to notice and act on it.

#### Scenario: Toggling enabled from the UI
- **WHEN** the user toggles the on/off control in the status view
- **THEN** the setting is saved and the sidecar is stopped and restarted, picking up the new value

#### Scenario: Changing granularity from the UI
- **WHEN** the user changes the granularity selector in the status view
- **THEN** the setting is saved and the sidecar is stopped and restarted, picking up the new value

### Requirement: Controls live in the status view
The on/off toggle and granularity selector SHALL appear directly in the existing status view, not a separate settings screen.

#### Scenario: Status view shows the controls
- **WHEN** the status view is showing (bridge configured)
- **THEN** the on/off toggle and granularity selector are visible alongside the existing status text
