#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rootDir = path.dirname(desktopDir);
const binariesDir = path.join(desktopDir, 'src-tauri', 'binaries');

function hostTriple() {
  const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const match = output.match(/host:\s*(\S+)/);
  if (!match) {
    throw new Error('Could not determine the current Rust host target triple from `rustc -vV`');
  }
  return match[1];
}

function main() {
  console.log('Building the bridge sidecar binary (npm run build:sea)...');
  execFileSync('npm', ['run', 'build:sea'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const triple = hostTriple();
  const isWindows = process.platform === 'win32';
  const sourceName = isWindows ? 'claude-telegram-bridge.exe' : 'claude-telegram-bridge';
  const targetName = isWindows ? `bridge-${triple}.exe` : `bridge-${triple}`;

  fs.mkdirSync(binariesDir, { recursive: true });
  fs.copyFileSync(path.join(rootDir, 'dist', sourceName), path.join(binariesDir, targetName));
  fs.chmodSync(path.join(binariesDir, targetName), 0o755);

  console.log(`Sidecar ready at ${path.join(binariesDir, targetName)}`);
}

main();
