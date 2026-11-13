#!/usr/bin/env node
/*
  eval runner — deterministic, no browser, no model.

  Each scenario in evals/scenarios/*.json is a declarative triple: an input
  fixture, the exact command line the skill documents, and a list of
  assertions about the resulting bytes. Nothing here interprets intent; a
  scenario either holds or it does not.

  Why this exists separately from test/injector.test.mjs: the unit tests check
  the injector's internals against inputs they construct themselves. These
  check the SHIPPED artifacts — the real fixtures, the real CLI, the real
  dist bundle — against the invariants in references/architecture.md. They are
  the thing that would catch "the build changed and every output file is now
  subtly different".

  Run:  node evals/run.mjs              (report, exit 1 on any failure)
        node evals/run.mjs --update     (rewrite golden files, then report)
        node evals/run.mjs --filter add (only scenarios whose name matches)
*/
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, existsSync, rmSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCEN = join(ROOT, 'evals', 'scenarios');
const GOLD = join(ROOT, 'evals', 'golden');
// A private directory per run. This used to be a fixed `evals/.work` that every run deleted
// on startup, so two concurrent runs — an eval pass alongside `npm test`, which runs evals
// itself — deleted each other's in-flight inputs and reported the product as broken.
const WORK = mkdtempSync(join(tmpdir(), 'fbw-evals-'));
const ADD = join(ROOT, 'bin', 'add-feedback.mjs');
const VERIFY = join(ROOT, 'bin', 'verify.mjs');

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update');
const FILTER = (argv.find((a) => a.startsWith('--filter=')) || '').split('=')[1]
  || (argv.includes('--filter') ? argv[argv.indexOf('--filter') + 1] : null);

const FENCE_OPEN = /<!--fbw:begin \d+-->/g;
const FENCE_END = /<!--fbw:end-->/g;
const ISLAND_OPEN = '<script type="application/json" id="fbw-state">';
const CLOSE_SCRIPT = '</' + 'script>';
const LEGACY = ['sticky-feedback', 'STICKY_FEEDBACK', 'fbw2-root', 'fbe-root', 'FEEDBACK_EDIT'];

// ---------------------------------------------------------------- helpers

// spawnSync rather than execFileSync so stderr survives a SUCCESSFUL run. The old form
// returned `stderr: ''` whenever the exit code was 0, which made every warning invisible to
// the eval suite — and warnings are exactly what the interesting scenarios emit, since a
// warning does not change the exit code.
function run(cmd, args) {
  const proc = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (proc.error) return { code: 1, stdout: '', stderr: String(proc.error.message) };
  return {
    code: typeof proc.status === 'number' ? proc.status : 1,
    stdout: proc.stdout || '',
    stderr: proc.stderr || ''
  };
}

function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

function islandText(html) {
  const at = html.lastIndexOf(ISLAND_OPEN);
  if (at === -1) return null;
  const from = at + ISLAND_OPEN.length;
  const to = html.indexOf(CLOSE_SCRIPT, from);
  if (to === -1) return null;
  return html.slice(from, to);
}

// Content ranges of every element the HTML parser reads as text rather than markup.
// `pre` is deliberately not one of them: its content IS parsed markup.
const RAW_TEXT = /<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b/gi;

function rawTextRanges(text) {
  const out = [];
  const open = new RegExp(RAW_TEXT.source, 'gi');
  let m;
  while ((m = open.exec(text)) !== null) {
    let gt = -1;
    let quote = null;
    for (let i = m.index + 1; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '>') { gt = i + 1; break; }
    }
    if (gt === -1) break;
    const close = new RegExp('</' + m[1] + '\\s*>', 'gi');
    close.lastIndex = gt;
    const hit = close.exec(text);
    const end = hit ? hit.index : text.length;
    out.push({ name: m[1].toLowerCase(), start: gt, end });
    open.lastIndex = end;
  }
  return out;
}

// --------------------------------------------------------------- assertions
// Every checker returns null when it holds, or a human-readable reason.

const CHECKS = {
  exitCode: (ctx, want) => (ctx.result.code === want
    ? null : `exit code was ${ctx.result.code}, expected ${want}${ctx.result.stderr ? ' — ' + ctx.result.stderr.trim().split('\n')[0] : ''}`),

  fencePair: (ctx, want) => {
    if (!ctx.out) return 'no output file was produced';
    const o = countMatches(ctx.out, FENCE_OPEN), c = countMatches(ctx.out, FENCE_END);
    if (o !== want || c !== want) return `found ${o} opening and ${c} closing fences, expected ${want} of each`;
    return null;
  },

  // Invariant 2, in its correct form. The whole-file count is NOT asserted to
  // be 1 — a legitimate page can carry the token inside a JS string literal,
  // and edge-script-literals.html does exactly that. What must hold is that
  // injection never changes the count, and that the block contributes none.
  bodyCountStable: (ctx, want) => {
    if (!ctx.out) return 'no output file was produced';
    if (want === false) return null;
    const before = countMatches(ctx.input, /<\/body\s*>/gi);
    const after = countMatches(ctx.out, /<\/body\s*>/gi);
    return before === after ? null
      : `injection changed the closing-body count from ${before} to ${after}`;
  },

  // The block must be MARKUP, not text.
  //
  // `blockShape` and `bodyCountStable` both pass happily on a document where the whole
  // block was injected inside a <textarea> or a <title>: it adds no closing-body token and
  // its own shape is fine. It is simply rendered on the page as 41 KB of visible text, with
  // the runtime never executing — and verify reports the file as valid. That is the exact
  // failure class the masking in bin/lib/html.mjs exists to prevent, so it needs an
  // assertion of its own rather than relying on the others to notice.
  fenceOutsideRawText: (ctx) => {
    if (!ctx.out) return 'no output file was produced';
    const at = ctx.out.indexOf('<!--fbw:begin');
    if (at === -1) return 'fenced region not found';
    for (const r of rawTextRanges(ctx.out)) {
      if (at > r.start && at < r.end) {
        return `the block was injected INSIDE a <${r.name}> element (fence at ${at}, ` +
          `inside content ${r.start}..${r.end}). A browser renders it as page text and the ` +
          'runtime never runs.';
      }
    }
    return null;
  },

  blockShape: (ctx) => {
    if (!ctx.out) return 'no output file was produced';
    const s = ctx.out.indexOf('<!--fbw:begin');
    const e = ctx.out.indexOf('<!--fbw:end-->');
    if (s === -1 || e === -1) return 'fenced region not found';
    const block = ctx.out.slice(s, e);
    const scripts = countMatches(block, /<\/script\s*>/gi);
    const bodies = countMatches(block, /<\/body\s*>/gi);
    if (bodies !== 0) return `the injected block contains ${bodies} closing-body tokens — this is the bug that corrupted ten files in the wild`;
    if (scripts !== 2) return `the injected block contains ${scripts} closing-script tokens, expected exactly 2`;
    return null;
  },

  sentinel: (ctx, want) => {
    if (!ctx.out) return 'no output file was produced';
    const has = /<html[^>]*\sdata-fbw="[0-9a-f]{16}"/i.test(ctx.out);
    return has === want ? null : (want ? 'no data-fbw sentinel on the html tag' : 'unexpected sentinel present');
  },

  islandParses: (ctx) => {
    const t = islandText(ctx.out || '');
    if (t === null) return 'state island not found';
    try { JSON.parse(t); return null; } catch (e) { return 'state island is not valid JSON: ' + e.message; }
  },

  // The single most important safety property: a reviewer's comment can never
  // break out of the script tag, because < and > are unrepresentable inside it.
  islandEscaped: (ctx) => {
    const t = islandText(ctx.out || '');
    if (t === null) return 'state island not found';
    const bad = /[<>]/.exec(t);
    return bad ? `state island contains a raw "${bad[0]}" at offset ${bad.index}` : null;
  },

  noLegacyMarkers: (ctx) => {
    if (!ctx.out) return 'no output file was produced';
    const hit = LEGACY.find((m) => ctx.out.includes(m));
    return hit ? `prior-generation marker "${hit}" survived` : null;
  },

  commentCount: (ctx, want) => {
    const t = islandText(ctx.out || '');
    if (t === null) return 'state island not found';
    const n = JSON.parse(t).comments.length;
    return n === want ? null : `state holds ${n} comments, expected ${want}`;
  },

  verifyPasses: (ctx, want) => {
    if (!ctx.outPath) return 'no output file was produced';
    const r = run(process.execPath, [VERIFY, ctx.outPath]);
    const ok = r.code === 0;
    if (ok === want) return null;
    return want
      ? `verify rejected the output: ${(r.stderr || r.stdout).trim().split('\n')[0]}`
      : 'verify accepted a file it should have rejected';
  },

  byteDeltaUnder: (ctx, want) => {
    if (!ctx.out) return 'no output file was produced';
    const delta = Buffer.byteLength(ctx.out) - Buffer.byteLength(ctx.input);
    return delta < want ? null : `grew by ${delta} bytes, budget is ${want}`;
  },

  bytesUnchanged: (ctx, want) => {
    const same = ctx.out === ctx.input;
    if (same === want) return null;
    return want ? 'the file was rewritten when it should have been left alone' : 'the file was not modified';
  },

  preservesBOM: (ctx) => (ctx.input.charCodeAt(0) === 0xfeff && ctx.out && ctx.out.charCodeAt(0) !== 0xfeff
    ? 'the byte-order mark was dropped' : null),

  preservesCRLF: (ctx) => {
    if (!ctx.out || !ctx.input.includes('\r\n')) return null;
    // The injected block is always LF by contract; the host document's own
    // lines must survive untouched.
    const before = ctx.input.split('\r\n').length - 1;
    const kept = ctx.out.split('\r\n').length - 1;
    return kept >= before ? null : `host CRLF line endings were rewritten (${before} before, ${kept} after)`;
  },

  // Injecting the same input twice, into two different destinations, must
  // produce identical bytes. This is what makes golden files meaningful and
  // re-running the injector a verifiable no-op.
  deterministic: (ctx) => {
    if (!ctx.outPath) return 'no output file was produced';
    const twin = ctx.outPath.replace(/\.html$/, '.twin.html');
    const r = run(process.execPath, [ADD, ctx.inputPath, '--out', twin, ...ctx.extraArgs]);
    if (r.code !== 0 && r.code !== 3) return `the second run exited ${r.code}`;
    if (!existsSync(twin)) return 'the second run produced no file';
    const a = readFileSync(ctx.outPath), b = readFileSync(twin);
    rmSync(twin, { force: true });
    if (a.equals(b)) return null;
    const at = [...a].findIndex((v, i) => v !== b[i]);
    return `the two runs differ at byte ${at} (${a.length} vs ${b.length} bytes)`;
  },

  golden: (ctx, name) => {
    const path = join(GOLD, name);
    if (!ctx.out) return 'no output file was produced';
    if (UPDATE || !existsSync(path)) {
      mkdirSync(GOLD, { recursive: true });
      writeFileSync(path, ctx.out);
      return null;
    }
    const want = readFileSync(path, 'utf8');
    if (want === ctx.out) return null;
    const at = (() => { for (let i = 0; i < Math.max(want.length, ctx.out.length); i++) if (want[i] !== ctx.out[i]) return i; return -1; })();
    return `differs from golden ${name} at offset ${at}\n      golden: ${JSON.stringify(want.slice(at - 40, at + 40))}\n      actual: ${JSON.stringify(ctx.out.slice(at - 40, at + 40))}`;
  },

  producedFile: (ctx, want) => {
    const made = ctx.out !== null;
    if (made === want) return null;
    return want ? 'no output file was produced' : 'a file was written when none should have been';
  },

  stderrContains: (ctx, want) => (ctx.result.stderr.includes(want) || ctx.result.stdout.includes(want)
    ? null : `expected the message to mention "${want}"`)
};

// -------------------------------------------------------------------- run

function loadScenarios() {
  if (!existsSync(SCEN)) return [];
  return readdirSync(SCEN)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(SCEN, f), 'utf8')) }))
    .filter((s) => !FILTER || s.name.includes(FILTER) || s.file.includes(FILTER));
}

function prepare(scenario) {
  // Scenarios never mutate the fixtures. Everything runs on a copy.
  const src = join(ROOT, scenario.input);
  const stem = basename(scenario.input).replace(/\.html$/, '');
  const inputPath = join(WORK, `${scenario.name}__${stem}.html`);
  let bytes = readFileSync(src);
  if (scenario.transform === 'preInject') {
    // Give the scenario an already-injected file, so it can test the
    // re-run-is-a-no-op path rather than a first injection.
    const once = join(WORK, `${scenario.name}__pre.html`);
    const r = run(process.execPath, [ADD, src, '--out', once, ...(scenario.args || [])]);
    if (!existsSync(once)) throw new Error('pre-injection failed: ' + (r.stderr || r.stdout).trim());
    bytes = readFileSync(once);
    rmSync(once, { force: true });
  }
  if (scenario.transform === 'doubleInject') {
    // Build a genuinely double-injected file the way the real corruption
    // happened: inject once, then append a second copy of the block.
    const once = join(WORK, `${scenario.name}__once.html`);
    run(process.execPath, [ADD, src, '--out', once]);
    const t = readFileSync(once, 'utf8');
    const s = t.indexOf('<!--fbw:begin'), e = t.indexOf('<!--fbw:end-->') + '<!--fbw:end-->'.length;
    const block = t.slice(s, e);
    bytes = Buffer.from(t.slice(0, e) + '\n' + block + '\n' + t.slice(e), 'utf8');
    rmSync(once, { force: true });
  }
  writeFileSync(inputPath, bytes);
  return inputPath;
}

function execute(scenario) {
  const inputPath = prepare(scenario);
  const outPath = scenario.inPlace ? inputPath : inputPath.replace(/\.html$/, '.out.html');
  const extraArgs = scenario.args || [];
  const args = scenario.inPlace
    ? [ADD, inputPath, '--in-place', ...extraArgs]
    : [ADD, inputPath, '--out', outPath, ...extraArgs];

  const input = readFileSync(inputPath, 'utf8');
  const result = run(process.execPath, args);
  const out = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;

  return { inputPath, outPath: out === null ? null : outPath, input, out, result, extraArgs };
}

function main() {
  if (!existsSync(ADD)) {
    console.error('bin/add-feedback.mjs does not exist yet — nothing to evaluate.');
    process.exit(1);
  }
  mkdirSync(WORK, { recursive: true });

  const scenarios = loadScenarios();
  if (!scenarios.length) {
    console.error('no scenarios found in evals/scenarios/');
    process.exit(1);
  }

  let failed = 0;
  const rows = [];

  for (const s of scenarios) {
    let ctx;
    const problems = [];
    try {
      ctx = execute(s);
    } catch (err) {
      rows.push({ name: s.name, ok: false, problems: ['threw: ' + err.message] });
      failed++;
      continue;
    }
    for (const [key, want] of Object.entries(s.expect || {})) {
      const check = CHECKS[key];
      if (!check) { problems.push(`unknown assertion "${key}"`); continue; }
      let reason;
      try { reason = check(ctx, want); }
      catch (err) { reason = 'assertion threw: ' + err.message; }
      if (reason) problems.push(`${key}: ${reason}`);
    }
    if (problems.length) failed++;
    rows.push({ name: s.name, ok: !problems.length, problems, why: s.why });
  }

  const width = Math.max(...rows.map((r) => r.name.length), 10);
  console.log('');
  for (const r of rows) {
    console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.why || ''}`);
    for (const p of r.problems || []) console.log(`        ${p}`);
  }
  console.log('');
  console.log(`  ${rows.length - failed}/${rows.length} scenarios passed${UPDATE ? ' (golden files rewritten)' : ''}`);
  console.log('');

  if (!failed) rmSync(WORK, { recursive: true, force: true });
  else console.log(`  working files kept for inspection: ${WORK}`);

  process.exit(failed ? 1 : 0);
}

main();
