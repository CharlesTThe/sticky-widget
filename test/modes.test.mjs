// Browser tests for everything that is not file mode: local mode, server mode against the
// real standalone server, single-page-app navigation, the offline outbox, the React binding,
// and an injected HTML file that syncs to a server.
//
// The file-mode suite (test/browser.test.mjs) is unchanged and still the contract for files.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { createServer } from '../server/standalone.mjs';
import { launchChromium } from './launch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = mkdtempSync(join(tmpdir(), 'fk-modes-'));

let browser = null;
let launchError = null;
let server = null;
let serverStore = null;
let origin = '';
const pageErrors = [];

before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'build', 'build.mjs')], { stdio: 'pipe' });

  // In memory by default. With TEST_DATABASE_URL the same server runs on real Postgres; its
  // table is DROPPED first, so point it at a database that exists only for tests.
  const dbUrl = process.env.TEST_DATABASE_URL;
  if (dbUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: dbUrl });
    await pool.query('DROP TABLE IF EXISTS feedback_comments');
    await pool.end();
  }
  const created = await createServer(dbUrl ? { DATABASE_URL: dbUrl } : {});
  const { app } = created;
  serverStore = created.store;

  // The React fixture, bundled with React itself, as an app's own build would do it.
  const bundle = await esbuild.build({
    entryPoints: [join(ROOT, 'test', 'fixtures', 'react-app.jsx')],
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error'
  });
  const reactJs = bundle.outputFiles[0].text;
  app.get('/react-fixture.js', (req, res) => res.type('js').send(reactJs));
  app.get('/react-fixture.html', (req, res) => res.type('html').send(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>React fixture</title></head>' +
    '<body><div id="root"></div><script src="/react-fixture.js"></' + 'script></body></html>'));
  app.get('/work/:name', (req, res) => res.type('html').send(readFileSync(join(WORK, req.params.name))));

  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  origin = `http://127.0.0.1:${server.address().port}`;

  try { browser = await launchChromium(); } catch (err) { launchError = err.message; }
  if (launchError && process.env.FBW_REQUIRE_BROWSER) {
    console.error(`\n  FBW_REQUIRE_BROWSER is set and no browser ran: ${launchError}\n`);
    process.exitCode = 1;
  }
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  if (serverStore && serverStore.close) await serverStore.close();
  rmSync(WORK, { recursive: true, force: true });
  assert.deepEqual(pageErrors, [], 'a page threw while the widget was on it');
});

const SKIP = () => (launchError ? `no browser: ${launchError}` : false);

async function fresh() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  return { ctx, page };
}

// Waits until the widget has booted and, in server mode, finished its first load.
async function ready(page, { loaded = true } = {}) {
  await page.waitForFunction((needLoaded) => {
    const s = window.FeedbackKit && window.FeedbackKit.status();
    return s && (!needLoaded || s.loaded);
  }, loaded, { timeout: 10000 });
}

async function settled(page) {
  await page.waitForFunction(() => {
    const s = window.FeedbackKit.status();
    return s && s.pending === 0;
  }, null, { timeout: 10000 });
}

async function serverList(page) {
  const r = await fetch(`${origin}/api/feedback/comments?page=${encodeURIComponent(page)}`);
  return r.json();
}

async function add(page, selector, text) {
  return page.evaluate(([sel, t]) => window.__fbw._add(document.querySelector(sel), t), [selector, text]);
}

const reviewButton = (page, label) => page.locator('.panel button', { hasText: label }).first();

// ---------------------------------------------------------------------------

describe('local mode', () => {
  test('comments stay in the browser, survive a reload, and nothing is sent anywhere', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    const requests = [];
    page.on('request', (r) => { if (r.url().includes('/api/')) requests.push(r.url()); });
    await page.goto(`${origin}/examples/static-local.html`);
    await ready(page);
    assert.equal((await page.evaluate(() => window.FeedbackKit.status())).mode, 'local');
    await add(page, '#title', 'kept locally');
    await page.reload();
    await ready(page);
    const after = await page.evaluate(() => window.FeedbackKit.getComments().map((c) => c.text));
    assert.deepEqual(after, ['kept locally']);
    assert.deepEqual(requests, [], 'local mode made a request to the API');
    await ctx.close();
  });

  test('no save button, and Cmd/Ctrl+S is left to the browser', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    await page.goto(`${origin}/examples/static-local.html`);
    await ready(page);
    // The rail's action buttons: hide pins and the review list, nothing that claims to save.
    const tips = await page.locator('.act .tip').allTextContents();
    assert.ok(!tips.some((t) => /save|send/i.test(t)), `unexpected save button: ${tips}`);
    const prevented = await page.evaluate(() => {
      const e = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(e);
      return e.defaultPrevented;
    });
    assert.equal(prevented, false);
    await ctx.close();
  });
});

describe('server mode, plain HTML page', () => {
  const PAGE = () => `${origin}/examples/static-server.html`;

  test('a comment reaches the server with its context, and a second browser sees it pinned', { skip: SKIP() }, async () => {
    const a = await fresh();
    await a.page.goto(PAGE());
    await ready(a.page);
    assert.equal((await a.page.evaluate(() => window.FeedbackKit.status())).mode, 'server');
    await add(a.page, '#title', 'The title should mention Q3');
    await settled(a.page);

    const stored = await serverList(PAGE());
    assert.equal(stored.comments.length, 1);
    const c = stored.comments[0];
    assert.equal(c.text, 'The title should mention Q3');
    assert.equal(c.context.page, PAGE());
    assert.match(c.context.viewport, /^\d+x\d+$/);

    const b = await fresh();
    await b.page.goto(PAGE());
    await ready(b.page);
    await b.page.waitForFunction(() => window.__fbw._state().groups.length === 1);
    const st = await b.page.evaluate(() => window.__fbw._state());
    assert.equal(st.groups[0].tag, 'h1');
    assert.equal(st.groups[0].text, 'Quarterly Product Update');
    await a.ctx.close(); await b.ctx.close();
  });

  test('resolving and deleting in one browser reach the other', { skip: SKIP() }, async () => {
    const a = await fresh();
    const b = await fresh();
    await a.page.goto(PAGE()); await ready(a.page);
    await b.page.goto(PAGE()); await ready(b.page);
    await b.page.waitForFunction(() => window.FeedbackKit.getComments().length === 1);

    // Through the real review list, not a test seam.
    await b.page.evaluate(() => window.FeedbackKit.openReview());
    await reviewButton(b.page, 'Resolve').click();
    await settled(b.page);
    await a.page.evaluate(() => window.FeedbackKit.sync());
    assert.equal(await a.page.evaluate(() => window.FeedbackKit.getComments()[0].resolved), true);

    await a.page.evaluate(() => window.FeedbackKit.openReview());
    await reviewButton(a.page, 'Delete').click();
    await settled(a.page);
    const stored = await serverList(PAGE());
    assert.equal(stored.comments.length, 0);
    assert.equal(stored.tombstones.length, 1);
    await b.page.evaluate(() => window.FeedbackKit.sync());
    assert.equal(await b.page.evaluate(() => window.FeedbackKit.getComments().length), 0);
    await a.ctx.close(); await b.ctx.close();
  });

  test('the real picker and composer, start to finish, including the name prompt', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    await page.goto(PAGE());
    await ready(page);
    await page.locator('.fab').click();
    await page.locator('table tbody tr:nth-child(2) td:first-child').click();
    await page.locator('textarea.cmt').fill('CSV export is needed sooner');
    await reviewButton(page, 'Add comment').click();
    await page.locator('.modal input').fill('Priya');
    await page.locator('.modal button', { hasText: 'Continue' }).click();
    await settled(page);
    const stored = await serverList(PAGE());
    const mine = stored.comments.find((c) => c.text === 'CSV export is needed sooner');
    assert.ok(mine, 'the comment did not reach the server');
    assert.equal(mine.author.name, 'Priya');
    assert.equal(mine.anchor.tag, 'td');
    await ctx.close();
  });
});

describe('server mode, offline', () => {
  test('a comment made with the server unreachable is kept, shown as unsent, and sent once it is back', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    await page.route('**/api/feedback/**', (r) => r.abort());
    await page.goto(`${origin}/examples/static-server.html`);
    await ready(page, { loaded: false });
    await add(page, 'h2', 'written on a train');
    await page.waitForFunction(() => window.FeedbackKit.status().lastError !== null);
    const st = await page.evaluate(() => window.FeedbackKit.status());
    assert.equal(st.pending, 1);

    await page.evaluate(() => window.FeedbackKit.openReview());
    const warn = await page.locator('.panel .warn').first().textContent();
    assert.match(warn, /not sent yet/);

    await page.unroute('**/api/feedback/**');
    await page.evaluate(() => window.FeedbackKit.sync());
    await settled(page);
    const stored = await serverList(`${origin}/examples/static-server.html`);
    assert.ok(stored.comments.some((c) => c.text === 'written on a train'));
    await ctx.close();
  });

  test('an outbox left on one page is sent from the next page the reviewer opens', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    await page.route('**/api/feedback/**', (r) => r.abort());
    await page.goto(`${origin}/examples/static-server.html`);
    await ready(page, { loaded: false });
    await add(page, 'h2', 'left behind in the outbox');
    await page.unroute('**/api/feedback/**');
    // A full load of a different page. The comment's page is never visited again.
    await page.goto(`${origin}/examples/spa/home`);
    await ready(page);
    const deadline = Date.now() + 8000;
    let found = false;
    while (!found && Date.now() < deadline) {
      const stored = await serverList(`${origin}/examples/static-server.html`);
      found = stored.comments.some((c) => c.text === 'left behind in the outbox');
      if (!found) await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(found, 'the outbox from the other page was never sent');
    await ctx.close();
  });
});

describe('server mode, refusals and recovery', () => {
  const PAGE = () => `${origin}/examples/static-server.html`;

  test('a comment the server refuses for good is not retried forever, and says why', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    let puts = 0;
    await page.route('**/api/feedback/comments/*', (r) => {
      if (r.request().method() !== 'PUT') return r.continue();
      puts++;
      return r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'that comment id belongs to another page' }) });
    });
    await page.goto(PAGE());
    await ready(page);
    await add(page, 'h2', 'refused');
    await page.waitForFunction(() => window.FeedbackKit.status().rejected === 1);
    const st = await page.evaluate(() => window.FeedbackKit.status());
    assert.equal(st.pending, 0, 'a refused comment still counts as pending');
    assert.equal(st.dirty, false);
    assert.equal(puts, 1);

    // Send now, focus, the poll: none of them sends the same refused version again.
    await page.evaluate(() => window.FeedbackKit.sync());
    await page.evaluate(() => window.FeedbackKit.sync());
    assert.equal(puts, 1, 'the refused comment was sent again');

    await page.evaluate(() => window.FeedbackKit.openReview());
    const panel = await page.locator('#fbw-host .panel').first().textContent();
    assert.match(panel, /refused 1 change: 409 \(that comment id belongs to another page\)/);
    // Kept, not dropped.
    assert.ok(await page.evaluate(() => window.FeedbackKit.getComments().some((c) => c.text === 'refused')));
    await ctx.close();
  });

  test('"not allowed" waits for a sign-in instead of retrying on a timer', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    let calls = 0;
    await page.route('**/api/feedback/comments**', (r) => {
      calls++;
      return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'not allowed' }) });
    });
    await page.goto(PAGE());
    await ready(page, { loaded: false });
    await add(page, 'h2', 'needs a sign-in');
    // Both the first load and the comment's PUT have been refused, and nothing is in flight.
    await page.waitForFunction(() => /403/.test(window.FeedbackKit.status().lastError || ''));
    while (calls < 2) await page.waitForTimeout(50);
    await page.waitForTimeout(500);
    const before = calls;
    // Past the first backoff step (5 s): a timer retry would have fired by now.
    await page.waitForTimeout(6000);
    assert.equal(calls, before, 'a 403 was retried on a timer');
    assert.equal((await page.evaluate(() => window.FeedbackKit.status())).pending, 1);

    await page.unroute('**/api/feedback/comments**');
    await page.evaluate(() => window.FeedbackKit.setUser({ name: 'Signed In' }));
    await settled(page);
    const stored = await serverList(PAGE());
    assert.ok(stored.comments.some((c) => c.text === 'needs a sign-in'));
    await ctx.close();
  });

  test('coming back online sends what was kept, without anyone pressing Send now', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    await page.route('**/api/feedback/**', (r) => r.abort());
    await page.goto(PAGE());
    await ready(page, { loaded: false });
    await add(page, 'h2', 'sent on the online event');
    await page.waitForFunction(() => window.FeedbackKit.status().lastError !== null);
    await page.unroute('**/api/feedback/**');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await settled(page);
    await page.waitForFunction(() => window.FeedbackKit.status().loaded, null, { timeout: 10000 });
    const stored = await serverList(PAGE());
    assert.ok(stored.comments.some((c) => c.text === 'sent on the online event'));
    await ctx.close();
  });

  test('the write key goes with every request', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    const keys = [];
    page.on('request', (r) => { if (r.url().includes('/api/feedback/')) keys.push(r.headers()['x-feedback-key'] || null); });
    await page.goto(PAGE());
    await ready(page);
    keys.length = 0;
    await page.evaluate(() => window.FeedbackKit.init({ endpoint: '/api/feedback', writeKey: 'k-123' }));
    await ready(page);
    await add(page, 'h2', 'with a key');
    await settled(page);
    assert.ok(keys.length > 0);
    assert.deepEqual([...new Set(keys)], ['k-123']);
    await ctx.close();
  });
});

describe('suggested wording in server mode', () => {
  const PAGE = () => `${origin}/examples/static-server.html`;

  test("another reviewer's rewrite is listed as a suggestion, not applied to the page", { skip: SKIP() }, async () => {
    const a = await fresh();
    await a.ctx.addInitScript(() => localStorage.setItem('fbw:author', JSON.stringify({ name: 'Ana', email: 'ana@x.test' })));
    await a.page.goto(PAGE());
    await ready(a.page);
    const original = await a.page.locator('h2').first().textContent();
    await a.page.evaluate(() => window.__fbw._add(document.querySelector('h2'), '', undefined, 'Pay to account 666'));
    await settled(a.page);
    // Her own suggestion is on her page after a reload.
    await a.page.reload();
    await ready(a.page);
    await a.page.waitForFunction(() => document.querySelector('h2').textContent === 'Pay to account 666',
      null, { timeout: 10000 });

    const b = await fresh();
    await b.page.goto(PAGE());
    await ready(b.page);
    await b.page.waitForFunction(() => window.FeedbackKit.getComments().some((c) => c.rewrite));
    await b.page.waitForTimeout(1500);   // past whenSettled, which is when rewrites are applied
    assert.equal(await b.page.locator('h2').first().textContent(), original, "someone else's rewrite changed this page");
    await b.page.evaluate(() => window.FeedbackKit.openReview());
    assert.ok(await b.page.locator('.panel .badge', { hasText: 'suggested text' }).count() >= 1);
    assert.equal(await b.page.locator('.panel button', { hasText: 'Put text back' }).count(), 0);

    // Put back and deleted, so later tests on this page start from what they expect.
    await a.page.evaluate(() => {
      const c = window.FeedbackKit.getComments().find((x) => x.rewrite);
      window.__fbw._revert(c.id);
    });
    await settled(a.page);
    await a.ctx.close(); await b.ctx.close();
  });
});

describe('single-page app', () => {
  test('each route keeps its own comments, and back/forward brings them back', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    await page.goto(`${origin}/examples/spa/home`);
    await ready(page);
    await add(page, '#usage', 'Show the limit as a bar');
    await settled(page);

    await page.locator('nav a', { hasText: 'Settings' }).click();
    await page.waitForFunction(() => window.FeedbackKit.status().page.endsWith('/examples/spa/settings'));
    await ready(page);
    assert.equal(await page.evaluate(() => window.FeedbackKit.getComments().length), 0);
    await page.waitForFunction(() => window.__fbw._state().groups.length === 0);

    await page.goBack();
    await page.waitForFunction(() => window.FeedbackKit.status().page.endsWith('/examples/spa/home'));
    await page.waitForFunction(() => window.__fbw._state().groups.length === 1);

    const home = await serverList(`${origin}/examples/spa/home`);
    const settings = await serverList(`${origin}/examples/spa/settings`);
    assert.equal(home.comments.length, 1);
    assert.equal(home.comments[0].author.name, 'Demo user', 'the user passed to init() was not used');
    assert.equal(settings.comments.length, 0);
    await ctx.close();
  });

  test('an outbox left by an in-app navigation is sent without a reload, and the page does not claim all is sent', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    await page.goto(`${origin}/examples/spa/home`);
    await ready(page);
    await page.route('**/api/feedback/**', (r) => r.abort());
    await add(page, '#usage', 'written offline on home');
    await page.waitForFunction(() => window.FeedbackKit.status().lastError !== null);

    await page.locator('nav a', { hasText: 'Settings' }).click();
    await page.waitForFunction(() => window.FeedbackKit.status().page.endsWith('/examples/spa/settings'));
    await page.waitForFunction(() => window.FeedbackKit.status().otherPending === 1);
    await page.evaluate(() => window.FeedbackKit.openReview());
    // #fbw-host: the example app has a .panel of its own.
    const panel = await page.locator('#fbw-host .panel').first().textContent();
    assert.doesNotMatch(panel, /Everything is sent/);
    assert.match(panel, /other pages/);

    await page.unroute('**/api/feedback/**');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => window.FeedbackKit.status().otherPending === 0, null, { timeout: 10000 });
    const home = await serverList(`${origin}/examples/spa/home`);
    assert.ok(home.comments.some((c) => c.text === 'written offline on home'), 'the home outbox was never sent');
    assert.equal(await page.evaluate(() => window.FeedbackKit.status().page.endsWith('/examples/spa/settings')), true,
      'the page reloaded or navigated, which would prove nothing');
    await ctx.close();
  });

  test('destroy() puts history back and removes everything it added', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    await page.goto(`${origin}/examples/spa/home`);
    await ready(page);
    const r = await page.evaluate(() => {
      window.FeedbackKit.destroy();
      return {
        host: !!document.getElementById('fbw-host'),
        native: /\[native code\]/.test(String(history.pushState)),
        instance: window.FeedbackKit.instance()
      };
    });
    assert.deepEqual(r, { host: false, native: true, instance: null });
    await ctx.close();
  });
});

describe('React binding', () => {
  test('one widget under StrictMode, not restarted by re-renders, user and callbacks live, gone on unmount', { skip: SKIP() }, async () => {
    const { ctx, page } = await fresh();
    await page.goto(`${origin}/react-fixture.html`);
    await ready(page);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#fbw-host').length), 1);
    await page.evaluate(() => { window.__inst = window.FeedbackKit.instance(); });

    for (let i = 0; i < 3; i++) await page.locator('#rerender').click();
    assert.equal(await page.evaluate(() => window.__inst === window.FeedbackKit.instance()), true,
      'a re-render restarted the widget');

    await add(page, '#para', 'first');
    assert.equal(await page.evaluate(() => window.__submitted), 1, 'onSubmit did not fire');
    assert.equal(await page.evaluate(() => window.__lastSubmitted.author.name), 'Ria');

    await page.locator('#switch-user').click();
    // React has rendered the new user, and a frame later its effects (setUser) have run.
    await page.waitForFunction(() => document.getElementById('who').textContent === 'Sam');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
    assert.equal(await page.evaluate(() => window.__inst === window.FeedbackKit.instance()), true,
      'changing the user restarted the widget');
    await add(page, '#title', 'second');
    assert.equal(await page.evaluate(() => window.__lastSubmitted.author.name), 'Sam');

    await settled(page);
    await page.locator('#toggle').click();
    await page.waitForFunction(() => !document.getElementById('fbw-host'));
    assert.equal(await page.evaluate(() => window.FeedbackKit.instance()), null);
    await ctx.close();
  });
});

describe('an HTML file injected with --endpoint', () => {
  test('syncs to the server, and every copy of the file shares one set of comments', { skip: SKIP() }, async () => {
    const out = join(WORK, 'deck.html');
    execFileSync(process.execPath, [join(ROOT, 'bin', 'add-feedback.mjs'), join(ROOT, 'examples', 'deck.html'),
      '--out', out, '--endpoint', `${origin}/api/feedback`, '--quiet'], { stdio: 'pipe' });
    execFileSync(process.execPath, [join(ROOT, 'bin', 'verify.mjs'), out], { stdio: 'pipe' });
    copyFileSync(out, join(WORK, 'deck (1) renamed.html'));

    const a = await fresh();
    await a.page.goto(`${origin}/work/deck.html`);
    await ready(a.page);
    const st = await a.page.evaluate(() => window.FeedbackKit.status());
    assert.equal(st.mode, 'server');
    assert.match(st.page, /^doc:[0-9a-f]{16}$/);
    await add(a.page, 'h1', 'on the deck');
    await settled(a.page);

    const b = await fresh();
    await b.page.goto(`${origin}/work/${encodeURIComponent('deck (1) renamed.html')}`);
    await ready(b.page);
    assert.equal(await b.page.evaluate(() => window.FeedbackKit.status().page), st.page);
    assert.deepEqual(await b.page.evaluate(() => window.FeedbackKit.getComments().map((c) => c.text)), ['on the deck']);
    await a.ctx.close(); await b.ctx.close();
  });
});

test('importing the module where there is no browser (server-side rendering) is harmless', async () => {
  const mod = await import(pathToFileURL(join(ROOT, 'dist', 'feedback-kit.mjs')).href);
  assert.equal(mod.init({ endpoint: '/x' }), null);
  assert.deepEqual(mod.getComments(), []);
  const react = await import(pathToFileURL(join(ROOT, 'dist', 'react.mjs')).href);
  assert.equal(typeof react.FeedbackWidget, 'function');
});
