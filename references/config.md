# Configuration

There is no config file and no runtime settings UI. Everything is decided at injection time by a
CLI flag, written into the state island's `config` object, and read once when the widget boots.
The island layout is `architecture.md` §3; the flags are in [cli.md](cli.md).

```jsonc
"config": {
  "accent": null,                 // CSS colour string, or null for auto-detect
  "position": "bottom-right",     // "bottom-right" | "bottom-left"
  "captureConsole": false,        // reserved in files; always written, settable by nothing
  "endpoint": "https://…",        // only when injected with --endpoint (server mode)
  "writeKey": "…"                 // only when injected with --write-key
}
```

This page is about **files** (file mode, and files injected with `--endpoint`). A page that
loads the widget from a script tag or an import configures it with options instead, including a
working `captureConsole` option for server and local mode: see the README's options table. Console
capture is never available in file mode, for the reasons in the last section.

**There are two settings.** `accent` and `position`. Everything else you may have seen here is
gone, and the two flags that wrote them are gone with it:

| Removed | Why |
|---|---|
| `--capture-console` | The runtime never read it. Wiring it up means a console buffer, a privacy surface and a storage cost that the previous generation already shipped once, with the results recorded below. Deleting a flag that does nothing is an improvement; building the feature to justify the flag is not. |
| `--author` | The runtime never read it. Identity belongs to the reviewer, not to the file: one deck goes to four people, so a name baked in at injection time is right for at most one of them. Reviewers type their name once and it is stored per browser, shared across every document they review. |

`captureConsole` is still **written** into every island, always `false` unless a file already
carried `true`. Keeping the key means the island layout, invariant 6 and every golden file are
unchanged; nothing can set it. An `author` object already present in a file is likewise
preserved on re-injection rather than silently dropped.

## Config is sticky across re-injection

Re-injecting a file that already carries a widget reads the existing `config` and keeps every key
you do not override. That is what makes "re-inject to pick up a new runtime" safe.

| Key | How to change it | How to undo it |
|---|---|---|
| `accent` | `--accent '#ff6a13'` | `--accent ''` (empty string, treated as unset by the runtime) |
| `position` | `--position bottom-left` | `--position bottom-right` |
| `endpoint` | `--endpoint https://…/api/feedback` | `--endpoint ''` |
| `writeKey` | `--write-key <key>` | `--write-key ''` |

---

## `accent`

**What it is.** The colour of the plus button, the pins and the primary buttons inside the
widget's panels. The widget derives its own foreground colour from it by luminance, so a light
accent gets dark text on it and a dark accent gets white.

**Default.** `null`, meaning the runtime decides in the browser.

**When to set it.** When auto-detection picks something wrong, and when you want the same colour
across a set of decks whose theming differs.

### How auto-detection actually works

Two independent decisions, made once at boot in `detectTheme()`.

**1. The accent.** If `config.accent` is empty or missing, the runtime reads custom properties off
the root element with `getComputedStyle(document.documentElement)` and takes the first one that
parses as a colour. The list is ranked, and the order matters:

```
--fbw-accent
--c-green
--accent
--green
--c-accent
--brand
--primary
--color-primary
```

A value "parses as a colour" if assigning it to a hidden span's `style.color` produces a
resolvable `rgb()`. A fully transparent colour (alpha 0) does not count.

If no probe hits, the accent falls back to `#4f9bea` on a dark page and `#2563eb` on a light one.

**2. Dark or light.** The runtime reads the computed `background-color` of `<body>`, then of
`<html>` if the body is transparent, and calls the page dark when its relative luminance is below
0.35. If neither has a usable background colour it defers to
`matchMedia('(prefers-color-scheme: dark)')`. This decision drives the panel background, text,
border and surface colours, and it is independent of the accent.

### When the theming defeats it

Three shapes come up.

- **The token exists but not on `:root`.** The probe only reads the root element. A deck that
  declares `--brand` on `.slide` or on `body` will not be found. Set `--accent` explicitly.
- **The first matching token is the wrong one.** A deck with both `--accent` (a neutral grey) and
  `--brand` (the real colour) gets the grey, because `--accent` is earlier in the list. Set
  `--accent` explicitly.
- **The page is dark but its `<body>` has no background.** The paint comes from a full-bleed child
  element, so both probes return transparent and the light/dark call falls through to the OS
  preference. The result is a light panel on a dark deck for a reviewer whose OS is in light mode.
  There is no flag for this. Declaring a background colour on `body` in the deck fixes it, and so
  does picking an accent that reads acceptably against both panel themes.

The cheapest permanent fix inside a deck you control is to declare `--fbw-accent` on `:root`. It
is first in the probe list and exists for exactly this purpose.

---

## `position`

**What it is.** Which bottom corner the rail sits in: the plus button, and the hide/save/list
buttons that fan out above it. It also decides which side tooltips appear on and where the
review panel is placed.

**Default.** `bottom-right`.

**Values.** `bottom-right` or `bottom-left`. Anything else is rejected before any file is read:

```
$ node bin/add-feedback.mjs deck.html --position top-left --out out.html
--position must be one of bottom-right, bottom-left
```

**When to change it.** When the deck has its own fixed furniture in the bottom-right corner, for
example navigation arrows or a slide counter.

The runtime already tries to avoid a collision on its own. At boot it hit-tests the point 48px in
from the chosen corner and 48px up from the bottom; if it finds an element with
`position: fixed` there, it lifts the rail to `bottom: 88px`. That handles a single bar. It does
not handle furniture that is tall, or furniture that appears later. Moving the rail to the other
corner is the reliable answer.

---

## `captureConsole` — reserved, and why there is no flag

**What it is.** A key held for a possible future capped buffer of the host page's console
output, attached to comments so a reviewer reporting "this chart is empty" also sends the error
that made it empty.

**Current state.** Always written, always `false` unless a file already carried `true`. Nothing
reads it. There is **no flag**, because a flag whose only effect is to change a value nobody
reads is a flag that lies to whoever runs `--help`.

**Why the feature was not simply built instead.** The previous generation shipped console
capture on, and it caused two distinct problems.

- **Storage.** The buffer went into `localStorage` alongside the comments. A page that logged in
  a render loop filled the origin's quota, which made *every* write fail, including the comment
  writes. The visible symptom was comments silently disappearing on reload, and the cause was
  several directories away from where anyone looked.
- **Privacy.** Console lines on a real document routinely contain API responses, row-level data,
  file paths and occasionally tokens. Those lines then travelled inside the HTML file to whoever
  it was forwarded to. Nothing was redacted, and nobody had agreed to send them.

Both are reasons to keep any future implementation opt-in per file, capped, and visible to the
reviewer before it is written.

---

## `author` — removed, and how identity actually works

There is no `--author` flag. Identity is a property of the **reviewer**, not of the file, and
the file is the thing that gets forwarded: one deck goes to four people, so a name baked in at
injection time is wrong for three of them. Pre-seeding it would have attached the wrong name
to real comments, which is worse than the flag doing nothing.

How it works instead: the first time someone adds a comment they are asked once, in a small
dialog over the comment they are already writing. The answer is stored in `localStorage` under
`fbw:author` — **per browser, shared across every document that person reviews** — so they are
never asked again, on any deck. "Stay anonymous" is a first-class answer and is remembered too.

An `author` object already present in an island is preserved across re-injection rather than
dropped, so nothing is lost from files produced before the flag was removed.

---

## What is collected, and what is not

This question comes up whenever someone rolls the widget out, so here it is plainly.

### Written into the HTML file

Per comment:

| Field | Content |
|---|---|
| `id` | Random, 12 hex characters from `crypto.getRandomValues`. Not derived from anything about the person or the machine. |
| `createdAt`, `updatedAt` | ISO-8601 UTC, from the reviewer's own clock. |
| `author` | `{name, email}` or `null`. The name is whatever the reviewer typed, capped at 120 characters. The UI never asks for an email, so `email` is `null` unless it came from a migrated prior-generation comment. "Stay anonymous" stores nothing. |
| `text` | The comment, capped at 10,000 characters. |
| `originalText` | A one-time snapshot of the text before the first edit. |
| `resolved` | Boolean. |
| `anchor.tag`, `.id`, `.path`, `.sig` | Structural description of the commented element: tag name, its `id` if document-unique, a `body`-rooted `nth-of-type` path, and tag-plus-sorted-classes with an ordinal. |
| `anchor.aria` | The element's `aria-label`, `data-label` or `title`. |
| `anchor.quote` | Up to 180 characters of the element's own visible text, plus up to 40 characters of the surrounding text on each side. |
| `anchor.hint` | `location.hash` at the moment of commenting, and a label for the nearest enclosing section (its `aria-label`, its `id`, or its first heading, capped at 60 characters). |

Per file: `docId` (a SHA-256 prefix of the document's own bytes), `title` (the document's
`<title>` at injection time), the `config` object above, and a `tombstones` list of
`{id, deletedAt}` for deleted comments.

The anchor is the part worth reading twice. It contains **page content**, because quoting the
commented element is how a comment stays findable after the page changes. If a deck contains
sensitive text, a comment on that text puts a copy of it in the island.

### Kept in the reviewer's browser, never in the file

| Store | Key | Content |
|---|---|---|
| `localStorage` | `fbw:<docId>` | Crash-recovery copy of the comments and tombstones. |
| `localStorage` | `fbw:<docId>:ui` | Whether pins are hidden, whether the intro toast has been seen, whether the reviewer chose to stay anonymous. |
| `localStorage` | `fbw:author` | The reviewer's name, shared across every document they review. |
| `IndexedDB` | `fbw` / `handles` / `<docId>` | A `FileSystemFileHandle` for the file on disk, so later saves need no dialog. Browser-internal; it is not readable as a path and never leaves the browser. |

### Not collected at all

- **No network requests.** The runtime makes exactly one `fetch`, to `location.href`, and only on
  an `http`/`https` page, to read back the document's own bytes for saving. There is no endpoint,
  no telemetry, no font or script load, and nothing to block.
- **No identity beyond a typed name.** No email, no login, no account, no device or browser
  fingerprint, no IP.
- **No file path.** `docId` is a hash of the document's content, not of `location.pathname`. The
  file can be renamed, moved, or re-downloaded as `deck (1).html` and stays the same document.
  Two copies of the same document share an id; that is intended.
- **No view or session tracking.** Opening a file records nothing. Only adding, editing, resolving
  or deleting a comment writes anything.
- **No console output**, per the section above.

### One caveat on the last save rung

If the widget cannot read the original file's bytes back (rung 4 of the save ladder, §7) it
serialises the live DOM instead. That snapshot contains whatever the page was showing at that
moment, including state produced by interaction. The widget warns before doing this when it
detects that the page has been rebuilt at runtime. On a page that displays data the reviewer
filtered or drilled into, the saved file can therefore contain more than the original did. See
[troubleshooting.md](troubleshooting.md#cmdctrls-downloads-a-file-instead-of-saving-in-place).
