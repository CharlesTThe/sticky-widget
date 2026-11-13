#!/usr/bin/env node
/*
  Invariant 8 has one carve-out, and a carve-out in a validator is exactly the
  kind of thing that quietly widens into a hole. These tests pin it shut:
  the flag excuses the docId check and nothing else, and only when the widget
  actually set it.

  Background: save rung 4 re-serialises the DOM because the original bytes
  could not be read. That normalises attribute quoting and tag shape, so the
  document hash legitimately stops matching the stored docId. The widget
  records this as state.snapshot. Without the carve-out, verify rejects every
  snapshot save, and people learn to ignore verify.
*/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADD = join(ROOT, 'bin', 'add-feedback.mjs');
const VERIFY = join(ROOT, 'bin', 'verify.mjs');
const ISLAND_OPEN = ['<', 'script type="application/json" id="fbw-state">'].join('');
const CLOSE = '</' + 'script>';

let WORK;
before(() => { WORK = mkdtempSync(join(tmpdir(), 'fbw-snap-')); });
after(() => { rmSync(WORK, { recursive: true, force: true }); });

function run(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, out: (err.stdout || '') + (err.stderr || '') };
  }
}

// Produce a valid injected file, then reproduce what a rung-4 save does to it.
//
// Note what is NOT changed: docId and the data-fbw sentinel stay as they were
// and stay equal to each other, because the widget carries them through
// untouched. What changes is the DOCUMENT, since re-serialising the DOM
// normalises markup. That is why the hash stops matching, and modelling it any
// other way tests the wrong invariant.
function make(name, { snapshot, reserialised }) {
  const src = join(WORK, name + '.src.html');
  const out = join(WORK, name + '.html');
  writeFileSync(src, '<!doctype html>\n<html><head><meta charset="utf-8"><title>t</title></head><body><h1>Hello</h1></body></html>\n');
  const r = run([ADD, src, '--out', out]);
  assert.equal(r.code, 0, 'setup injection failed: ' + r.out);

  let html = readFileSync(out, 'utf8');

  if (reserialised) {
    // Stand in for the normalisation a DOM round-trip performs.
    html = html.replace('<h1>Hello</h1>', '<h1 class="">Hello</h1>');
  }

  if (snapshot) {
    const a = html.indexOf(ISLAND_OPEN) + ISLAND_OPEN.length;
    const b = html.indexOf(CLOSE, a);
    const state = JSON.parse(html.slice(a, b));
    state.snapshot = true;
    const encoded = JSON.stringify(state).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    html = html.slice(0, a) + encoded + html.slice(b);
  }

  writeFileSync(out, html);
  return out;
}

describe('the snapshot carve-out on invariant 8', () => {
  test('a document whose bytes no longer hash to its docId is rejected when the flag is absent', () => {
    const f = make('nosnap', { snapshot: false, reserialised: true });
    const r = run([VERIFY, f]);
    assert.equal(r.code, 1, 'verify accepted a file whose docId does not match its content');
    assert.match(r.out, /invariant 8|does not match/i);
  });

  test('the same mismatch is excused when the flag is set, and the excuse is reported', () => {
    const f = make('snap', { snapshot: true, reserialised: true });
    const r = run([VERIFY, f]);
    assert.equal(r.code, 0, 'verify rejected a legitimate snapshot save: ' + r.out);
    assert.match(r.out, /not applicable/i, 'the carve-out should be reported, not silent');
  });

  test('the flag excuses invariant 8 and nothing else', () => {
    // Same flag, but now also corrupt something the flag has no business
    // covering: strip the sentinel off the html tag (invariant 3).
    const f = make('snapbroken', { snapshot: true, reserialised: true });
    const html = readFileSync(f, 'utf8').replace(/\sdata-fbw="[0-9a-f]{16}"/, '');
    writeFileSync(f, html);
    const r = run([VERIFY, f]);
    assert.equal(r.code, 1, 'the snapshot flag must not excuse a missing sentinel');
    assert.match(r.out, /invariant 3|data-fbw/i);
  });

  test('a normal injected file carries no snapshot flag', () => {
    const f = make('plain', { snapshot: false, reserialised: false });
    const html = readFileSync(f, 'utf8');
    const a = html.indexOf(ISLAND_OPEN) + ISLAND_OPEN.length;
    const state = JSON.parse(html.slice(a, html.indexOf(CLOSE, a)));
    assert.equal('snapshot' in state, false, 'the injector should never set the snapshot flag');
    assert.equal(run([VERIFY, f]).code, 0);
  });
});
