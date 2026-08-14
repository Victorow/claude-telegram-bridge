import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const WINDOWS_TASK_NAME = 'ClaudeTelegramBridge';
const LAUNCHD_LABEL = 'com.claudetelegrambridge.bridge';

function launchdPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function systemdUnitPath() {
  return path.join(os.homedir(), '.config', 'systemd', 'user', 'claude-telegram-bridge.service');
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shellQuote(value) {
  return /["'\s]/.test(value) ? `"${String(value).replace(/"/g, '\\"')}"` : String(value);
}

function buildLaunchdPlist({ command, args }) {
  const items = [command, ...args].map((a) => `    <string>${escapeXml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${items}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

function buildSystemdUnit({ command, args }) {
  const execStart = [command, ...args].map(shellQuote).join(' ');
  return `[Unit]
Description=Claude Telegram Bridge

[Service]
ExecStart=${execStart}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

/**
 * Registers the bridge to run in the background at login. Real OS calls
 * (schtasks/launchctl/systemctl) are injected so tests never touch the
 * actual machine's task scheduler/launch agents/systemd units.
 */
export function registerService({
  platform = process.platform,
  command,
  args,
  execFileSyncFn,
  writeFileSyncFn = fs.writeFileSync,
  mkdirSyncFn = fs.mkdirSync,
} = {}) {
  if (platform === 'win32') {
    const taskCommand = [command, ...args].map(shellQuote).join(' ');
    execFileSyncFn('schtasks', ['/Create', '/TN', WINDOWS_TASK_NAME, '/TR', taskCommand, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F']);
    return { registered: true, mechanism: 'schtasks', name: WINDOWS_TASK_NAME };
  }
  if (platform === 'darwin') {
    const plistPath = launchdPlistPath();
    mkdirSyncFn(path.dirname(plistPath), { recursive: true });
    writeFileSyncFn(plistPath, buildLaunchdPlist({ command, args }));
    execFileSyncFn('launchctl', ['load', plistPath]);
    return { registered: true, mechanism: 'launchd', path: plistPath };
  }
  if (platform === 'linux') {
    const unitPath = systemdUnitPath();
    mkdirSyncFn(path.dirname(unitPath), { recursive: true });
    writeFileSyncFn(unitPath, buildSystemdUnit({ command, args }));
    execFileSyncFn('systemctl', ['--user', 'enable', '--now', 'claude-telegram-bridge.service']);
    return { registered: true, mechanism: 'systemd', path: unitPath };
  }
  throw new Error(`Unsupported platform for background service registration: ${platform}`);
}

export function unregisterService({ platform = process.platform, execFileSyncFn, rmSyncFn = fs.rmSync } = {}) {
  if (platform === 'win32') {
    execFileSyncFn('schtasks', ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F']);
    return { unregistered: true };
  }
  if (platform === 'darwin') {
    const plistPath = launchdPlistPath();
    execFileSyncFn('launchctl', ['unload', plistPath]);
    rmSyncFn(plistPath, { force: true });
    return { unregistered: true };
  }
  if (platform === 'linux') {
    execFileSyncFn('systemctl', ['--user', 'disable', '--now', 'claude-telegram-bridge.service']);
    rmSyncFn(systemdUnitPath(), { force: true });
    return { unregistered: true };
  }
  throw new Error(`Unsupported platform for background service unregistration: ${platform}`);
}
