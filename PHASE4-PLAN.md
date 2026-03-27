# Phase 4 Implementation Plan

## Status: Phases 1-3 complete, all tested and working.

## What's done (Phases 1-3)

### Phase 1: Core UX
- [x] Confirmation dialog on accidental close ("Discard feedback?" with Discard/Submit/Go back)
- [x] Success/error toast after submit
- [x] Focus trapping in popover
- [x] Ctrl+Enter / Cmd+Enter to submit
- [x] `:focus-visible` styles on FAB and buttons
- [x] POST error handling (checks response.ok, shows error toast, onError callback)
- [x] DOMContentLoaded guard for async loading

### Phase 2: Security hardening
- [x] Rate limiting (30 req/min/IP via express-rate-limit)
- [x] CORS lockdown (warns if CORS_ORIGIN not set)
- [x] API key on GET (optional API_SECRET env var)
- [x] Helmet security headers
- [x] ID validation (max 256 chars)
- [x] Input length validation (comment 5000, selectedText 10000, pageUrl 2048, selector 500, label 500)
- [x] Body size limit (16kb)
- [x] Graceful shutdown (SIGTERM handler)
- [x] page_url nullable (fixed schema/code mismatch)
- [x] created_at index
- [x] Deleted dead db.js

### Phase 3: Data enrichment
- [x] Browser metadata auto-capture (userAgent, viewport, screenSize, language, url, referrer)
- [x] Console log capture (console.error/warn, window.onerror, unhandledrejection, last 50 entries)
- [x] User identity via config (user: { name, email })
- [x] DB columns: metadata JSONB, user_name, user_email, console_logs JSONB

---

## Phase 4: What's left to implement

### 4.1 Shadow DOM Isolation
**Goal**: Wrap the widget in a Shadow DOM so host page CSS can't break widget styles and widget CSS can't leak into the host page.

**Current state**: Widget injects a `<style>` tag into `document.head` (src/styles.js:184-191) and appends elements to `document.body`.

**Changes needed**:
1. In `feedback-widget.js` `init()` → `boot()`:
   - Create a container `<div id="fbw-root">` and append to `document.body`
   - Attach a shadow root: `container.attachShadow({ mode: 'open' })`
   - Inject the CSS `<style>` tag into the shadow root (not `document.head`)
   - Append the FAB into the shadow root
2. In `popover.js`:
   - `popoverEl` and `confirmEl` should be appended to the shadow root, not `document.body`
   - Pass the shadow root reference from `feedback-widget.js` to `popover.show()` and related functions
3. In `overlay.js`:
   - Overlay and highlight need to stay in `document.body` (they cover the full page), OR be in the shadow root with `position: fixed` (should still work)
   - Test both approaches — shadow root with `position: fixed` is simpler
4. In `styles.js`:
   - `injectCSS()` needs to accept a target node (shadow root) instead of always using `document.head`
   - `removeCSS()` similarly needs to query within the shadow root
5. In `feedback-widget.js`:
   - The crosshair cursor class (`fbw-cursor-crosshair`) is added to `document.documentElement` — this must stay outside Shadow DOM since it affects host page elements
   - The `--fbw-accent` CSS custom properties are set on `document.documentElement` — move these to the shadow root's host element
6. **Testing concern**: `document.elementFromPoint()` used in mouse handlers — verify it still works when widget DOM is in shadow root (it should, since the overlay has `pointer-events: none`)

**Architecture decision**: Keep the overlay/highlight in `document.body` (they need to cover the full viewport). Put FAB, popover, confirm dialog, and toast in the shadow root.

### 4.2 Async Loading Documentation
**Goal**: Update README and demo to promote non-blocking widget loading.

**Changes needed**:
1. In `demo/index.html`: Change `<script src="../dist/feedback-widget.min.js"></script>` to use `async` attribute with an `onload` handler
2. In README.md: Update the CDN/script tag examples to use async loading pattern
3. The `DOMContentLoaded` guard in `init()` is already implemented (Phase 1), so async loading is already safe

### 4.3 Automated Testing (Playwright)
**Goal**: Write a Playwright test suite that submits 100 feedback entries and verifies they're stored correctly.

**Setup**:
- Install Playwright as devDependency: `npm install -D @playwright/test`
- Add `"test"` script to package.json
- Create `tests/` directory

**Test files to create**:

#### `tests/widget.spec.js` — Core widget tests
1. **FAB renders** — verify `.fbw-fab` exists after init
2. **Feedback mode toggle** — click FAB, verify overlay appears, click again to exit
3. **Element highlighting** — hover over elements, verify `.fbw-highlight` appears
4. **Popover opens on click** — click element in feedback mode, verify popover with textarea
5. **Submit flow** — type text, click submit, verify `onSubmit` callback fires with correct payload
6. **Ctrl+Enter submit** — type text, press Ctrl+Enter, verify submission
7. **Cancel flow** — open popover, click cancel (empty textarea), verify popover closes
8. **Confirmation dialog** — type text, click outside, verify confirm dialog appears
9. **Confirm → Go back** — verify text preserved after going back
10. **Confirm → Discard** — verify popover closes
11. **Confirm → Submit** — verify feedback submitted from confirm dialog
12. **Escape key** — test escape in popover and feedback mode
13. **Focus trapping** — verify Tab cycles within popover
14. **Toast appears on submit** — verify toast element created
15. **Error toast on failed POST** — configure bad postUrl, verify error toast
16. **Browser metadata captured** — verify metadata fields in payload
17. **User identity** — configure user in init(), verify in payload
18. **Console logs captured** — trigger console.error, verify in consoleLogs array

#### `tests/stress.spec.js` — 100 submissions test
1. Start a test Express server with in-memory SQLite (or mock)
2. Loop 100 times: open feedback mode → click element → type comment → submit
3. Verify all 100 entries stored correctly via GET endpoint
4. Verify each entry has unique ID, correct comment, metadata, user info

#### `tests/security.spec.js` — Backend security tests (requires running server)
1. Rate limiting — send 31 requests in 1 minute, verify 429 on 31st
2. CORS — verify non-whitelisted origin is rejected
3. API key on GET — verify 401 without key, 200 with key
4. Input validation — send oversized ID (>256 chars), verify 400
5. Body size — send >16kb body, verify 413

**Note**: The demo page at `demo/index.html` should be served from project root (`npx serve .`) and accessed at `http://localhost:PORT/demo/` — serving from `demo/` alone causes 404 on the dist script. Consider updating the `dev` script in package.json to `npx serve .` instead of `npx serve demo`.

---

## Backlog (not in Phase 4)
- `role="dialog"` / ARIA labeling on popover
- TypeScript type definitions (.d.ts)
- `aria-pressed` on FAB
- Source maps / ESM output from build
- Shadow DOM for full CSS encapsulation (addressed in 4.1)
