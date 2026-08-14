import test from 'node:test';
import assert from 'node:assert/strict';
import { registerOwner, createInvite, redeemInvite } from '../src/registration.js';

function baseConfig() {
  return { botToken: 't', owners: {}, invites: {}, enabled: true, granularity: 'default' };
}

test('registerOwner maps a chat id to an owner id', () => {
  const config = baseConfig();
  registerOwner(config, 555, 'operator');
  assert.equal(config.owners['555'], 'operator');
});

test('operator auto-registration needs no invite code', () => {
  const config = baseConfig();
  registerOwner(config, 555, 'operator');
  assert.equal(Object.keys(config.invites).length, 0);
  assert.equal(config.owners['555'], 'operator');
});

test('a freshly created invite code is unconsumed', () => {
  const config = baseConfig();
  const code = createInvite(config, { now: () => 1000, randomBytes: () => 'abc123' });
  assert.equal(code, 'abc123');
  assert.equal(config.invites['abc123'].consumed, false);
});

test('redeeming a valid, unused invite registers a new owner and consumes the code', () => {
  const config = baseConfig();
  const code = createInvite(config, { ownerLabel: 'amigo', randomBytes: () => 'xyz' });
  const result = redeemInvite(config, '777', code);
  assert.equal(result.ok, true);
  assert.equal(result.ownerId, 'amigo');
  assert.equal(config.owners['777'], 'amigo');
  assert.equal(config.invites[code].consumed, true);
});

test('redeeming an already-used code is rejected and does not register anything', () => {
  const config = baseConfig();
  const code = createInvite(config, { randomBytes: () => 'xyz' });
  redeemInvite(config, '777', code);
  const second = redeemInvite(config, '888', code);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already-used');
  assert.equal(config.owners['888'], undefined);
});

test('redeeming an unknown code is rejected', () => {
  const config = baseConfig();
  const result = redeemInvite(config, '777', 'does-not-exist');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown-code');
});

test('redeeming with a missing code is rejected without throwing', () => {
  const config = baseConfig();
  const result = redeemInvite(config, '777', '');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-code');
});
