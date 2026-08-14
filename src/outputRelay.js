import path from 'node:path';
import { loadConfig, chatIdForOwner } from './config.js';
import { loadRegistry, saveRegistry, upsertSession, recordOutboundMessage, sessionsForOwner } from './registry.js';
import { sendMessage } from './gateway.js';
import { appendLog } from './log.js';

// `Notification` hooks are wired with a broad matcher (see installer) so that changing
// `granularity` in config takes effect immediately, without needing to reinstall hooks.
// This is where the actual per-type filtering happens instead.
const DEFAULT_NOTIFICATION_TYPES = new Set(['permission_prompt', 'idle_prompt', 'agent_needs_input']);
const VERBOSE_NOTIFICATION_TYPES = new Set([
  ...DEFAULT_NOTIFICATION_TYPES,
  'agent_completed',
  'elicitation_dialog',
  'elicitation_url_dialog',
]);

export function shouldRelay(payload, config) {
  if (payload.hook_event_name === 'Stop') return true;
  if (payload.hook_event_name === 'Notification') {
    const allowed = config.granularity === 'verbose' ? VERBOSE_NOTIFICATION_TYPES : DEFAULT_NOTIFICATION_TYPES;
    return allowed.has(payload.notification_type);
  }
  return false; // No other hook event types are wired in this version - see design.md / tasks.md scope note.
}

export function formatMessage(payload, { label, hasMultipleSessions }) {
  const prefix = hasMultipleSessions && label ? `[${label}] ` : '';
  if (payload.hook_event_name === 'Stop') {
    return `${prefix}${payload.last_assistant_message || '(sem texto de resposta)'}`;
  }
  if (payload.hook_event_name === 'Notification') {
    return `${prefix}⚠️ ${payload.notification_message}`;
  }
  return null;
}

/**
 * Entry point invoked (indirectly, via bin/hook.js) by a Claude Code hook.
 * `owner` is baked into the hook command's args at install time (see
 * installer.js) - one account, one fixed owner. `label` is NOT baked in:
 * it defaults to the basename of the session's own `cwd`, computed fresh per
 * event, so one account can run many different projects over time and each
 * gets its own sensible label without a separate install per project.
 */
export async function handleHookEvent(
  payload,
  {
    owner,
    label,
    config = loadConfig(),
    registry = loadRegistry(),
    send = sendMessage,
    persistRegistry = saveRegistry,
    now = () => Date.now(),
  } = {}
) {
  if (!config) {
    appendLog('handleHookEvent: no config yet, skipping (bridge not set up)');
    return { sent: false, reason: 'not-configured' };
  }
  if (!owner) {
    appendLog(`handleHookEvent: hook invoked without --owner for session ${payload.session_id}`);
    return { sent: false, reason: 'no-owner' };
  }

  const resolvedLabel = label || (payload.cwd ? path.basename(payload.cwd) : 'sessão');
  upsertSession(registry, { sessionId: payload.session_id, cwd: payload.cwd, label: resolvedLabel, owner }, now());

  if (!config.enabled) {
    persistRegistry(registry); // still track the session, just don't relay while disabled
    return { sent: false, reason: 'disabled' };
  }

  if (!shouldRelay(payload, config)) {
    persistRegistry(registry);
    return { sent: false, reason: 'granularity-filtered' };
  }

  const hasMultipleSessions = sessionsForOwner(registry, owner).length > 1;
  const text = formatMessage(payload, { label: resolvedLabel, hasMultipleSessions });
  if (text === null) {
    persistRegistry(registry);
    return { sent: false, reason: 'no-content' };
  }

  const chatId = chatIdForOwner(config, owner);
  if (!chatId) {
    appendLog(`handleHookEvent: owner "${owner}" has no registered chat id`);
    persistRegistry(registry);
    return { sent: false, reason: 'owner-not-registered' };
  }

  const sentMessage = await send(config, chatId, text);
  if (sentMessage?.message_id != null) {
    recordOutboundMessage(registry, sentMessage.message_id, payload.session_id, now());
  }
  persistRegistry(registry);
  return { sent: true };
}
