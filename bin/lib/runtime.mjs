// Resolving the runtime artifact. The CLI treats it as an opaque blob: it is read from disk
// and inserted byte-for-byte, and nothing here inspects what it does.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST_RUNTIME = resolve(PACKAGE_ROOT, 'dist', 'widget.min.js');
export const SRC_RUNTIME = resolve(PACKAGE_ROOT, 'src', 'widget.js');

/**
 * §8 source-level invariant. A runtime carrying `</script` truncates its own script element;
 * one carrying `</body` puts a second body-closing token in every injected file, which is
 * exactly what defeated the previous generation's marker check.
 */
export function checkRuntimeSource(text) {
  const problems = [];
  for (const forbidden of ['</script', '</body']) {
    const at = text.toLowerCase().indexOf(forbidden);
    if (at !== -1) {
      problems.push(`runtime contains the literal "${forbidden}" at offset ${at}; it must be built by concatenation`);
    }
  }
  return problems;
}

/**
 * Resolution order: --runtime, then dist/widget.min.js, then src/widget.js (--dev forces src).
 * Returns { path, source, text } or { path: null, tried } when nothing exists.
 */
export function resolveRuntime({ runtimePath = null, dev = false } = {}) {
  const tried = [];
  const candidates = [];
  if (runtimePath) candidates.push({ path: resolve(runtimePath), source: 'flag' });
  else if (dev) candidates.push({ path: SRC_RUNTIME, source: 'src' });
  else {
    candidates.push({ path: DIST_RUNTIME, source: 'dist' });
    candidates.push({ path: SRC_RUNTIME, source: 'src' });
  }
  for (const candidate of candidates) {
    tried.push(candidate.path);
    if (!existsSync(candidate.path)) continue;
    const text = readFileSync(candidate.path, 'utf8');
    return { ...candidate, text, tried };
  }
  return { path: null, source: null, text: null, tried };
}

/**
 * Who wrote this file, as a fact rather than a claim. `build` is the hash of the exact runtime
 * bytes being embedded, so a comment carrying it can always be traced to one widget build —
 * including a runtime passed with --runtime or --dev, which no version number would describe.
 * `version` is the human-readable package version and may be null if it cannot be read.
 */
export function toolStamp(runtimeText) {
  return {
    name: 'fbw',
    version: packageVersion(),
    build: createHash('sha256').update(Buffer.from(runtimeText, 'utf8')).digest('hex').slice(0, 12),
  };
}

function packageVersion() {
  try {
    const raw = readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8');
    const version = JSON.parse(raw).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

export function runtimeNotFoundMessage(tried) {
  return `no widget runtime found. Tried:\n  ${tried.join('\n  ')}\nPass --runtime <path>, or build dist/widget.min.js.`;
}
