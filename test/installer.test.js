import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  installAccount,
  uninstallAccount,
  readSettings,
  mergeHooksIntoSettings,
  buildHookEntry,
} from '../src/installer.js';

function withTempSettingsPath(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-installer-'));
  const settingsPath = path.join(dir, 'settings.json');
  try {
    return fn(settingsPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HOOK = { command: '/usr/bin/node', args: ['/opt/bridge/hook.js', '--owner', 'caio'] };

test('installing into a fresh settings.json adds only this bridge\'s entries', () => {
  withTempSettingsPath((settingsPath) => {
    const result = installAccount({ settingsPath, ...HOOK });
    assert.deepEqual(Object.keys(result.hooks).sort(), ['Notification', 'Stop']);
    assert.equal(result.hooks.Stop.length, 1);
    assert.equal(result.hooks.Stop[0].hooks[0].command, '/usr/bin/node');
  });
});

test('installing preserves pre-existing unrelated hooks untouched', () => {
  withTempSettingsPath((settingsPath) => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        otherSetting: true,
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'echo', args: ['unrelated'] }] }],
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo', args: ['guard'] }] }],
        },
      })
    );
    const result = installAccount({ settingsPath, ...HOOK });
    assert.equal(result.otherSetting, true);
    assert.equal(result.hooks.Stop.length, 2); // unrelated entry preserved + ours added
    assert.ok(result.hooks.Stop.some((e) => e.hooks[0].command === 'echo'));
    assert.ok(result.hooks.Stop.some((e) => e.hooks[0].command === '/usr/bin/node'));
    assert.equal(result.hooks.PreToolUse.length, 1); // completely untouched, different event
  });
});

test('running the installer twice does not create duplicate entries', () => {
  withTempSettingsPath((settingsPath) => {
    installAccount({ settingsPath, ...HOOK });
    const second = installAccount({ settingsPath, ...HOOK });
    assert.equal(second.hooks.Stop.length, 1);
    assert.equal(second.hooks.Notification.length, 1);
  });
});

test('uninstall removes exactly this bridge\'s entries and leaves others intact', () => {
  withTempSettingsPath((settingsPath) => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo', args: ['unrelated'] }] }] } })
    );
    installAccount({ settingsPath, ...HOOK });
    let settings = readSettings(settingsPath);
    assert.equal(settings.hooks.Stop.length, 2);

    const afterUninstall = uninstallAccount({ settingsPath, ...HOOK });
    assert.equal(afterUninstall.hooks.Stop.length, 1);
    assert.equal(afterUninstall.hooks.Stop[0].hooks[0].command, 'echo');
    assert.equal(afterUninstall.hooks.Notification.length, 0);
  });
});

test('Notification hook entry has no matcher (broad by design - see design.md Decision 18)', () => {
  const entry = buildHookEntry(HOOK);
  assert.equal(entry.matcher, undefined);
});

test('installing with a different command for the same owner replaces the old entry instead of duplicating it', () => {
  withTempSettingsPath((settingsPath) => {
    installAccount({ settingsPath, command: '/usr/bin/node', args: ['/opt/bridge/hook.js', '--owner', 'caio'] });
    const result = installAccount({ settingsPath, command: '/opt/bridge/bridge-binary', args: ['hook', '--owner', 'caio'] });
    assert.equal(result.hooks.Stop.length, 1);
    assert.equal(result.hooks.Stop[0].hooks[0].command, '/opt/bridge/bridge-binary');
    assert.equal(result.hooks.Notification.length, 1);
    assert.equal(result.hooks.Notification[0].hooks[0].command, '/opt/bridge/bridge-binary');
  });
});

test('installing a second owner does not disturb the first owner\'s entry', () => {
  withTempSettingsPath((settingsPath) => {
    installAccount({ settingsPath, command: '/usr/bin/node', args: ['/opt/bridge/hook.js', '--owner', 'caio'] });
    const result = installAccount({ settingsPath, command: '/usr/bin/node', args: ['/opt/bridge/hook.js', '--owner', 'amigo'] });
    assert.equal(result.hooks.Stop.length, 2);
    assert.ok(result.hooks.Stop.some((e) => e.hooks[0].args.includes('caio')));
    assert.ok(result.hooks.Stop.some((e) => e.hooks[0].args.includes('amigo')));
  });
});

test('uninstall removes this owner\'s entry even if it was installed with a different command variant', () => {
  withTempSettingsPath((settingsPath) => {
    installAccount({ settingsPath, command: '/usr/bin/node', args: ['/opt/bridge/hook.js', '--owner', 'caio'] });
    const afterUninstall = uninstallAccount({
      settingsPath,
      command: '/different/path/bridge-binary',
      args: ['hook', '--owner', 'caio'],
    });
    assert.equal(afterUninstall.hooks.Stop.length, 0);
    assert.equal(afterUninstall.hooks.Notification.length, 0);
  });
});

test('mergeHooksIntoSettings is a pure function that does not mutate the input', () => {
  const original = { hooks: {} };
  const result = mergeHooksIntoSettings(original, HOOK);
  assert.notEqual(result, original);
  assert.deepEqual(original.hooks, {});
});
