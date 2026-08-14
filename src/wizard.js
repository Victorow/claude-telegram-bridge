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
  const config = createDefaultConfig(token);

  await prompt('Agora mande qualquer mensagem para o seu bot no Telegram e pressione Enter aqui...');
  const updates = await getUpdatesFn(config, 0, 5);
  const withChat = [...updates].reverse().find((u) => u.message?.chat?.id != null);
  if (!withChat) {
    throw new Error('Não recebi nenhuma mensagem do bot ainda. Mande uma mensagem para ele e rode a instalação de novo.');
  }

  const chatId = String(withChat.message.chat.id);
  registerOwner(config, chatId, 'operator');
  saveConfigFn(config);
  return { ranWizard: true, chatId, ownerId: 'operator' };
}
