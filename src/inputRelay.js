import crossSpawn from 'cross-spawn';
import { resolveTarget, loadRegistry, saveRegistry, upsertSession, markForked } from './registry.js';
import { sendMessage } from './gateway.js';

function runHeadless({ spawnFn, claudeBin, sessionId, cwd, prompt, fork }) {
  return new Promise((resolve, reject) => {
    const args = fork
      ? ['--resume', sessionId, '--fork-session', '-p', prompt, '--output-format', 'json']
      : ['--resume', sessionId, '-p', prompt];
    let child;
    try {
      child = spawnFn(claudeBin, args, { cwd });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject); // e.g. the claude binary isn't on PATH
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(stderr.trim() || `claude exited with code ${code}`));
    });
  });
}

/** Reads the new session id `--fork-session --output-format json` reports directly in its result, rather than guessing from a later hook event (see design.md Decision 3). Returns null on anything unparseable, which the caller treats as a failed fork. */
function parseForkedSessionId(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return typeof parsed.session_id === 'string' ? parsed.session_id : null;
  } catch {
    return null;
  }
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
  { spawnFn = crossSpawn, send = sendMessage, claudeBin = 'claude', now = () => Date.now() } = {}
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
  const shouldFork = session.origin !== 'telegram-fork';

  try {
    const result = await runHeadless({
      spawnFn,
      claudeBin,
      sessionId: session.sessionId,
      cwd: session.cwd,
      prompt,
      fork: shouldFork,
    });

    if (shouldFork) {
      const forkedSessionId = parseForkedSessionId(result.stdout);
      if (!forkedSessionId) {
        throw new Error('não consegui identificar a sessão criada pelo fork');
      }
      upsertSession(
        registry,
        { sessionId: forkedSessionId, cwd: session.cwd, label: session.label, owner: ownerId, origin: 'telegram-fork' },
        now()
      );
      markForked(registry, session.sessionId, forkedSessionId);
      await send(
        config,
        chatId,
        'Criei uma continuação separada dessa sessão (ela pode ainda estar aberta em outro lugar, como o IDE) — as próximas respostas por aqui vão continuar essa continuação separada. ' +
          `Ela não aparece no seletor /resume (sessões headless não geram esse índice), mas dá pra abrir direto por ID: claude --resume ${forkedSessionId}`
      );
    }

    return { handled: 'delegated-to-output-relay' };
  } catch (err) {
    await send(config, chatId, `Não consegui continuar essa sessão: ${err.message}`);
    return { handled: 'failure', error: err.message };
  }
}

/**
 * Loads the registry fresh right before handling, instead of reusing a
 * snapshot captured once at bridge startup. Sessions are also written by
 * separate hook processes (one per Claude Code Stop/Notification event) as
 * they happen, so a long-lived in-memory copy goes stale the moment any hook
 * fires - and saving that stale copy back would clobber whatever the hook
 * had just written.
 */
export async function relayInboundMessage(config, ownerId, messageInfo, { loadRegistryFn = loadRegistry, saveRegistryFn = saveRegistry, ...rest } = {}) {
  const registry = loadRegistryFn();
  const result = await handleInboundMessage(config, registry, ownerId, messageInfo, rest);
  saveRegistryFn(registry);
  return result;
}
