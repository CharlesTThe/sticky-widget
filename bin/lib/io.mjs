// Small file/format helpers shared by both CLIs.

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Read as UTF-8 and prove it round-trips. Re-encoding a file that was not UTF-8 would corrupt
 * it silently, and a corrupt output is far worse than a refusal.
 */
export function readTextFile(path) {
  const buffer = readFileSync(path);
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) {
    throw new Error(`${path} is not valid UTF-8; refusing to rewrite it`);
  }
  return { buffer, text };
}

export function writeTextFile(path, text) {
  const buffer = Buffer.from(text, 'utf8');
  writeFileSync(path, buffer);
  return buffer.length;
}

export function formatBytes(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  return `${sign}${(abs / (1024 * 1024)).toFixed(1)} MB`;
}

export function signedBytes(n) {
  return `${n >= 0 ? '+' : ''}${formatBytes(n)}`;
}

/** Worst-outcome aggregation across files: 1 beats 3 beats 0 beats 2. */
const SEVERITY = { 1: 3, 3: 2, 0: 1, 2: 0 };
export function worstExit(codes) {
  let worst = 2;
  for (const code of codes) {
    if (SEVERITY[code] > SEVERITY[worst]) worst = code;
  }
  return codes.length === 0 ? 1 : worst;
}
