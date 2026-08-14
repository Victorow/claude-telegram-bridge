import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULTS = {
  botToken: null,
  owners: {}, // chatId (string) -> ownerId (string)
  invites: {}, // code (string) -> { ownerLabel: string|null, consumed: boolean, createdAt: number }
  enabled: true,
  granularity: 'default', // 'default' | 'verbose'
};

export function getConfigDir() {
  return process.env.BRIDGE_CONFIG_DIR || path.join(os.homedir(), '.claude-telegram-bridge');
}

export function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

export function validateConfig(config, configPath) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Config at ${configPath} must be a JSON object`);
  }
  if (typeof config.botToken !== 'string' || config.botToken.length === 0) {
    throw new Error(`Config at ${configPath} is missing a valid "botToken" string`);
  }
  if (config.owners !== undefined && (typeof config.owners !== 'object' || Array.isArray(config.owners))) {
    throw new Error(`Config at ${configPath} field "owners" must be an object`);
  }
  if (config.invites !== undefined && (typeof config.invites !== 'object' || Array.isArray(config.invites))) {
    throw new Error(`Config at ${configPath} field "invites" must be an object`);
  }
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error(`Config at ${configPath} field "enabled" must be a boolean`);
  }
  if (config.granularity !== undefined && !['default', 'verbose'].includes(config.granularity)) {
    throw new Error(`Config at ${configPath} field "granularity" must be "default" or "verbose"`);
  }
}

export function configExists() {
  return fs.existsSync(getConfigPath());
}

export function loadConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Config file at ${configPath} is not valid JSON: ${err.message}`);
  }
  validateConfig(parsed, configPath);
  return { ...DEFAULTS, ...parsed, owners: { ...parsed.owners }, invites: { ...parsed.invites } };
}

export function saveConfig(config) {
  validateConfig(config, getConfigPath());
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function createDefaultConfig(botToken) {
  return { ...DEFAULTS, botToken, owners: {}, invites: {} };
}

/** Reverse lookup: each owner maps to exactly one registered chat. */
export function chatIdForOwner(config, ownerId) {
  const entry = Object.entries(config.owners).find(([, owner]) => owner === ownerId);
  return entry?.[0];
}

