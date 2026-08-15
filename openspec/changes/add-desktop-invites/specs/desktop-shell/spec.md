## Purpose

Extends the desktop-shell capability (from `add-desktop-shell`/`add-desktop-onboarding`/`add-desktop-settings`) with invite generation and review, closing the last CLI-only action in the base multi-owner sharing feature.

## ADDED Requirements

### Requirement: Invite listing
The bridge binary SHALL expose a way (`invite --list --json`) to list all invites created so far, each reporting its code, optional label, consumed state, creation time, and (for labeled, consumed invites only) the chat id that redeemed it.

#### Scenario: Listing with no invites yet
- **WHEN** `invite --list --json` runs and no invites have been created
- **THEN** it reports an empty list

#### Scenario: Listing includes pending and consumed invites
- **WHEN** `invite --list --json` runs after some invites have been created, some consumed and some not
- **THEN** each is reported with its code, label (if any), and whether it's been consumed

#### Scenario: A labeled, consumed invite reports who redeemed it
- **WHEN** a labeled invite has been redeemed
- **THEN** the listing includes the chat id currently registered for that label

### Requirement: Invite creation, machine-readable
The existing `invite` subcommand SHALL support `--json` for machine-readable output, with no change to its plain-text behavior when `--json` is omitted.

#### Scenario: Creating an invite with --json
- **WHEN** `invite --json [--for-account <label>]` runs
- **THEN** it creates the invite exactly as today and reports the new code as JSON, instead of the existing human-readable text

#### Scenario: Creating an invite without --json
- **WHEN** `invite [--for-account <label>]` runs with no `--json`
- **THEN** behavior is byte-for-byte unchanged from before this change

### Requirement: Invite section in the status view
The status view SHALL offer a collapsible section for generating and reviewing invites, closed by default.

#### Scenario: Opening the section
- **WHEN** the user clicks "Convidar alguém"
- **THEN** the section expands, showing an optional label field, a "Gerar convite" button, and the current list of invites

#### Scenario: Generating an invite
- **WHEN** the user clicks "Gerar convite" (with or without a label)
- **THEN** a new invite is created, its code is displayed with a "Copiar" button, and the invite list refreshes to include it

### Requirement: Copy to clipboard
The generated invite code SHALL be copyable via a real clipboard write, not only manual text selection.

#### Scenario: Clicking Copiar
- **WHEN** the user clicks "Copiar" next to a generated code
- **THEN** that code is written to the system clipboard
