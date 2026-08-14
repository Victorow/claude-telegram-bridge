import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from './config.js';

/** Appends a line to the local bridge log. Never throws — logging must not itself break a fail-open path. */
export function appendLog(message) {
  try {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'bridge.log'), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Swallow - see doc comment above.
  }
}
