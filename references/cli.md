# CLI reference

Two commands. `bin/add-feedback.mjs` puts the widget into an HTML file. `bin/verify.mjs` checks
that a file still satisfies the on-disk contract. Neither needs a network, a config file, or an
install step beyond Node 18 or newer.

The on-disk contract they implement is [`architecture.md`](architecture.md). This page describes
the interface; go there for the byte layout (§1), the state shape (§3), the invariants (§8) and
the exit-code contract (§9).

---

## `add-feedback`

```
node bin/add-feedback.mjs <input.html...> [options]
```

### Flags

| Flag | Default | What it does |
|---|---|---|
| `--out <file\|dir>` | none | Where to write. If the path exists and is a directory, the output is that directory plus the input's basename. With several inputs it **must** be an existing directory. |
| `--in-place` | off | Overwrite the input. Copies the original to `<input>.bak` first, but only when something is actually written. Mutually exclusive with `--out`. |
| `--accent <color>` | unset | Any CSS colour string. Lands in `state.config.accent`. Unset means the runtime picks a colour from the page. See [config.md](config.md). |
| `--position <pos>` | `bottom-right` | `bottom-right` or `bottom-left`. Anything else is rejected before any file is read. |
| `--endpoint <url>` | unset | An absolute `http(s)` URL of a feedback server (see [server.md](server.md)). The file then runs in server mode: comments sync to the server instead of being saved into the file, and every copy of the file — renamed, re-downloaded, forwarded — shares one set of comments, keyed by the document id. Comments already in the island are uploaded on first open. Sticky across re-injection; `--endpoint ''` removes it. Lands in `state.config.endpoint`. |
| `--write-key <key>` | unset | The server's `WRITE_KEY`, sent as `X-Feedback-Key` with every request. Printable ASCII, no spaces. Anyone who opens the file can read it, exactly like the endpoint, so it keeps strangers out and is not sign-in. Sticky; `--write-key ''` removes it. Lands in `state.config.writeKey`. |
| `--runtime <path>` | `dist/widget.min.js`, then `src/widget.js` | The artifact to embed, byte for byte. Resolved relative to your working directory. |
| `--dev` | off | Shorthand for embedding `src/widget.js`. Roughly 158 KB instead of 65 KB, and files built this way fail `verify` unless you pass the same `--runtime`. |
| `--check` | off | Compute everything, print the summary, write nothing. The exit code is the one a real run would produce. |
| `--json` | off | One JSON object on stdout and nothing else. Warnings and errors move into the object instead of stderr. |
| `--quiet` | off | Suppress the human summary line. Warnings and errors still go to stderr. No effect with `--json`. |
| `-h`, `--help` | | Print usage to stdout, exit 0. |

With no `--out` and no `--in-place`, the output goes next to the input as
`<name> - feedback - YYYYMMDD.html`, using today's local date and the input's extension.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Injected into a clean file. |
| 1 | Error. Nothing was written. |
| 2 | Already current. The file was not opened for writing, its mtime is untouched, and no `.bak` was made. |
| 3 | Upgraded from a prior generation, or healed a double injection, or re-injected over an existing block. |

**0, 2 and 3 are all success. Only 1 means nothing was written.** A shell caller should test
for `1`, not for non-zero — a script under `set -e` that re-runs the injector over its own
output will otherwise fail on a clean no-op. The `--json` object already says this directly:
`ok` is defined as `exitCode !== 1`.

Exit 2 means "the bytes that would be written are already at the output path". It is decided by
comparing the planned output against the file that is already there, so it fires both for a
repeat `--in-place` run and for a repeat `--out` run into the same destination. With `--out`,
the summary line names the **output**, because the output is what was already current — the
input never was.

Exit 3 covers every case where the input already carried a widget of some kind. That includes a
plain re-injection to pick up a new runtime or a new accent, where nothing is being "upgraded"
in the colloquial sense.

#### 0, injected

```
$ node bin/add-feedback.mjs test/fixtures/light.html --out "$OUT/light.html"
injected         test/fixtures/light.html -> /tmp/x/light.html  +49.3 KB (56.2 KB total)
$ echo $?
0
```

#### 1, error

```
$ node bin/add-feedback.mjs test/fixtures/light.html --out test/fixtures/light.html
error: test/fixtures/light.html: refusing to overwrite the input without --in-place
failed           test/fixtures/light.html
$ echo $?
1
```

Every distinct refusal message is listed in [troubleshooting.md](troubleshooting.md#injection-exits-1).

#### 2, already current

```
$ node bin/add-feedback.mjs deck.html --in-place
injected         deck.html -> deck.html  +49.3 KB (56.2 KB total)
$ node bin/add-feedback.mjs deck.html --in-place
unchanged        deck.html  (already current, 48.5 KB total)
$ echo $?
2
```

#### 3, upgraded or healed

```
$ node bin/add-feedback.mjs v2deck.html --out v2deck-fb.html
upgraded         v2deck.html -> v2deck-fb.html  +49.3 KB (50.0 KB total)  [from v2, 2 comment(s) migrated]
$ echo $?
3
```

```
$ node bin/add-feedback.mjs doubled.html --out healed.html
upgraded         doubled.html -> healed.html  -41.5 KB (48.4 KB total)  [healed 2 fences]
$ echo $?
3
```

The healed output is byte-identical to a single clean injection of the same document. See
[migration.md](migration.md).

### Human output

One line per input file on stdout:

```
<verb padded to 16> <input> -> <output>  <signed delta> (<total>)[  <notes>]
```

The verb is `injected`, `upgraded`, `unchanged` or `failed`, prefixed with `would be ` under
`--check` for the first two. Notes appear in square brackets and may include `from v1+v2`,
`healed N fences`, `N comment(s) migrated` and `N dropped`.

Warnings and errors go to stderr, prefixed `warning: ` and `error: ` plus the file path. A
warning does not change the exit code. The two you will see most:

```
warning: page.html: no </body> found; the block was inserted before the last </html>
warning: page.html: no </body> or </html> found; the block was appended at end of file
```

### `--json` output

Captured, not invented:

```json
{"ok":true,"exitCode":0,"runtime":"/path/to/feedback-kit/dist/widget.min.js","results":[{"file":"/tmp/x/deck.html","out":"/tmp/x/deck-fb.html","action":"injected","exitCode":0,"written":true,"docId":"1402d5c777cd54b1","comments":0,"migrated":{"v1":0,"v2":0,"fbe":0,"dropped":0},"priorGenerations":[],"fences":0,"bytesBefore":7096,"bytesAfter":49699,"delta":42603,"warnings":[],"errors":[]}]}
```

Field by field:

| Field | Meaning |
|---|---|
| `ok` | `exitCode !== 1`. An upgrade and a no-op are both "ok". |
| `exitCode` | The process exit code, repeated here so a pipeline does not have to capture both. |
| `runtime` | Absolute path of the artifact that was embedded. |
| `results[].file` | Absolute input path. |
| `results[].out` | Absolute output path, or `null` if the run failed before one was chosen. |
| `results[].action` | `injected`, `upgraded`, `unchanged` or `error`. |
| `results[].exitCode` | This file's own code, before aggregation. |
| `results[].written` | `false` under `--check`, on a no-op, and on an error. |
| `results[].docId` | The 16 hex characters from §4, or `null` on an early failure. |
| `results[].comments` | Comments in the state that was written, existing plus migrated. |
| `results[].migrated` | `{v1, v2, fbe, dropped}`. `v1` never carries state, so that count is always 0. |
| `results[].priorGenerations` | Sorted list of detected generations, for example `["v1","v2"]`. |
| `results[].fences` | How many `fbw` fenced regions the input already had. More than 1 means a double injection was healed. |
| `results[].bytesBefore` / `bytesAfter` / `delta` | Byte counts. `delta` is forced to 0 on a no-op. |
| `results[].warnings` / `errors` | Strings. In `--json` mode these do not also go to stderr. |

On a failure that happens before any file is read (no runtime found, a runtime carrying a
forbidden literal) the shape is flatter, with no per-file results:

```json
{"ok":false,"exitCode":1,"error":"no widget runtime found. Tried:\n  /tmp/x/nope.js\nPass --runtime <path>, or build dist/widget.min.js.","results":[]}
```

### Several inputs

Each file is processed independently and gets its own entry in `results`. One file failing does
not stop the others.

The process exit code is the **worst** outcome, ranked:

```
1  (error)  >  3  (upgraded)  >  0  (injected)  >  2  (no-op)
```

So a batch where one deck was clean, one was already current and one carried a v1 widget exits 3.
Add a missing file to that batch and it exits 1, even though three files were written. Use
`--json` and read the per-file `exitCode` when you need to know which is which.

`--out` with several inputs must be an existing directory, checked before any work starts:

```
$ node bin/add-feedback.mjs a.html b.html --out combined.html
--out must be an existing directory when several inputs are given
```

---

## `verify`

```
node bin/verify.mjs <file.html...> [--json] [--runtime <path>] [--quiet]
```

Asserts the nine invariants of §8 against each file. It never writes anything.

| Flag | Default | What it does |
|---|---|---|
| `--runtime <path>` | `dist/widget.min.js`, then `src/widget.js` | The artifact invariant 7 byte-compares the embedded runtime against. |
| `--json` | off | One JSON object on stdout, nothing else. |
| `--quiet` | off | Suppress the `ok` lines and their notes. Failures still print to stderr. |
| `-h`, `--help` | | Print usage to stdout, exit 0. |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Every file is valid. |
| 1 | At least one file is invalid, missing, or unreadable. |

#### 0, valid

```
$ node bin/verify.mjs deck-fb.html
ok        deck-fb.html
$ echo $?
0
```

#### 1, invalid

```
$ node bin/verify.mjs doubled.html
invalid   doubled.html
          invariant 1: expected exactly one fbw fence pair, found 2 begin marker(s) and 2 end marker(s)
          invariant 4: expected exactly one state island (<script type="application/json" id="fbw-state">), found 2
          invariant 4: expected exactly one runtime script (<script id="fbw-core">), found 2
$ echo $?
1
```

Each failure names the invariant it broke, so `architecture.md §8` tells you what the rule is and
why it exists. Failure ids are the numbers `1`–`9`, plus `S1` for the source-level rule and `io`
for a file that could not be read.

### Invariant 7 is skipped, not failed, when there is no artifact

`verify` has to stay usable on a machine that only ever received the injected file. If no runtime
artifact can be resolved, invariant 7 becomes a note and the file can still pass:

```
$ node bin/verify.mjs deck-fb.html --runtime /nonexistent.js
ok        deck-fb.html
          note: invariant 7 skipped: no runtime artifact could be resolved to compare against
$ echo $?
0
```

The flip side: running `verify` inside this repository always resolves `dist/widget.min.js`, so a
file injected with an **older** build of the widget fails invariant 7 even though it is perfectly
sound:

```
invariant 7: the embedded runtime does not byte-match /path/to/feedback-kit/dist/widget.min.js (embedded 42163 chars, artifact 42273 chars)
```

That is a version mismatch, not corruption. Re-inject to bring the file up to the current runtime,
or point `--runtime` at the build the file was made with.

### `--json` output

Captured from a passing and a failing file:

```json
{"ok":true,"exitCode":0,"runtime":"/path/to/feedback-kit/dist/widget.min.js","results":[{"file":"/tmp/x/deck-fb.html","valid":true,"failures":[],"notes":[]}]}
```

```json
{"ok":false,"exitCode":1,"runtime":"/path/to/feedback-kit/dist/widget.min.js","results":[{"file":"/tmp/x/doubled.html","valid":false,"failures":[{"id":"1","message":"expected exactly one fbw fence pair, found 2 begin marker(s) and 2 end marker(s)"},{"id":"4","message":"expected exactly one state island (<script type=\"application/json\" id=\"fbw-state\">), found 2"},{"id":"4","message":"expected exactly one runtime script (<script id=\"fbw-core\">), found 2"}],"notes":[]}]}
```

`runtime` is `null` when none could be resolved. Several failures can share an `id`; there is one
entry per failed check, not per invariant.

---

## Recipes

Each block is runnable as written from the package root. The scratch directory keeps output out
of the repository.

```bash
OUT=$(mktemp -d)
```

**Inject one deck, writing a new file.**

```bash
node bin/add-feedback.mjs test/fixtures/light.html --out "$OUT/light-review.html"
node bin/verify.mjs "$OUT/light-review.html"
```

**Inject a folder in place.** Every input gets a `.bak` sibling. Files that are already current
are skipped without being touched.

```bash
mkdir -p "$OUT/decks"
cp test/fixtures/light.html test/fixtures/app-shell.html "$OUT/decks/"
node bin/add-feedback.mjs "$OUT"/decks/*.html --in-place
node bin/verify.mjs "$OUT"/decks/*.html
```

**Check what would happen, without writing.** Useful before a batch run, and as a CI gate: exit 0
means clean, 2 means already done, 3 means something old is in there.

```bash
node bin/add-feedback.mjs "$OUT"/decks/*.html --in-place --check --json
```

**Re-inject after changing the accent.** Exit 3, because the file already carried a block. The
comments, the tombstones and the `docId` all survive; only the config and the runtime change.

```bash
node bin/add-feedback.mjs "$OUT/decks/light.html" --in-place --accent '#ff6a13'
```

To go back to auto-detection, pass an empty accent. The runtime treats an empty string the same
as "not set". There is no flag that deletes the key.

```bash
node bin/add-feedback.mjs "$OUT/decks/light.html" --in-place --accent ''
```

**Validate a file someone sent you.** Run it without a runtime comparison first, so a version
difference does not mask a real problem:

```bash
node bin/verify.mjs "$OUT/decks/light.html" --runtime /nonexistent --json
```

If that passes, the file's structure and state are sound. Then run it again without `--runtime` to
find out whether the embedded runtime matches your current build.
