import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getConfigDir,
  getConfigPath,
  loadConfig,
  saveConfig,
  createDefaultConfig,
  validateConfig,
  applySettingsUpdate,
} from '../src/config.js';

function withTempConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-config-'));
  const prev = process.env.BRIDGE_CONFIG_DIR;
  process.env.BRIDGE_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.BRIDGE_CONFIG_DIR;
    else process.env.BRIDGE_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('loadConfig returns null when no config file exists yet', () => {
  withTempConfigDir(() => {
    assert.equal(loadConfig(), null);
  });
});

test('saveConfig then loadConfig round-trips the data', () => {
  withTempConfigDir(() => {
    const config = createDefaultConfig('123:abc-token');
    config.owners['555'] = 'operator';
    saveConfig(config);
    const loaded = loadConfig();
    assert.equal(loaded.botToken, '123:abc-token');
    assert.equal(loaded.owners['555'], 'operator');
    assert.equal(loaded.enabled, true);
  });
});

test('loadConfig rejects a config file missing botToken', () => {
  withTempConfigDir((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getConfigPath(), JSON.stringify({ owners: {} }));
    assert.throws(() => loadConfig(), /botToken/);
  });
});

test('loadConfig rejects malformed JSON', () => {
  withTempConfigDir((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getConfigPath(), '{not json');
    assert.throws(() => loadConfig(), /not valid JSON/);
  });
});

test('validateConfig rejects an invalid granularity value', () => {
  assert.throws(
    () => validateConfig({ botToken: 'x', granularity: 'chatty' }, '/tmp/config.json'),
    /granularity/
  );
});

test('getConfigDir defaults under the home directory', () => {
  const prev = process.env.BRIDGE_CONFIG_DIR;
  delete process.env.BRIDGE_CONFIG_DIR;
  try {
    assert.ok(getConfigDir().includes('.claude-telegram-bridge'));
  } finally {
    if (prev !== undefined) process.env.BRIDGE_CONFIG_DIR = prev;
  }
});

test('applySettingsUpdate with no changes returns an equivalent config', () => {
  const config = createDefaultConfig('123:abc');
  const result = applySettingsUpdate(config, {});
  assert.deepEqual(result, config);
});

test('applySettingsUpdate sets enabled without touching granularity', () => {
  const config = createDefaultConfig('123:abc');
  const result = applySettingsUpdate(config, { enabled: false });
  assert.equal(result.enabled, false);
  assert.equal(result.granularity, 'default');
});

test('applySettingsUpdate sets granularity without touching enabled', () => {
  const config = createDefaultConfig('123:abc');
  const result = applySettingsUpdate(config, { granularity: 'verbose' });
  assert.equal(result.granularity, 'verbose');
  assert.equal(result.enabled, true);
});

test('applySettingsUpdate rejects an invalid granularity', () => {
  const config = createDefaultConfig('123:abc');
  assert.throws(() => applySettingsUpdate(config, { granularity: 'chatty' }), /granularity/);
});
