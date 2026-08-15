import { chatIdForOwner } from './config.js';

/**
 * A point-in-time snapshot of the bridge's configuration and activity,
 * with no dependency on a running polling loop - used by `status --json`
 * (see bin/bridge.js) so the desktop app's sidecar can answer it as a
 * quick one-shot call, whether or not the long-running `start` process
 * happens to be alive at the same moment.
 */
export function getStatusSnapshot(config, registry) {
  if (!config) {
    return { configured: false };
  }
  const sessions = Object.values(registry?.sessions ?? {});
  return {
    configured: true,
    enabled: config.enabled,
    granularity: config.granularity,
    connectedOwner: 'operator',
    connectedChatId: chatIdForOwner(config, 'operator') ?? null,
    sessionCount: sessions.length,
    lastActivity: sessions.length ? Math.max(...sessions.map((s) => s.lastActive)) : null,
  };
}
