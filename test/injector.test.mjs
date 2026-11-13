// Unit tests for bin/add-feedback.mjs and bin/verify.mjs.
//
// Everything these tests read is written by these tests: test/fixtures is owned by another
// component and may not exist yet. Run with: node --test test/injector.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TMP = resolve(HERE, 'tmp');
const ADD = resolve(ROOT, 'bin', 'add-feedback.mjs');
const VERIFY = resolve(ROOT, 'bin', 'verify.mjs');
const STUB = resolve(TMP, 'stub-runtime.js');

// The stub stands in for dist/widget.min.js. Per the §8 source-level invariant it must not
// contain a script- or body-closing token.
const STUB_SOURCE = "console.info('fbw stub runtime');\n";

const ISLAND_OPEN = '<script type="application/json" id="fbw-state">';
const FENCE_BEGIN = '<!--fbw:begin 1-->';
const FENCE_END = '<!--fbw:end-->';

let counter = 0;

function tmpPath(name) {
  counter += 1;
  return join(TMP, `${String(counter).padStart(3, '0')}-${name}`);
}

function write(name, content) {
  const path = tmpPath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(content, 'utf8'));
  return path;
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function run(script, args) {
  const proc = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  if (proc.error) throw proc.error;
  return { code: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}

function inject(args) {
  return run(ADD, [...args, '--runtime', STUB]);
}

function verify(args) {
  return run(VERIFY, [...args, '--runtime', STUB]);
}

function injectJson(args) {
  const proc = inject([...args, '--json']);
  return { ...proc, json: JSON.parse(proc.stdout) };
}

function islandOf(text) {
  const start = text.indexOf(ISLAND_OPEN);
  assert.notEqual(start, -1, 'no state island in output');
  const from = start + ISLAND_OPEN.length;
  const to = text.indexOf('</script>', from);
  return text.slice(from, to);
}

function stateOf(text) {
  return JSON.parse(islandOf(text));
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const PAGE = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Network Density Review</title></head>',
  '<body>',
  '  <h2 id="kpi">Uplift 3.2x</h2>',
  '</body>',
  '</html>',
  '',
].join('\n');

before(() => {
  // A previous run's outputs would otherwise be picked up as "already current" (exit 2),
  // so every run starts from an empty scratch directory.
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(STUB, STUB_SOURCE);
});

describe('clean injection', () => {
  it('injects, verifies, and leaves exactly one fence pair and one </body>', () => {
    const input = write('clean.html', PAGE);
    const out = tmpPath('clean.out.html');

    const result = inject([input, '--out', out]);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(existsSync(out));

    const text = read(out);
    assert.equal(count(text, FENCE_BEGIN), 1);
    assert.equal(count(text, FENCE_END), 1);
    assert.equal(count(text, '</body>'), 1);
    assert.equal(count(text, ISLAND_OPEN), 1);
    assert.equal(count(text, '<script id="fbw-core">'), 1);

    // The runtime goes in byte-for-byte.
    assert.ok(text.includes(`<script id="fbw-core">${STUB_SOURCE}</script>`));

    // The block sits immediately before the last </body>, in the fixed §1 layout.
    assert.ok(text.includes(`\n${FENCE_END}\n</body>`));
    assert.match(text, /<html data-fbw="[0-9a-f]{16}" lang="en">/);

    const state = stateOf(text);
    assert.equal(state.v, 2);
    assert.equal(state.title, 'Network Density Review');
    // The tool stamp names the build that wrote the file. `build` is the hash of the runtime
    // bytes actually embedded, which here is the stub this suite injects, so it is asserted
    // as a shape rather than a constant.
    assert.equal(state.tool.name, 'fbw');
    assert.match(state.tool.build, /^[0-9a-f]{12}$/);
    assert.deepEqual(state.config, { accent: null, position: 'bottom-right', captureConsole: false });
    assert.deepEqual(state.comments, []);
    assert.deepEqual(state.tombstones, []);
    assert.match(state.docId, /^[0-9a-f]{16}$/);

    assert.equal(verify([out]).code, 0);
  });

  it('carries the CLI options into the state island', () => {
    const input = write('opts.html', PAGE);
    const out = tmpPath('opts.out.html');
    const result = inject([input, '--out', out, '--accent', '#ff0055', '--position', 'bottom-left']);
    assert.equal(result.code, 0, result.stderr);

    const state = stateOf(read(out));
    assert.equal(state.config.accent, '#ff0055');
    assert.equal(state.config.position, 'bottom-left');
    // Still written for every file so the island layout and invariant 6 are unchanged,
    // but nothing can set it any more: no runtime has ever read it.
    assert.equal(state.config.captureConsole, false);
    assert.ok(!('author' in state.config), 'a fresh injection must seed no reviewer identity');
  });

  it('refuses the two flags that never changed any behaviour', () => {
    const input = write('deadflags.html', PAGE);
    for (const args of [['--capture-console'], ['--author', 'Jo Doe']]) {
      const result = inject([input, '--out', tmpPath('deadflags.out.html'), ...args]);
      assert.equal(result.code, 1, `${args[0]} should no longer be accepted:\n${result.stdout}`);
      assert.match(result.stderr, /unknown option/i, result.stderr);
    }
  });

  it('preserves an identity that is already in the island it re-injects', () => {
    // Removing --author must not mean silently dropping a name from a file in the wild.
    const first = tmpPath('identity.out.html');
    assert.equal(inject([write('identity.html', PAGE), '--out', first]).code, 0);

    const seeded = read(first).replace('"captureConsole":false', '"captureConsole":false,"author":{"name":"Jo Doe","email":null}');
    const carrier = write('identity-seeded.html', seeded);

    const out = tmpPath('identity-again.out.html');
    const result = inject([carrier, '--out', out]);
    assert.equal(result.code, 3, result.stderr); // re-injecting an injected file is an upgrade
    assert.deepEqual(stateOf(read(out)).config.author, { name: 'Jo Doe', email: null });
  });

  it('reports the byte delta and the resulting total size', () => {
    const input = write('summary.html', PAGE);
    const out = tmpPath('summary.out.html');
    const result = inject([input, '--out', out]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /injected/);
    assert.match(result.stdout, /\+\d/);
    assert.match(result.stdout, /total/);
  });

  it('honours --quiet and --json', () => {
    const input = write('json.html', PAGE);
    const out = tmpPath('json.out.html');
    const quiet = inject([input, '--out', out, '--quiet']);
    assert.equal(quiet.code, 0);
    assert.equal(quiet.stdout, '');

    const out2 = tmpPath('json2.out.html');
    const { code, json, stdout } = injectJson([input, '--out', out2]);
    assert.equal(code, 0);
    assert.equal(stdout.trimEnd(), JSON.stringify(json));
    assert.equal(json.exitCode, 0);
    assert.equal(json.results.length, 1);
    assert.equal(json.results[0].action, 'injected');
    assert.equal(json.results[0].written, true);
    assert.equal(json.results[0].bytesAfter, statSync(out2).size);
    assert.equal(json.results[0].delta, json.results[0].bytesAfter - json.results[0].bytesBefore);
  });
});

describe('determinism', () => {
  it('produces byte-identical output for the same input', () => {
    const input = write('det.html', PAGE);
    const a = tmpPath('det.a.html');
    const b = tmpPath('det.b.html');
    assert.equal(inject([input, '--out', a]).code, 0);
    assert.equal(inject([input, '--out', b]).code, 0);
    assert.ok(readFileSync(a).equals(readFileSync(b)), 'two injections of the same input differ');
  });

  it('derives the same docId from two copies of the same document', () => {
    const one = write('copy1.html', PAGE);
    const two = write('copy2.html', PAGE);
    const outOne = tmpPath('copy1.out.html');
    const outTwo = tmpPath('copy2.out.html');
    inject([one, '--out', outOne]);
    inject([two, '--out', outTwo]);
    assert.equal(stateOf(read(outOne)).docId, stateOf(read(outTwo)).docId);
  });
});

describe('idempotency', () => {
  it('re-running in place is a no-op: exit 2, bytes and mtime unchanged', () => {
    const input = write('idem.html', PAGE);
    assert.equal(inject([input, '--in-place']).code, 0);

    const before = readFileSync(input);
    const mtimeBefore = statSync(input).mtimeMs;

    const second = inject([input, '--in-place']);
    assert.equal(second.code, 2, second.stderr);
    assert.ok(readFileSync(input).equals(before), 'bytes changed on the no-op run');
    assert.equal(statSync(input).mtimeMs, mtimeBefore, 'mtime changed on the no-op run');
  });

  it('does not create a .bak on the no-op run', () => {
    const input = write('idem-bak.html', PAGE);
    assert.equal(inject([input, '--in-place']).code, 0);
    rmSync(`${input}.bak`);
    const second = inject([input, '--in-place']);
    assert.equal(second.code, 2);
    assert.equal(existsSync(`${input}.bak`), false, 'a .bak was written for a no-op');
  });

  it('writes a .bak before overwriting in place', () => {
    const input = write('bak.html', PAGE);
    assert.equal(inject([input, '--in-place']).code, 0);
    assert.equal(read(`${input}.bak`), PAGE);
  });
});

describe('healing and upgrades', () => {
  it('heals a double injection back to a single fence', () => {
    const input = write('double-src.html', PAGE);
    const single = tmpPath('double.single.html');
    assert.equal(inject([input, '--out', single]).code, 0);

    const injected = read(single);
    const blockStart = injected.indexOf(`\n${FENCE_BEGIN}`);
    const blockEnd = injected.indexOf(FENCE_END) + FENCE_END.length + 1;
    const block = injected.slice(blockStart, blockEnd);
    const doubled = write('doubled.html', injected.replace('</body>', `${block}</body>`));
    assert.equal(count(read(doubled), FENCE_BEGIN), 2);

    const healed = tmpPath('doubled.out.html');
    const result = inject([doubled, '--out', healed]);
    assert.equal(result.code, 3, result.stderr);
    const text = read(healed);
    assert.equal(count(text, FENCE_BEGIN), 1);
    assert.equal(count(text, FENCE_END), 1);
    assert.equal(text, injected, 'healing did not reproduce the single-injection bytes');
    assert.equal(verify([healed]).code, 0);
  });

  it('migrates a v2 seed with the §6 field mapping', () => {
    const v2 = write('v2.html', [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head><title>V2 Deck</title></head>',
      '<body>',
      '  <h2 id="kpi">Uplift 3.2x</h2>',
      '<!-- sticky-feedback-v2 drop-in -->',
      '<div id="fbw2-root"><button class="fbw2-open">Feedback</button></div>',
      '<script>',
      'const STICKY_FEEDBACK_V2_SEED = [',
      '{"id":"1727","timestamp":"2026-01-02T03:04:05.000Z","editedAt":"2026-02-03T04:05:06.000Z",',
      ' "comment":"The CAGR here does not match slide 4.","originalComment":"CAGR wrong",',
      ' "resolved":true,"user":"Jo Doe",',
      ' "target":{"selector":"body>h2:nth-of-type(1)","label":"Pipeline uplift","tagName":"H2"},',
      ' "selectedText":"3.2x"},',
      '{"id":"c-abc","timestamp":1735689600000,"comment":"second note",',
      ' "target":{"selector":"div:nth-child(2)"},"selectedText":"Uplift"}',
      '];',
      '</script>',
      '<!-- /sticky-feedback-v2 -->',
      '</body>',
      '</html>',
      '',
    ].join('\n'));

    const out = tmpPath('v2.out.html');
    const result = injectJson([v2, '--out', out]);
    assert.equal(result.code, 3, result.stderr);
    assert.deepEqual(result.json.results[0].priorGenerations, ['v2']);
    assert.equal(result.json.results[0].migrated.v2, 2);

    const text = read(out);
    assert.equal(verify([out]).code, 0);
    assert.ok(!text.includes('fbw2-root'));
    assert.ok(!text.includes('STICKY_FEEDBACK_V2_SEED'));
    assert.ok(!text.includes('sticky-feedback'));
    assert.ok(text.includes('Uplift 3.2x'), 'host content was damaged by the strip');

    const state = stateOf(text);
    assert.equal(state.comments.length, 2);
    assert.deepEqual(state.comments[0], {
      id: 'c-1727',
      schemaVersion: 1,
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z',
      author: { name: 'Jo Doe', email: null },
      text: 'The CAGR here does not match slide 4.',
      originalText: 'CAGR wrong',
      resolved: true,
      // A migrated comment predates both: it was written by a widget that could not rewrite
      // text and did not stamp its build. Written explicitly as null rather than left out,
      // so every comment in an island carries the same key set.
      toolBuild: null,
      rewrite: null,
      anchor: {
        tag: 'h2',
        id: null,
        path: 'body>h2:nth-of-type(1)',
        aria: 'Pipeline uplift',
        sig: null,
        quote: { exact: '3.2x', prefix: null, suffix: null },
        hint: null,
      },
    });
    // An unrooted v2 selector is discarded (§6); the quote keeps the comment anchorable.
    assert.equal(state.comments[1].id, 'c-abc');
    assert.equal(state.comments[1].anchor.path, null);
    assert.equal(state.comments[1].createdAt, '2025-01-01T00:00:00.000Z');
    assert.equal(state.comments[1].anchor.quote.exact, 'Uplift');
  });

  it('gives an upgraded file the same docId as the clean original', () => {
    // §4 promises this, and the reviewer's crash-recovery buffer depends on it: the storage
    // key is `fbw:<docId>`. The stripper used to remove a prior generation's markup but
    // leave the blank lines it sat in, so the pristine text of an upgraded file differed
    // from the same document injected clean — different whitespace, different sha256.
    const original = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head><meta charset="utf-8"><title>Deck</title></head>',
      '<body>',
      '<section id="s1"><h1>Revenue</h1><p class="kpi">3.2x</p></section>',
      '</body>',
      '</html>',
      '',
    ].join('\n');

    // The same document with a v2 widget glued on the way v2 actually did it: a fence
    // comment, a root div and a seed script, each alone on its own line.
    const withV2 = original.replace('</body>', [
      '<!-- sticky-feedback-v2 drop-in -->',
      '<div id="fbw2-root"></div>',
      '<script>var STICKY_FEEDBACK_V2_SEED = [];</scr' + 'ipt>',
      '<!-- /sticky-feedback-v2 drop-in -->',
      '</body>',
    ].join('\n'));

    const cleanOut = tmpPath('stable-clean.out.html');
    const upgradedOut = tmpPath('stable-upgraded.out.html');
    assert.equal(inject([write('stable-clean.html', original), '--out', cleanOut]).code, 0);
    assert.equal(inject([write('stable-v2.html', withV2), '--out', upgradedOut]).code, 3);

    const a = stateOf(read(cleanOut)).docId;
    const b = stateOf(read(upgradedOut)).docId;
    assert.equal(b, a, `upgrading changed the docId from ${a} to ${b}, stranding the reviewer's buffer`);

    // And the upgraded file is byte-identical to the clean one: the strip left nothing behind.
    assert.equal(read(upgradedOut), read(cleanOut), 'upgrading left residue in the pristine text');
  });

  it('strips a v1 widget, which has no state to migrate', () => {
    const v1 = write('v1.html', [
      '<!DOCTYPE html>',
      '<html>',
      '<head><title>V1 Deck</title>',
      '<style>.sticky-feedback-btn { color: red }</style>',
      '</head>',
      '<body>',
      '  <p>Body copy that must survive</p>',
      '  <div id="sticky-feedback-root"><button>Feedback</button></div>',
      '  <script>var STICKY_FEEDBACK = { version: 1 };</script>',
      '</body>',
      '</html>',
      '',
    ].join('\n'));

    const out = tmpPath('v1.out.html');
    const result = injectJson([v1, '--out', out]);
    assert.equal(result.code, 3, result.stderr);
    assert.deepEqual(result.json.results[0].priorGenerations, ['v1']);
    assert.equal(result.json.results[0].migrated.v2, 0);

    const text = read(out);
    assert.ok(!text.includes('sticky-feedback'));
    assert.ok(!text.includes('STICKY_FEEDBACK'));
    assert.ok(text.includes('Body copy that must survive'));
    assert.deepEqual(stateOf(text).comments, []);
    assert.equal(verify([out]).code, 0);
  });

  it('round-trips comment text containing </script>, <!--, ]]> and emoji', () => {
    const nasty = 'break </script> out <!-- and ]]> too 🚂 — done';
    const seed = write('escape.html', [
      '<!DOCTYPE html>',
      '<html><head><title>Escape</title></head>',
      '<body>',
      '  <p id="target">anchor me</p>',
      '<div id="fbe-root"></div>',
      '<script>',
      `const FEEDBACK_EDIT_SEED = [{"id":"x1","timestamp":"2026-03-04T05:06:07.000Z","comment":${JSON.stringify(nasty)},"target":{"selector":"body>p:nth-of-type(1)","tagName":"P"}}];`,
      '</script>',
      '</body>',
      '</html>',
      '',
    ].join('\n'));

    const out = tmpPath('escape.out.html');
    assert.equal(inject([seed, '--out', out]).code, 3);

    const text = read(out);
    const island = islandOf(text);
    assert.ok(!island.includes('<'), 'unescaped < survived into the island');
    assert.ok(!island.includes('>'), 'unescaped > survived into the island');
    assert.ok(island.includes('\\u003c'), 'the escape was not applied');

    const state = JSON.parse(island);
    assert.equal(state.comments.length, 1);
    assert.equal(state.comments[0].text, nasty);
    assert.equal(count(text, '</body>'), 1);
    assert.equal(verify([out]).code, 0);
  });
});

describe('host document quirks', () => {
  it('falls back to </html> when there is no </body>', () => {
    const input = write('nobody.html', '<!DOCTYPE html>\n<html><head><title>No body</title></head>\n<p>loose</p>\n</html>\n');
    const out = tmpPath('nobody.out.html');
    const result = inject([input, '--out', out]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /no <\/body> found/);
    const text = read(out);
    assert.ok(text.includes(`${FENCE_END}\n</html>`));
    assert.equal(verify([out]).code, 0);
  });

  it('appends at end of file when there is neither </body> nor </html>', () => {
    const input = write('fragment.html', '<html><title>Fragment</title><p>bare</p>\n');
    const out = tmpPath('fragment.out.html');
    const result = inject([input, '--out', out]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /end of file/);
    assert.ok(read(out).endsWith(`${FENCE_END}\n`));
    assert.equal(verify([out]).code, 0);
  });

  it('finds an uppercase </BODY> but always emits lowercase markup', () => {
    const input = write('upper.html', '<!DOCTYPE HTML>\n<HTML>\n<HEAD><TITLE>Shouty</TITLE></HEAD>\n<BODY>\n<P>hi</P>\n</BODY>\n</HTML>\n');
    const out = tmpPath('upper.out.html');
    const result = inject([input, '--out', out]);
    assert.equal(result.code, 0, result.stderr);
    const text = read(out);
    assert.ok(text.includes(`${FENCE_END}\n</BODY>`), 'the block was not placed before </BODY>');
    assert.equal(count(text, '</BODY>'), 1);
    assert.equal(count(text, FENCE_BEGIN), 1);
    assert.match(text, /<HTML data-fbw="[0-9a-f]{16}">/);
    assert.equal(verify([out]).code, 0);
  });

  it('ignores a comment that appears before <html> and one that quotes <html', () => {
    const input = write('leading-comment.html', [
      '<!-- generated by something; contains <html lang="xx"> on purpose -->',
      '<!DOCTYPE html>',
      '<html lang="nl">',
      '<head><title>Comment first</title></head>',
      '<body><p>ok</p></body>',
      '</html>',
      '',
    ].join('\n'));
    const out = tmpPath('leading-comment.out.html');
    assert.equal(inject([input, '--out', out]).code, 0);
    const text = read(out);
    assert.match(text, /<html data-fbw="[0-9a-f]{16}" lang="nl">/);
    assert.ok(text.includes('<html lang="xx">'), 'the comment was modified');
    assert.equal(verify([out]).code, 0);
  });

  it('preserves CRLF line endings outside the block', () => {
    const crlf = PAGE.split('\n').join('\r\n');
    const input = write('crlf.html', crlf);
    const out = tmpPath('crlf.out.html');
    assert.equal(inject([input, '--out', out]).code, 0);

    const text = read(out);
    assert.equal(count(text, '\r\n'), count(crlf, '\r\n'), 'host line endings were rewritten');
    const block = text.slice(text.indexOf(FENCE_BEGIN), text.indexOf(FENCE_END));
    assert.ok(!block.includes('\r'), 'the block must always use \\n');
    assert.equal(verify([out]).code, 0);
  });

  it('preserves a UTF-8 BOM', () => {
    const input = write('bom.html', `﻿${PAGE}`);
    const out = tmpPath('bom.out.html');
    assert.equal(inject([input, '--out', out]).code, 0);
    const bytes = readFileSync(out);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the BOM was dropped');
    assert.equal(count(bytes.toString('utf8'), '﻿'), 1);
    assert.equal(verify([out]).code, 0);
  });

  it('does not treat a </body> inside a JS string literal as the injection point', () => {
    const input = write('literal.html', [
      '<!DOCTYPE html>',
      '<html><head><title>Literal</title></head>',
      '<body>',
      '  <script>var marker = "</body>"; var other = "</body>";</script>',
      '  <p>real content</p>',
      '</body>',
      '<script>var trailing = "</body>";</script>',
      '</html>',
      '',
    ].join('\n'));
    const out = tmpPath('literal.out.html');
    const result = inject([input, '--out', out]);
    assert.equal(result.code, 0, result.stderr);

    const text = read(out);
    // Inserted before the one real </body>, which is the one that is not inside a script.
    assert.ok(text.includes(`${FENCE_END}\n</body>\n<script>var trailing`));
    assert.equal(count(text, '</body>'), 4, 'the literals should be untouched');
    assert.equal(verify([out]).code, 0);
  });
});

describe('--check', () => {
  it('writes nothing but still returns the injection exit code', () => {
    const input = write('check.html', PAGE);
    const out = tmpPath('check.out.html');
    const result = injectJson([input, '--out', out, '--check']);
    assert.equal(result.code, 0);
    assert.equal(result.json.results[0].written, false);
    assert.equal(existsSync(out), false, '--check wrote a file');
  });

  it('returns 3 for a file that would be upgraded, and leaves it alone', () => {
    const v1 = write('check-v1.html', '<html><head><title>t</title></head><body><div id="sticky-feedback"></div></body></html>\n');
    const before = readFileSync(v1);
    const result = inject([v1, '--in-place', '--check']);
    assert.equal(result.code, 3, result.stderr);
    assert.ok(readFileSync(v1).equals(before));
    assert.equal(existsSync(`${v1}.bak`), false);
  });

  it('returns 2 for an already-current file', () => {
    const input = write('check-current.html', PAGE);
    assert.equal(inject([input, '--in-place']).code, 0);
    assert.equal(inject([input, '--in-place', '--check']).code, 2);
  });
});

describe('multiple inputs', () => {
  it('reports the worst outcome across files', () => {
    const clean = write('multi-clean.html', PAGE);
    const current = write('multi-current.html', PAGE);
    assert.equal(inject([current, '--in-place']).code, 0);
    const v1 = write('multi-v1.html', '<html><head><title>t</title></head><body><div id="sticky-feedback"></div></body></html>\n');

    const result = injectJson([clean, current, v1, '--in-place']);
    assert.equal(result.code, 3, result.stderr); // 3 beats 0 beats 2
    assert.equal(result.json.results.length, 3);
    assert.deepEqual(result.json.results.map((r) => r.exitCode), [0, 2, 3]);
  });

  it('lets an error outrank everything else', () => {
    const clean = write('multi-ok.html', PAGE);
    const missing = join(TMP, 'does-not-exist.html');
    const result = injectJson([clean, missing, '--in-place']);
    assert.equal(result.code, 1);
    assert.equal(result.json.ok, false);
    assert.equal(result.json.results[1].action, 'error');
  });
});

describe('runtime resolution', () => {
  it('fails with the paths it tried when no runtime exists', () => {
    const input = write('noruntime.html', PAGE);
    const result = run(ADD, [input, '--runtime', join(TMP, 'nope.js'), '--out', tmpPath('noruntime.out.html')]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no widget runtime found/);
    assert.match(result.stderr, /nope\.js/);
  });

  it('rebuilds when the embedded runtime has gone stale', () => {
    const input = write('stale.html', PAGE);
    const out = tmpPath('stale.out.html');
    assert.equal(inject([input, '--out', out]).code, 0);

    const other = write('other-runtime.js', "console.info('fbw stub runtime v2');\n");
    const result = run(ADD, [out, '--in-place', '--runtime', other]);
    assert.equal(result.code, 3, result.stderr);
    assert.ok(read(out).includes("console.info('fbw stub runtime v2');"));
    assert.equal(run(VERIFY, [out, '--runtime', other]).code, 0);
  });
});

describe('verify', () => {
  let injected;
  let injectedText;

  before(() => {
    const input = write('verify-src.html', PAGE);
    injected = tmpPath('verify-src.out.html');
    assert.equal(inject([input, '--out', injected]).code, 0);
    injectedText = read(injected);
  });

  function broken(name, text) {
    const path = write(name, text);
    const result = run(VERIFY, [path, '--runtime', STUB, '--json']);
    return { code: result.code, report: JSON.parse(result.stdout).results[0], stderr: result.stderr };
  }

  it('accepts a freshly injected file', () => {
    const result = verify([injected]);
    assert.equal(result.code, 0, result.stderr);
  });

  it('names invariant 1 when the fence is removed', () => {
    const { code, report } = broken('v-nofence.html', injectedText.replace(`${FENCE_BEGIN}\n`, ''));
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '1'), JSON.stringify(report.failures));
  });

  it('names invariant 1 when there are two fence pairs', () => {
    const blockStart = injectedText.indexOf(`\n${FENCE_BEGIN}`);
    const blockEnd = injectedText.indexOf(FENCE_END) + FENCE_END.length + 1;
    const block = injectedText.slice(blockStart, blockEnd);
    const { code, report } = broken('v-double.html', injectedText.replace('</body>', `${block}</body>`));
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '1' && /found 2 begin/.test(f.message)), JSON.stringify(report.failures));
  });

  it('names invariant 2 when the block carries a closing-body token', () => {
    const text = injectedText.replace('<script id="fbw-core">', '<script id="fbw-core">// </body>\n');
    const { code, report } = broken('v-blockbody.html', text);
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '2' && /closing-body/.test(f.message)), JSON.stringify(report.failures));
  });

  it('names invariant 2 when the block carries a stray closing-script token', () => {
    const text = injectedText.replace("console.info('fbw stub runtime');", "console.info('x');</script><script>evil();");
    const { code, report } = broken('v-blockscript.html', text);
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '2' && /closing-script/.test(f.message)), JSON.stringify(report.failures));
  });

  it('accepts a page whose scripts carry closing-body tokens in string literals', () => {
    const input = write('v-literals-src.html', [
      '<!DOCTYPE html>',
      '<html><head><title>Literals</title></head>',
      '<body>',
      '  <script>var a = "</body>"; var b = "</body>";</script>',
      '</body>',
      '</html>',
      '',
    ].join('\n'));
    const out = tmpPath('v-literals.out.html');
    assert.equal(inject([input, '--out', out]).code, 0);
    const result = verify([out]);
    assert.equal(result.code, 0, result.stderr);
  });

  it('names invariant 5 for an unescaped < in the island', () => {
    const text = injectedText.replace('"title":"Network Density Review"', '"title":"Network < Density"');
    const { code, report } = broken('v-unescaped.html', text);
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '5'), JSON.stringify(report.failures));
  });

  it('names invariant 3 when data-fbw is stripped from <html>', () => {
    const { code, report } = broken('v-nodocid.html', injectedText.replace(/ data-fbw="[0-9a-f]{16}"/, ''));
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '3'), JSON.stringify(report.failures));
  });

  it('names invariant 4 when the island is not valid JSON', () => {
    const { code, report } = broken('v-badjson.html', injectedText.replace('{"v":2', '{"v":2,,'));
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '4'), JSON.stringify(report.failures));
  });

  it('names invariant 8 when the docId no longer matches the pristine text', () => {
    const { code, report } = broken('v-docid.html', injectedText.replace('<body>', '<body>\n  <p>added after injection</p>'));
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '8'), JSON.stringify(report.failures));
  });

  it('names invariant 6 when the state shape is wrong', () => {
    const { code, report } = broken('v-shape.html', injectedText.replace('"v":2', '"v":3'));
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '6'), JSON.stringify(report.failures));
  });

  it('names invariant 7 when the embedded runtime does not match the artifact', () => {
    const other = write('verify-other-runtime.js', "console.info('different');\n");
    const result = run(VERIFY, [injected, '--runtime', other, '--json']);
    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout).results[0];
    assert.ok(report.failures.some((f) => f.id === '7'), JSON.stringify(report.failures));
  });

  it('names invariant 9 when a prior-generation marker survives', () => {
    const { code, report } = broken('v-marker.html', injectedText.replace('<body>', '<body>\n<div id="fbw2-root"></div>'));
    assert.equal(code, 1);
    assert.ok(report.failures.some((f) => f.id === '9'), JSON.stringify(report.failures));
  });

  it('skips invariant 7 with a note when no runtime artifact can be resolved', () => {
    const result = run(VERIFY, [injected, '--runtime', join(TMP, 'absent.js'), '--json']);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout).results[0];
    assert.ok(report.notes.some((n) => /invariant 7 skipped/.test(n)), JSON.stringify(report.notes));
  });

  it('exits 1 and reports the missing file rather than throwing', () => {
    const result = run(VERIFY, [join(TMP, 'not-here.html'), '--json']);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).results[0].valid, false);
  });
});

describe('refusal to write', () => {
  it('refuses to overwrite the input without --in-place', () => {
    const input = write('self.html', PAGE);
    const result = inject([input, '--out', input]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--in-place/);
    assert.equal(read(input), PAGE);
  });

  it('rejects a runtime that carries a script-closing token', () => {
    const bad = write('bad-runtime.js', 'var s = "</scr" + "ipt>"; var t = "</' + 'script>";\n');
    const input = write('bad-runtime-host.html', PAGE);
    const result = run(ADD, [input, '--runtime', bad, '--out', tmpPath('bad-runtime.out.html')]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /must be built by concatenation/);
  });

  it('rejects an unknown --position', () => {
    const input = write('badpos.html', PAGE);
    const result = inject([input, '--position', 'top-left', '--out', tmpPath('badpos.out.html')]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--position must be one of/);
  });
});

describe('--endpoint and --write-key', () => {
  const ENDPOINT = 'https://feedback.example.com/api/feedback';

  it('writes both into the island, and the result verifies', () => {
    const input = write('ep.html', PAGE);
    const out = tmpPath('ep.out.html');
    const r = inject([input, '--out', out, '--endpoint', ENDPOINT, '--write-key', 'k-123']);
    assert.equal(r.code, 0, r.stderr);
    const state = stateOf(read(out));
    assert.equal(state.config.endpoint, ENDPOINT);
    assert.equal(state.config.writeKey, 'k-123');
    assert.equal(verify([out]).code, 0);
  });

  it('keeps them when the file is injected again without the flags', () => {
    const input = write('ep-sticky.html', PAGE);
    const first = tmpPath('ep-sticky.1.html');
    const second = tmpPath('ep-sticky.2.html');
    assert.equal(inject([input, '--out', first, '--endpoint', ENDPOINT, '--write-key', 'k']).code, 0);
    const r = inject([first, '--out', second]);
    assert.ok([0, 2, 3].includes(r.code), r.stderr);
    const state = stateOf(read(second));
    assert.equal(state.config.endpoint, ENDPOINT, 're-injecting silently turned a server deck back into a file deck');
    assert.equal(state.config.writeKey, 'k');
  });

  it("removes them with ''", () => {
    const input = write('ep-remove.html', PAGE);
    const first = tmpPath('ep-remove.1.html');
    const second = tmpPath('ep-remove.2.html');
    assert.equal(inject([input, '--out', first, '--endpoint', ENDPOINT, '--write-key', 'k']).code, 0);
    const r = inject([first, '--out', second, '--endpoint', '', '--write-key', '']);
    assert.ok([0, 2, 3].includes(r.code), r.stderr);
    const state = stateOf(read(second));
    assert.equal('endpoint' in state.config, false);
    assert.equal('writeKey' in state.config, false);
  });

  it('refuses a relative or non-http endpoint, and a key with spaces, writing nothing', () => {
    const input = write('ep-bad.html', PAGE);
    for (const args of [['--endpoint', '/api/feedback'], ['--endpoint', 'ftp://x.test/api'], ['--write-key', 'has space']]) {
      const out = tmpPath('ep-bad.out.html');
      const r = inject([input, '--out', out, ...args]);
      assert.equal(r.code, 1, `accepted ${args.join(' ')}`);
      assert.equal(existsSync(out), false);
    }
  });

  it('verify rejects a hand-edited island with a bad endpoint', () => {
    const input = write('ep-hand.html', PAGE);
    const out = tmpPath('ep-hand.out.html');
    assert.equal(inject([input, '--out', out, '--endpoint', ENDPOINT]).code, 0);
    const edited = tmpPath('ep-hand.edited.html');
    writeFileSync(edited, read(out).replace(JSON.stringify(ENDPOINT), JSON.stringify('javascript:alert(1)')));
    const r = verify([edited]);
    assert.notEqual(r.code, 0);
    assert.match(r.stdout + r.stderr, /endpoint/);
  });
});
