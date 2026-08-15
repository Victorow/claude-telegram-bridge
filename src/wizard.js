import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { configExists, createDefaultConfig, saveConfig } from './config.js';
import { registerOwner } from './registration.js';
import { getUpdates } from './gateway.js';

async function defaultPrompt(question) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Given an already-validated, non-empty bot token, tries once to detect a
 * chat that has messaged that bot and, on success, registers it as the
 * operator and saves the config. Shared by the terminal wizard (which
 * validates and prompts before calling this) and the desktop app's GUI
 * onboarding (which calls this directly, on demand, with no prompting) -
 * see design.md Decision 1 in add-desktop-onboarding.
 */
export async function attemptOnboarding(token, { getUpdatesFn = getUpdates, saveConfigFn = saveConfig } = {}) {
  const trimmedToken = (token ?? '').trim();
  if (!trimmedToken) {
    return { ok: false, reason: 'empty-token' };
  }
  const config = createDefaultConfig(trimmedToken);

  const updates = await getUpdatesFn(config, 0, 5);
  const withChat = [...updates].reverse().find((u) => u.message?.chat?.id != null);
  if (!withChat) {
    return { ok: false, reason: 'no-message-yet' };
  }

  const chatId = String(withChat.message.chat.id);
  registerOwner(config, chatId, 'operator');
  saveConfigFn(config);
  return { ok: true, chatId, ownerId: 'operator' };
}

/**
 * First-run setup: bot token (interaction 1), then a short confirmation once
 * the operator has messaged their own bot (interaction 2) - from which the
 * operator's chat id is auto-detected, so they never need to know or paste
 * their own numeric Telegram id. Skips entirely if config already exists.
 */
export async function runFirstRunWizard({
  prompt = defaultPrompt,
  configExistsFn = configExists,
  saveConfigFn = saveConfig,
  getUpdatesFn = getUpdates,
} = {}) {
  if (configExistsFn()) {
    return { ranWizard: false };
  }

  const token = (await prompt('Cole aqui o token do bot (fale com @BotFather no Telegram, envie /newbot): ')).trim();
  if (!token) {
    throw new Error('Token do bot não pode ser vazio.');
  }

  await prompt('Agora mande qualquer mensagem para o seu bot no Telegram e pressione Enter aqui...');

  const result = await attemptOnboarding(token, { getUpdatesFn, saveConfigFn });
  if (!result.ok) {
    throw new Error('Não recebi nenhuma mensagem do bot ainda. Mande uma mensagem para ele e rode a instalação de novo.');
  }
  return { ranWizard: true, chatId: result.chatId, ownerId: result.ownerId };
}
