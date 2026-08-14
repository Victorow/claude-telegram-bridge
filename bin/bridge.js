#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from '../src/config.js';
import { loadRegistry, saveRegistry } from '../src/registry.js';
import { runFirstRunWizard } from '../src/wizard.js';
import { installAccount, uninstallAccount, defaultClaudeSettingsPath, defaultHookInvocation } from '../src/installer.js';
import { registerService } from '../src/service.js';
import { runPollingLoop, sendMessage } from '../src/gateway.js';
import { handleInboundMessage } from '../src/inputRelay.js';
import { redeemInvite, createInvite } from '../src/registration.js';
import { handleHookEvent } from '../src/outputRelay.js';
import { appendLog } from '../src/log.js';

// `import.meta.url` is only meaningful when this file runs as real ESM
// source. Bundled into a CJS SEA binary (see scripts/build-sea.mjs), esbuild
// leaves `import.meta` empty, so this throws - which is exactly the signal
// we use to detect "this IS the packaged binary" (in that case the running
// executable's own path, `process.execPath`, is what other commands need,
// not a script path on disk).
let bridgeScriptPath = null;
try {
  bridgeScriptPath = fileURLToPath(import.meta.url);
} catch {
  // Packaged mode - see comment above.
}
const isPackaged = bridgeScriptPath === null;

// One entry point serves the CLI (start/install/uninstall/invite) and the
// hook handler (`hook` subcommand) alike - required so this can later be
// packaged as a single self-contained binary (Fase 9), which can only embed
// one main script. In source mode the hook command is `node bridge.js hook`;
// once packaged, it becomes `<binary> hook` directly (see defaultHookInvocation).
function ensureAccountInstalled({ owner = 'operator', settingsPath = defaultClaudeSettingsPath() } = {}) {
  const { command, args } = defaultHookInvocation(
    isPackaged ? { owner, packagedBinaryPath: process.execPath } : { owner, hookScriptPath: bridgeScriptPath }
  );
  return installAccount({ settingsPath, command, args });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function cmdHook(args) {
  const { values } = parseArgs({ args, options: { owner: { type: 'string' }, label: { type: 'string' } } });
  try {
    const raw = await readStdin();
    const payload = JSON.parse(raw);
    await handleHookEvent(payload, { owner: values.owner, label: values.label });
  } catch (err) {
    appendLog(`hook error: ${err?.stack || err}`);
  }
  // Fail open, always: exit 0 no matter what. Exit code 2 specifically tells
  // Claude Code "don't stop" - something this hook must never trigger.
  process.exit(0);
}

function registerAutostart() {
  try {
    const { command, args } = isPackaged
      ? { command: process.execPath, args: ['start'] }
      : { command: process.execPath, args: [bridgeScriptPath, 'start'] };
    registerService({ command, args, execFileSyncFn: execFileSync });
  } catch (err) {
    // Non-fatal: the bridge still works in foreground even if autostart registration fails
    // (e.g. unsupported platform, missing schtasks/launchctl/systemctl on a minimal system).
    appendLog(`autostart registration skipped/failed: ${err.message}`);
    console.warn(`Aviso: não consegui registrar o início automático (${err.message}). Rode "start" manualmente quando precisar.`);
  }
}

async function cmdStart() {
  const wizardResult = await runFirstRunWizard();
  if (wizardResult.ranWizard) {
    console.log(`Bot configurado. Chat autorizado: ${wizardResult.chatId}`);
    registerAutostart(); // once, right after first-run setup - not on every subsequent manual start
  }

  ensureAccountInstalled({ owner: 'operator' }); // idempotent - also self-heals if hooks were removed by hand

  const config = loadConfig();
  if (!config) {
    console.error('Configuração ausente mesmo após o assistente. Abortando.');
    process.exitCode = 1;
    return;
  }
  const registry = loadRegistry();

  console.log('Bridge rodando (Ctrl+C para parar)...');
  await runPollingLoop(
    config,
    {
      onRegister: async (chatId, code) => {
        const result = redeemInvite(config, chatId, code);
        saveConfig(config);
        await sendMessage(
          config,
          chatId,
          result.ok ? 'Registrado! Agora você pode conversar por aqui.' : 'Código de convite inválido ou já usado.'
        );
      },
      onToggle: async (chatId, enabled) => {
        config.enabled = enabled;
        saveConfig(config);
        await sendMessage(config, chatId, enabled ? '✅ Integração ligada.' : '⏸️ Integração desligada.');
      },
      onMessage: async (chatId, ownerId, message) => {
        await handleInboundMessage(config, registry, ownerId, {
          replyToMessageId: message.reply_to_message?.message_id,
          text: message.text,
          chatId,
        });
        saveRegistry(registry);
      },
    },
    { onError: (err) => appendLog(`polling loop error: ${err?.stack || err}`) }
  );
}

function cmdInvite(args) {
  const config = loadConfig();
  if (!config) {
    console.error('Rode "start" pelo menos uma vez antes de convidar alguém.');
    process.exitCode = 1;
    return;
  }
  const { values } = parseArgs({ args, options: { 'for-account': { type: 'string' } } });
  const code = createInvite(config, { ownerLabel: values['for-account'] || null });
  saveConfig(config);
  console.log(`Código de convite: ${code}`);
  console.log(`Peça para a pessoa mandar "/register ${code}" para o bot.`);
}

function cmdInstall(args) {
  const { values } = parseArgs({ args, options: { owner: { type: 'string' }, 'settings-path': { type: 'string' } } });
  const owner = values.owner || 'operator';
  const settingsPath = values['settings-path'] || defaultClaudeSettingsPath();
  ensureAccountInstalled({ owner, settingsPath });
  console.log(`Hooks instalados para o dono "${owner}" em ${settingsPath}`);
}

function cmdUninstall(args) {
  const { values } = parseArgs({ args, options: { owner: { type: 'string' }, 'settings-path': { type: 'string' } } });
  const owner = values.owner || 'operator';
  const settingsPath = values['settings-path'] || defaultClaudeSettingsPath();
  const { command, args: hookArgs } = defaultHookInvocation(
    isPackaged ? { owner, packagedBinaryPath: process.execPath } : { owner, hookScriptPath: bridgeScriptPath }
  );
  uninstallAccount({ settingsPath, command, args: hookArgs });
  console.log(`Hooks removidos para o dono "${owner}" em ${settingsPath}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'start':
      return cmdStart();
    case 'install':
      return cmdInstall(rest);
    case 'uninstall':
      return cmdUninstall(rest);
    case 'invite':
      return cmdInvite(rest);
    case 'hook':
      return cmdHook(rest);
    default:
      console.log('Uso: claude-telegram-bridge <start|install|uninstall|invite>');
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exitCode = 1;
});
