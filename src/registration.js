import crypto from 'node:crypto';
import { chatIdForOwner } from './config.js';

/** Registers (or re-registers) a chat as belonging to the given owner. Used both by the first-run wizard (operator) and by invite-code redemption (invited owners). */
export function registerOwner(config, chatId, ownerId) {
  config.owners[String(chatId)] = ownerId;
  return config;
}

/** Generates a single-use invite code. Not yet consumed. */
export function createInvite(config, { ownerLabel = null, now = () => Date.now(), randomBytes = () => crypto.randomBytes(6).toString('hex') } = {}) {
  const code = randomBytes();
  config.invites[code] = { ownerLabel, consumed: false, createdAt: now() };
  return code;
}

/**
 * Redeems an invite code for a chat that is not yet an owner (or re-attempting).
 * Returns a result object describing what happened - callers use this to reply
 * to the chat without needing to inspect config internals.
 */
export function redeemInvite(config, chatId, code) {
  if (!code) {
    return { ok: false, reason: 'missing-code' };
  }
  const invite = config.invites[code];
  if (!invite) {
    return { ok: false, reason: 'unknown-code' };
  }
  if (invite.consumed) {
    return { ok: false, reason: 'already-used' };
  }
  const ownerId = invite.ownerLabel || `owner-${String(chatId)}`;
  invite.consumed = true;
  registerOwner(config, chatId, ownerId);
  return { ok: true, ownerId };
}

/** Turns config.invites into a displayable list. redeemedChatId is only resolved for labeled, consumed invites (an invite's ownerLabel *is* the resulting owner id once redeemed - see redeemInvite above) - an unlabeled invite's derived owner id (`owner-<chatId>`) is left alone rather than reverse-parsed, since --for-account is the project's only documented usage. */
export function listInvites(config) {
  return Object.entries(config.invites).map(([code, invite]) => ({
    code,
    ownerLabel: invite.ownerLabel,
    consumed: invite.consumed,
    createdAt: invite.createdAt,
    redeemedChatId: invite.consumed && invite.ownerLabel ? (chatIdForOwner(config, invite.ownerLabel) ?? null) : null,
  }));
}
