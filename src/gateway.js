const TELEGRAM_API = 'https://api.telegram.org';

export function isRegisteredOwner(config, chatId) {
  return Object.prototype.hasOwnProperty.call(config.owners, String(chatId));
}

export function ownerIdFor(config, chatId) {
  return config.owners[String(chatId)];
}

export async function sendMessage(config, chatId, text, options = {}) {
  const url = `${TELEGRAM_API}/bot${config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...options }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.result; // { message_id, ... }
}

export async function getUpdates(config, offset, timeoutSeconds = 30) {
  const url = `${TELEGRAM_API}/bot${config.botToken}/getUpdates?offset=${offset}&timeout=${timeoutSeconds}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Telegram getUpdates failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.result; // array of updates
}

/**
 * Pure decision logic for a single inbound Telegram update. Makes no network
 * calls itself; all side effects go through the provided callbacks, which
 * keeps this function unit-testable without a real Telegram connection.
 *
 * Precedence: /register (always, even if unauthorized) -> allowlist gate ->
 * /on /off (allowed even while disabled) -> enabled gate -> normal message.
 */
export async function handleUpdate(config, update, callbacks) {
  const message = update.message;
  if (!message || typeof message.text !== 'string') {
    return; // ignore non-text updates for v1 (photos, edits, channel posts, ...)
  }
  const chatId = String(message.chat.id);
  const text = message.text.trim();

  if (text === '/register' || text.startsWith('/register ')) {
    const code = text.slice('/register'.length).trim();
    await callbacks.onRegister(chatId, code);
    return;
  }

  if (!isRegisteredOwner(config, chatId)) {
    return; // Sender allowlist: unauthorized senders are silently ignored.
  }

  if (text === '/on' || text === '/off') {
    await callbacks.onToggle(chatId, text === '/on');
    return;
  }

  if (!config.enabled) {
    return; // Disabled: no further processing, no side effects.
  }

  await callbacks.onMessage(chatId, ownerIdFor(config, chatId), message);
}

/**
 * Long-running polling loop. Thin by design - all decision logic lives in
 * handleUpdate so it can be tested without network access.
 */
export async function runPollingLoop(config, callbacks, { signal, onError } = {}) {
  let offset = 0;
  while (!signal?.aborted) {
    let updates;
    try {
      updates = await getUpdates(config, offset);
    } catch (err) {
      onError?.(err);
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      try {
        await handleUpdate(config, update, callbacks);
      } catch (err) {
        onError?.(err);
      }
    }
  }
}
