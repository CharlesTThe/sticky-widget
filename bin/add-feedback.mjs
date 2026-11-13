#!/usr/bin/env node
// Drop the feedback widget into an HTML file.
//
// Exit codes are a public contract (§9): 0 injected, 1 error (nothing written),
// 2 already current (no-op), 3 upgraded from a prior generation or healed.

import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { planInjection, verifyDocument } from './lib/doc.mjs';
import { formatBytes, readTextFile, signedBytes, worstExit, writeTextFile } from './lib/io.mjs';
import { checkRuntimeSource, resolveRuntime, runtimeNotFoundMessage } from './lib/runtime.mjs';
import { POSITIONS } from './lib/state.mjs';

const USAGE = `Usage: node bin/add-feedback.mjs <input.html...> [options]

  --out <file|dir>   output path; a directory means "same basename, in here".
                     Default: alongside the input as "<name> - feedback - YYYYMMDD.html"
  --in-place         overwrite the input (writes a .bak sibling first)
  --accent <color>   pin/button accent; omitted means auto-detect in the browser
  --position <pos>   ${POSITIONS[0]} (default) | ${POSITIONS[1]}
  --endpoint <url>   send comments to a feedback server instead of saving them into the
                     file; every copy of the document then shares one set of comments.
                     Absolute http(s) URL; '' removes it again.
  --write-key <key>  the server's WRITE_KEY, sent with every request (it is readable by
                     anyone who opens the file, like the endpoint); '' removes it again.
  --runtime <path>   runtime artifact to embed (default dist/widget.min.js, then src/widget.js)
  --dev              use src/widget.js instead of dist/widget.min.js
  --check            report what would happen; write nothing; exit code still meaningful
  --json             single JSON object on stdout, nothing else
  --quiet            suppress the human summary
  -h, --help
`;

const OPTIONS = {
  out: { type: 'string' },
  'in-place': { type: 'boolean', default: false },
  accent: { type: 'string' },
  position: { type: 'string' },
  endpoint: { type: 'string' },
  'write-key': { type: 'string' },
  runtime: { type: 'string' },
  dev: { type: 'boolean', default: false },
  check: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

function datestamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function defaultOutPath(inputPath) {
  const ext = extname(inputPath) || '.html';
  return join(dirname(inputPath), `${basename(inputPath, extname(inputPath))} - feedback - ${datestamp()}${ext}`);
}

function resolveOutPath(inputPath, values) {
  if (values['in-place']) return inputPath;
  if (values.out !== undefined) {
    const target = resolve(values.out);
    if (existsSync(target) && statSync(target).isDirectory()) return join(target, basename(inputPath));
    return target;
  }
  return defaultOutPath(inputPath);
}

function shortPath(p) {
  const rel = relative(process.cwd(), p);
  return rel === '' || rel.startsWith('..') ? p : rel;
}

function processFile(inputPath, { runtime, values }) {
  const result = {
    file: inputPath,
    out: null,
    action: 'error',
    exitCode: 1,
    written: false,
    docId: null,
    comments: 0,
    migrated: { v1: 0, v2: 0, fbe: 0, dropped: 0 },
    priorGenerations: [],
    fences: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    delta: 0,
    warnings: [],
    errors: [],
  };

  if (!existsSync(inputPath) || !statSync(inputPath).isFile()) {
    result.errors.push(`${inputPath} does not exist or is not a file`);
    return result;
  }

  const { buffer, text: rawText } = readTextFile(inputPath);
  result.bytesBefore = buffer.length;

  const outPath = resolveOutPath(inputPath, values);
  result.out = outPath;
  if (!values['in-place'] && outPath === inputPath) {
    result.errors.push('refusing to overwrite the input without --in-place');
    return result;
  }
  if (!existsSync(dirname(outPath))) {
    result.errors.push(`output directory ${dirname(outPath)} does not exist`);
    return result;
  }

  const plan = planInjection({
    rawText,
    runtimeText: runtime.text,
    options: {
      accent: values.accent,
      position: values.position,
      endpoint: values.endpoint,
      writeKey: values['write-key'],
    },
  });

  result.warnings.push(...plan.warnings);
  result.docId = plan.docId;
  result.priorGenerations = plan.generations;
  result.migrated = plan.migration.counts;
  result.fences = plan.regions.length;
  result.comments = plan.state?.comments?.length ?? 0;

  if (plan.errors.length > 0 || plan.out === null) {
    result.errors.push(...plan.errors);
    return result;
  }

  // Self-verify the exact bytes that are about to land on disk. A corrupt output is far worse
  // than a refusal, and this is the only place that can catch a stripper that ate too much.
  const check = verifyDocument(plan.out, { runtime });
  if (!check.valid) {
    for (const f of check.failures) result.errors.push(`invariant ${f.id}: ${f.message}`);
    result.errors.push('self-verification failed; nothing was written');
    return result;
  }

  const outBuffer = Buffer.from(plan.out, 'utf8');
  result.bytesAfter = outBuffer.length;
  result.delta = outBuffer.length - buffer.length;

  const targetExists = existsSync(outPath) && statSync(outPath).isFile();
  const targetMatches = targetExists && readFileSync(outPath).equals(outBuffer);
  if (targetMatches) {
    // Already current: do not rewrite, do not touch mtime, do not make a .bak.
    result.action = 'unchanged';
    result.exitCode = 2;
    result.delta = 0;
    return result;
  }

  const upgraded = plan.regions.length > 0 || plan.generations.length > 0;
  result.action = upgraded ? 'upgraded' : 'injected';
  result.exitCode = upgraded ? 3 : 0;

  if (values.check) return result;

  if (values['in-place']) copyFileSync(inputPath, `${inputPath}.bak`);
  writeTextFile(outPath, plan.out);
  result.written = true;
  return result;
}

function describe(result, check) {
  const verb = { injected: 'injected', upgraded: 'upgraded', unchanged: 'unchanged', error: 'failed' }[result.action];
  const prefix = check && result.action !== 'unchanged' && result.action !== 'error' ? 'would be ' : '';
  const label = `${prefix}${verb}`.padEnd(16);
  if (result.action === 'error') return `${label} ${shortPath(result.file)}`;
  if (result.action === 'unchanged') {
    // Name the OUTPUT. With --out it is the output that was already current; the input was
    // never in that state, and pointing the operator at it sends them to inspect a clean file.
    if (result.out !== null && result.out !== result.file) {
      return `${label} ${shortPath(result.file)} -> ${shortPath(result.out)}  ` +
        `(output already current, ${formatBytes(result.bytesAfter)} total)`;
    }
    return `${label} ${shortPath(result.file)}  (already current, ${formatBytes(result.bytesAfter)} total)`;
  }
  const migrated = result.migrated.v2 + result.migrated.fbe;
  const extra = [];
  if (result.priorGenerations.length > 0) extra.push(`from ${result.priorGenerations.join('+')}`);
  if (result.fences > 1) extra.push(`healed ${result.fences} fences`);
  if (migrated > 0) extra.push(`${migrated} comment(s) migrated`);
  if (result.migrated.dropped > 0) extra.push(`${result.migrated.dropped} dropped`);
  const suffix = extra.length > 0 ? `  [${extra.join(', ')}]` : '';
  return `${label} ${shortPath(result.file)} -> ${shortPath(result.out)}  ` +
    `${signedBytes(result.delta)} (${formatBytes(result.bytesAfter)} total)${suffix}`;
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
    process.stderr.write(`no input files given.\n\n${USAGE}`);
    return 1;
  }
  if (values.position !== undefined && !POSITIONS.includes(values.position)) {
    process.stderr.write(`--position must be one of ${POSITIONS.join(', ')}\n`);
    return 1;
  }
  // A file is opened from disk as often as from a server, and a relative URL means nothing to
  // a page at file://, so only an absolute one works everywhere the file goes.
  if (values.endpoint !== undefined && values.endpoint !== '' && !/^https?:\/\/\S+$/.test(values.endpoint)) {
    process.stderr.write('--endpoint must be an absolute http(s) URL, e.g. https://feedback.example.com/api/feedback\n');
    return 1;
  }
  if (values['write-key'] !== undefined && !/^[!-~]{0,200}$/.test(values['write-key'])) {
    process.stderr.write('--write-key must be printable ASCII without spaces, at most 200 characters\n');
    return 1;
  }
  if (values.out !== undefined && values['in-place']) {
    process.stderr.write('--out and --in-place are mutually exclusive\n');
    return 1;
  }
  if (positionals.length > 1 && values.out !== undefined) {
    const target = resolve(values.out);
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      process.stderr.write('--out must be an existing directory when several inputs are given\n');
      return 1;
    }
  }

  const runtime = resolveRuntime({ runtimePath: values.runtime, dev: values.dev });
  if (runtime.path === null) {
    const message = runtimeNotFoundMessage(runtime.tried);
    if (values.json) process.stdout.write(`${JSON.stringify({ ok: false, exitCode: 1, error: message, results: [] })}\n`);
    else process.stderr.write(`${message}\n`);
    return 1;
  }
  const sourceProblems = checkRuntimeSource(runtime.text);
  if (sourceProblems.length > 0) {
    const message = `${runtime.path}: ${sourceProblems.join('; ')}`;
    if (values.json) process.stdout.write(`${JSON.stringify({ ok: false, exitCode: 1, error: message, results: [] })}\n`);
    else process.stderr.write(`${message}\n`);
    return 1;
  }

  const results = [];
  for (const positional of positionals) {
    const inputPath = resolve(positional);
    try {
      results.push(processFile(inputPath, { runtime, values }));
    } catch (err) {
      results.push({
        file: inputPath, out: null, action: 'error', exitCode: 1, written: false,
        docId: null, comments: 0, migrated: { v1: 0, v2: 0, fbe: 0, dropped: 0 }, priorGenerations: [],
        fences: 0, bytesBefore: 0, bytesAfter: 0, delta: 0, warnings: [], errors: [err.message],
      });
    }
  }

  const exitCode = worstExit(results.map((r) => r.exitCode));

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ ok: exitCode !== 1, exitCode, runtime: runtime.path, results })}\n`);
    return exitCode;
  }

  for (const result of results) {
    for (const warning of result.warnings) process.stderr.write(`warning: ${shortPath(result.file)}: ${warning}\n`);
    for (const error of result.errors) process.stderr.write(`error: ${shortPath(result.file)}: ${error}\n`);
    if (!values.quiet) process.stdout.write(`${describe(result, values.check)}\n`);
  }
  return exitCode;
}

process.exitCode = main();
