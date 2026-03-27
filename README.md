# sticky-widget

A lightweight, drop-in widget for collecting user feedback on any website. Users click a floating button, hover to highlight elements on the page, click a target, write a comment, and submit. Entries are stored in PostgreSQL via a small Express router you mount in your existing backend.

**6KB gzipped. Zero runtime dependencies. Framework-agnostic. Shadow DOM isolated.**

---

## Demo

https://github.com/user-attachments/assets/73c2957d-ccc1-41b5-a202-ae53bbdb7094

---

## How it works

1. A floating chat button appears in the bottom-right corner of your page
2. A user clicks it to activate — the cursor becomes a crosshair
3. They hover over any element; meaningful components are automatically highlighted
4. They click the element they want to comment on (or select text first)
5. A small popover appears for them to type their comment
6. On submit, the entry is POSTed to your backend and stored in Postgres

No page reload. No third-party services required. Widget CSS is fully isolated via Shadow DOM.

---

## Installation

### 1. Install the package

```bash
npm install sticky-widget
```

### 2. Run the database migration

```bash
psql $DATABASE_URL -f node_modules/sticky-widget/server/schema.sql
```

This creates a single `feedback` table.

### 3. Mount the router in your Express app

```js
const { Pool } = require('pg');
const { stickyRouter } = require('sticky-widget/server');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Mount under /api/v1 — or any prefix you choose
app.use('/api/v1', stickyRouter(pool));
```

The router adds two endpoints:
- `POST /api/v1/feedback` — receives and stores an entry
- `GET /api/v1/feedback` — returns all entries (useful for internal dashboards)

### 4. Add the widget to your frontend

**Option A — CDN (recommended):**

```html
<script src="https://cdn.jsdelivr.net/npm/sticky-widget@1.0.0/dist/sticky-widget.min.js" async onload="StickyWidget.init({ postUrl: '/api/v1/feedback' })"></script>
```

**Option B — from your own bundle:**

```js
import StickyWidget from 'sticky-widget';

StickyWidget.init({
  postUrl: '/api/v1/feedback'
});
```

That's it. The widget self-installs into the page.

---

## Configuration

All options are passed to `StickyWidget.init()`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `postUrl` | `string` | `null` | URL to POST entries to. If omitted, entries are only stored in-memory. |
| `onSubmit` | `function` | `null` | Called with the entry after submit. Useful for analytics or custom storage. |
| `onError` | `function` | `null` | Called with `(error, entry)` when a POST fails. |
| `onOpen` | `function` | `null` | Called when the widget is activated. |
| `onClose` | `function` | `null` | Called when the widget is deactivated. |
| `user` | `object` | `null` | `{ name, email }` — attached to every entry. Pass from your auth layer (e.g. Okta). |
| `captureConsole` | `boolean` | `true` | Capture `console.error`/`warn` and unhandled errors (last 50 entries). |
| `accentColor` | `string` | `#4f46e5` | Hex color for the FAB, highlights, and submit button. |
| `position` | `string` | `bottom-right` | FAB position. Use `bottom-left` to move it. |
| `zIndexBase` | `number` | `99999` | Base z-index. Increase if other elements overlap the widget. |

**Example with all options:**

```js
StickyWidget.init({
  postUrl: '/api/v1/feedback',
  accentColor: '#0f766e',
  position: 'bottom-right',
  zIndexBase: 99999,
  user: { name: 'Jane Doe', email: 'jane@example.com' },
  captureConsole: true,
  onSubmit: (entry) => console.log('New entry:', entry),
  onError: (err, entry) => console.error('POST failed:', err),
  onOpen: () => console.log('Widget activated'),
  onClose: () => console.log('Widget deactivated'),
});
```

---

## JavaScript API

```js
StickyWidget.open()           // programmatically activate the widget
StickyWidget.close()          // programmatically deactivate the widget
StickyWidget.getEntries()     // returns array of all in-memory entries
StickyWidget.clearEntries()   // clears in-memory store
StickyWidget.destroy()        // removes the widget from the page entirely
```

---

## Entry data shape

Each entry stored in Postgres (and passed to `onSubmit`) looks like this:

```json
{
  "id": "a1b2c3d4-...",
  "timestamp": "2025-03-17T10:30:00.000Z",
  "pageUrl": "https://yourapp.com/dashboard",
  "target": {
    "selector": "section#dashboard > div.card:nth-child(2)",
    "tagName": "div",
    "id": "revenue-card",
    "label": "Total Revenue",
    "rect": { "top": 120, "left": 240, "width": 280, "height": 140 }
  },
  "selectedText": "This number looks wrong",
  "comment": "The revenue figure doesn't match the report from last week.",
  "metadata": {
    "userAgent": "Mozilla/5.0 ...",
    "viewport": "1280x720",
    "screenSize": "1920x1080",
    "language": "en-US",
    "url": "https://yourapp.com/dashboard",
    "referrer": null,
    "timestamp": "2025-03-17T10:30:00.000Z"
  },
  "user": { "name": "Jane Doe", "email": "jane@example.com" },
  "consoleLogs": [
    { "level": "error", "message": "TypeError: ...", "timestamp": "2025-03-17T10:29:55.000Z" }
  ]
}
```

| Field | Description |
|-------|-------------|
| `id` | UUID, unique per submission |
| `timestamp` | ISO 8601, set client-side at moment of submission |
| `pageUrl` | Full URL of the page |
| `target.selector` | CSS selector path to the element — lets you programmatically find it again |
| `target.label` | Best available human-readable label (aria-label, inner text snippet) |
| `target.rect` | Position and size of the element at time of submission |
| `selectedText` | The text the user highlighted before clicking, if any |
| `comment` | The user's comment |
| `metadata` | Browser info auto-captured at submission time |
| `user` | User identity (only present if `user` config is set) |
| `consoleLogs` | Recent console errors/warnings captured before submission |

---

## Querying entries

### From Postgres directly

```sql
-- All entries for a specific page
SELECT * FROM feedback
WHERE page_url = 'https://yourapp.com/dashboard'
ORDER BY created_at DESC;

-- Most commented-on elements
SELECT label, selector, COUNT(*) as count
FROM feedback
GROUP BY label, selector
ORDER BY count DESC
LIMIT 20;

-- Entries with selected text
SELECT * FROM feedback
WHERE selected_text IS NOT NULL
ORDER BY created_at DESC;
```

### Via the API

```bash
curl https://yourapp.com/api/v1/feedback -H 'X-API-Key: your-secret'
```

Returns a JSON array of all entries ordered by most recent first (capped at 200 rows).

---

## Opt-in element targeting

By default, the widget uses smart heuristics to find the nearest meaningful element when a user clicks. You can override this by marking elements explicitly:

```html
<div data-sticky-id="revenue-chart">
  <!-- clicking anywhere inside always targets this element -->
</div>
```

This is useful for custom components where the auto-detection doesn't land on the right element.

---

## Security

The Express server supports these security features via environment variables:

| Env var | Description |
|---------|-------------|
| `CORS_ORIGIN` | Restrict which origins can POST. Warns if not set. |
| `API_SECRET` | Optional. When set, `GET /feedback` requires an `X-API-Key` header. |

Additional protections:
- Rate limiting: 30 requests/min per IP
- Body size limit: 16KB
- Input validation: field length limits enforced server-side
- Helmet security headers

The `POST` endpoint is unauthenticated by default (rate-limited instead). For public-facing apps, add auth middleware before mounting the router.

---

## Using with React / SPA frameworks

The widget appends to `document.body` and manages its own DOM. In a single-page app, you need to manage its lifecycle correctly to avoid errors during page navigation.

### Recommended: mount at the layout level

Since the widget is page-agnostic, mount it in a component that persists across route changes (e.g. your app shell or layout). This avoids destroy/re-init on every navigation:

```jsx
import { useEffect, useRef } from 'react';
import StickyWidget from 'sticky-widget';

function useStickyWidget(options) {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    StickyWidget.init(options);

    return () => {
      initializedRef.current = false;
      StickyWidget.destroy();
    };
  }, []);
}

// In your app shell:
function AppShell({ children }) {
  useStickyWidget({
    postUrl: '/api/v1/feedback',
    user: { name: 'Jane', email: 'jane@example.com' },
  });

  return <div>{children}</div>;
}
```

### If you need per-page config

If different pages need different widget options, mount/destroy per page — but always import as an ES module (not via `<script>` tags, which have unreliable `onload` behavior for cached scripts in SPAs):

```jsx
import { useEffect } from 'react';
import StickyWidget from 'sticky-widget';

function FeedbackPage() {
  useEffect(() => {
    StickyWidget.init({ postUrl: '/api/v1/feedback' });
    return () => StickyWidget.destroy();
  }, []);

  return <div>...</div>;
}
```

### Important notes for SPA integration

- **Always call `destroy()` before React unmounts the page.** The `useEffect` cleanup function handles this automatically.
- **Import as an ES module**, not via dynamic `<script>` insertion. Cached scripts may not re-fire `onload` on SPA navigation.
- **Do not call `init()` from an `onClose` callback.** This causes re-entrant initialization during teardown. If you need to re-initialize with different options, do so in a separate `useEffect` or `setTimeout`.
- **`destroy()` is idempotent** — calling it multiple times is safe (React 18 Strict Mode double-invokes effects in development).

---

## FAQ

**Does it work on React / Vue / Angular apps?**
Yes. The widget is a plain JS IIFE that manipulates the DOM directly. It doesn't know or care what framework rendered the page. Call `StickyWidget.init()` once after the page mounts.

**Can I use this without a backend at all?**
Yes — omit `postUrl` and use `onSubmit` to handle the entry yourself (e.g. send to a third-party API, log it, store in localStorage). The widget works entirely in-memory without a server.

**Do I need to use Express?**
The included server router requires Express. If you use a different framework (Fastify, Koa, Hapi), use `server/router.js` as a reference — it's about 30 lines of logic to re-implement.

**The widget highlights the wrong element — how do I fix it?**
Add `data-sticky-id="your-label"` to the element you want targeted. This always takes priority over the auto-detection heuristics.

**How do I hide the widget for certain users?**
Don't call `StickyWidget.init()` for those users. Or call `StickyWidget.destroy()` after init to remove it conditionally.

**Can I trigger the widget programmatically?**
Yes: `StickyWidget.open()` and `StickyWidget.close()`.

**What browsers are supported?**
Any modern browser (Chrome, Firefox, Safari, Edge). The bundle targets ES2020. IE is not supported.

**How do I change the button position or color?**
Pass `position: 'bottom-left'` and `accentColor: '#your-hex'` to `init()`.

**Is the data stored securely?**
The widget stores entries in your own Postgres database — nothing goes to a third party. You control the data entirely. Set `API_SECRET` to protect the `GET` endpoint.
