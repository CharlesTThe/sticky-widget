#!/usr/bin/env node
/*
  Browser behaviour suite.

  These are the assertions that cannot be made by reading bytes: does the rail
  actually sit on top of the page, do pins follow an inner scroll container, do
  anchors survive a re-render, does a save round-trip through a real browser
  produce a file that shows the comments when reopened with no storage.

  Served over http://127.0.0.1 rather than opened from file:// on purpose. It
  is the only way to exercise a byte-perfect save rung under automation: the
  File System Access rung needs a real user gesture and a real dialog, so the
  fetch rung is what a headless run can actually prove. The file:// rungs are
  covered by the manual check in the README.

  If a browser cannot be launched the whole suite skips with a loud message
  rather than failing — a constrained CI box should not turn red for a missing
  Chromium, but it must never look like these assertions passed.
*/
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADD = join(ROOT, 'bin', 'add-feedback.mjs');
const WORK = mkdtempSync(join(tmpdir(), 'fbw-browser-'));

let browser = null;
let server = null;
let origin = '';
let launchError = null;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };

function inject(fixture, outName) {
  const out = join(WORK, outName);
  execFileSync(process.execPath, [ADD, join(ROOT, fixture), '--out', out], { stdio: 'pipe' });
  return out;
}

// Launched at MODULE scope, not in before(). node:test evaluates describe() callbacks when
// they are registered, which is before any before() hook runs, so a `skip` option cannot see
// a result produced in before(). Hoisting is what lets a browserless run report its tests as
// SKIPPED rather than as passed.
//
// The distinction matters more than it sounds. With the launch in before(), every test here
// returned early and node:test counted all sixteen as passing — a run that asserted nothing
// was indistinguishable from a run that asserted everything, on the suite that covers the
// save ladder. The header below promises the skip is loud; it was silent.
if (!existsSync(ADD)) {
  launchError = 'bin/add-feedback.mjs is missing';
} else {
  server = createServer((req, res) => {
    const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    // A real Chrome asks for /favicon.ico on every navigation; the headless shell does not.
    // Unanswered it becomes a 404 the console-error assertions below count as a page fault.
    if (name === 'favicon.ico') { res.writeHead(204); res.end(); return; }
    const path = join(WORK, name);
    if (!path.startsWith(WORK) || !existsSync(path)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;

  try {
    // Playwright's own browser download is blocked outright on some corporate machines,
    // which silently skips this entire suite - the one place the widget's behaviour is
    // asserted in a real browser. launchChromium falls back to an installed Chrome or Edge.
    const { launchChromium } = await import('./launch.mjs');
    browser = await launchChromium();
  } catch (err) {
    launchError = err.message.split('\n')[0];
  }
}

// Passed to every describe below. A string skips the suite AND prints the reason.
const SKIP = launchError ? `no browser available — ${launchError}` : false;

if (launchError) {
  console.error(`\n  SKIPPING the entire browser suite: ${launchError}`);
  console.error('  Nothing below this line was verified.\n');
}

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  rmSync(WORK, { recursive: true, force: true });
  // Run on its own, a constrained box that simply has no Chromium should not go red — that
  // is the deliberate choice this file was written with. But `npm test` is a gate, and a
  // gate that cannot run its browser assertions has not passed them. The env var is how the
  // two callers ask for different things from one suite.
  if (launchError && process.env.FBW_REQUIRE_BROWSER) {
    console.error(`\n  FBW_REQUIRE_BROWSER is set and no browser ran: ${launchError}\n`);
    process.exitCode = 1;
  }
});

async function withPage(fn, opts = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try { return await fn(page, errors, ctx); }
  finally { await ctx.close(); }
}

async function ready(page) {
  await page.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
  await page.waitForTimeout(400); // whenSettled's quiet-frame probe
}

const FIXTURES = [
  ['examples/deck.html', 'deck.html'],
  ['test/fixtures/app-shell.html', 'app-shell.html'],
  ['test/fixtures/light.html', 'light.html'],
  ['test/fixtures/hostile.html', 'hostile.html'],
  ['test/fixtures/iframe.html', 'iframe.html'],
  ['test/fixtures/edge-rtl.html', 'rtl.html']
];

describe('boots cleanly everywhere', { skip: SKIP }, () => {
  for (const [fixture, name] of FIXTURES) {
    test(`${name}: no console errors, rail on top`, async () => {
      const r = await withPage(async (page, errors) => {
        inject(fixture, name);
        await page.goto(`${origin}/${name}`);
        await ready(page);

        assert.deepEqual(errors, [], 'the widget logged errors on boot');

        // Hit-test the real compositing result: whatever is painted at the
        // FAB's centre must be our host, not a page element on top of it.
        const owned = await page.evaluate(() => {
          const host = document.getElementById('fbw-host');
          if (!host) return 'no host element';
          const fab = host.shadowRoot.querySelector('.fab');
          if (!fab) return 'no fab';
          const r = fab.getBoundingClientRect();
          if (r.width < 40) return 'fab has no size';
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit === host ? true : 'covered by ' + (hit ? hit.tagName + '.' + hit.className : 'nothing');
        });
        assert.equal(owned, true, `the rail is not clickable: ${owned}`);
        return 'ok';
      });
      if (r === 'skipped') return;
    });
  }
});

describe('the file is the database', { skip: SKIP }, () => {
  test('comment survives reload, then a save produces a file that shows it with no storage', async () => {
    const r = await withPage(async (page) => {
      const out = inject('test/fixtures/light.html', 'roundtrip.html');
      await page.goto(`${origin}/roundtrip.html`);
      await ready(page);

      // Drive the real UI once, rather than only the test seam.
      await page.evaluate(() => document.getElementById('fbw-host').shadowRoot.querySelector('.fab').click());
      await page.waitForTimeout(150);
      await page.mouse.click(60, 120);
      await page.waitForTimeout(150);
      const typed = 'Check this figure against the appendix.';
      await page.evaluate((t) => {
        const sr = document.getElementById('fbw-host').shadowRoot;
        const ta = sr.querySelector('textarea');
        ta.value = t;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }, typed);
      await page.evaluate(() => {
        const sr = document.getElementById('fbw-host').shadowRoot;
        [...sr.querySelectorAll('button')].find((b) => b.textContent === 'Add comment').click();
      });
      await page.waitForTimeout(200);
      // The identity prompt appears on the first comment.
      await page.evaluate(() => {
        const sr = document.getElementById('fbw-host').shadowRoot;
        const skip = [...sr.querySelectorAll('button')].find((b) => b.textContent === 'Stay anonymous');
        if (skip) skip.click();
      });
      await page.waitForTimeout(250);

      assert.equal(await page.evaluate(() => window.__fbw.getComments().length), 1, 'the comment was not recorded');
      assert.equal(await page.evaluate(() => document.getElementById('fbw-host').shadowRoot.querySelectorAll('.pin').length), 1,
        'no pin was drawn — this is the headline behaviour');

      await page.reload();
      await ready(page);
      assert.equal(await page.evaluate(() => window.__fbw.getComments().length), 1,
        'the comment did not survive a reload');

      const download = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }),
        page.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);

      const savedPath = join(WORK, 'saved.html');
      await download.saveAs(savedPath);
      const saved = readFileSync(savedPath, 'utf8');
      assert.ok(saved.includes('Check this figure'), 'the saved file does not contain the comment text');

      // The real proof: a brand-new context with no localStorage at all.
      const fresh = await browser.newContext();
      const p2 = await fresh.newPage();
      await p2.goto(`${origin}/saved.html`);
      await p2.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p2.waitForTimeout(400);
      const seen = await p2.evaluate(() => ({
        n: window.__fbw.getComments().length,
        pins: document.getElementById('fbw-host').shadowRoot.querySelectorAll('.pin').length,
        dirty: window.__fbw._state().dirty
      }));
      await fresh.close();

      assert.equal(seen.n, 1, 'a fresh browser did not see the comment baked into the file');
      assert.equal(seen.pins, 1, 'a fresh browser drew no pin');
      assert.equal(seen.dirty, false, 'a freshly opened saved file should not look unsaved');
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });

  test('hostile comment text survives the round trip intact', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'hostiletext.html');
      await page.goto(`${origin}/hostiletext.html`);
      await ready(page);

      const nasty = '</' + 'script><img onerror=alert(1)> <!-- ]]> 🙂 مرحبا ' + 'x'.repeat(200);
      await page.evaluate((t) => window.__fbw._add(document.querySelector('h1'), t), nasty);
      await page.waitForTimeout(150);

      const download = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }),
        page.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);
      const p = join(WORK, 'nasty.html');
      await download.saveAs(p);

      const fresh = await browser.newContext();
      const p2 = await fresh.newPage();
      const errs = [];
      p2.on('pageerror', (e) => errs.push(String(e)));
      await p2.goto(`${origin}/nasty.html`);
      await p2.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      const got = await p2.evaluate(() => window.__fbw.getComments()[0].text);
      await fresh.close();

      assert.deepEqual(errs, [], 'the reopened file threw — the island was probably broken out of');
      assert.equal(got, nasty, 'the comment text did not survive verbatim');
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });

  test('saving twice does not grow the file or duplicate the block', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'twice.html');
      await page.goto(`${origin}/twice.html`);
      await ready(page);
      await page.evaluate(() => window.__fbw._add(document.querySelector('h1'), 'one'));

      const grab = async (name) => {
        const d = await Promise.all([
          page.waitForEvent('download', { timeout: 8000 }),
          page.evaluate(() => window.__fbw.save())
        ]).then(([x]) => x);
        const p = join(WORK, name);
        await d.saveAs(p);
        return readFileSync(p, 'utf8');
      };

      const first = await grab('t1.html');
      await page.waitForTimeout(200);
      const second = await grab('t2.html');

      const fences = (s) => (s.match(/<!--fbw:begin \d+-->/g) || []).length;
      assert.equal(fences(first), 1);
      assert.equal(fences(second), 1, 'the second save added another block');
      assert.equal(first.length, second.length, 'the file grew between two identical saves');
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });
});

describe('anchoring', { skip: SKIP }, () => {
  test('twin cards keep their own pins', async () => {
    const r = await withPage(async (page) => {
      inject('examples/deck.html', 'twins.html');
      await page.goto(`${origin}/twins.html`);
      await ready(page);

      const n = await page.evaluate(() => {
        // Find two structurally identical siblings anywhere on the deck.
        const groups = {};
        for (const el of document.querySelectorAll('div,section,article')) {
          const k = el.tagName + '|' + el.className + '|' + (el.parentElement ? el.parentElement.className : '');
          (groups[k] = groups[k] || []).push(el);
        }
        const pair = Object.values(groups).find((g) => g.length >= 2 && g[0].className);
        if (!pair) return 'no twin pair found in the fixture';
        window.__fbw._add(pair[0], 'on the first twin');
        window.__fbw._add(pair[1], 'on the second twin');
        const st = window.__fbw._state();
        return st.groups.length;
      });
      assert.equal(n, 2, 'the two twins collapsed onto one pin — rooted paths are not disambiguating');
      return 'ok';
    });
    if (r === 'skipped') return;
  });

  /*
    These two replace a single test that could not fail, in two independent ways.

    It anchored to `document.querySelector('tbody tr, .row, li')`. That is a selector LIST,
    resolved in document order, and app-shell.html's `<aside id="sidecol">` (line 229) comes
    before `<tbody id="lane-body">` (line 256) and is filled with 64 `div.row` children. So
    the comment landed on a sidebar depot row, which `renderTable` never touches — a test
    named "a comment survives its element being re-rendered" that never re-rendered anything.
    It then asserted only `orphans === 0`, which says a comment landed somewhere, not that it
    landed on the right thing.

    So: anchor into the table explicitly, and assert IDENTITY and `via`, never a bare count.
    `via` matters as much as identity — after T1-0 the design is "resolve correctly AND tell
    the reviewer how confident you are", and identity alone would pass a future change that
    resolved right and silently stopped badging.

    lanes[i-1].region is REGIONS[i % 3] over ['north','central','south'], so LN-01 is central
    (removed by the north filter) and LN-03 is north (kept). That gives both cases for free.
  */
  async function commentOnLane(page, laneId, text) {
    return page.evaluate(([id, t]) => {
      const row = [...document.querySelectorAll('#lane-body tr')]
        .find((tr) => tr.cells[0] && tr.cells[0].textContent.trim() === id);
      if (!row) return 'no row ' + id;
      window.__fbw._add(row, t);
      return null;
    }, [laneId, text]);
  }

  async function filterToNorth(page) {
    await page.evaluate(() => {
      const sel = document.getElementById('region');
      sel.value = 'north';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(600);
  }

  // Reads the anchor, what it resolves to now, and how. `_state()` reports `via` per group.
  async function resolution(page) {
    return page.evaluate(() => {
      const st = window.__fbw._state();
      const c = window.__fbw.getComments()[0];
      const hit = document.querySelector(c.anchor.path);
      return {
        quote: c.anchor.quote && c.anchor.quote.exact,
        path: c.anchor.path,
        orphans: st.orphans,
        groups: st.groups,
        via: st.groups.length ? st.groups[0].via : null,
        pathNowMatches: hit ? hit.textContent.replace(/\s+/g, ' ').trim() : null
      };
    });
  }

  test('a comment whose row the re-render keeps but moves is re-found by its text, and badged', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/app-shell.html', 'rerender-keep.html');
      await page.goto(`${origin}/rerender-keep.html`);
      await ready(page);

      assert.equal(await commentOnLane(page, 'LN-03', 'LN-03 volume looks wrong'), null);
      await page.waitForTimeout(300);
      const before = await resolution(page);
      assert.equal(before.orphans, 0, 'orphaned before the re-render even ran');
      assert.equal(before.groups[0].via, 'path', `expected a clean path hit to start from: ${JSON.stringify(before)}`);

      // LN-03 is a north lane, so the filter keeps the row — but it also drops every lane
      // above it, so the row moves from position 3 to position 1. The element survives; its
      // POSITION does not, and `path` is positional.
      await filterToNorth(page);

      const after = await resolution(page);

      // Precondition, stated as an assertion because it is what makes this test interesting:
      // the recorded path is now stale and points at a different lane entirely.
      assert.ok(after.pathNowMatches && !/LN-03/.test(after.pathNowMatches),
        `fixture assumption broken — the path was expected to go stale: ${JSON.stringify(after)}`);

      // What must happen: the path rung is offered that stale hit, corroborates it against
      // the recorded quote, rejects it, and falls through to the quote rung, which finds the
      // real row. Identity AND confidence — `via` matters as much as the element, because
      // resolving correctly while silently dropping the badge is a different product.
      assert.equal(after.orphans, 0, `the comment was orphaned instead of re-found: ${JSON.stringify(after)}`);
      assert.equal(after.groups.length, 1, JSON.stringify(after));
      assert.match(after.groups[0].text, /LN-03/,
        `re-attached to the wrong row: ${JSON.stringify(after)}`);
      assert.equal(after.groups[0].via, 'text',
        `found by the wrong rung — a stale positional path must not be accepted: ${JSON.stringify(after)}`);
      return 'ok';
    });
    if (r === 'skipped') return;
  });

  test('a comment whose row the re-render removes is orphaned, not moved to a different row', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/app-shell.html', 'rerender-drop.html');
      await page.goto(`${origin}/rerender-drop.html`);
      await ready(page);

      assert.equal(await commentOnLane(page, 'LN-01', 'LN-01 fill rate disagrees with slide 4'), null);
      await page.waitForTimeout(300);
      const before = await resolution(page);
      assert.equal(before.orphans, 0, 'should resolve cleanly before the filter');

      await filterToNorth(page);   // LN-01 is central: gone from the table entirely

      const after = await resolution(page);

      // The defect this asserts against: `path` is positional, so `#lane-body tr:nth-of-type(1)`
      // still matches — it is now LN-03's row. Before the corroboration check, this reported
      // orphans: 0, via: "path", and put an UNBADGED pin carrying a comment about LN-01 on the
      // row for LN-03. `via: "path"` is one of the two rungs that raises no "moved" warning.
      assert.ok(after.pathNowMatches && !/LN-01/.test(after.pathNowMatches),
        `fixture assumption broken: the path should now match a different lane, got ${JSON.stringify(after)}`);
      assert.equal(after.orphans, 1,
        `the comment was re-attached to a row it was never about instead of being orphaned: ${JSON.stringify(after)}`);
      assert.equal(after.groups.length, 0,
        `expected no pin at all, got ${JSON.stringify(after.groups)}`);

      // Baseline/after figure for the cost of resolution failure. An orphan runs all five
      // rungs every frame, and the quote and sig rungs each sweep the whole candidate set,
      // so the number is only readable next to that set's size. No assertion: a threshold
      // here would be a guess, and the point is to retire an unknown, not to gate on it.
      const perf = await page.evaluate(async () => {
        const rows = document.querySelectorAll('tr').length;
        const all = document.getElementsByTagName('*').length;
        const t0 = performance.now();
        let frames = 0;
        for (let k = 0; k < 10; k++) {
          window.scrollTo(0, 120 * (k % 5));
          await new Promise((res) => requestAnimationFrame(res));
          frames++;
        }
        return { ms: (performance.now() - t0) / frames, rows, all };
      });
      console.log(`  [perf] orphaned anchor, per scroll frame: ${perf.ms.toFixed(2)} ms ` +
        `(1 comment, 1 orphan, ${perf.rows} tr candidates, ${perf.all} elements total)`);
      return 'ok';
    });
    if (r === 'skipped') return;
  });
});

describe('hostile pages', { skip: SKIP }, () => {
  test('pins track an inner scroll container', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/app-shell.html', 'scroll.html');
      await page.goto(`${origin}/scroll.html`);
      await ready(page);

      const moved = await page.evaluate(async () => {
        const scroller = [...document.querySelectorAll('*')].find((e) => {
          const cs = getComputedStyle(e);
          return /auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 200;
        });
        if (!scroller) return 'no inner scroller in the fixture';
        // Anchor to a child a little way down the list and scroll by a modest
        // amount, so the target stays on screen. Scrolling to the very bottom
        // would push it out of view, at which point the pin correctly hides
        // and stops updating its transform — which looks identical to the bug
        // this test is meant to catch.
        const kids = [...scroller.children];
        const target = kids[Math.min(3, kids.length - 1)];
        window.__fbw._add(target, 'pinned inside a scrolling panel');
        await new Promise((r) => setTimeout(r, 300));
        const sr = document.getElementById('fbw-host').shadowRoot;
        const read = () => {
          const pin = sr.querySelector('.pin');
          return { t: pin.style.transform, shown: pin.style.display !== 'none' };
        };
        const a = read();
        scroller.scrollTop = 120;
        await new Promise((r) => setTimeout(r, 400));
        return { a, b: read() };
      });
      if (typeof moved === 'string') return 'ok';
      assert.ok(moved.a.shown && moved.b.shown, 'the pin should have stayed visible across a 120px scroll');
      assert.notEqual(moved.a.t, moved.b.t,
        'the pin did not move when an inner panel scrolled — a window-only scroll listener is the classic cause, since this page never scrolls the window');
      return 'ok';
    });
    if (r === 'skipped') return;
  });

  test('the host page keeps working and gains no globals', async () => {
    const r = await withPage(async (page, errors) => {
      inject('test/fixtures/hostile.html', 'noninterf.html');
      await page.goto(`${origin}/noninterf.html`);
      await ready(page);

      const report = await page.evaluate(() => {
        const before = document.documentElement.scrollHeight;
        let hostSaw = 0;
        document.addEventListener('click', () => { hostSaw++; }, false);
        document.body.click();
        return {
          hostSaw,
          scrollDelta: document.documentElement.scrollHeight - before,
          appConfig: typeof window.APP_CONFIG,
          ourGlobals: Object.keys(window).filter((k) => /^(fbw|__fbw|StickyFeedback|FeedbackAndEdit)/.test(k))
        };
      });

      assert.deepEqual(errors, []);
      assert.equal(report.appConfig, 'object', "the host page's own global was clobbered");
      assert.deepEqual(report.ourGlobals, ['__fbw'], `expected exactly one global, saw ${report.ourGlobals.join(', ')}`);
      assert.equal(report.scrollDelta, 0, 'the widget changed the host page layout');
      return 'ok';
    });
    if (r === 'skipped') return;
  });

  test('destroy() leaves no trace', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'destroy.html');
      await page.goto(`${origin}/destroy.html`);
      await ready(page);
      const after = await page.evaluate(() => {
        window.__fbw.destroy();
        return {
          host: !!document.getElementById('fbw-host'),
          global: typeof window.__fbw,
          cursor: document.documentElement.style.cursor
        };
      });
      assert.equal(after.host, false, 'the host element survived destroy()');
      assert.equal(after.global, 'undefined', 'the global survived destroy()');
      assert.equal(after.cursor, '', 'destroy() left the crosshair cursor behind');
      return 'ok';
    });
    if (r === 'skipped') return;
  });
});

describe('scale', { skip: SKIP }, () => {
  test('300 comments render within budget', async () => {
    const r = await withPage(async (page) => {
      inject('examples/deck.html', 'many.html');
      await page.goto(`${origin}/many.html`);
      await ready(page);

      const ms = await page.evaluate(async () => {
        const targets = [...document.querySelectorAll('div,p,h1,h2,span')].slice(0, 300);
        for (let i = 0; i < 300; i++) {
          window.__fbw._add(targets[i % targets.length], 'bulk comment ' + i);
        }
        const t0 = performance.now();
        window.scrollTo(0, 600);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      });
      assert.ok(ms < 900, `a scroll with 300 comments took ${ms.toFixed(0)}ms`);
      return 'ok';
    });
    if (r === 'skipped') return;
  });
});

describe('accessibility', { skip: SKIP }, () => {
  test('a comment can be created without a mouse', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'kbd.html');
      await page.goto(`${origin}/kbd.html`);
      await ready(page);

      await page.evaluate(() => document.getElementById('fbw-host').shadowRoot.querySelector('.fab').focus());
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      await page.keyboard.press('Tab');     // step to the first candidate element
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');   // select it
      await page.waitForTimeout(250);

      const composerOpen = await page.evaluate(() =>
        !!document.getElementById('fbw-host').shadowRoot.querySelector('textarea'));
      assert.ok(composerOpen, 'keyboard picking never reached the comment form');

      await page.keyboard.type('left entirely from the keyboard');
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const sr = document.getElementById('fbw-host').shadowRoot;
        const skip = [...sr.querySelectorAll('button')].find((b) => b.textContent === 'Stay anonymous');
        if (skip) skip.click();
      });
      await page.waitForTimeout(200);

      assert.equal(await page.evaluate(() => window.__fbw.getComments().length), 1,
        'the keyboard-only path did not produce a comment');
      return 'ok';
    });
    if (r === 'skipped') return;
  });
});

/*
  The worst defects in this tool have all been the same shape: it reports success, or says
  nothing at all, while not doing what was asked. Each test here pins one of those.
*/
describe('failure modes that lie', { skip: SKIP }, () => {
  // Reaches the "point at the file" dialog by removing both automatic routes: no File
  // System Access API, and the no-store re-fetch of the document blocked.
  async function atSaveDialog(page, name) {
    inject('test/fixtures/light.html', name);
    await page.addInitScript('window.showSaveFilePicker = undefined;');
    await page.goto(`${origin}/${name}`);
    await ready(page);
    await page.route(`${origin}/${name}`, (r) => r.abort());
    await page.evaluate(() => window.__fbw._add(document.querySelector('h1,h2,p'), 'needs saving'));
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('fbw-host').shadowRoot.querySelectorAll('.act')[1].click());
    await page.waitForFunction(
      "!!document.getElementById('fbw-host').shadowRoot.querySelector('.modal')", null, { timeout: 5000 });
  }

  const readShadow = (page, expr) =>
    page.evaluate(`(function(){var sr=document.getElementById('fbw-host').shadowRoot;return ${expr};})()`);

  for (const [how, dismiss] of [
    ['Escape', (page) => page.keyboard.press('Escape')],
    ['a click on the veil', (page) =>
      page.evaluate(() => document.getElementById('fbw-host').shadowRoot.querySelector('.veil').click())],
  ]) {
    test(`dismissing the save dialog with ${how} says so, and saving still works afterwards`, async () => {
      const r = await withPage(async (page) => {
        await atSaveDialog(page, `wedge-${how.replace(/\W+/g, '-')}.html`);
        await dismiss(page);
        await page.waitForTimeout(500);

        // The dialog resolved the save's promise, so `saving` is back to false. Before the
        // onDismiss callback existed, that promise never settled: `saving` stayed true for
        // the rest of the session and EVERY later Cmd+S was a silent no-op.
        const toastText = await readShadow(page, "(sr.querySelector('.toast')||{}).textContent||''");
        assert.match(toastText, /Save cancelled/,
          `dismissing said nothing; a reviewer reads silence after a save request as success (saw "${toastText}")`);

        // The real proof that nothing is wedged: ask again and watch the dialog come back.
        await page.evaluate(() => document.getElementById('fbw-host').shadowRoot.querySelectorAll('.act')[1].click());
        await page.waitForTimeout(800);
        assert.equal(await readShadow(page, "!!sr.querySelector('.modal')"), true,
          'the second save produced no dialog — `saving` is stuck true and every later save is a silent no-op');
        return 'ok';
      });
      if (r === 'skipped') return;
    });
  }

  test('the identity prompt veils the composer rather than stranding a second live copy of it', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'identity.html');
      await page.goto(`${origin}/identity.html`);
      await ready(page);

      await page.evaluate(() => document.getElementById('fbw-host').shadowRoot.querySelector('.fab').click());
      await page.waitForTimeout(150);
      await page.mouse.click(60, 120);
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const ta = document.getElementById('fbw-host').shadowRoot.querySelector('textarea');
        ta.value = 'a paragraph of feedback I do not want to lose';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.evaluate(() => {
        const sr = document.getElementById('fbw-host').shadowRoot;
        [...sr.querySelectorAll('button')].find((b) => b.textContent === 'Add comment').click();
      });
      await page.waitForTimeout(300);

      // Panels, not comments. The old bug mounted the identity prompt as a SECOND panel
      // without removing the composer, leaving it on screen, live, and able to post again
      // — a count of comments cannot see that, which is why it went unnoticed.
      const shown = await page.evaluate(() => {
        const sr = document.getElementById('fbw-host').shadowRoot;
        return {
          panels: sr.querySelectorAll('.panel').length,
          modals: sr.querySelectorAll('.modal').length,
          veils: sr.querySelectorAll('.veil').length
        };
      });
      assert.deepEqual(shown, { panels: 1, modals: 1, veils: 1 },
        `expected the composer veiled under one modal, saw ${JSON.stringify(shown)}`);

      // Dismissing posts nothing and discards nothing: back to the live composer, text intact.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const afterEsc = await page.evaluate(() => {
        const sr = document.getElementById('fbw-host').shadowRoot;
        const ta = sr.querySelector('textarea');
        return {
          comments: window.__fbw.getComments().length,
          panels: sr.querySelectorAll('.panel').length,
          modals: sr.querySelectorAll('.modal').length,
          text: ta ? ta.value : null
        };
      });
      assert.deepEqual(afterEsc, {
        comments: 0, panels: 1, modals: 0,
        text: 'a paragraph of feedback I do not want to lose'
      }, `dismissing the identity prompt should hand back the live composer, saw ${JSON.stringify(afterEsc)}`);
      return 'ok';
    });
  });

  test('a deleted comment that was already in the file stays deleted across a reload', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'del-0.html');
      await page.goto(`${origin}/del-0.html`);
      await ready(page);
      await page.evaluate(() => window.__fbw._add(document.querySelector('h1,h2,p'), 'DOOMED comment'));
      await page.waitForTimeout(200);

      // It has to be IN THE FILE. The boot merge is island ∪ buffer, so a comment that only
      // ever lived in localStorage has nothing to come back from and cannot show this.
      const dl = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);
      await dl.saveAs(join(WORK, 'del-1.html'));
      assert.match(readFileSync(join(WORK, 'del-1.html'), 'utf8'), /DOOMED/, 'setup: the save did not bake it in');

      await page.goto(`${origin}/del-1.html`);
      await ready(page);
      assert.equal(await page.evaluate(() => window.__fbw.getComments().length), 1);

      await page.evaluate(() => document.getElementById('fbw-host').shadowRoot.querySelectorAll('.act')[2].click());
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const sr = document.getElementById('fbw-host').shadowRoot;
        [...sr.querySelectorAll('button')].find((b) => b.textContent === 'Delete').click();
      });
      await page.waitForTimeout(300);

      // Asserted right here, inside the undo window, not only after the reload. The
      // tombstone used to be written on an 8.2-second timer, which made a UI affordance
      // accidentally load-bearing for durability; stepping over the window is exactly how
      // the old coverage missed it.
      const atDelete = await page.evaluate(() => ({
        comments: window.__fbw.getComments().length,
        tombstones: (JSON.parse(localStorage.getItem('fbw:' + window.__fbw.docId) || '{}').tombstones || []).length,
        dirty: window.__fbw._state().dirty
      }));
      assert.deepEqual(atDelete, { comments: 0, tombstones: 1, dirty: true },
        `the deletion is not durable the instant it is made: ${JSON.stringify(atDelete)}`);

      await page.reload();
      await ready(page);
      const afterReload = await page.evaluate(() => ({
        comments: window.__fbw.getComments().length,
        dirty: window.__fbw._state().dirty
      }));
      // dirty stays true on purpose: the FILE still holds the comment, so there really is
      // something unsaved. Before the fix this read {comments: 1, dirty: false} — the
      // comment was back and nothing said so.
      assert.deepEqual(afterReload, { comments: 0, dirty: true },
        `the deleted comment came back after a reload: ${JSON.stringify(afterReload)}`);
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });
});

describe('several reviewers in series', { skip: SKIP }, () => {
  // The workflow the docs are about to recommend, and the only multi-reviewer story we
  // support. Nothing in the suite covered a second reviewer opening a first reviewer's
  // saved file, which is the whole point of writing comments into the file.
  test('Alice saves, Bob opens her file cold and saves again, and both sets survive', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'serial-0.html');
      await page.goto(`${origin}/serial-0.html`);
      await ready(page);
      await page.evaluate(() => window.__fbw._add(
        document.querySelector('h1,h2,p'), 'ALICE: the CAGR disagrees with slide 4', { name: 'Alice', email: null }));
      await page.waitForTimeout(200);
      const aliceDocId = await page.evaluate(() => window.__fbw.docId);
      const dlA = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);
      await dlA.saveAs(join(WORK, 'serial-1.html'));

      // A brand-new context: no localStorage, so everything Bob sees came out of the file.
      const bob = await browser.newContext({ acceptDownloads: true });
      const p2 = await bob.newPage();
      await p2.goto(`${origin}/serial-1.html`);
      await p2.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p2.waitForTimeout(400);
      const bobOnOpen = await p2.evaluate(() => ({
        n: window.__fbw.getComments().length,
        authors: window.__fbw.getComments().map((c) => c.author && c.author.name),
        pins: document.getElementById('fbw-host').shadowRoot.querySelectorAll('.pin').length,
        dirty: window.__fbw._state().dirty,
        docId: window.__fbw.docId
      }));
      await p2.evaluate(() => window.__fbw._add(
        document.querySelectorAll('h1,h2,p')[1] || document.querySelector('h1,h2,p'),
        'BOB: and the axis label is wrong', { name: 'Bob', email: null }));
      await p2.waitForTimeout(200);
      const dlB = await Promise.all([
        p2.waitForEvent('download', { timeout: 10000 }),
        p2.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);
      await dlB.saveAs(join(WORK, 'serial-2.html'));
      await bob.close();

      // A received file must not announce itself as unsaved. loadState derives the baseline
      // from the island for exactly this reason, and it is easy to regress.
      assert.equal(bobOnOpen.n, 1, 'Bob did not see the comment Alice saved into the file');
      assert.deepEqual(bobOnOpen.authors, ['Alice']);
      assert.equal(bobOnOpen.pins, 1, 'Bob saw no pin for a comment that is in his file');
      assert.equal(bobOnOpen.dirty, false, 'a freshly received file announced itself as having unsaved changes');
      assert.equal(bobOnOpen.docId, aliceDocId, 'the docId shifted between Alice and Bob');

      const carol = await browser.newContext();
      const p3 = await carol.newPage();
      await p3.goto(`${origin}/serial-2.html`);
      await p3.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p3.waitForTimeout(400);
      const final = await p3.evaluate(() => ({
        texts: window.__fbw.getComments().map((c) => c.text),
        authors: window.__fbw.getComments().map((c) => c.author && c.author.name).sort(),
        pins: document.getElementById('fbw-host').shadowRoot.querySelectorAll('.pin').length,
        orphans: window.__fbw._state().orphans,
        dirty: window.__fbw._state().dirty,
        docId: window.__fbw.docId
      }));
      await carol.close();

      assert.deepEqual(final.authors, ['Alice', 'Bob'], `Bob's save lost a set of comments: ${JSON.stringify(final)}`);
      assert.ok(final.texts.some((t) => t.startsWith('ALICE')) && final.texts.some((t) => t.startsWith('BOB')));
      assert.equal(final.pins, 2, `expected a pin each, saw ${final.pins}`);
      assert.equal(final.orphans, 0);
      assert.equal(final.dirty, false);
      assert.equal(final.docId, aliceDocId, 'the docId shifted across two saves');

      const text = readFileSync(join(WORK, 'serial-2.html'), 'utf8');
      assert.equal((text.match(/<!--fbw:begin /g) || []).length, 1, 'two saves left two fences');
      execFileSync(process.execPath, [join(ROOT, 'bin', 'verify.mjs'), join(WORK, 'serial-2.html')], { stdio: 'pipe' });
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });
});

// The element a reviewer is allowed to retype: a text leaf, found the same way the widget
// finds one, so these tests cannot drift from the runtime's rule by picking a container.
const LEAF = "(() => [...document.querySelectorAll('h1,h2,h3,p,span,td,li,div')]"
  + ".find((n) => n.children.length === 0 && n.textContent.trim().length > 3))()";

describe("rewriting the page's own text", { skip: SKIP }, () => {
  test('the new text is on the page, the saved markup still holds the original, and a cold open shows the new one', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'rw-0.html');
      await page.goto(`${origin}/rw-0.html`);
      await ready(page);

      const before = await page.evaluate(`(() => {
        const n = ${LEAF};
        const was = n.textContent.trim();
        window.__fbw._add(n, 'this heading undersells it', { name: 'Alice', email: null }, 'REWRITTEN BY ALICE');
        return { was: was, now: n.textContent };
      })()`);
      assert.equal(before.now, 'REWRITTEN BY ALICE', 'the page was not retyped');
      assert.notEqual(before.was, 'REWRITTEN BY ALICE');

      await page.waitForTimeout(200);
      const dl = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);
      await dl.saveAs(join(WORK, 'rw-1.html'));

      // The architecture in one assertion. Save rungs 1-3 write the document's ORIGINAL bytes
      // back with only the island replaced, so the new wording must NOT be in the markup — it
      // lives in the island and is replayed on load. If this ever inverts, a rewrite stops
      // being revertable and the author's own words are gone from the file for good.
      const saved = readFileSync(join(WORK, 'rw-1.html'), 'utf8');
      const island = saved.slice(saved.indexOf('id="fbw-state"'), saved.indexOf('id="fbw-core"'));
      assert.ok(saved.includes('>' + before.was + '<'), 'the original wording was overwritten in the markup');
      assert.ok(island.includes('REWRITTEN BY ALICE'), 'the rewrite was not recorded in the island');
      assert.ok(!saved.replace(island, '').includes('REWRITTEN BY ALICE'),
        'the new text was baked into the markup, which it must never be');
      execFileSync(process.execPath, [join(ROOT, 'bin', 'verify.mjs'), join(WORK, 'rw-1.html')], { stdio: 'pipe' });

      // A context that has never seen this document: everything below came out of the file.
      const bob = await browser.newContext();
      const p2 = await bob.newPage();
      await p2.goto(`${origin}/rw-1.html`);
      await p2.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p2.waitForTimeout(400);
      const cold = await p2.evaluate(`(() => {
        const st = window.__fbw._state();
        return { text: ${LEAF}.textContent, rewrites: st.rewrites, orphans: st.orphans, dirty: st.dirty };
      })()`);
      await bob.close();

      assert.equal(cold.text, 'REWRITTEN BY ALICE', 'the rewrite was not replayed onto a cold open');
      assert.deepEqual(cold.rewrites, { total: 1, applied: 1, missing: 0, conflicts: 0 });
      assert.equal(cold.orphans, 0);
      assert.equal(cold.dirty, false, 'a received file announced itself as having unsaved changes');
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });

  test('putting the text back restores the author wording and leaves the comment standing', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'rw-revert.html');
      await page.goto(`${origin}/rw-revert.html`);
      await ready(page);
      const out = await page.evaluate(`(() => {
        const n = ${LEAF};
        const was = n.textContent;
        window.__fbw._add(n, 'wrong word', null, 'TEMPORARY');
        const after = n.textContent;
        window.__fbw._revert(window.__fbw.getComments().find((c) => !!c.rewrite).id);
        return { was: was, after: after, back: n.textContent,
                 stillRewritten: !!window.__fbw.getComments()[0].rewrite,
                 kept: window.__fbw.getComments().length,
                 dirty: window.__fbw._state().dirty };
      })()`);
      assert.equal(out.after, 'TEMPORARY');
      assert.equal(out.back, out.was, 'the original wording was not restored');
      assert.equal(out.stillRewritten, false, 'the rewrite was not cleared');
      assert.equal(out.kept, 1, 'reverting the text deleted the comment with it');
      assert.equal(out.dirty, true, 'a revert left the file looking saved');
      return 'ok';
    });
    if (r === 'skipped') return;
  });

  test('a comment written AFTER a rewrite still finds its element on a later load', async () => {
    // The ordering invariant, and the reason rewrites are replayed before pins resolve. Bob
    // commented on text Alice had already retyped, so his anchor recorded HER wording. Draw
    // the pins first and the page is still showing the original at that moment: his quote
    // matches nothing and his comment is reported orphaned on an element plainly still there.
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'rw-order-0.html');
      await page.goto(`${origin}/rw-order-0.html`);
      await ready(page);
      await page.evaluate(`window.__fbw._add(${LEAF}, 'tighten this', { name: 'Alice', email: null }, 'ALICE WORDING')`);
      await page.waitForTimeout(200);
      const dlA = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);
      await dlA.saveAs(join(WORK, 'rw-order-1.html'));

      const bob = await browser.newContext({ acceptDownloads: true });
      const p2 = await bob.newPage();
      await p2.goto(`${origin}/rw-order-1.html`);
      await p2.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p2.waitForTimeout(400);
      const bobSees = await p2.evaluate(`${LEAF}.textContent`);
      await p2.evaluate(`window.__fbw._add(${LEAF}, 'BOB: better, but still long', { name: 'Bob', email: null })`);
      await p2.waitForTimeout(200);
      const dlB = await Promise.all([
        p2.waitForEvent('download', { timeout: 10000 }),
        p2.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);
      await dlB.saveAs(join(WORK, 'rw-order-2.html'));
      await bob.close();

      const carol = await browser.newContext();
      const p3 = await carol.newPage();
      await p3.goto(`${origin}/rw-order-2.html`);
      await p3.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p3.waitForTimeout(400);
      const final = await p3.evaluate(`(() => {
        const st = window.__fbw._state();
        return { text: ${LEAF}.textContent, orphans: st.orphans, groups: st.groups.length,
                 pinned: st.groups.reduce((n, g) => n + g.n, 0), rewrites: st.rewrites };
      })()`);
      await carol.close();

      assert.equal(bobSees, 'ALICE WORDING', 'Bob did not see the text Alice retyped');
      assert.equal(final.text, 'ALICE WORDING');
      assert.equal(final.orphans, 0,
        'a comment written after a rewrite was orphaned on an element that is still on the page');
      assert.equal(final.pinned, 2, `both comments should be pinned, saw ${JSON.stringify(final)}`);
      assert.equal(final.groups, 1, 'the two comments landed on different elements');
      assert.equal(final.rewrites.applied, 1);
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });

  test('an element with element children offers no text field, so structure cannot be retyped away', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'rw-leaf.html');
      await page.goto(`${origin}/rw-leaf.html`);
      await ready(page);
      const fields = await page.evaluate(`(() => {
        const sr = document.getElementById('fbw-host').shadowRoot;
        const container = [...document.querySelectorAll('div,section,main')].find((n) => n.children.length > 1);
        const count = (node) => {
          window.__fbw._compose(node);
          const n = sr.querySelectorAll('textarea').length;
          window.__fbw._closePanel();
          return n;
        };
        return { leaf: count(${LEAF}), container: count(container) };
      })()`);
      assert.equal(fields.leaf, 2, 'a text leaf should offer both the page text and a comment');
      assert.equal(fields.container, 1, 'a container offered an editable text field');
      return 'ok';
    });
    if (r === 'skipped') return;
  });
});

describe('the JSON round-trip', { skip: SKIP }, () => {
  test('the export tags every entry to its component and names the build that wrote it', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'json-0.html');
      await page.goto(`${origin}/json-0.html`);
      await ready(page);
      const data = await page.evaluate(`(() => {
        window.__fbw._add(${LEAF}, 'a note with a rewrite', { name: 'Alice', email: null }, 'NEW WORDS');
        return window.__fbw._json();
      })()`);

      assert.equal(data.format, 'fbw-feedback');
      assert.equal(data.formatVersion, 1);
      assert.match(data.tool.build, /^[0-9a-f]{12}$/);
      assert.equal(data.document.docId, await page.evaluate(() => window.__fbw.docId));
      assert.equal(data.comments.length, 1);
      const c = data.comments[0];
      assert.equal(c.toolBuild, data.tool.build, 'the entry was not stamped with the build that wrote it');
      assert.equal(c.rewrite.to, 'NEW WORDS');
      assert.ok(c.rewrite.from && c.rewrite.from !== c.rewrite.to);
      assert.ok(c.anchor && c.anchor.path, 'no machine-resolvable anchor');
      assert.equal(c.on.onPage, true);
      assert.ok(c.on.label, 'no human-readable component label');

      // And the button in the review list is actually wired to that object.
      const dl = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.evaluate(() => {
          const sr = document.getElementById('fbw-host').shadowRoot;
          // render() appends the open-comment count to this label, hence the prefix match.
          sr.querySelector('button[aria-label^="Open the review list"]').click();
          [...sr.querySelectorAll('button')].find((b) => b.textContent === 'Download JSON').click();
        })
      ]).then(([d]) => d);
      assert.match(dl.suggestedFilename(), /feedback\.json$/);
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });

  test('two reviewers who were sent the file at the same time merge onto one deck', async () => {
    // The one thing a single passed-along file cannot do, and the reason the JSON exists.
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'json-merge.html');
      await page.goto(`${origin}/json-merge.html`);
      await ready(page);
      const alice = await page.evaluate(`(() => {
        window.__fbw._add(${LEAF}, 'ALICE: rewrite this', { name: 'Alice', email: null }, 'ALICE TEXT');
        return window.__fbw._json();
      })()`);

      const bobCtx = await browser.newContext();
      const p2 = await bobCtx.newPage();
      await p2.goto(`${origin}/json-merge.html`);
      await p2.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p2.waitForTimeout(400);
      const bob = await p2.evaluate(`(() => {
        window.__fbw._add(document.querySelectorAll('h1,h2,p')[1] || ${LEAF}, 'BOB: and this', { name: 'Bob', email: null });
        return window.__fbw._json();
      })()`);
      await bobCtx.close();

      const carolCtx = await browser.newContext();
      const p3 = await carolCtx.newPage();
      await p3.goto(`${origin}/json-merge.html`);
      await p3.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p3.waitForTimeout(400);
      const merged = await p3.evaluate(`(() => {
        window.__fbw._import(${JSON.stringify(alice)});
        window.__fbw._import(${JSON.stringify(bob)});
        window.__fbw._import(${JSON.stringify(alice)});
        const st = window.__fbw._state();
        return {
          authors: window.__fbw.getComments().map((c) => c.author && c.author.name).sort(),
          text: ${LEAF}.textContent,
          orphans: st.orphans, rewrites: st.rewrites, dirty: st.dirty
        };
      })()`);
      await carolCtx.close();

      // Alice's export is imported twice on purpose: the merge is by id, so a reviewer who
      // sends the same JSON twice must not double their own comments.
      assert.deepEqual(merged.authors, ['Alice', 'Bob'], 'a parallel review was lost, or duplicated, in the merge');
      assert.equal(merged.text, 'ALICE TEXT', 'an imported rewrite never reached the page');
      assert.equal(merged.orphans, 0);
      assert.equal(merged.rewrites.applied, 1);
      assert.equal(merged.dirty, true, 'imported comments are not in the file until it is saved');
      return 'ok';
    });
    if (r === 'skipped') return;
  });
});

describe('rewrites and the anchor ladder', { skip: SKIP }, () => {
  // Found on a real deck, not by the fixtures. Once a rewrite is applied the element no
  // longer says what its anchor recorded, so corroborating the path rung against the quote
  // rejects the very element the comment was written on. On light.html the sig rung happened
  // to rescue it with a badge; on an SVG deck where fifty <text> elements share one class
  // signature there is nothing to rescue it and the comment orphaned on an element that was
  // right there. Asserting `via` rather than just "not orphaned" is the point: a weaker rung
  // carrying a "moved" badge is a different, quieter version of the same bug.
  test('a rewritten element is still found on its strongest locator, in the session and after a reload', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'rw-ladder.html');
      await page.goto(`${origin}/rw-ladder.html`);
      await ready(page);
      const live = await page.evaluate(`(() => {
        window.__fbw._add(${LEAF}, 'retyped', { name: 'Alice', email: null }, 'LADDER REWRITE');
        const st = window.__fbw._state();
        return { orphans: st.orphans, via: st.groups.map((g) => g.via), n: st.groups.length };
      })()`);
      assert.equal(live.orphans, 0, 'the comment orphaned on the element it was just written on');
      assert.deepEqual(live.via, ['path'], `resolved by a weaker rung than path: ${JSON.stringify(live)}`);

      await page.waitForTimeout(200);
      const dl = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);
      await dl.saveAs(join(WORK, 'rw-ladder-1.html'));

      const cold = await browser.newContext();
      const p2 = await cold.newPage();
      await p2.goto(`${origin}/rw-ladder-1.html`);
      await p2.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p2.waitForTimeout(400);
      const after = await p2.evaluate(() => {
        const st = window.__fbw._state();
        const sr = document.getElementById('fbw-host').shadowRoot;
        return { orphans: st.orphans, via: st.groups.map((g) => g.via), pins: sr.querySelectorAll('.pin').length };
      });
      await cold.close();
      assert.equal(after.orphans, 0, 'the comment orphaned after a reload');
      assert.deepEqual(after.via, ['path'], `resolved by a weaker rung after reload: ${JSON.stringify(after)}`);
      assert.equal(after.pins, 1, 'no pin was drawn for a comment whose element is on the page');
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });
});

// An element whose text sits on its own indented line, which is the normal shape of authored
// HTML and the shape every other fixture in this file happens to avoid. `LEAF` above picks
// the FIRST childless element, which in light.html is a tight one-liner — so the whole rewrite
// suite passed while rewrites were being dropped on ordinary markup. Both halves of that blind
// spot are deliberate targets here.
const INDENTED_LEAF = "(() => [...document.querySelectorAll('p,h1,h2,h3,li,td')]"
  + ".find((n) => n.children.length === 0 && n.textContent.includes(String.fromCharCode(10))"
  + " && n.textContent.trim().length > 20))()";

describe('rewrites on the markup shape real decks actually have', { skip: SKIP }, () => {
  // `rewrite.from` is the element's RAW textContent, kept raw so Revert can restore the
  // author's markup exactly; `rewrite.to` comes out of a textarea and may carry newlines.
  // Every comparison in the ladder is against collapsed node text, so unless `want` is
  // collapsed too the two are different quantities and never match. When they did not match,
  // the path rung rejected the element the comment was written on, the quote rung found
  // nothing, and the rewrite was dropped while its comment was filed as orphaned — on an
  // element that had never moved, in a file that still passed verify.
  test('a rewrite on an indented element applies and keeps its strongest locator, in session and cold', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'rw-indented.html');
      await page.goto(`${origin}/rw-indented.html`);
      await ready(page);

      const live = await page.evaluate(`(() => {
        const n = ${INDENTED_LEAF};
        const raw = n.textContent;
        window.__fbw._add(n, 'tighten this paragraph', { name: 'Alice', email: null }, 'INDENTED REWRITE');
        const st = window.__fbw._state();
        const c = window.__fbw.getComments()[0];
        return {
          rawHadNewline: raw.includes(String.fromCharCode(10)),
          fromKeptRaw: c.rewrite.from === raw,
          orphans: st.orphans, via: st.groups.map((g) => g.via), text: n.textContent
        };
      })()`);
      // The premise of the bug: if the fixture stopped being indented this test would pass
      // for the wrong reason, so assert the shape before asserting the behaviour.
      assert.equal(live.rawHadNewline, true, 'fixture element is not indented; this test no longer covers the case');
      assert.equal(live.fromKeptRaw, true, 'from must stay byte-exact so Revert can restore the markup');
      assert.equal(live.text, 'INDENTED REWRITE');
      assert.equal(live.orphans, 0, 'the comment orphaned in the same session it was written');
      assert.deepEqual(live.via, ['path']);

      await page.waitForTimeout(200);
      const dl = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.evaluate(() => window.__fbw.save())
      ]).then(([d]) => d);
      await dl.saveAs(join(WORK, 'rw-indented-1.html'));
      execFileSync(process.execPath, [join(ROOT, 'bin', 'verify.mjs'), join(WORK, 'rw-indented-1.html')], { stdio: 'pipe' });

      const cold = await browser.newContext();
      const p2 = await cold.newPage();
      await p2.goto(`${origin}/rw-indented-1.html`);
      await p2.waitForFunction('!!window.__fbw', null, { timeout: 5000 });
      await p2.waitForTimeout(400);
      const after = await p2.evaluate(`(() => {
        const st = window.__fbw._state();
        return { text: ${INDENTED_LEAF} ? ${INDENTED_LEAF}.textContent : null,
                 applied: document.body.innerText.includes('INDENTED REWRITE'),
                 rewrites: st.rewrites, orphans: st.orphans, via: st.groups.map((g) => g.via) };
      })()`);
      await cold.close();

      assert.equal(after.applied, true, 'the rewrite was not replayed onto a cold open');
      assert.deepEqual(after.rewrites, { total: 1, applied: 1, missing: 0, conflicts: 0 });
      assert.equal(after.orphans, 0, 'the rewrite was dropped and its comment orphaned');
      assert.deepEqual(after.via, ['path'], `resolved on a weaker rung: ${JSON.stringify(after)}`);
      return 'ok';
    }, { acceptDownloads: true });
    if (r === 'skipped') return;
  });

  // The text field is a textarea, so this is not an exotic input.
  test('a rewrite whose new text spans lines does not orphan its own comment', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'rw-multiline.html');
      await page.goto(`${origin}/rw-multiline.html`);
      await ready(page);
      const out = await page.evaluate(`(() => {
        const n = ${LEAF};
        window.__fbw._add(n, 'split this', null, 'FIRST LINE' + String.fromCharCode(10) + 'SECOND LINE');
        const st = window.__fbw._state();
        return { orphans: st.orphans, groups: st.groups.length, via: st.groups.map((g) => g.via) };
      })()`);
      assert.equal(out.orphans, 0, 'a multi-line rewrite orphaned its comment the moment it was added');
      assert.equal(out.groups, 1);
      assert.deepEqual(out.via, ['path']);
      return 'ok';
    });
    if (r === 'skipped') return;
  });

  // Put text back is one click away from Resolve and Delete, and on a rewrite-only comment
  // `from` is the last copy of the author's wording. It must not be discarded on an element
  // that cannot be found, and it must not claim to have restored anything.
  test('reverting a rewrite whose element is gone keeps the record and says it failed', async () => {
    const r = await withPage(async (page) => {
      inject('test/fixtures/light.html', 'rw-revert-gone.html');
      await page.goto(`${origin}/rw-revert-gone.html`);
      await ready(page);
      const out = await page.evaluate(`(() => {
        const n = ${LEAF};
        window.__fbw._add(n, '', null, 'ORPHANED REWRITE');
        const id = window.__fbw.getComments()[0].id;
        n.remove();
        window.__fbw._revert(id);
        const c = window.__fbw.getComments()[0];
        const sr = document.getElementById('fbw-host').shadowRoot;
        const toast = sr.querySelector('.toast');
        return { stillHasRewrite: !!c.rewrite,
                 from: c.rewrite ? c.rewrite.from : null,
                 said: toast ? toast.textContent : '' };
      })()`);
      assert.equal(out.stillHasRewrite, true,
        "the author's original wording was discarded on an element that could not be found");
      assert.ok(out.from, 'from was emptied');
      assert.ok(/could not be put back/.test(out.said),
        `the reviewer was not told the revert failed, toast said: ${JSON.stringify(out.said)}`);
      return 'ok';
    });
    if (r === 'skipped') return;
  });
});
