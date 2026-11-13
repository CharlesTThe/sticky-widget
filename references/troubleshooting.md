# Troubleshooting

Organised by what you see. Each entry says what is happening underneath before it says what to
do, because most of these look like the same thing (the widget "not working") and have unrelated
causes.

Two commands settle most questions before you open a browser:

```bash
node bin/verify.mjs suspect.html          # is the file structurally sound?
node bin/add-feedback.mjs suspect.html --in-place --check --json   # what is already in it?
```

And two expressions settle the rest, in the browser console:

```js
window.__fbw            // undefined means the runtime never ran
window.__fbw._state()   // { dirty, storageBroken, bufferAhead, groups, orphans }
```

---

## Widget code appears as visible text on the page

Two causes, and they are easy to tell apart: if only the widget's code is visible and the rest of
the deck renders normally, it is the first; if the whole file shows as source, it is the second.

**The block landed inside a text-content element.** The injector inserts before the last real
`</body>`, computed over a copy of the document with comments and `<script>`/`<style>` bodies
blanked out. That masking does not cover `<textarea>`, `<pre>`, `<xmp>` or `<title>`. A page whose
only `</body>` token sits inside one of those, for example a textarea that shows sample markup,
gets the block inserted into that element, where the browser renders it as text.

`verify` passes on such a file. Every invariant holds: one fence pair, one island, the sentinel
attribute, an unchanged closing-body count. The placement is wrong, and nothing checks placement.

Fix: give the page a real `</body>` after the text element, or escape the token inside it as
`&lt;/body&gt;`. Then re-inject.

**The file is being shown as plain text.** A `.txt` extension, a server sending
`Content-Type: text/plain`, or a raw-file view in a code host. The whole document is source, not
just the widget. Rename it to `.html` and open it locally, or use the host's rendered preview.

---

## The rail is invisible or unclickable

The rail is a `position: fixed` host `<div id="fbw-host">` with `all: initial` and
`z-index: 2147483000`, holding a shadow root. The outer z-index is what lifts it above a deck
whose own slides carry z-indexes; everything inside the shadow root only ranks against its
siblings.

Check in order.

**Did it boot at all?** `window.__fbw` in the console. If it is `undefined`, the runtime never
ran: the file may be truncated, an earlier script may have thrown and stopped parsing, or the
block may be sitting inside an unterminated HTML comment or an unclosed `<script>` in the host
page. The injector warns about the latter two indirectly, by reporting that it found no
`</body>` and appended at the end of the file. Look for `[fbw]` warnings in the console too;
every entry point is wrapped so a widget bug logs rather than taking the page down.

**Is the host element still in the DOM?** `document.getElementById('fbw-host')`. A page that does
`document.body.innerHTML = …` after boot removes it. Nothing puts it back. Reload the page and do
not re-run whatever rebuilt the body.

**Is something painted on top?** The widget's own browser test hit-tests this. Do the same:

```js
const h = document.getElementById('fbw-host');
const r = h.shadowRoot.querySelector('.fab').getBoundingClientRect();
document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
```

If that returns anything other than the host element, a page element is covering it. In practice
that means a fixed overlay using the maximum z-index (`2147483647`), or an element that entered
fullscreen (nothing outside the fullscreen element is rendered at all). Leave fullscreen, close
the overlay, or move the rail with `--position bottom-left`.

**Is it just somewhere else?** At boot the widget hit-tests the point 48px in from its corner and
48px up from the bottom. If it finds a `position: fixed` element there, it lifts the rail to
`bottom: 88px` rather than sitting on the page's own navigation. That is deliberate, and it can
put the rail somewhere you were not looking.

**Are you printing?** All widget chrome is hidden under `@media print`, by design.

**Are you looking at the wrong document?** The widget lives in one file. If the deck you are
reviewing is loaded inside an `<iframe>`, injecting the inner file puts the widget inside the
frame, and injecting the outer file gives you a widget that can only comment on the frame element
itself, not on its contents.

---

## A comment shows as "orphaned"

Every comment carries five independent locators (§3). The runtime tries them in this order and
accepts a rung only when it yields **exactly one** non-widget element:

1. a document-unique `id`;
2. a `body`-rooted `nth-of-type` path — **accepted only if the element still says what it said
   when the comment was written**;
3. an `aria-label`;
4. an exact match on the element's own visible text, narrowed by the class signature if several
   elements have the same text;
5. the tag-plus-sorted-classes signature, when exactly one element still has that signature.

A comment that gets no single match on any of the five is orphaned.

**Two of those rules are why you will see orphans the older widgets never showed you, and both
are deliberate.** A path describes a *position*: `div:nth-of-type(3)` still matches after you
delete the element it was written on, because the next sibling slides into the slot. The
signature's stored ordinal has the same problem. Either one will happily produce a confident
pin on a completely different figure. So a path hit is checked against the recorded text
before it is accepted, and the ordinal is not used at all. When the tool cannot tell, it says
so instead of guessing — a pin on the wrong number is worse than a comment in the orphan list,
because only one of them tells you something false.

It is never dropped. It moves to the "Orphaned comments" section of the review list, shown with
the text it was written on (`Was on: "…"`) so you can find the content again.

What actually causes it:

- **The element is gone from the DOM.** A client-side route change, a tab or accordion that
  destroys rather than hides its contents, a chart library that replaced its container.
- **The element was rebuilt with different markup.** New classes break the signature, a new tag
  breaks the quote lookup, a new position breaks the path.
- **The document is a different document.** You are looking at a newer export of the deck and the
  section was rewritten.

What does **not** cause it: an element that is merely hidden. `display: none` and
`visibility: hidden` elements are still found by the locators, so a comment on a slide you are
not currently viewing is not orphaned. Its pin is hidden, which is a different thing (see below).

What to do. If the content still exists somewhere on the page, navigate to the state where it is
present; the widget re-resolves after DOM churn settles (a 220ms debounce on a mutation observer)
and the comment un-orphans on its own. If the content is genuinely gone, read the quote, act on
the feedback, and resolve the comment. Orphaned comments are kept forever, so nothing is lost by
leaving them.

---

## A pin has a dashed amber border

That is the "moved" state. It means the comment resolved on a **weaker** rung than `id` or
`path`: it was found by its aria label, by its text, or by its tag-and-class signature. Opening
the pin shows the reason in the thread panel:

> This element moved or changed since the comment was written. It was matched by its text, so
> double-check it is the right spot.

Underneath: the element's position in the document changed enough that its rooted
`nth-of-type` path no longer matches, or it lost the unique `id` it had when the comment was
written. Adding one sibling of the same tag anywhere above it is enough.

A pin covers all the comments on one element, and the group is marked moved if **any** of its
comments needed a weaker rung.

The badge is a prompt to check, not an error. If the pin is on the right element, ignore it. If
it is on the wrong element, the signature rung has an ordinal fallback that can land on a
same-shaped neighbour; delete the comment and re-add it on the correct element.

One limitation worth knowing: the anchor is captured once, when the comment is created. Editing
the comment text does not re-capture it, so a moved comment stays moved. Deleting and re-adding
is the only way to refresh an anchor.

---

## Cmd/Ctrl+S downloads a file instead of saving in place

The runtime intercepts Cmd/Ctrl+S on a capture-phase `keydown` listener and calls its own save,
so the browser's Save Page As never runs. What that save does depends on the browser, because
only one of the four rungs in §7 can write to a path on disk.

| Browser | What happens | Result |
|---|---|---|
| Chrome, Edge | `showSaveFilePicker` is available. The first save opens a Save dialog; point it at the file you are viewing. The handle is cached in IndexedDB under the document's id, so every later save is silent. | True in-place write, byte-perfect |
| Firefox, Safari, on `http(s)` | No `showSaveFilePicker`. The runtime fetches the page's own URL with `cache: 'no-store'`, splices the new state into those bytes, and hands you a download. | Download, byte-perfect |
| Firefox, Safari, on `file://` | No `showSaveFilePicker` and `fetch` is not usable on `file:`. You are asked to point at the file once, then given a download. | Download, byte-perfect |
| Anything, when all of the above fail | The live DOM is serialised. | Download, lossy |

This is not a bug in the widget. Writing to an arbitrary path from a page requires the File
System Access API, which only Chromium-based browsers ship. On Firefox and Safari you have to
move the downloaded file over the original yourself; the download carries the page's own
filename, so it will land as `deck.html` or `deck (1).html` in your Downloads folder.

The first three rungs all produce the document's **original bytes** with only the state island
changed, so a download is not a degraded save. Only the fourth rung is lossy, and it warns:

> Saved from a snapshot of the page as it looks now, because the original file could not be read.
> Interactive state may be baked in.

If nothing at all happens on Cmd/Ctrl+S, a script in the host page is consuming the keystroke
before the widget's capture-phase listener sees it. Use the download-arrow button on the rail, or
"Save into file" at the bottom of the review list.

---

## The widget asks you to pick the file

You see a dialog saying:

> This browser cannot write to the file directly. Point at deck.html so your comments can be
> added to a copy of it.

This appears only when every automatic route is exhausted: there is no cached file handle, the
browser has no `showSaveFilePicker` (or you cancelled it), and either the page is on `file://`
so `fetch` cannot read it, or the fetched bytes did not carry this document's id. The widget
asks before opening a file dialog rather than springing one on you.

Note what it does and does not promise. This route produces a **downloaded copy**; it cannot
write into the file you have open. The toast afterwards says which file is now the current
one. (The dialog used to say it would "write the feedback into this file" and then download
anyway.)

You can back out. Escape, or a click outside the dialog, cancels the save and says so:

> Save cancelled. Nothing was written.

Cancelling the file dialog itself does the same. Nothing is lost either way — your comments
are still in the browser and the save button still carries its dot.

Choosing the right file gives you a byte-perfect download. Choosing the wrong one gives you:

> That is a different document. Save cancelled — nothing was written.

That check reads the first 64 KB of whatever you picked and looks for `data-fbw="<this
document's id>"`. It is what stops the widget from splicing your comments into an unrelated deck.
"Use a snapshot instead" skips to the lossy DOM rung.

Two related surprises:

- **Chrome asks again after you cancelled.** The handle is cached the moment you pick a file in
  the Save dialog. Cancelling caches nothing and falls straight through to this prompt.
- **Chrome saves to a copy you did not expect.** The cached handle is keyed by the document id,
  and the document id is a hash of the content, so two copies of the same deck in two folders
  share it. If you first pointed the picker at `~/Downloads/deck.html`, later saves from
  `~/decks/deck.html` write to the Downloads copy. Check the toast: it names the file it wrote.

---

## "This browser is blocking or has run out of local storage"

Shown as a warning at the top of the review list:

> This browser is blocking or has run out of local storage. Your comments are held in this tab
> only — save the file now, or they will be lost when you close it.

(Quoted verbatim, so it matches what you can search for in the source.)

Every `localStorage` read and write is wrapped, and any throw flips this flag. Three things throw:

- a private or incognito window that denies storage;
- a browser configured to block all cookies and site data, which blocks `localStorage` with it;
- a full origin quota. On `file://` every local file can share one origin, so an unrelated page
  can be what filled it.

Nothing is broken. The file is the source of truth and `localStorage` is only the crash-recovery
buffer, so saving works normally and a saved file reopens with all its comments on a machine that
has no storage at all. What you lose is the safety net: close the tab before saving and the
comments typed in it are gone.

Act on it literally. Save now, then continue.

---

## Comments in the browser are not in the file yet

Shown as a warning at the top of the review list:

> 3 comments in this browser are not in the file yet. This usually means you are looking at an
> older copy. Saving will write everything into the file.

The widget merges the file's comments with the browser buffer on boot, then counts how many of
the merged comments have ids the file does not carry. A non-zero count is the stale-cache case.
The widget says so rather than reconciling quietly, because quiet reconciliation is how you end
up not noticing that the file you are about to forward is the old one.

The document id is a hash of the document's content, so this can only happen when the buffer and
the file describe the *same* pristine document. In practice that means:

- you saved a download and are still looking at the original file;
- the page came from an HTTP cache and the server has a newer copy;
- someone sent you the pre-comment version of a file you had already commented on.

Fix: save. The merge is already done in memory, so one save writes everything into the file. If
you would rather work from the current copy, hard-reload first (the buffer survives the reload
and merges again).

---

## Pins do not move when the page scrolls

Pins are absolutely positioned against the viewport and repositioned on a `requestAnimationFrame`
whenever something suggests the layout moved: a capture-phase `scroll` on `document` (which
catches inner scroll containers, not only the window), `resize`, `orientationchange`, a
`ResizeObserver` on `<html>` and `<body>`, web fonts finishing, and a debounced `MutationObserver`
on the body.

If the content moves without producing any of those, nothing schedules a reposition and the pins
stay where they were. The usual cases:

- **A CSS transform animation or transition.** A slide deck that translates a track has no scroll
  event and no mutation. The pins update at the next unrelated event.
- **Scrolling inside an `<iframe>`.** Events in the frame do not reach the parent document.
- **Scrolling inside a closed shadow root.** Same reason.

Three things look like this bug and are not:

- **The pin disappeared instead of moving.** A pin hides when its element leaves the viewport by
  more than 60px, or when the element is `display: none` or `visibility: hidden`. That is
  correct behaviour; scroll back.
- **The pin is stuck at the edge of the screen.** Pins are clamped into the viewport so that a
  comment on a very tall or very wide element is still reachable. On a full-height element the
  pin parks at the top-right and barely moves.
- **All pins vanished at once.** The "Hide pins" toggle is on. It is remembered per document in
  `localStorage` under `fbw:<docId>:ui`, so it survives a reload. Turn it off from the rail or
  the review list.

Workaround while the content is animating: resize the window by a pixel, or scroll the window,
to force a reframe.

---

## Injection exits 1

Nothing was written. Every message is listed here with what to do.

### Before any file is read

| Message | What it means |
|---|---|
| `no input files given.` plus the usage block | No positional argument. |
| a `parseArgs` error plus the usage block | An unknown flag, or a value-taking flag with no value. |
| `--position must be one of bottom-right, bottom-left` | Only those two are valid. See [config.md](config.md#position). |
| `--out and --in-place are mutually exclusive` | Pick one. `--in-place` overwrites the input and writes a `.bak`. |
| `--out must be an existing directory when several inputs are given` | With more than one input, `--out` names a folder. Create it first. |
| `no widget runtime found. Tried: …` | Neither `dist/widget.min.js` nor `src/widget.js` exists, or the `--runtime` path does not. Run `npm run build`, or pass `--runtime`. |
| `<path>: runtime contains the literal "</script" at offset N; it must be built by concatenation` | The runtime artifact spells out a token that would truncate its own script element once pasted into a document. The same check covers `"</body"`. This is the §8 source-level invariant; build the token by concatenation in the runtime source. |

### Per file, prefixed `error: <file>:`

| Message | What it means |
|---|---|
| `<path> does not exist or is not a file` | Wrong path, or you pointed at a directory. In a batch the other files still run, and the process still exits 1. |
| `refusing to overwrite the input without --in-place` | `--out` resolved to the input path. Use `--in-place`, which makes a `.bak` first. |
| `output directory <dir> does not exist` | `--out` names a file in a folder that is not there. The injector does not create folders. |
| `<path> is not valid UTF-8; refusing to rewrite it` | The bytes do not round-trip through UTF-8. Re-encoding would corrupt the file silently, and a corrupt output is worse than a refusal. Convert the file first. |
| `no <html> element to carry the data-fbw sentinel (invariant 3)` | The input is an HTML fragment. The sentinel attribute has to live on `<html>`, so wrap the fragment in a real document. |
| `prior-generation marker(s) X could not be removed (first at offset N); they are not inside a comment, a script/style element, or an element that carries them in its open tag` | A string like `fbw2-root` appears as loose text in the document, usually because somebody wrote about the old widget in a slide. Rename or rephrase it. See [migration.md](migration.md). |
| `invariant N: …` followed by `self-verification failed; nothing was written` | The injector verified the exact bytes it was about to write and they failed a §8 invariant. This is a bug in the injector or a document shape it mishandles. The named invariant is the lead. Keep the input and report it; nothing was written, so the file on disk is intact. |

---

## The file grew more than expected

Baseline, with the current build:

| Part | Size |
|---|---|
| Runtime (`dist/widget.min.js`, embedded verbatim) | about 65 KB, roughly 22 KB gzipped |
| Fences, script tags, newlines | about 200 bytes |
| Empty state JSON | about 150 bytes |
| Each comment, escaped | 0.3 to 0.6 KB. A typical one with a full anchor measures 514 bytes |
| Each tombstone | about 60 bytes, and they are kept forever |

So a fresh injection costs about 49.3 KB, and a hundred comments add roughly 50 KB on top.
Confirm with `--json` and read `bytesBefore`, `bytesAfter` and `delta`.

If the growth is much larger than that:

- **You used `--dev`.** That embeds `src/widget.js` unminified, roughly 158 KB instead of 65 KB.
  Files built that way also fail `verify` invariant 7 unless you pass the same `--runtime`.
  Re-inject without `--dev`.
- **The file was injected twice.** Two runtimes, two islands. `verify` reports it under invariant
  1, and re-running the injector heals it back to exactly one. See
  [migration.md](migration.md#healing-a-double-injection).
- **Comments carry long quotes.** Every comment stores up to 180 characters of the element's text
  plus 40 characters on each side. Commenting on a whole section rather than a heading is the
  expensive case.

What the injector never does: reformat, minify, reflow, or rewrite a single byte of your content.
The BOM, the line endings, the doctype casing and the whitespace all survive, so any growth
beyond the table above did not come from here.

The 65 KB matters when files are emailed and hardly matters when they are served, since the
runtime gzips to about a third of its size. There is no shared-file or CDN mode; the runtime is
embedded on purpose so a file works offline from `file://` with no network requests at all.

---

## A reviewer on Safari or Firefox, in a private window

Everything works. Two things differ, and both surprise people.

**Saving is always a download.** Neither browser ships `showSaveFilePicker`, so the in-place rung
is unavailable. See the save table above. The reviewer has to move the downloaded file over the
original, or send the download back as-is.

**The crash-recovery buffer is unavailable or ephemeral.** A private window commonly denies
`localStorage`, which raises the "blocking or has run out of local storage" banner. It also means:

- comments live only in the open tab until the file is saved;
- the reviewer's name is asked for again on every document;
- the IndexedDB handle cache is empty, so on `file://` the "point at it once" dialog appears on
  every save rather than only the first.

None of this affects the saved file. A file saved from a private window is byte-identical to one
saved from a normal window and reopens with its comments intact anywhere.

What to tell a reviewer in this situation: save early, save often, and do not close the tab
before saving. The browser will also warn on close while there are unsaved comments, because the
widget arms a `beforeunload` guard whenever the comment list differs from what is in the file.
