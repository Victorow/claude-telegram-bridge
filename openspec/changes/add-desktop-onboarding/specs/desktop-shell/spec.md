## Purpose

Extends the desktop-shell capability (from `add-desktop-shell`) with a GUI-driven first-run flow, so the desktop distribution never requires a terminal, and guards every path that could otherwise hang waiting for one.

## ADDED Requirements

### Requirement: Onboarding view
The desktop app SHALL show an onboarding view instead of the status view whenever `status --json` reports `configured: false`, in the same window Phase 1 already uses for status.

#### Scenario: App starts unconfigured
- **WHEN** the app starts and `status --json` reports `configured: false`
- **THEN** the onboarding view is shown instead of the status view

#### Scenario: App starts already configured
- **WHEN** the app starts and `status --json` reports `configured: true`
- **THEN** the status view is shown directly, exactly as in Phase 1, with no onboarding step

### Requirement: BotFather shortcut
The onboarding view SHALL offer a button that opens `https://t.me/BotFather` in the user's default handler for that link.

#### Scenario: User clicks the BotFather button
- **WHEN** the user clicks the "Abrir @BotFather" button
- **THEN** `https://t.me/BotFather` opens via the OS's registered handler for that URL, not inside the app's own webview

### Requirement: Onboarding completion
The desktop app SHALL let the user paste a bot token and attempt, on demand (not automatically/via polling), to complete setup by checking whether a message has been sent to that bot.

#### Scenario: Token accepted and a message is found
- **WHEN** the user pastes a token and clicks "Verificar", and a message to that bot is found
- **THEN** the configuration is saved, and the view switches to the status display without any further confirmation screen

#### Scenario: No message received yet
- **WHEN** the user clicks "Verificar" before sending any message to the bot
- **THEN** a clear error is shown, the token remains in the field, and the user can click "Verificar" again

#### Scenario: Empty token
- **WHEN** the user clicks "Verificar" with an empty token field
- **THEN** a clear error is shown without attempting any network call

### Requirement: No `start` invocation while unconfigured
Neither the app's own startup sequence nor the tray's "Iniciar" menu item SHALL invoke `bridge start` while `status --json` reports `configured: false`.

#### Scenario: App launches unconfigured
- **WHEN** the app starts and the bridge is not yet configured
- **THEN** the app does not spawn a `start` sidecar - the onboarding view is shown instead, and `start` is only spawned after onboarding completes successfully

#### Scenario: Tray "Iniciar" clicked while unconfigured
- **WHEN** the user selects "Iniciar" from the tray menu while the bridge is not yet configured
- **THEN** the app does not spawn a `start` sidecar (which would otherwise hang indefinitely waiting for a terminal prompt no attached terminal will ever answer)
