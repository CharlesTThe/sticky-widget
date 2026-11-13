---
name: feedback-widget
description: Use when adding a reviewer feedback or annotation widget to a standalone HTML file, whether a slide deck, a dashboard, a one-pager, or an interactive demo, so reviewers can click any element, leave a comment, and press Cmd or Ctrl plus S to write that feedback back into the HTML file itself. Reviewers can also retype the text of any text-only element directly in the comment pop-up, with the original kept and revertable, and can download all comments and text changes as a JSON tagged to each element and to the widget build that wrote it, or import one back to merge several parallel reviewers onto one copy. Comments show as numbered pins on the page, survive reload and renaming, and accumulate as the file is passed from one reviewer to the next. No backend, no third-party requests or telemetry. Also use to upgrade a file carrying an older sticky-feedback widget, or to repair one that was injected twice. Trigger on "add a feedback widget", "let reviewers comment on this HTML", "add feedback to this deck", "annotate this dashboard", "collect feedback on this one-pager", "feedback knop op deze HTML", "voeg feedback toe aan deze slide", and equally on "let me edit the text directly", "fix the wording on the page", "in-line editing", "download the feedback as JSON", "merge feedback from several reviewers". Injection is always done by the bundled script, never by hand-editing the HTML.
---

# feedback-widget

A reviewer clicks any element, types a comment, presses Cmd/Ctrl+S, and the comment is written
into the HTML file itself. The next person to open that file just sees the pins. The file is
the database; browser storage is only a crash-recovery buffer.

On an element whose content is just text, the composer also shows that text, editable: the
reviewer can retype the headline rather than describe what is wrong with it. The original
wording is kept and can be put back, and the saved file still holds the author's markup —
the new text lives in the state island and is re-applied on load, which is what keeps it
revertable.

Nothing to install. `dist/widget.min.js` is committed and adds about 65 KB per file.

**Comments should go to a server instead of into the file?** Add
`--endpoint https://<server>/api/feedback` to the injector: every copy of the file then syncs to
one set of comments. For web apps and sites (script tag, npm import, React), this skill is not
the route — see README.md and `references/server.md`.

## Do this

Two commands. Both are deterministic, so the same input always gives the same output.

```bash
node "<this-skill-dir>/bin/add-feedback.mjs" "<input.html>" --out "<output.html>"
node "<this-skill-dir>/bin/verify.mjs" "<output.html>"
```

Write a **new** file by default; never overwrite someone's original unless they ask, in which
case use `--in-place` (it keeps a `.bak`). Omitting `--out` writes
`<name> - feedback - YYYYMMDD.html` next to the input.

`verify` exiting 0 is what lets you say the job is done. If it exits non-zero it names the
invariant that failed. Do not hand over the file until it passes.

### Exit codes from `add-feedback`

| Code | Meaning | What to do |
|---|---|---|
| 0 | injected into a clean file | done |
| 2 | already current | nothing; the file was not touched |
| 3 | upgraded from an older widget, or a double injection was healed | done; mention it to the user |
| 1 | refused, nothing written | read the message, it names the reason |

**0, 2 and 3 are all success. Only 1 is a failure.** Do not treat a non-zero exit as an error:
scripting this with `set -e`, or checking `if exit != 0`, will report a perfectly good no-op
as a failure. With `--json`, `ok` is already defined as `exitCode !== 1`.

## Never

- **Never hand-inline the widget.** Reading the file and pasting the script yourself is how
  ten files in the wild ended up double- or triple-injected. The script is the only supported
  path; if Node is unavailable, stop and say so.
- Never re-run the injector to "make sure". It is idempotent and will tell you (exit 2).
- Never edit the injected block, the state island, or the `data-fbw` attribute by hand.

## Tell the user, briefly

- Comments are saved by pressing **Cmd/Ctrl+S**, or the save button in the widget.
- In Chrome and Edge that writes straight back into the file. Safari and Firefox download a
  copy instead, and may ask the reviewer to point at the file once.
- Reviewers can retype the text of any element that is just text. The page changes when they
  add the comment, **Put text back** restores the author's wording, and the review list shows
  the before and after.
- **Download JSON** saves every comment and text change, each tagged to the element it sits on
  and to the widget build that wrote it. **Import JSON** merges one back in.
- Several reviewers, two ways round:
  - **Pass the file along one at a time** — each person opens the file the previous person
    saved and adds to it. Simplest, and nothing to merge.
  - **In parallel**, each reviewer downloads their JSON and sends it back; importing them all
    onto one copy merges them. Union by id, so importing the same file twice changes nothing
    and the order does not matter. What you cannot do is fold four separately SAVED HTML
    copies together — merging is through the JSON, not through the files.

## Go deeper only when you need to

| Read | When |
|---|---|
| `references/cli.md` | a flag, the `--json` shape, batch runs, or an exit code you did not expect |
| `references/config.md` | accent colour, position, reviewer identity, or what metadata is collected |
| `references/migration.md` | the file already has an older widget, or was injected twice |
| `references/troubleshooting.md` | something looks wrong on the page or the injector refused |
| `references/architecture.md` | you are changing the widget, the injector, or the file format |

Running `npm test` is for changing this skill, not for using it — see the README. Using it
means running `verify`, which is the check that matters and is already above.
