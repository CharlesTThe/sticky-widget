// The server contract, run against every store. Postgres runs on pg-mem, an in-memory
// emulation of Postgres, so the SQL is exercised without a database server. pg-mem is not
// Postgres: it is a check that the SQL is sane and the merge rule holds, not a substitute for
// running against the real thing before production (see references/server.md §5).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { newDb } from 'pg-mem';
import { feedbackRouter, postgresStore, memoryStore } from '../server/index.mjs';
import { createServer, parseTrustProxy } from '../server/standalone.mjs';

function comment(id, over = {}) {
  const t = over.updatedAt || '2026-11-01T10:00:00.000Z';
  return {
    id, schemaVersion: 1, createdAt: over.createdAt || t, updatedAt: t,
    author: { name: 'Ana', email: null }, text: 'Too much padding', resolved: false,
    originalText: null, toolBuild: null, rewrite: null,
    anchor: { tag: 'h1', id: null, path: 'body>h1:nth-of-type(1)', aria: null, sig: 'h1|0', quote: { exact: 'Hello' }, hint: null },
    context: { page: 'https://app.test/', viewport: '1280x800' },
    ...over
  };
}

const stores = {
  memory: async () => memoryStore(),
  'postgres (pg-mem)': async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const s = postgresStore(new Pool());
    await s.migrate();
    return s;
  }
};

// Real Postgres, when you point the suite at one:
//   TEST_DATABASE_URL=postgres://user:pw@localhost:5432/fk_test npm run test:pg
// The table is DROPPED first, so give it a database that exists only for this.
if (process.env.TEST_DATABASE_URL) {
  stores['postgres (real)'] = async () => {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await pool.query('DROP TABLE IF EXISTS feedback_comments');
    const s = postgresStore(pool);
    await s.migrate();
    s.close = () => pool.end();
    return s;
  };
}

for (const [name, make] of Object.entries(stores)) {
  describe(`server contract — ${name}`, () => {
    let server, base, store;
    let allow = true;
    let authorizeThrows = false;

    before(async () => {
      store = await make();
      const app = express();
      app.use('/fb', feedbackRouter({ store, adminKey: 'sekret', authorize: () => {
        if (authorizeThrows) throw new Error('session store is down');
        return allow;
      } }));
      server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
      base = `http://127.0.0.1:${server.address().port}/fb`;
    });
    after(async () => {
      await new Promise((r) => server.close(r));
      if (store.close) await store.close();
    });

    const call = async (method, path, body, headers = {}) => {
      const r = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: r.status, body: await r.json() };
    };
    const put = (page, c) => call('PUT', `/comments/${encodeURIComponent(c.id)}`, { page, comment: c });
    const list = (page) => call('GET', `/comments?page=${encodeURIComponent(page)}`);

    test('an unknown page is empty, not an error', async () => {
      const r = await list('https://app.test/nothing');
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { comments: [], tombstones: [] });
    });

    test('a comment written is read back verbatim, unknown fields included', async () => {
      const c = comment('c-aaaaaaaaaaaa', { futureField: { kept: true } });
      const w = await put('P1', c);
      assert.equal(w.status, 200);
      assert.equal(w.body.ok, true);
      const r = await list('P1');
      assert.equal(r.body.comments.length, 1);
      assert.deepEqual(r.body.comments[0], c);
    });

    test('pages are kept apart', async () => {
      await put('P2', comment('c-bbbbbbbbbbbb'));
      assert.equal((await list('P2')).body.comments.length, 1);
      assert.ok(!(await list('P1')).body.comments.some((c) => c.id === 'c-bbbbbbbbbbbb'));
    });

    test('newer updatedAt wins; an older write is answered with the newer version', async () => {
      const id = 'c-cccccccccccc';
      await put('P3', comment(id, { text: 'v2', updatedAt: '2026-11-02T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' }));
      const stale = await put('P3', comment(id, { text: 'v1', updatedAt: '2026-11-01T12:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' }));
      assert.equal(stale.body.comment.text, 'v2', 'the stale write must not win, and the reply must say what did');
      const fresh = await put('P3', comment(id, { text: 'v3', updatedAt: '2026-11-03T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' }));
      assert.equal(fresh.body.comment.text, 'v3');
      assert.equal((await list('P3')).body.comments[0].text, 'v3');
    });

    test('the same write twice is harmless', async () => {
      const c = comment('c-dddddddddddd');
      await put('P4', c);
      const again = await put('P4', c);
      assert.equal(again.status, 200);
      assert.equal((await list('P4')).body.comments.length, 1);
    });

    test('a deletion is a tombstone, and a tombstone beats a later upload', async () => {
      const id = 'c-eeeeeeeeeeee';
      await put('P5', comment(id));
      const d = await call('DELETE', `/comments/${id}?page=P5&deletedAt=2026-11-05T00:00:00.000Z`);
      assert.equal(d.status, 200);
      const r = await list('P5');
      assert.equal(r.body.comments.length, 0);
      assert.deepEqual(r.body.tombstones.map((t) => t.id), [id]);
      // A browser that still holds the comment, even with a newer edit, must not bring it back.
      const back = await put('P5', comment(id, { updatedAt: '2026-11-09T00:00:00.000Z' }));
      assert.equal(back.body.deleted, true);
      assert.equal((await list('P5')).body.comments.length, 0);
    });

    test('deleting a comment this server never saw still records the tombstone', async () => {
      const id = 'c-ffffffffffff';
      await call('DELETE', `/comments/${id}?page=P6`);
      const back = await put('P6', comment(id));
      assert.equal(back.body.deleted, true);
    });

    test('a comment id cannot be moved to, or deleted from, another page', async () => {
      await put('P7', comment('c-111111111111'));
      assert.equal((await put('P8', comment('c-111111111111', { updatedAt: '2026-11-08T00:00:00.000Z' }))).status, 409);
      assert.equal((await call('DELETE', '/comments/c-111111111111?page=P8')).status, 409);
      assert.equal((await list('P7')).body.comments.length, 1);
    });

    test('malformed input is refused with a reason', async () => {
      const cases = [
        [() => call('PUT', '/comments/not-an-id', { page: 'P', comment: comment('not-an-id') }), /invalid comment id/],
        [() => call('PUT', '/comments/c-222222222222', { comment: comment('c-222222222222') }), /page is required/],
        [() => call('PUT', '/comments/c-222222222222', { page: 'P', comment: comment('c-333333333333') }), /must match/],
        [() => call('PUT', '/comments/c-222222222222', { page: 'P', comment: comment('c-222222222222', { text: 'x'.repeat(10001) }) }), /at most 10000/],
        [() => call('PUT', '/comments/c-222222222222', { page: 'P', comment: comment('c-222222222222', { updatedAt: '2099-01-01T00:00:00.000Z' }) }), /future/],
        [() => call('PUT', '/comments/c-222222222222', { page: 'P', comment: comment('c-222222222222', { updatedAt: 'yesterday' }) }), /ISO date/],
        // Date.parse accepts these; Postgres's timestamptz does not, which used to be a 500.
        [() => call('PUT', '/comments/c-222222222222', { page: 'P', comment: comment('c-222222222222', { updatedAt: '1' }) }), /ISO date/],
        [() => call('PUT', '/comments/c-222222222222', { page: 'P', comment: comment('c-222222222222', { updatedAt: '2026-01-01 junk' }) }), /ISO date/],
        [() => call('GET', '/export?page=a&page=b', undefined, { 'X-Api-Key': 'sekret' }), /once/],
        [() => call('GET', '/comments'), /page is required/]
      ];
      for (const [run, why] of cases) {
        const r = await run();
        assert.equal(r.status, 400, JSON.stringify(r.body));
        assert.match(r.body.error, why);
      }
    });

    test('authorize() can refuse reads and writes', async () => {
      allow = false;
      try {
        assert.equal((await list('P1')).status, 403);
        assert.equal((await put('P1', comment('c-444444444444'))).status, 403);
      } finally { allow = true; }
    });

    test('authorize() that throws is a 503 (try again), not a 403 (not allowed)', async () => {
      authorizeThrows = true;
      try {
        const r = await list('P1');
        assert.equal(r.status, 503);
        assert.equal((await call('DELETE', '/comments/c-555555555555?page=P1')).status, 503);
      } finally { authorizeThrows = false; }
    });

    test('authorize() can refuse a delete', async () => {
      allow = false;
      try {
        assert.equal((await call('DELETE', '/comments/c-aaaaaaaaaaaa?page=P1')).status, 403);
      } finally { allow = true; }
      assert.equal((await list('P1')).body.comments.length, 1);
    });

    test('a broken or oversized body is answered in JSON, not an HTML error page', async () => {
      const bad = await fetch(base + '/comments/c-666666666666', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"page": "P", '
      });
      assert.equal(bad.status, 400);
      assert.match((await bad.json()).error, /JSON/);
      const big = await put('P9', comment('c-777777777777', { anchor: { pad: 'x'.repeat(120000) } }));
      assert.equal(big.status, 413);
      assert.match(big.body.error, /too large/);
    });

    test('a page field inside the comment cannot change the page the export reports', async () => {
      await put('P10', comment('c-888888888888', { page: 'somewhere-else' }));
      const r = await call('GET', '/export?page=P10', undefined, { 'X-Api-Key': 'sekret' });
      assert.equal(r.body.comments.length, 1);
      assert.equal(r.body.comments[0].page, 'P10');
    });

    test('export needs the admin key and returns live comments only', async () => {
      assert.equal((await call('GET', '/export')).status, 401);
      const r = await call('GET', '/export', undefined, { 'X-Api-Key': 'sekret' });
      assert.equal(r.status, 200);
      const ids = r.body.comments.map((c) => c.id);
      assert.ok(ids.includes('c-aaaaaaaaaaaa'));
      assert.ok(!ids.includes('c-eeeeeeeeeeee'), 'a deleted comment is not exported');
      assert.ok(r.body.comments.every((c) => typeof c.page === 'string'));
    });
  });
}

test('export is switched off, not left open, when no admin key is configured', async () => {
  const app = express();
  app.use('/fb', feedbackRouter({ store: memoryStore() }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/fb/export`);
    assert.equal(r.status, 404);
  } finally { await new Promise((r) => server.close(r)); }
});

describe('standalone server: WRITE_KEY, CORS, TRUST_PROXY', () => {
  let server, base;
  before(async () => {
    const { app } = await createServer({ WRITE_KEY: 'k-123', CORS_ORIGIN: 'https://app.test', TRUST_PROXY: '1' });
    server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/feedback`;
  });
  after(async () => { await new Promise((r) => server.close(r)); });

  test('every API call needs the key; health does not', async () => {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/comments?page=P')).status, 403);
    assert.equal((await fetch(base + '/comments?page=P', { headers: { 'X-Feedback-Key': 'wrong' } })).status, 403);
    assert.equal((await fetch(base + '/comments?page=P', { headers: { 'X-Feedback-Key': 'k-123' } })).status, 200);
    const w = await fetch(base + '/comments/c-aaaaaaaaaaaa', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 'P', comment: comment('c-aaaaaaaaaaaa') })
    });
    assert.equal(w.status, 403);
  });

  test('a preflight from an allowed origin may send the key; another origin is not allowed', async () => {
    const ok = await fetch(base + '/comments/c-aaaaaaaaaaaa', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.test', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,x-feedback-key' }
    });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.test');
    assert.match(ok.headers.get('access-control-allow-headers') || '', /X-Feedback-Key/i);
    const other = await fetch(base + '/health', { headers: { Origin: 'https://evil.test' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  });

  test('TRUST_PROXY is read as a hop count, a boolean, or an address list', () => {
    assert.equal(parseTrustProxy(undefined), undefined);
    assert.equal(parseTrustProxy(''), undefined);
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy('true'), true);
    assert.equal(parseTrustProxy('loopback'), 'loopback');
  });
});
