import test from 'node:test';
import assert from 'node:assert/strict';
import { runFirstRunWizard, attemptOnboarding } from '../src/wizard.js';

test('wizard is skipped entirely when config already exists', async () => {
  const result = await runFirstRunWizard({ configExistsFn: () => true });
  assert.deepEqual(result, { ranWizard: false });
});

test('wizard collects a token, waits for a message, and auto-registers the operator', async () => {
  const prompts = [];
  const saved = [];
  const result = await runFirstRunWizard({
    configExistsFn: () => false,
    prompt: async (q) => {
      prompts.push(q);
      return q.includes('token') ? '123:abc' : '';
    },
    getUpdatesFn: async () => [{ update_id: 1, message: { chat: { id: 555 }, text: 'oi' } }],
    saveConfigFn: (config) => saved.push(config),
  });
  assert.equal(result.ranWizard, true);
  assert.equal(result.chatId, '555');
  assert.equal(prompts.length, 2);
  assert.equal(saved[0].botToken, '123:abc');
  assert.equal(saved[0].owners['555'], 'operator');
});

test('wizard throws a clear error when no message has been received yet', async () => {
  await assert.rejects(
    () =>
      runFirstRunWizard({
        configExistsFn: () => false,
        prompt: async () => '123:abc',
        getUpdatesFn: async () => [],
        saveConfigFn: () => {},
      }),
    /Não recebi nenhuma mensagem/
  );
});

test('wizard rejects an empty token before waiting for any message', async () => {
  let getUpdatesCalled = false;
  await assert.rejects(
    () =>
      runFirstRunWizard({
        configExistsFn: () => false,
        prompt: async () => '',
        getUpdatesFn: async () => {
          getUpdatesCalled = true;
          return [];
        },
      }),
    /Token do bot não pode ser vazio/
  );
  assert.equal(getUpdatesCalled, false);
});

test('attemptOnboarding reports empty-token without making any network call', async () => {
  const getUpdatesFn = async () => {
    throw new Error('should not be called');
  };
  const result = await attemptOnboarding('   ', { getUpdatesFn, saveConfigFn: () => {} });
  assert.deepEqual(result, { ok: false, reason: 'empty-token' });
});

test('attemptOnboarding reports no-message-yet without saving anything', async () => {
  const getUpdatesFn = async () => [];
  let saved = false;
  const result = await attemptOnboarding('realtoken', {
    getUpdatesFn,
    saveConfigFn: () => {
      saved = true;
    },
  });
  assert.deepEqual(result, { ok: false, reason: 'no-message-yet' });
  assert.equal(saved, false);
});

test('attemptOnboarding detects the chat and saves on success', async () => {
  const getUpdatesFn = async () => [{ message: { chat: { id: 555 } } }];
  let savedConfig = null;
  const result = await attemptOnboarding('realtoken', {
    getUpdatesFn,
    saveConfigFn: (cfg) => {
      savedConfig = cfg;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.chatId, '555');
  assert.equal(result.ownerId, 'operator');
  assert.equal(savedConfig.owners['555'], 'operator');
});
