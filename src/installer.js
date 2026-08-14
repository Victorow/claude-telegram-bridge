import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOOK_EVENTS = ['Stop', 'Notification'];

/** The hook entry this bridge needs. `Notification` has no matcher on purpose - see design.md Decision 18: granularity is filtered in our own code, not in settings.json, so it takes effect without reinstalling. */
export function buildHookEntry({ command, args }) {
  return { hooks: [{ type: 'command', command, args, timeout: 15 }] };
}

function sameHookEntry(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Idempotent: adds this bridge's hook entry for Stop/Notification without touching any other entry already present. */
export function mergeHooksIntoSettings(settings, { command, args }) {
  const next = { ...settings, hooks: { ...(settings.hooks || {}) } };
  const entry = buildHookEntry({ command, args });
  for (const event of HOOK_EVENTS) {
    const existingList = Array.isArray(next.hooks[event]) ? next.hooks[event] : [];
    const alreadyPresent = existingList.some((e) => sameHookEntry(e, entry));
    next.hooks[event] = alreadyPresent ? existingList : [...existingList, entry];
  }
  return next;
}

/** Removes exactly the entry this bridge would have added for this command/args - never anything else. */
export function removeHooksFromSettings(settings, { command, args }) {
  if (!settings.hooks) return settings;
  const entry = buildHookEntry({ command, args });
  const next = { ...settings, hooks: { ...settings.hooks } };
  for (const event of HOOK_EVENTS) {
    const existingList = Array.isArray(next.hooks[event]) ? next.hooks[event] : [];
    next.hooks[event] = existingList.filter((e) => !sameHookEntry(e, entry));
  }
  return next;
}

export function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  const raw = fs.readFileSync(settingsPath, 'utf8');
  if (raw.trim() === '') return {};
  return JSON.parse(raw);
}

export function writeSettings(settingsPath, settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export function installAccount({ settingsPath, command, args }) {
  const settings = readSettings(settingsPath);
  const next = mergeHooksIntoSettings(settings, { command, args });
  writeSettings(settingsPath, next);
  return next;
}

export function uninstallAccount({ settingsPath, command, args }) {
  const settings = readSettings(settingsPath);
  const next = removeHooksFromSettings(settings, { command, args });
  writeSettings(settingsPath, next);
  return next;
}

/** Default Claude Code account settings.json for this machine, honoring CLAUDE_CONFIG_DIR like Claude Code itself does. */
export function defaultClaudeSettingsPath() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'settings.json');
}

/**
 * The command/args this bridge's own `hook` subcommand should be invoked with.
 * One entry point (`bin/bridge.js`) serves both the CLI and the hook handler -
 * required for packaging as a single self-contained binary (see Fase 9),
 * which can only embed one main script. `packagedBinaryPath` is used once a
 * platform binary exists; otherwise this runs from source via `node <script>`.
 */
export function defaultHookInvocation({ owner, hookScriptPath, packagedBinaryPath }) {
  if (packagedBinaryPath) {
    return { command: packagedBinaryPath, args: ['hook', '--owner', owner] };
  }
  return { command: process.execPath, args: [hookScriptPath, 'hook', '--owner', owner] };
}
