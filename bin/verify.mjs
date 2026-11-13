#!/usr/bin/env node
// Assert the nine invariants of architecture.md §8 against one or more injected files.
//
// Exit 0 if every file is valid, 1 otherwise (§9).

import { existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { verifyDocument } from './lib/doc.mjs';
import { readTextFile } from './lib/io.mjs';
import { checkRuntimeSource, resolveRuntime } from './lib/runtime.mjs';

const USAGE = `Usage: node bin/verify.mjs <file.html...> [--json] [--runtime <path>] [--quiet]

  --runtime <path>   runtime artifact to byte-compare against (invariant 7)
  --json             single JSON object on stdout, nothing else
  --quiet            suppress the human summary; exit code only
  -h, --help
`;

const OPTIONS = {
  json: { type: 'boolean', default: false },
  runtime: { type: 'string' },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

function shortPath(p) {
  const rel = relative(process.cwd(), p);
  return rel === '' || rel.startsWith('..') ? p : rel;
}

function main() {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true }));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    return 1;
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (positionals.length === 0) {
    process.stderr.write(`no files given.\n\n${USAGE}`);
    return 1;
  }

  // Invariant 7 is skipped, not failed, when no artifact is available: verify has to stay
  // usable on a machine that only ever received the injected file.
  const resolved = resolveRuntime({ runtimePath: values.runtime });
  const runtime = resolved.path === null ? null : resolved;
  if (runtime) {
    for (const problem of checkRuntimeSource(runtime.text)) {
      process.stderr.write(`warning: ${runtime.path}: ${problem}\n`);
    }
  }

  const results = [];
  for (const positional of positionals) {
    const file = resolve(positional);
    if (!existsSync(file) || !statSync(file).isFile()) {
      results.push({ file, valid: false, failures: [{ id: 'io', message: 'file does not exist' }], notes: [] });
      continue;
    }
    let text;
    try {
      ({ text } = readTextFile(file));
    } catch (err) {
      results.push({ file, valid: false, failures: [{ id: 'io', message: err.message }], notes: [] });
      continue;
    }
    const report = verifyDocument(text, { runtime });
    results.push({ file, valid: report.valid, failures: report.failures, notes: report.notes });
  }

  const exitCode = results.every((r) => r.valid) ? 0 : 1;

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ ok: exitCode === 0, exitCode, runtime: runtime?.path ?? null, results })}\n`);
    return exitCode;
  }

  for (const result of results) {
    if (result.valid) {
      if (!values.quiet) process.stdout.write(`ok        ${shortPath(result.file)}\n`);
      for (const note of result.notes) {
        if (!values.quiet) process.stdout.write(`          note: ${note}\n`);
      }
      continue;
    }
    process.stderr.write(`invalid   ${shortPath(result.file)}\n`);
    for (const failure of result.failures) {
      process.stderr.write(`          invariant ${failure.id}: ${failure.message}\n`);
    }
  }
  return exitCode;
}

process.exitCode = main();
