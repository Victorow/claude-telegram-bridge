import { spawn } from 'node:child_process';
import { resolveTarget } from './registry.js';
import { sendMessage } from './gateway.js';

function runHeadless({ spawnFn, claudeBin, sessionId, cwd, prompt }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(claudeBin, ['--resume', sessionId, '-p', prompt], { cwd });
    } catch (err) {
      reject(err);
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject); // e.g. the claude binary isn't on PATH
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `claude exited with code ${code}`));
    });
  });
}

/**
 * Handles one inbound Telegram message already known to be authorized and
 * enabled (telegram-gateway has already gated on both). On a successful
 * headless turn this sends NOTHING itself - that turn's own `Stop` hook
 * flows through output-relay, which is the single delivery path (see
 * design.md Decision 15). This function only speaks directly when there is
 * no session to target, or when the headless call fails before a Stop hook
 * could ever fire.
 */
export async function handleInboundMessage(
  config,
  registry,
  ownerId,
  { replyToMessageId, text, chatId },
  { spawnFn = spawn, send = sendMessage, claudeBin = 'claude' } = {}
) {
  const resolution = resolveTarget(registry, ownerId, { replyToMessageId, text });

  if (resolution.noSessions) {
    await send(config, chatId, 'Nenhuma sessão ativa encontrada para você ainda.');
    return { handled: 'no-sessions' };
  }
  if (resolution.noMatch) {
    await send(config, chatId, `Não encontrei esse projeto. Sessões conhecidas: ${resolution.knownLabels.join(', ')}`);
    return { handled: 'no-match' };
  }

  const { session, text: prompt } = resolution;
  try {
    await runHeadless({ spawnFn, claudeBin, sessionId: session.sessionId, cwd: session.cwd, prompt });
    return { handled: 'delegated-to-output-relay' };
  } catch (err) {
    await send(config, chatId, `Não consegui continuar essa sessão: ${err.message}`);
    return { handled: 'failure', error: err.message };
  }
}
