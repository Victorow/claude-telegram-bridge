import test from 'node:test';
import assert from 'node:assert/strict';
import { registerService, unregisterService } from '../src/service.js';

function recordingExec() {
  const calls = [];
  const fn = (cmd, args) => calls.push({ cmd, args });
  return { calls, fn };
}

test('registerService on win32 calls schtasks with the right task name and command', () => {
  const exec = recordingExec();
  const result = registerService({
    platform: 'win32',
    command: 'C:\\node.exe',
    args: ['C:\\bridge\\bin\\bridge.js', 'start'],
    execFileSyncFn: exec.fn,
  });
  assert.equal(result.mechanism, 'schtasks');
  assert.equal(exec.calls[0].cmd, 'schtasks');
  assert.ok(exec.calls[0].args.includes('ClaudeTelegramBridge'));
  assert.ok(exec.calls[0].args.includes('/Create'));
});

test('registerService on darwin writes a launchd plist and loads it', () => {
  const exec = recordingExec();
  const written = [];
  const result = registerService({
    platform: 'darwin',
    command: '/usr/bin/node',
    args: ['/opt/bridge/bin/bridge.js', 'start'],
    execFileSyncFn: exec.fn,
    writeFileSyncFn: (p, content) => written.push({ p, content }),
    mkdirSyncFn: () => {},
  });
  assert.equal(result.mechanism, 'launchd');
  assert.equal(written.length, 1);
  assert.match(written[0].content, /RunAtLoad/);
  assert.equal(exec.calls[0].cmd, 'launchctl');
  assert.equal(exec.calls[0].args[0], 'load');
});

test('registerService on linux writes a systemd unit and enables it', () => {
  const exec = recordingExec();
  const written = [];
  const result = registerService({
    platform: 'linux',
    command: '/usr/bin/node',
    args: ['/opt/bridge/bin/bridge.js', 'start'],
    execFileSyncFn: exec.fn,
    writeFileSyncFn: (p, content) => written.push({ p, content }),
    mkdirSyncFn: () => {},
  });
  assert.equal(result.mechanism, 'systemd');
  assert.match(written[0].content, /ExecStart=/);
  assert.deepEqual(exec.calls[0], { cmd: 'systemctl', args: ['--user', 'enable', '--now', 'claude-telegram-bridge.service'] });
});

test('registerService throws on an unsupported platform', () => {
  assert.throws(() => registerService({ platform: 'aix', command: 'x', args: [] }), /Unsupported platform/);
});

test('unregisterService on win32 deletes the scheduled task', () => {
  const exec = recordingExec();
  unregisterService({ platform: 'win32', execFileSyncFn: exec.fn });
  assert.deepEqual(exec.calls[0], { cmd: 'schtasks', args: ['/Delete', '/TN', 'ClaudeTelegramBridge', '/F'] });
});

test('unregisterService on linux disables the unit and removes the file', () => {
  const exec = recordingExec();
  const removed = [];
  unregisterService({ platform: 'linux', execFileSyncFn: exec.fn, rmSyncFn: (p) => removed.push(p) });
  assert.equal(exec.calls[0].cmd, 'systemctl');
  assert.equal(removed.length, 1);
});
