# feedback-kit

Click-to-comment feedback for anything you put in front of people: a standalone HTML file, a
static site, or a React, Vue, Svelte or Angular app. A reviewer clicks **+**, points at
anything on the page, and types. A numbered pin stays on that spot for everyone who looks next.

One widget, three places the comments can go:

| Mode | Comments go… | Backend | Use it for |
|---|---|---|---|
| **file** | into the HTML file itself (Cmd/Ctrl+S) | none | decks, one-pagers and prototypes you email around |
| **server** | to your Node + Postgres server, synced both ways | `npm run server`, or mount the router in your app | apps and sites, many reviewers, one place to read it all |
| **local** | into this browser, shared as JSON | none | quick solo review, or when there is nowhere to send them |

It is the same runtime in all three: the picker, pins, threads, resolve, suggested text edits,
the review list, Copy summary and JSON export/import. It lives in its own shadow root, so your
CSS cannot break it and it cannot break your CSS, and nothing is loaded from a third party.

This merges two earlier widgets: the file-based `feedback-widget` (robust anchoring, pins,
threads, text rewrites, save-into-file) and `sticky-widget` (backend submission, Express +
Postgres, user identity, console capture).

---

## Pick your setup

### A standalone HTML file → file mode

```bash
node bin/add-feedback.mjs "my-deck.html" --out "my-deck - review.html"
node bin/verify.mjs "my-deck - review.html"      # exit 0 = done
```

Send the output file. Reviewers open it, comment, press Cmd/Ctrl+S, and send it on; the next
person sees everything before them. Details: [`references/cli.md`](references/cli.md),
[`references/architecture.md`](references/architecture.md).

Want those comments in one place instead of in the file? Add `--endpoint`:

```bash
node bin/add-feedback.mjs my-deck.html --out review.html --endpoint https://feedback.example.com/api/feedback
```

(Add `--write-key <key>` if the server runs with `WRITE_KEY`.)

Every copy of that file, however it is renamed or forwarded, then shares one set of comments.

### Any web page → one script tag

```html
<!-- comments to your server -->
<script src="https://feedback.example.com/feedback-kit.js"
        data-endpoint="https://feedback.example.com/api/feedback"></script>

<!-- or: comments stay in the browser -->
<script src="feedback-kit.js" data-mode="local"></script>
```

Other attributes: `data-page-id`, `data-accent`, `data-position="bottom-left"`,
`data-user-name`, `data-user-email`, `data-capture-console`, `data-text-edits="false"`,
`data-poll-interval`, `data-write-key`, `data-show-rewrites="all"`. A bare `data-feedback-kit`
starts it with no other settings.

### An app with a bundler → import it

```js
import FeedbackKit from 'feedback-kit';

FeedbackKit.init({
  endpoint: '/api/feedback',
  user: { name: currentUser.name, email: currentUser.email },   // skips the name prompt
});
```

Client-side routing is followed automatically (`pushState`, `replaceState`, back/forward): each
route keeps its own comments. Safe to import during server-side rendering; it does nothing there.

### React

```jsx
import { FeedbackWidget } from 'feedback-kit/react';

<FeedbackWidget endpoint="/api/feedback" user={user} disabled={!user?.isStaff} />
```

Render it once near the root. It survives StrictMode and re-renders, and changing `user` does
not restart it. Next.js: put it in a `'use client'` component. Full example:
[`examples/react/App.jsx`](examples/react/App.jsx). Vue, Svelte, Angular:
[`examples/other-frameworks.md`](examples/other-frameworks.md).

---

## The server

```bash
npm install
DATABASE_URL=postgres://user:pass@localhost/feedback npm run server
# → http://localhost:3001/examples/ to try it
```

Without `DATABASE_URL` it runs on an in-memory store (and says so), which is fine for a try-out.
Set `CORS_ORIGIN` to the sites allowed to send feedback, `TRUST_PROXY=1` if it sits behind a
reverse proxy (otherwise every reviewer shares one rate limit), and `ADMIN_KEY` to switch on
`GET /api/feedback/export` for reading everything:

```bash
curl -H "X-Api-Key: $ADMIN_KEY" http://localhost:3001/api/feedback/export
```

Already have an Express app? Mount the router and use your own sign-in:

```js
import { feedbackRouter, postgresStore } from 'feedback-kit/server';
const store = postgresStore(pool);
await store.migrate();
app.use('/api/feedback', feedbackRouter({ store, authorize: (req) => Boolean(req.user) }));
```

The HTTP contract, the sync model, and how to plug in another database:
[`references/server.md`](references/server.md).

**Offline is handled.** Comments are kept in the browser until the server confirms them, retried
with backoff, and sent from whichever page the reviewer is on if they navigated away. A comment
the server **refuses** (invalid, too large, an id that belongs to another page) is not retried
forever: it is kept in the browser, reported once through `onError`, and the review list says
which and why. "Not allowed" (401/403) waits for a sign-in (`setUser`) or the next sync instead
of retrying on a timer. The review list always says whether everything is sent.

---

## Options

| Option | Default | |
|---|---|---|
| `mode` | `'auto'` | `'file'` on an injected file, `'server'` when `endpoint` is set, else `'local'` |
| `endpoint` | — | base URL of the feedback server |
| `pageId` | origin + path | what counts as one page; a function is re-read on every navigation. An injected file with `--endpoint` uses `doc:<docId>`; a page opened from `file:` uses its full path |
| `user` | — | `{ name, email }`; when set, reviewers are never asked their name |
| `headers` | — | extra request headers, or a function returning them (for tokens) |
| `credentials` | `'same-origin'` | `fetch` credentials for server calls |
| `writeKey` | — | the standalone server's `WRITE_KEY`, sent as `X-Feedback-Key` |
| `showRewrites` | `'mine'` in server mode, else `'all'` | whose suggested wording is applied to the page; others' are listed as suggestions |
| `accent` | from the page | colour of the button and pins; set `--fbw-accent` in your CSS to theme it once |
| `position` | `'bottom-right'` | or `'bottom-left'` |
| `captureConsole` | `false` | attach the last console errors/warnings to each comment (never in file mode) |
| `textEdits` | `true` | let reviewers retype text-only elements as a suggestion |
| `pollInterval` | `60` | server mode: seconds between refreshes while the tab is visible; `0` = off |
| `saveShortcut` | `true` | server mode: Cmd/Ctrl+S means "send now"; set `false` if your app uses it |
| `onSubmit`, `onChange`, `onError`, `onOpen`, `onClose`, `onPageChange` | — | callbacks |

API: `init`, `destroy`, `open`, `close`, `openReview`, `save`, `sync`, `setUser`, `getComments`,
`status`. Types: [`types/index.d.ts`](types/index.d.ts), [`types/react.d.ts`](types/react.d.ts) and
[`types/server.d.ts`](types/server.d.ts); the script tag's `window.FeedbackKit` is typed too.

Each comment records the element it is on (five independent locators, so pins survive
re-renders and reordering; see architecture.md §3), the author, timestamps, any suggested
rewrite, and outside file mode the page, URL, viewport, browser and language.

---

## Limits worth knowing

- **Comments on a page that changed.** If the element a comment was on is gone, the comment is
  listed as *orphaned* with the text it was written on, never moved onto something else. A pin
  with a dashed amber ring was re-found by a weaker match: check it.
- **Suggested text in React/Vue apps.** A rewrite is shown on the page, but the framework may
  put its own text back on the next render. The suggestion is kept and the pin still finds the
  element; the page just stops showing the new wording.
- **Content inside an `iframe`** cannot carry pins; comment on the frame as a whole.
- **Server mode trusts reviewers' clocks** for "newer wins". Far-future timestamps are refused.
- **Other reviewers' suggested wording is not applied in server mode.** Anyone who can reach the
  server could otherwise change what every visitor reads. Each reviewer sees their own
  suggestions on the page and everyone else's in the review list (`showRewrites: 'all'` changes
  that for a server you trust).
- **`WRITE_KEY` is not authentication**: it sits in your page source. Use `authorize()` with your
  own sign-in for anything public.
- File mode's notes from the original widget still apply: see
  [`references/troubleshooting.md`](references/troubleshooting.md).

---

## Development

```bash
npm install
npm test          # build + size gate, 91 unit/server tests, 19 evals, 50 browser tests
```

| | |
|---|---|
| `src/widget.js` | the runtime, commented; one implementation for every mode and entry point |
| `src/index.js`, `src/react.js` | module and React entry points (thin wrappers) |
| `dist/` | built: `widget.min.js` (script tag + injector), `feedback-kit.mjs`, `react.mjs` |
| `server/` | Express router, Postgres and memory stores, standalone server, `schema.sql` |
| `bin/` | the HTML injector and validator |
| `test/` | `browser.test.mjs` (file mode), `modes.test.mjs` (local, server, SPA, React), `server.test.mjs`, injector tests |
| `examples/` | runnable pages, served by `npm run server` at `/examples/` |

The browser suites use Playwright's Chromium if installed, else your installed Chrome or Edge.
`npm test` runs the Postgres store on pg-mem, an in-memory emulation. To run the server
contract and the server-mode browser tests (`test/modes.test.mjs`) against real Postgres
(verified on PostgreSQL 18.6):

```bash
TEST_DATABASE_URL=postgres://user:pw@localhost:5432/fk_test npm run test:pg
```

Use a database that exists only for tests: its `feedback_comments` table is dropped first.
See `references/server.md` §5.

Before changing the runtime or the file format, read
[`references/architecture.md`](references/architecture.md): it is the contract the injector, the
validator and the evals all implement.
