# Migrating files that already carry a widget

Three earlier widget generations exist in the wild, plus files that got the current widget
injected twice. `add-feedback` handles all four in one pass: it strips whatever is there, carries
over any comments it can map, and writes a single current block. There is no separate migrate
command and no flag to opt in.

Every upgrade exits **3**. The on-disk contract is `architecture.md` §2 (stripping) and §6
(detection and field mapping).

---

## The three prior generations

Detected on the raw text, before anything else happens. A file can carry more than one.

| Gen | Detected by any of | Carries state? |
|---|---|---|
| v1 | `STICKY_FEEDBACK`, `sticky-feedback` | No |
| v2 | `STICKY_FEEDBACK_V2_SEED`, `STICKY_FEEDBACK_V2`, `sticky-feedback-v2`, `fbw2-root` | Yes, a `STICKY_FEEDBACK_V2_SEED = [...]` array |
| fbe | `FEEDBACK_EDIT_SEED`, `fbe-root` | Yes, a `FEEDBACK_EDIT_SEED = [...]` array |

`STICKY_FEEDBACK` is a substring of `STICKY_FEEDBACK_V2_SEED`, and `sticky-feedback` a substring
of the v2 fence, so the v1 test runs last, on a copy with the newer markers blanked out. Without
that, every v2 file would also report as v1. The `priorGenerations` field in `--json` is the
sorted result, for example `["v1","v2"]`.

### What gets removed

Removal is structural, not marker-string surgery. Anything whose markup carries a marker goes,
outermost first, repeated until no markers remain (up to 64 passes):

- any HTML comment containing a marker, including the `<!-- sticky-feedback-v2 drop-in -->` and
  `<!-- /sticky-feedback-v2 -->` fences;
- any `<script>` or `<style>` whose **body** contains a marker;
- any element whose **open tag** contains a marker, which is where `id="fbw2-root"` and
  `class="sticky-feedback-btn"` live, together with everything inside it.

A marker that survives all of that is a hard error, not a warning:

```
error: page.html: prior-generation marker(s) fbw2-root could not be removed (first at offset 76);
they are not inside a comment, a script/style element, or an element that carries them in its open tag
```

That happens when the marker is loose text in the document, which in practice means somebody
wrote about the old widget in a slide. Edit the text or rename the reference, then re-run.

---

## Field mapping for v2 and fbe seeds

Both generations use the same entry shape, so one mapping covers both. The seed arrays are
parsed out of the raw text with `JSON.parse` before anything is stripped. A reference like
`SEED.forEach(` or `SEED[0]` is skipped; only an assignment to an array literal counts.

| Source field | Target | Notes |
|---|---|---|
| `id` | `id` | Prefixed with `c-` unless it already starts with that. `1727` becomes `c-1727`. |
| (no `id`) | `id` | `c-` plus the first 12 hex of `sha256(JSON.stringify(entry))`. Content-derived, so migration stays a pure function. |
| `timestamp` | `createdAt` | Accepts an ISO string or epoch milliseconds. |
| `editedAt ?? timestamp` | `updatedAt` | Falls back to `createdAt` if neither parses. |
| `comment`, else `text` | `text` | If neither is a string, the entry is dropped. |
| `originalComment` | `originalText` | Otherwise `null`. |
| `resolved` | `resolved` | Strictly `=== true`; anything else becomes `false`. |
| `user` | `author` | A string becomes `{name, email: null}`. An object keeps `name` and `email` when they are strings. |
| `target.selector` | `anchor.path` | **Only if rooted** at `html` or `body`. Otherwise discarded. |
| `target.label` | `anchor.aria` | Empty string becomes `null`. |
| `target.tagName` | `anchor.tag` | Lowercased. |
| `selectedText` | `anchor.quote.exact` | The only field `quote` carries. |
| | `anchor.id`, `anchor.sig`, `anchor.hint` | Always `null`. Prior generations had no equivalent. |

Migration never fails the run. Losing the strip because one seed entry is malformed would be
worse than dropping that entry, so problems come back as counted warnings on stderr and in the
`--json` `warnings` array.

### What is dropped, and why it cannot be carried over

| Dropped | Why |
|---|---|
| **Every v1 comment.** | v1 embedded no state. The comments were downloaded as JSON and never written back into the file, so the file contains nothing to migrate. A v1 upgrade is a strip plus a fresh, empty block. |
| **Unrooted `target.selector` values.** | v2 wrote unrooted `nth-child` paths. Those are exactly the locators that collided on structurally identical twin cards, which is the bug the rooted `nth-of-type` path in §3 exists to fix. Importing them would import the bug. The comment survives if `selectedText` or `target.label` gives it another locator. |
| **Entries with no mappable text.** | A comment with no text is not a comment. Counted in `migrated.dropped`. |
| **Entries with no locator at all** (no rooted path, no label, no selected text). | Nothing would place them on the page and nothing would identify them in the orphan list. Counted in `migrated.dropped`. |
| **`anchor.sig`, `anchor.id`, `anchor.hint`.** | No prior generation recorded them. A migrated comment therefore resolves on fewer rungs than a native one. |
| **Timestamps that do not parse.** | Set to `1970-01-01T00:00:00.000Z`. Injection has to stay a pure function of its input (§4), so using the current clock is not an option. The comment is kept and dates itself visibly as 1 January 1970 in the review list. |
| **Replies, reactions, attachments, ordering, and any other field.** | The Comment shape in §3 has no place for them. Only the fields in the table above are read. |

Both drop counts are reported:

```
warning: fbedeck.html: 2 prior-generation comment(s) had no mappable text or locator and were dropped
upgraded         fbedeck.html -> fbedeck-fb.html  +49.3 KB (49.7 KB total)  [from fbe, 1 comment(s) migrated, 2 dropped]
```

---

## Healing a double injection

A file with two current `fbw` blocks is healed by re-running the injector. `architecture.md` §2
removes **every** fenced region, not the first, so the canonical pristine text is the same one a
clean file would produce. Both islands are read, their comment lists are merged by id with the
higher `updatedAt` winning, their tombstone lists are unioned, and one block is written.

```
$ node bin/add-feedback.mjs doubled.html --out healed.html
upgraded         doubled.html -> healed.html  -41.5 KB (48.4 KB total)  [healed 2 fences]
$ echo $?
3
$ node bin/verify.mjs healed.html
ok        healed.html
```

The healed output is byte-identical to a single clean injection of the same document. The block
folds the newlines around it into its own region, so removing it reproduces the original bytes
exactly. `verify` flags the unhealed file first, under invariant 1:

```
invalid   doubled.html
          invariant 1: expected exactly one fbw fence pair, found 2 begin marker(s) and 2 end marker(s)
          invariant 4: expected exactly one state island (<script type="application/json" id="fbw-state">), found 2
          invariant 4: expected exactly one runtime script (<script id="fbw-core">), found 2
```

---

## Running it

Work on a copy or use `--in-place`, which writes a `.bak` sibling before overwriting. Check
first if you want to know what is in a batch without touching it:

```bash
node bin/add-feedback.mjs decks/*.html --in-place --check --json
```

Read `priorGenerations`, `migrated` and `fences` per file. Then do it:

```bash
node bin/add-feedback.mjs decks/*.html --in-place
node bin/verify.mjs decks/*.html
```

A single file, end to end, with the codes you should see:

```bash
node bin/add-feedback.mjs v2deck.html --out v2deck-fb.html   # exit 3
node bin/verify.mjs v2deck-fb.html                            # exit 0
```

Exit 3 from the first command and exit 0 from the second is the whole success condition. Exit 0
from the first means the injector found no prior generation, so check your detection assumption.
Exit 1 means nothing was written; the message names the reason.

`verify` also asserts that no prior-generation marker survives anywhere outside the new block
(invariant 9), so a passing `verify` is proof the strip was complete.

---

## What a reviewer sees afterwards

**Will see:**

- Every migrated comment, in the review list, with its original text, author name and dates.
- A numbered pin on the page for each migrated comment whose anchor still resolves.
- Comments that resolved by a weaker locator marked with a dashed amber pin border, and a
  warning in the thread panel saying the element was matched by its text or its shape.
- Comments whose element is gone under "Orphaned comments", with the quoted text they were
  written on. Nothing is deleted.
- A resolved migrated comment still marked resolved, struck through in the list.

**Will not see:**

- Any v1 comment. There were none in the file.
- The old widget's button, panel or styling. All of it is gone.
- Replies, reactions or threading from the old tool.
- A correct date on any comment whose timestamp did not parse; those read as January 1970.

**One behaviour worth knowing.** `docId` is the SHA-256 prefix of the canonical pristine text,
and upgrading gives a file **the same `docId`** as injecting into the clean original —
byte-identical output, in fact. The stripper removes each piece of prior-generation markup
together with the line it sat on, the way the fbw block folds the newlines it owns, so no blank
lines are left behind to change the hash.

That holds for the markup all three known generations actually emit, where each piece is alone
on its own line. A prior-generation block hand-edited into the middle of a line leaves its
surrounding whitespace behind and will not recover byte-for-byte; in that case the upgraded
file is still correct and still verifies, it simply has a different `docId` from a fresh
injection into the original.

---

## Removing the widget

**There is no removal flag.** `add-feedback --help` lists every option and none of them uninstall.
The injector only ever writes a file that carries a block.

Three ways out, in order of preference.

**1. The `.bak` file.** Any `--in-place` run that wrote something left `<input>.bak` next to it,
holding the exact bytes from before. Restoring it is the only method that needs no reasoning:

```bash
mv deck.html.bak deck.html
```

No `.bak` is written on a no-op run (exit 2) or a failed one, so its absence is not a problem in
itself.

**2. By hand.** The block is a fenced region and a single attribute, both defined by §1 and §2.
Removing them restores the original bytes:

- delete everything from `<!--fbw:begin 1-->` through `<!--fbw:end-->`, including the newline
  immediately before the begin marker and the one immediately after the end marker;
- delete ` data-fbw="…"` from the `<html>` tag.

Nothing else was changed. The BOM, the line endings, the doctype casing and every byte of your
own content were left alone.

**3. Scripted.** Same two edits. Safe because the state island cannot contain `<` (§3), so no
comment text can fake a fence, and the runtime contains neither fence marker:

```bash
node -e '
const fs = require("fs");
const p = process.argv[1];
let t = fs.readFileSync(p, "utf8");
t = t.replace(/\n?<!--fbw:begin [\s\S]*?<!--fbw:end-->\n?/g, "");
t = t.replace(/(<html\b[^>]*?)\s+data-fbw="[0-9a-f]{16}"/i, "$1");
fs.writeFileSync(p, t);
' deck.html
```

This round-trips to the original byte for byte, including on a CRLF file and on a file that was
double-injected. Confirm it with `cmp`:

```bash
cmp deck.html deck.html.bak && echo identical
```

**What you lose.** Every comment. They live only in the island, and removing the block removes
them. Export first if you need them: open the file, open the review list, and use "Copy summary"
to get a Markdown list of every comment with its author and the element it was written on.
Deleting the block also strands any browser-side buffer, since that is keyed by the `docId` the
removed block carried.
