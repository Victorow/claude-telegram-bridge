#!/usr/bin/env node
// Builds a self-contained, single-executable binary for the current platform.
// ESM entry-point support in Node's SEA tooling is very recent and not yet
// reliably present across the Node versions people are likely to have
// installed for building (see design.md Decision: bundle to CJS). Bundling
// bin/bridge.js + all of src/ into one CommonJS file with esbuild sidesteps
// that entirely - esbuild is a build-time-only devDependency, never shipped
// to end users, who get a binary with the Node runtime already embedded.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, 'dist');
const bundlePath = path.join(distDir, 'bridge.cjs');
const seaConfigPath = path.join(distDir, 'sea-config.json');
const blobPath = path.join(distDir, 'sea-prep.blob');
const outputBinaryName = os.platform() === 'win32' ? 'claude-telegram-bridge.exe' : 'claude-telegram-bridge';
const outputBinaryPath = path.join(distDir, outputBinaryName);

async function main() {
  fs.mkdirSync(distDir, { recursive: true });

  console.log('Bundling bin/bridge.js (+ src/*) into a single CommonJS file...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'bin', 'bridge.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    target: 'node20',
  });

  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true }, null, 2)
  );

  console.log('Generating the SEA blob...');
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { stdio: 'inherit' });

  console.log(`Copying the Node binary to ${outputBinaryPath}...`);
  fs.copyFileSync(process.execPath, outputBinaryPath);
  fs.chmodSync(outputBinaryPath, 0o755);

  if (os.platform() === 'darwin') {
    // A copied Node binary carries a code signature that injection would invalidate.
    execFileSync('codesign', ['--remove-signature', outputBinaryPath]);
  }

  console.log('Injecting the application blob into the binary (postject)...');
  const postjectArgs = [
    '--yes',
    'postject',
    outputBinaryPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  if (os.platform() === 'win32') {
    // Windows binaries don't carry a Mach-O signature to worry about.
  } else if (os.platform() === 'darwin') {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  }
  execFileSync('npx', postjectArgs, { stdio: 'inherit', shell: os.platform() === 'win32' });

  if (os.platform() === 'darwin') {
    execFileSync('codesign', ['--sign', '-', outputBinaryPath]);
  }

  console.log(`\nDone: ${outputBinaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
