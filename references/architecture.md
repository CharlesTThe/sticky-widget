# Architecture and on-disk contract

Read this if you are modifying the widget, the injector, or the evals. You do not need it to
*use* the skill — see `SKILL.md` for that.

This document is normative. The injector (`bin/add-feedback.mjs`), the validator
(`bin/verify.mjs`), the runtime (`src/widget.js`) and the eval suite all implement the same
contract described here, and every invariant below is asserted by `bin/verify.mjs`.

---

## 1. The injected block

Exactly one block is appended immediately before the document's last `</body>`. Its byte
layout is fixed, because output must be reproducible:

```
\n<!--fbw:begin 1-->\n<script type="application/json" id="fbw-state">STATE</script>\n<script id="fbw-core">RUNTIME</script>\n<!--fbw:end-->\n
```

- `1` in the opening fence is the **block format version**, bumped only if this layout changes.
- `STATE` is the escaped state JSON (§3).
- `RUNTIME` is the contents of `dist/widget.min.js` verbatim, with no wrapper and no
  transformation. It is inserted byte-for-byte so that `verify` can compare it against the
  shipped artifact.
- Line endings inside the block are always `\n`, even in a CRLF document. HTML does not care,
  and mixing would make byte-comparison depend on the host file's convention.

### Insertion point

`lastIndexOf('</body>')` over the **canonical pristine text** (§2) — never `indexOf`. Host
pages legitimately contain the string `</body>` inside JavaScript string literals; the last
occurrence is the real one. If there is no `</body>`, fall back in order to the last
`</html>`, then to end-of-file.

The search runs over a copy with every **inert region blanked** — comment bodies, and the
content of every element the HTML parser reads as text rather than markup: `script`, `style`,
`textarea`, `title`, `xmp`, `iframe`, `noembed`, `noframes`, `noscript`. Blanking preserves
offsets, so a match maps straight back onto the original.

`pre` is deliberately **not** in that set. Its content is parsed markup, so a `</body>` inside
a `<pre>` really does close the body and must keep counting.

This is load-bearing, not tidiness. A page that shows example markup in a `<textarea>`, or
names a tag in its `<title>`, and omits the optional `</body>` end tag — all three legal, and
common in generated pages — puts its only closing-body token inside text. Aim at it and the
entire block is injected there: rendered on the page as forty kilobytes of visible text, the
runtime never executing, and `verify` reporting the file as valid, because the block adds no
closing-body token and its own shape is fine. Invariants 1, 2 and 8 all hold on a completely
broken document. That is the failure class this masking exists to prevent, and it has its own
eval scenarios (`18-textarea-body`, `19-title-body`) rather than relying on the others to
notice.

---

## 2. Canonical pristine text

Several operations need "this document without any widget in it". That text is produced by:

1. Removing every `<!--fbw:begin …-->` … `<!--fbw:end-->` region — **all of them**, not the
   first. Files double-injected by earlier generations exist, and this is how they heal.
2. Removing every prior-generation region (§6).
3. Removing the ` data-fbw="…"` attribute from the `<html>` tag.
4. Leaving everything else — including the BOM, line endings, doctype casing and whitespace —
   untouched.

Canonical pristine text is the input to the document id, and the base the new block is
appended to.

---

## 3. State JSON

### Embedding

The JSON is escaped before it goes into the island, and unescaped implicitly by `JSON.parse`:

```js
JSON.stringify(state).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
```

Escaping `<` and `>` is sufficient and complete. It makes `</script`, `<!--` and `]]>`
unrepresentable in the island by construction, so no comment text can ever break out of the
script tag. The result is still valid JSON and parses to exactly the same value.

**Do not** hand-roll a narrower escape. A reviewer typing a literal `</script>` into a comment
is the exact case this defends.

### Shape

```jsonc
{
  "v": 2,
  "docId": "a1b2c3d4e5f60718",
  "title": "Network Density Review",   // informational, captured at inject time
  "tool": {                            // who wrote this file (§3.1)
    "name": "fbw",
    "version": "1.0.0",                // package version, or null if unreadable
    "build": "205d4f10588f"            // sha256(embedded runtime)[0:12]
  },
  "config": {
    "accent": null,                    // null = auto-detect from the page
    "position": "bottom-right",
    "captureConsole": false           // reserved; always written, settable by nothing
  },
  "comments": [ /* Comment */ ],
  "tombstones": [ { "id": "c-…", "deletedAt": "2026-09-24T12:00:00.000Z" } ]
}
```

### Comment

```jsonc
{
  "id": "c-3f9a2b81c4d7",            // see below
  "schemaVersion": 1,
  "createdAt": "2026-09-24T12:00:00.000Z",   // ISO-8601, always UTC, always from one clock
  "updatedAt": "2026-09-24T12:00:00.000Z",
  "author": { "name": "Jo Doe", "email": null },   // or null if left anonymous
  "text": "The CAGR here does not match slide 4.",
  "originalText": null,              // one-time snapshot of the pre-edit COMMENT text
  "resolved": false,
  "toolBuild": "205d4f10588f",       // the build that created this entry, or null (§3.1)
  "rewrite": null,                   // or a Rewrite (§3.2)
  "anchor": { /* Anchor */ }
}
```

`originalText` and `rewrite` are different things and the names are worth keeping straight:
`originalText` is the reviewer's own comment before they edited their wording; `rewrite` is a
change to the HOST PAGE's text.

Only these keys are written. Unknown keys found on read are **preserved** on write, so a file
touched by a newer version does not lose data when an older version saves it.

**Comment ids.** Newly created comments use `"c-"` plus 12 lowercase hex. Migrated ones keep
their original id with `c-` prefixed (§6), which will not match that pattern — a v2 id of
`1727` becomes `c-1727`. Validation is therefore structural, not the narrow hex form:

```
^c-[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$
```

Requiring the hex form would make every real migration fail self-verification. A seed entry
carrying no id at all is given `c-<sha256(entry)[0:12]>`, derived from its content rather than
a clock or a counter, so migration stays a pure function.

### 3.1 The tool stamp

`state.tool` names the widget that wrote the file; `comment.toolBuild` names the one that
wrote each entry. They are not the same claim — a deck that has been round-tripped through
three builds carries one `state.tool` and up to three distinct `toolBuild` values.

`build` is **the sha256 of the runtime bytes actually embedded**, first 12 hex, computed by
the injector at the moment it embeds them. That is deliberately not the package version: a
version number can be left unbumped, and `--runtime`/`--dev` embed a runtime no version
describes. The hash cannot be wrong about which code is in the file.

The runtime never derives it — a script cannot reliably hash its own bytes — it reads it from
the island, stamps it into everything it creates, and copies it into the JSON export (§10).
`toolBuild` is null on a comment migrated from v1/v2/fbe, which is true: those widgets did not
record one.

### 3.2 Rewrite

```jsonc
{
  "from": "Uplift 3.2x",             // the element's text when the reviewer opened it
  "to": "Uplift 3.4x",               // what they typed instead
  "at": "2026-10-16T09:12:00.000Z"
}
```

A rewrite is a change to the host page's own text, carried by the comment that made it. One
record, one anchor, one pin: a reviewer who retypes a headline and explains why has made one
remark about one element, not two.

**Nothing about it is ever written into the markup.** Save rungs 1-3 write the document's
original bytes back with only the island replaced (§7), so the retyped wording lives in the
island and is re-applied on every load. This is the same rule anchors follow and it has the
same reason: what we hand back must be the author's document. It is also what keeps a rewrite
revertable — `from` is retained for the life of the entry, so the author's words survive in
the file even while the page shows someone else's.

`from === to` is invalid and is dropped on normalisation: a rewrite that changes nothing would
badge an element whose text is exactly as the author wrote it.

**Only a text leaf may be rewritten** — an element with no element children. An element
wrapping a chart, a table or three spans cannot be retyped into a textarea without losing part
of the page, so the composer offers no text field for one. `script`, `style`, form controls
and replaced elements are excluded by tag as well.

#### Replay order

Rewrites are applied **in `createdAt` order, before any pin is resolved**. Both halves of that
are load-bearing.

*In `createdAt` order, against the file:* every load starts with the author's original words
on the page, so the first rewrite of an element finds the text its anchor recorded and
corroborates against it. Two successive rewrites of one element chain correctly — the second
recorded what the element said after the first, which is exactly what it finds.

*Before pins, against later comments:* a note written on an element AFTER someone retyped it
recorded the NEW wording as its `quote.exact`. Resolve the pins first and that note looks
orphaned, because at that moment the page is still showing the old text — a comment reported
as lost on an element that is plainly still there. Replaying the rewrites first reconstitutes
the document the later reviewer was actually looking at. `test/browser.test.mjs` asserts this
directly, three reviewers deep.

#### Comparison basis

The replay compares `textContent`, collapsed, never `visibleText`. A rewrite is written to
`textContent`, so it must be read back from `textContent` or the two are not the same
quantity: `visibleText` goes through `innerText`, which returns the RENDERED text, and on an
element carrying `text-transform: uppercase` that never equals the stored wording. Comparing
the two reported every rewrite on such an element as a conflict with the author's markup.

#### Conflicts

If the element resolves but says neither `from` nor `to`, the rewrite is applied anyway — it
is what the reviewer asked for, and Put text back still restores the original — and counted in
`rewriteReport.conflicts`, which the review list reports. Quietly overwriting an author's
later change is how a review tool loses someone's work.

### Anchor

Five independent locators. None of them require mutating the host document — that is the
central design constraint, because the saved file is the original source, so any attribute the
runtime stamps at comment time would not survive a reload.

```jsonc
{
  "tag": "div",
  "id": "kpi-row",                   // only if document-unique at capture time, else null
  "path": "body>div:nth-of-type(1)>section:nth-of-type(2)>div:nth-of-type(3)",
  "aria": "Pipeline uplift",         // aria-label / data-label / title, else null
  "sig": "div.kpi.card|2",           // tag + sorted class list + RESERVED ordinal (see below)
  "quote": { "exact": "3.2x" },      // or null for empty elements
  "hint": { "hash": "#s1", "label": "Slide 2" }                  // context, for orphan display
}
```

`path` is **rooted at `body` and uses `nth-of-type`**. Rooting is what makes it unique;
v2's unrooted `nth-child` path is why structurally identical twin cards collided.

**The `|N` ordinal in `sig` is reserved and unread.** It is still written, and files in the
wild carry it, so removing it is a format change and must be made as one. Nothing resolves
with it any more: see the policy below.

### Resolution order

Tried in order, first locator that yields **exactly one** element wins:

`id` → `path` (corroborated) → `aria` → `quote.exact` (narrowed by `sig` on a tie) → `sig`

The rung that succeeded is held in memory only (`foundVia`) and never persisted; it drives the
"moved" badge in the UI. A comment that resolves to zero elements is **never dropped** — it
goes to the Orphaned section of the review list, displayed with `quote.exact` and `hint`.

**`path` is corroborated, and this is not optional.** A rooted path names a *slot*, not an
element: delete the element a comment was written on and the next sibling slides into
`div:nth-of-type(3)`, where the same selector matches it. `path` is one of the two rungs that
raises no badge, so an uncorroborated hit is the worst outcome the tool can produce — a
confident, unmarked pin on content the comment was never about. So when the anchor recorded a
`quote.exact` and the element found by `path` no longer says it, the hit is rejected and
resolution continues down the ladder.

### Badge or orphan

> **Badge, do not orphan**, when the ladder finds a real weak match — a unique quote hit, or a
> sig pool with exactly one survivor. That is evidence.
>
> **Orphan, do not badge**, when the ladder has no match and would have to manufacture one
> from an index that no longer means anything. That is not evidence.

This is why the `sig` rung stops at a pool of one and never falls back to the stored ordinal.
`div.card|2` means "the third element that looked like this *at capture time*"; if the pool
has changed at all, that index selects whatever moved into the slot — the same positional
defect the `path` rung is corroborated against, one rung further down. Indexing into a set we
know has changed is a coin flip, and a coin flip carrying a "moved" badge is worse than no
answer, because the badge reads as *this is your element and it moved* and invites one
specific wrong conclusion. Orphaned says *the element this was written on is no longer on the
page*, and shows the original text. That is true, and nothing is lost.

An earlier version of this section documented a fifth rung, a fuzzy match over
`quote.prefix`/`quote.suffix`. It was never built, the two fields were written and never read,
and they are no longer written. The honest answer when the recorded text is gone is Orphaned,
not a guess assembled from its neighbours.

---

## 4. Document id

```
docId = sha256(canonical pristine text, as UTF-8 bytes).hex.slice(0, 16)
```

Consequences, all intended:

- **Injection is a pure function.** Same input, same widget version → same output bytes. This
  is what makes golden-file evals possible and re-running verifiably idempotent.
- Upgrading a v1/v2/fbe file and injecting fresh into the same original both yield the same
  `docId`. This holds for the markup the three known generations actually emit, where each
  piece sits alone on its own line: the stripper removes the whole line, the way the fbw
  block folds the newlines it owns (§2.1). A prior-generation block glued in mid-line leaves
  its surrounding whitespace behind and will not recover byte-for-byte.
- Two copies of the same document share an id — correct, they are the same document.

  This also means **two reviewers' copies of one deck share a `localStorage` key**, because
  the key is `fbw:<docId>` (§5). Opening a colleague's returned copy while you still hold
  unsaved comments of your own on the same deck will show yours on their file, and saving
  writes them in. The widget detects this (`bufferAhead`) and says so in a toast at boot and
  in the review list, but it is a property of hashing content rather than location, and the
  alternative — keying on the path — is the v1/v2 behaviour that broke on every rename and
  re-download.
- Renaming, re-downloading as `deck (1).html`, or moving the file does not change it. This is
  the whole reason the id is not derived from `location.pathname` the way v1 and v2 did it.

The id is also written as a sentinel attribute on the root element: `<html data-fbw="…">`.
A text scan for the fence can be defeated; an attribute on `<html>` cannot.

---

## 5. Browser-side storage

`localStorage` is a **crash-recovery buffer only**. The file is the source of truth.

| Key | Value |
|---|---|
| `fbw:<docId>` | `{ comments, tombstones, savedHash }` |
| `fbw:<docId>:ui` | `{ pinsHidden }` |
| `fbw:author` | `{ name, email }` — one identity per person, shared across all documents |

### Merge

On boot, and on every `storage` event from another tab, file-state and buffer are merged:

1. Union by `id`.
2. On collision, the higher `updatedAt` wins.
3. Any id appearing in either `tombstones` list is removed. Tombstones are retained forever;
   they cost ~60 bytes each and dropping them lets deleted comments resurrect from an older copy.

If the buffer contains comments the file does not, the widget says so rather than silently
reconciling — in the review list, and in a toast at boot, because the pins are drawn either
way and a pin that appears with no explanation is the problem. The commonest cause is not a
stale download but the shared-key case in §4: another copy of the same deck opened in this
browser. The message names both possibilities and asserts neither.

### Deletion

A deleted comment gets its **tombstone immediately**, and Undo removes the tombstone again.

Not on a timer at the end of the undo window. The boot merge is island ∪ buffer, so until a
tombstone exists there is nothing to stop a comment that is already saved in the file from
walking back in: delete it, reload inside the window, and it returns — with `dirty` false, so
no dot, no unload guard, no signal at all. Closing the tab inside the window lost the
deletion permanently. Durability must not depend on how long a toast stays on screen.

### Dirty tracking

`savedHash` is a hash of the canonical serialised `comments` array at the last successful
save. Dirty is `hash(current) !== savedHash`. This handles adds, edits and deletes uniformly.

The serialisation includes `rewrite.to`. Changing the page's text, or reverting it, is an
unsaved change exactly as much as typing a note is; leaving it out meant the save dot never
appeared for a reviewer who only retyped a headline.

It is a small non-cryptographic hash (FNV-style), not SHA-256, and deliberately: it answers
one question — *has the comment list changed since the last save?* — and has to answer it
synchronously on every render, which rules out `crypto.subtle`. The requirement is
collision-resistance for a dirty dot, not integrity.

The baseline is derived from the **island**, never from the buffer. What is in the file is by
definition saved, so a file opened on a machine that has never seen it reads as clean.
Keeping the baseline in the buffer instead made every freshly received file announce unsaved
changes and armed the unload guard on a page the reader had not touched.

v1 and v2 tracked a *count* of downloaded comments, which goes negative and stays wrong the
first time anything is deleted.

---

## 6. Prior generations

The injector recognises, strips and migrates three earlier widgets. All of them are detected
on the raw text before anything else happens.

| Gen | Detection | Migration |
|---|---|---|
| v1 | `sticky-feedback` / `STICKY_FEEDBACK` | no embedded state — strip only |
| v2 | `fbw2-root` / `STICKY_FEEDBACK_V2_SEED` / the `sticky-feedback-v2 drop-in` fence | parse the `_SEED` array, map to Comment |
| fbe | `fbe-root` / `FEEDBACK_EDIT_SEED` | parse the `_SEED` array, map to Comment |

Field mapping for v2 and fbe seeds:

| Source | Target |
|---|---|
| `id` | `id` (prefixed with `c-` if it is not already) |
| `timestamp` | `createdAt` |
| `editedAt ?? timestamp` | `updatedAt` |
| `comment` | `text` |
| `originalComment` | `originalText` |
| `resolved` | `resolved` |
| `user` | `author` |
| `target.selector` | `anchor.path` if it is rooted, else discarded |
| `target.label` | `anchor.aria` |
| `target.tagName` | `anchor.tag` |
| `selectedText` | `anchor.quote.exact` |

Anything unmappable is dropped with a counted warning on stderr. Migration never fails the
run — losing the strip because one seed entry is malformed would be worse.

---

## 7. Save ladder

The runtime never re-serialises the DOM unless every other option is gone. Serialising a
27 MB deck allocates a 27 MB string; serialising an interactive demo bakes whatever runtime
state is on screen into the "saved" file.

| # | Mechanism | Available on | Fidelity |
|---|---|---|---|
| 1 | `showSaveFilePicker` → read from disk → splice → `createWritable()` | Chrome/Edge, incl. `file://` | byte-perfect, true in-place save |
| 2 | `fetch(location.href, {cache:'no-store'})` → splice → download | http(s) | byte-perfect |
| 3 | `<input type="file">` re-pick → splice → download | Firefox/Safari on `file://` | byte-perfect |
| 4 | serialise the live DOM → splice → download | always | lossy; warns first |

Rungs 2 and 3 verify the `data-fbw` id in the bytes they obtained matches this document, and
fall through to the next rung if it does not. That is what stops rung 2 from silently saving a
stale cached copy and rung 3 from accepting the wrong file.

Rung 1 caches its `FileSystemFileHandle` in IndexedDB (`fbw` / `handles` / `<docId>`) so later
saves need no dialog, re-checking `queryPermission` each time. It reports the **handle's own
name**, not the filename in the address bar: the picker lets the reviewer save anywhere under
any name, so the two are regularly different and naming the wrong one is a lie about what was
just written.

Rungs 3 and 4 produce a **downloaded copy**; they cannot write to the file that is open. The
dialog that asks the reviewer to point at their file says so, and the toast afterwards says
which file is now the current one. It used to promise "to write the feedback into this file"
and then always download.

### Nothing here may end in silence

Every route out of a save has to say what happened, and that includes the routes where the
reviewer changes their mind. A save request answered by silence reads as success, and that is
how unsaved work gets closed.

- The "point at your file" dialog is a promise that must be settled on **every** exit —
  a button, Escape, a click on the veil, another dialog replacing it, or teardown. It is
  wrapped in a promise that only its two buttons could once resolve, so dismissing it left
  the in-flight flag set for the rest of the session and silently swallowed every later
  Cmd/Ctrl+S. Dismissal now resolves it and reports *Save cancelled. Nothing was written.*
- Cancelling the OS file dialog in rung 3 fires no `change` event. The `cancel` event is
  listened for as well, or the same wedge happens one level down — on Firefox and Safari over
  `file://`, where rung 3 is the only byte-perfect route available.
- A save requested while one is already running says so rather than returning quietly.

### Splicing

Only the state island changes. The splice finds:

```js
const OPEN  = '<script type="application/json" id="fbw-state">';
const CLOSE = '</' + 'script>';          // first occurrence after OPEN
```

Because the island's JSON cannot contain `<` (§3), the first `</script>` after `OPEN` is
always the island's own closing tag.

For large files the runtime reads only the **last 2 MB** as text to locate the island, then
composes the output without ever materialising the whole document as a string:

```js
new Blob([file.slice(0, start), newState, file.slice(end)])
```

---

## 8. Invariants

Asserted by `bin/verify.mjs`; each maps to a distinct non-zero failure message.

1. Exactly one `<!--fbw:begin …-->` and exactly one `<!--fbw:end-->`, in that order.
2. **The injected block introduces no closing-body token and no stray closing-script token.**
   Inside the fenced region there must be exactly two `</script>` (the island's and the
   runtime's) and zero `</body>`. Across the whole file, the count of `</body>` must equal the
   count in the canonical pristine text — injection never changes it.

   > Stated as "exactly one `</body>` in the file" this invariant is wrong, and a fixture
   > proves it: a page may legitimately carry the token inside a JavaScript string literal.
   > What actually matters is that *the widget never adds one*. The earlier generation did —
   > it emitted a closing-body tag inside its own export code — which put three tokens in
   > every injected file, five in a double-injected one, and is precisely what defeated the
   > next injector's marker check.
3. `<html>` carries `data-fbw="<16 hex>"`, matching `state.docId`.
4. The state island exists, and its text parses as JSON.
5. The island's text contains no unescaped `<` or `>`.
6. `state.v === 2` and every comment satisfies the Comment shape, including `toolBuild`
   (12 hex or null) and `rewrite` (null, or `from`/`to`/`at` with `from !== to`).

   > The bump from 1 is not cosmetic. A v1 runtime reading a v2 file preserves the `rewrite`
   > key and never applies it, so the page would show the author's original wording while the
   > file and the JSON export both say it was changed. A file that silently renders differently
   > depending on which build opened it is worse than one that is refused, so the version says
   > plainly that this file needs a runtime which understands rewrites. The runtime writes the
   > version it IMPLEMENTS rather than echoing the island's, or a v1 island would round-trip
   > out of a v2 build still claiming v1 with rewrites inside it.
7. The runtime block byte-matches `dist/widget.min.js`.
8. `docId === sha256(canonical pristine text).slice(0,16)` — **unless `state.snapshot` is
   `true`**, in which case the check is reported as not applicable.

   > Rung 4 re-serialises the DOM, which normalises attribute quoting, entity encoding and tag
   > shape. The resulting bytes are a faithful re-rendering of the document but not the
   > original bytes, so the hash legitimately differs. The widget sets `state.snapshot` when
   > and only when it used rung 4, and clears it again on the next byte-perfect save. Without
   > this carve-out the validator rejects every snapshot save, which would push people toward
   > ignoring it.
9. No prior-generation markers remain anywhere in the file.

### Source-level invariant

`src/widget.js` and `dist/widget.min.js` must not contain any of these literals:

- `</script`
- `</body`
- `<script type="application/json" id="fbw-state">` — the island's opening tag

Where they are needed they are built by concatenation (`'</' + 'script>'`). esbuild does not
constant-fold string concatenation at the settings this project pins, and the build asserts
the rule against the minified output as well, so a change in that behaviour fails loudly.

The reason generalises: **this runtime is pasted into the very file it describes.** Any token
it spells out in full then appears twice in that file — once as the real markup, once as a
string inside the runtime. Anything scanning for that token counts two and refuses the file.
The `</body>` case is what corrupted ten files in the wild; the island tag is the same trap
one level up, and was caught only because the eval suite ran every scenario against a real
injected document.

This is not cosmetic. Earlier generations emitted `'</body>'` inside a JS string literal, which
put three `</body>` tokens in every injected file and five in a double-injected one — and that
is precisely what defeated the next injector's marker check.

---

## 9. Exit codes

Both CLIs support `--json`, which prints a single JSON object to stdout and nothing else.

### `bin/add-feedback.mjs`

| Code | Meaning |
|---|---|
| 0 | injected into a clean file |
| 1 | error — nothing was written |
| 2 | already current; no-op, file untouched |
| 3 | upgraded from a prior generation (or healed a double injection) |

### `bin/verify.mjs`

| Code | Meaning |
|---|---|
| 0 | valid |
| 1 | invalid — the failed invariant from §8 is named on stderr |

---

## 10. The JSON export and import

Saving into the file stays the primary route and the only one that needs no second step. The
JSON exists for the two things one file cannot do: handing the feedback to something that is
not a browser, and collecting reviewers who were all sent the same file at the same time.

```jsonc
{
  "format": "fbw-feedback",          // refused on import if this is missing or different
  "formatVersion": 1,                // of the EXPORT envelope, independent of state.v
  "exportedAt": "2026-10-16T09:12:00.000Z",
  "tool": { "name": "fbw", "version": "1.0.0", "build": "205d4f10588f" },
  "document": { "docId": "a1b2c3d4e5f60718", "title": "Network Density Review",
                "file": "deck - feedback - 20261016.html" },
  "comments": [ /* Comment, verbatim, plus `on` */ ],
  "tombstones": [ /* as in the island */ ]
}
```

Each comment is the island's own record, unchanged — anchor, `rewrite`, `toolBuild` and all —
plus one added key:

```jsonc
"on": { "label": "Pipeline uplift", "tag": "h2", "onPage": true, "foundVia": "path" }
```

`on` is **derived at export time and never read back**. The anchor is how a machine finds the
element again; `on` is how a human or an agent reads the file without running the widget, and
`onPage: false` is how it says the element is gone. Import ignores it and re-resolves every
anchor against the document in front of it, because that is the only answer that can be true
of a different copy.

### Import

Import is the boot merge (§5) with a file in place of the island: union by id, higher
`updatedAt` wins, anything tombstoned in either list stays dead. Three consequences, all
wanted:

- **Importing the same export twice changes nothing.** Ids are stable, so there is no
  "already imported" flag to get wrong.
- **Several reviewers merge in any order** and land in the same state.
- A **deletion travels**: a tombstone in an imported file removes the comment here too.

A `docId` that does not match is reported and the reviewer decides. Anchors are resolved
against this page, so importing across documents mostly produces orphans rather than confident
wrong pins — but it is still the wrong deck, and saying so beats guessing.

Imported rewrites are replayed onto the page immediately (§3.2), not only listed. Imported
state is not in the file until it is saved, so the dirty dot comes on, which is correct: the
comments exist only in this browser until Cmd/Ctrl+S.
