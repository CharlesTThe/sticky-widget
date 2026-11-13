# Server mode and the HTTP contract

Read this if you are running the feedback server, mounting it in your own app, or writing a
server of your own for the widget to talk to.

---

## 1. The model

The server is the database. The browser keeps a copy in `localStorage`, which doubles as the
outbox.

There is no queue of operations. For each comment the widget remembers the `updatedAt` the
server last **confirmed** (`fbw:<page-key>:sync` in `localStorage`). A comment whose current
`updatedAt` differs from the confirmed one is pending; a tombstone the server has not confirmed
is pending. Pending things are sent until they are confirmed. Consequences:

- **Sending twice is harmless.** The server's write is an idempotent upsert.
- **Nothing is lost offline.** Pending comments survive reloads, and an outbox left on one page
  of an app is sent from whichever page the reviewer opens next.
- **Two reviewers converge** by the same rule the file merge uses (architecture.md §5): union by
  id, newer `updatedAt` wins, a tombstone always wins.

What the widget does with each kind of failure:

| Answer | Meaning | The widget |
|---|---|---|
| no answer, `408`, `429`, `5xx` | may work later | keeps it pending; retries with backoff (5 s doubling to 5 min), and again on `online`, focus, the poll and Send now |
| `401`, `403` | not allowed in | keeps it pending, no timer; tries again on `setUser`, focus, the poll and Send now |
| any other `4xx` (`400`, `409`, `413` …) | this version will never be accepted | records it as **refused**, with the reason; does not send that version again (editing the comment makes a new one, which is tried); keeps it in the browser; says so once through `onError` and in the review list |

`onError` is called once per distinct problem, not on every retry. Outboxes left on other pages
of an app are sent by the same paths, so an in-app navigation does not strand them.

Clocks are the reviewers' own. A skewed clock can make an older edit win; the server refuses an
`updatedAt` more than a day in the future so that one bad clock cannot win forever.

## 2. What a page is

Comments are grouped by **page**, a string.

| Where | Default page |
|---|---|
| A web app or site | `location.origin + location.pathname` (query and hash ignored) |
| An HTML file injected with `--endpoint` | `doc:<docId>` — the document's content hash, so every copy shares it |
| Anything else | whatever `pageId` returns (a string, or a function re-read on every navigation) |

A comment id belongs to one page for life; the server refuses to move it (409).

## 3. Endpoints

Relative to wherever the router is mounted (`/api/feedback` in the standalone server). JSON in,
JSON out.

### `GET /comments?page=P`

```json
{ "comments": [ /* Comment */ ], "tombstones": [ { "id": "c-…", "deletedAt": "…" } ] }
```

Every comment is returned exactly as it was sent. Unknown fields are kept, so a newer widget's
data survives an older server.

### `PUT /comments/:id`

Body: `{ "page": "P", "comment": { /* Comment, with comment.id === :id */ } }`

| Reply | Meaning |
|---|---|
| `200 { ok, comment }` | stored, or a newer version was already there. `comment` is whichever **won**; if it is not what was sent, the widget adopts it. |
| `200 { ok, deleted: true, deletedAt }` | the comment is tombstoned on the server; the widget deletes its copy. |
| `400 { error }` | the comment failed validation (below), or the body is not valid JSON. |
| `403` | `authorize()` said no. |
| `409` | that id belongs to another page. |
| `413` | the body is over 96 KB. |
| `503` | `authorize()` threw (your session store is down, say): try again. |
| `500` | the store failed. |

Every error is `{ error }` JSON, malformed bodies included. `GET /comments` and `DELETE` answer
`400`, `403`, `503` and `500` the same way.

Validation is structural, like `bin/verify.mjs`: id matches `^c-[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`,
`createdAt`/`updatedAt` are ISO 8601 date-times with a zone (`2026-11-01T10:00:00.000Z`, as
`toISOString` writes them) and `updatedAt` is not more than a day ahead, `text` is a
string of at most 10,000 characters, `author` and `anchor` are objects if present, and the whole
body is under 96 KB.

### `DELETE /comments/:id?page=P&deletedAt=T`

Records a tombstone, even for an id the server has never seen: the browser that deleted it may be
the only one that ever had it, and another browser may still try to upload it. `200 { ok,
deleted: true, deletedAt }`, or `409` if the id belongs to another page.

### `GET /export?page=&since=&limit=`

For triage, not for the widget. Every live comment, newest change first, each with its `page`
(the page it is stored under; a `page` field inside the comment cannot change it). Needs
`X-Api-Key: <adminKey>`: `401` without it, and with no `adminKey` configured the endpoint answers
`404` rather than being left open. `400` if a parameter is given twice.

### `GET /health`

`{ ok: true, store: "postgres" | "memory" | … }`

## 4. Running it

### Standalone

```bash
DATABASE_URL=postgres://user:pass@localhost/feedback npm run server
```

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | unset | Postgres. Unset keeps comments **in memory**, lost on restart; it warns at startup. |
| `PORT` | 3001 | |
| `CORS_ORIGIN` | any | Comma-separated origins allowed to call the API. Set it in production. |
| `ADMIN_KEY` | unset | Turns on `/export`. |
| `WRITE_KEY` | unset | Every API call must carry it in `X-Feedback-Key`: the widget's `writeKey` option, `data-write-key`, or `--write-key` for an injected file. Keeps strangers out of an internal tool; it is visible in your page source, so it is not sign-in. |
| `TRUST_PROXY` | unset | Behind a reverse proxy or load balancer: `1` (hops), `true`, or an address list such as `loopback`. Without it the rate limit (300 requests a minute) counts the proxy, so every reviewer shares one budget. |

It also serves the widget at `/feedback-kit.js` (script tag) and `/feedback-kit.mjs` (module), and
the examples at `/examples/`.

The table is created on startup. To create it yourself: `server/schema.sql`.

### Inside your own Express app

```js
import express from 'express';
import pg from 'pg';
import { feedbackRouter, postgresStore } from 'feedback-kit/server';

const store = postgresStore(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
await store.migrate();

app.use('/api/feedback', feedbackRouter({
  store,
  adminKey: process.env.FEEDBACK_ADMIN_KEY,
  // Tie feedback to your own sign-in. action is 'read' | 'write' | 'delete'.
  authorize: (req, { action, page }) => Boolean(req.user)
}));
```

Then in the page: `FeedbackKit.init({ endpoint: '/api/feedback' })`. If the API is on another
origin and uses cookies, pass `credentials: 'include'` and configure CORS with credentials; with a
bearer token, pass `headers: () => ({ Authorization: 'Bearer ' + token })`.

### A store of your own

A store is four async functions, plus an optional `migrate()` (called at startup) and `name`
(reported by `/health`); `server/stores/memory.mjs` is the reference implementation in under
sixty lines. Types: `types/server.d.ts`.

| Method | Returns |
|---|---|
| `list(page)` | `{ comments, tombstones }` |
| `upsert(page, comment)` | `{ comment }` (the winner), `{ deleted, deletedAt }`, or `{ conflict: 'page' }` |
| `remove(page, id, deletedAt)` | `{ deleted: true, deletedAt }` or `{ conflict: 'page' }` |
| `export({ page, since, limit })` | an array of comments, each with `page` |

`test/server.test.mjs` runs the whole contract against every store; add yours to its `stores`
table.

## 5. Verifying against Postgres

`npm test` runs the Postgres store on pg-mem, an in-memory emulation, so it needs no database.
To run the same contract — and the server-mode browser tests (`test/modes.test.mjs`), with the
server on Postgres — against a real database, point `TEST_DATABASE_URL` at one that exists only for tests (the
`feedback_comments` table in it is **dropped** first):

```bash
createdb fk_test        # or: CREATE DATABASE fk_test;
TEST_DATABASE_URL=postgres://user:pw@localhost:5432/fk_test npm run test:pg
```

Last run: PostgreSQL 18.6, 49 server-contract tests (15 of them on real Postgres) and 18 browser
tests, all passing.

No Postgres to hand? Either of these gives you one:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=fk_test postgres:18
# or, without Docker: the official binaries from npm (x64; runs under emulation on Windows ARM)
npm pack @embedded-postgres/windows-x64     # or linux-x64, darwin-arm64 …
# unpack, then: initdb -D data -U postgres -W  &&  pg_ctl -D data -o "-p 5432" start
```
