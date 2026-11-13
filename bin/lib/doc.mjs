// Document-level operations: canonical pristine text, the document id, planning an
// injection, and the nine invariants. Both CLIs are thin wrappers around this file.

import { createHash } from 'node:crypto';

import {
  BLOCK_VERSION,
  CORE_OPEN,
  DOCID_ATTR,
  FENCE_BEGIN_PREFIX,
  FENCE_END,
  ISLAND_OPEN,
  buildBlock,
  countOccurrences,
  countTokens,
  extractTitle,
  findBodyClose,
  findFbwRegions,
  findHtmlClose,
  findHtmlTag,
  getDocIdAttr,
  maskInert,
  parseRegion,
  removeRegions,
  setDocIdAttr,
  stripDocIdAttr,
} from './html.mjs';
import { detectGenerations, findMarkers, migrateSeeds, stripPriorRegions } from './priorgen.mjs';
import { toolStamp } from './runtime.mjs';
import {
  POSITIONS,
  buildState,
  mergeComments,
  mergeTombstones,
  serialiseState,
  validateState,
} from './state.mjs';

export function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** §4 — the id is a pure function of the pristine text, which is why injection is reproducible. */
export function docIdOf(pristineText) {
  return sha256Hex(pristineText).slice(0, 16);
}

/**
 * §2 — "this document without any widget in it": every fbw region, every prior-generation
 * region, and the sentinel attribute removed; everything else, BOM and line endings included,
 * left exactly as it was.
 */
export function canonicalPristine(rawText) {
  const regions = findFbwRegions(rawText);
  const withoutFbw = removeRegions(rawText, regions);
  const stripped = stripPriorRegions(withoutFbw);
  const text = stripDocIdAttr(stripped.text);
  return {
    text,
    regions,
    withoutFbw,
    priorRemoved: stripped.removed,
    leftoverMarkers: stripped.leftover,
  };
}

function snip(value, max = 80) {
  const s = String(value);
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length} chars)`;
}

/** Read whatever state the file already carries, from every fbw region present. */
export function readExistingStates(rawText, regions) {
  const states = [];
  const problems = [];
  for (const region of regions) {
    const parsed = parseRegion(rawText, region);
    if (!parsed) {
      problems.push(`fbw block at offset ${region.start} does not match the §1 layout`);
      continue;
    }
    let state = null;
    try {
      state = JSON.parse(parsed.island);
    } catch (err) {
      problems.push(`state island at offset ${region.start} is not valid JSON: ${err.message}`);
      continue;
    }
    states.push({ region, state, runtime: parsed.runtime, version: parsed.version });
  }
  return { states, problems };
}

/**
 * Everything needed to decide what to write, without writing anything.
 *
 * Throws nothing: problems come back in `errors`, so the caller can refuse cleanly.
 */
export function planInjection({ rawText, runtimeText, options = {} }) {
  const warnings = [];
  const errors = [];

  const generations = detectGenerations(rawText); // §6: detected on the raw text, first
  const { text: pristine, regions, leftoverMarkers } = canonicalPristine(rawText);

  if (leftoverMarkers.length > 0) {
    const names = [...new Set(leftoverMarkers.map((m) => m.text))].join(', ');
    errors.push(
      `prior-generation marker(s) ${names} could not be removed (first at offset ${leftoverMarkers[0].at}); ` +
      'they are not inside a comment, a script/style element, or an element that carries them in its open tag',
    );
  }

  const docId = docIdOf(pristine);
  const { states, problems } = readExistingStates(rawText, regions);
  for (const p of problems) warnings.push(`${p} — rebuilding from pristine text`);

  const migration = migrateSeeds(rawText);
  for (const w of migration.warnings) warnings.push(w);

  const existing = states[0]?.state ?? null;
  const existingLists = states.map((s) => (Array.isArray(s.state?.comments) ? s.state.comments : []));
  const tombstones = mergeTombstones([
    ...states.map((s) => (Array.isArray(s.state?.tombstones) ? s.state.tombstones : [])),
  ]);
  const comments = mergeComments([...existingLists, migration.comments], tombstones);

  const existingConfig = existing && typeof existing.config === 'object' && existing.config !== null
    ? existing.config
    : {};
  const config = {
    accent: options.accent ?? (typeof existingConfig.accent === 'string' ? existingConfig.accent : null),
    position: options.position ?? (POSITIONS.includes(existingConfig.position) ? existingConfig.position : POSITIONS[0]),
    // Always written, no longer settable. Nothing in the runtime reads it and the flag that
    // set it is gone. Keeping the key means the island layout, invariant 6 and every golden
    // stay byte-identical, and a file that already carries `true` keeps it.
    captureConsole: existingConfig.captureConsole === true,
  };
  // No flag writes this any more. Identity belongs to the reviewer, not to the file: one
  // deck is forwarded to several people, so a name baked in at injection time mislabels
  // everyone but the first. A value already present in an island is preserved rather than
  // silently dropped.
  if (existingConfig.author) config.author = existingConfig.author;
  // Sticky like accent and position. Written only when set, so a file-mode island stays
  // byte-identical to what earlier versions produced. An empty string removes it.
  const endpoint = options.endpoint !== undefined ? options.endpoint
    : (typeof existingConfig.endpoint === 'string' ? existingConfig.endpoint : '');
  if (endpoint) config.endpoint = endpoint;
  const writeKey = options.writeKey !== undefined ? options.writeKey
    : (typeof existingConfig.writeKey === 'string' ? existingConfig.writeKey : '');
  if (writeKey) config.writeKey = writeKey;

  const extras = {};
  if (existing && typeof existing === 'object') {
    for (const [k, v] of Object.entries(existing)) {
      if (!['v', 'docId', 'title', 'tool', 'config', 'comments', 'tombstones'].includes(k)) extras[k] = v;
    }
  }

  const state = buildState({
    docId,
    title: extractTitle(pristine),
    // Re-stamped on every injection from the runtime actually being embedded, never carried
    // over from the island: the point of the stamp is to name the widget in THIS file.
    tool: toolStamp(runtimeText),
    config,
    comments,
    tombstones,
    extras,
  });

  const base = setDocIdAttr(pristine, docId);
  if (base === null) {
    errors.push('no <html> element to carry the data-fbw sentinel (invariant 3)');
    return { errors, warnings, docId, state, pristine, regions, generations, migration, out: null };
  }

  // §1 insertion point. `lastIndexOf` semantics, over markup only, because host pages carry
  // `</body>` inside JS string literals and the last *real* one is the injection point.
  const masked = maskInert(base);
  let at = findBodyClose(base, masked);
  if (at === -1) {
    at = findHtmlClose(base, masked);
    if (at === -1) {
      at = base.length;
      warnings.push('no </body> or </html> found; the block was appended at end of file');
    } else {
      warnings.push('no </body> found; the block was inserted before the last </html>');
    }
  }

  const block = buildBlock(serialiseState(state), runtimeText);
  const out = base.slice(0, at) + block + base.slice(at);

  return { errors, warnings, docId, state, pristine, regions, generations, migration, out };
}

/**
 * The nine invariants of §8, plus the source-level rule. Every failure names its invariant.
 * `runtime` may be null, in which case invariant 7 is noted as skipped rather than failed —
 * verify has to stay usable on a machine that only has the injected file.
 */
export function verifyDocument(text, { runtime = null } = {}) {
  const failures = [];
  const notes = [];
  const fail = (id, message) => failures.push({ id, message });

  // 1 — fences
  const beginCount = countOccurrences(text, FENCE_BEGIN_PREFIX);
  const endCount = countOccurrences(text, FENCE_END);
  const regions = findFbwRegions(text);
  let parsed = null;
  if (beginCount !== 1 || endCount !== 1) {
    fail('1', `expected exactly one fbw fence pair, found ${beginCount} begin marker(s) and ${endCount} end marker(s)`);
  } else if (text.indexOf(FENCE_BEGIN_PREFIX) > text.indexOf(FENCE_END)) {
    fail('1', 'the fbw:end marker precedes the fbw:begin marker');
  } else if (regions.length !== 1 || !regions[0].terminated) {
    fail('1', 'the fbw fence is not a single terminated region');
  } else {
    parsed = parseRegion(text, regions[0]);
    if (!parsed) fail('1', `the fbw block at offset ${regions[0].start} does not match the fixed §1 byte layout`);
    else if (parsed.version !== BLOCK_VERSION) {
      fail('1', `block format version is ${parsed.version}, expected ${BLOCK_VERSION}`);
    }
  }

  // 2 — the block adds no closing-body token and no stray closing-script token. A whole-file
  // count of one would be wrong: host pages legitimately carry the token inside JS string
  // literals, and `</BODY>` is real, so what matters is that injection never changes the count.
  const { text: pristine, leftoverMarkers } = canonicalPristine(text);
  if (regions.length === 1 && regions[0].terminated) {
    const region = text.slice(regions[0].start, regions[0].end);
    const scripts = countTokens(region, 'script');
    const bodies = countTokens(region, 'body');
    if (scripts !== 2) {
      fail('2', `the fenced region holds ${scripts} closing-script token(s); exactly two are allowed (the island's and the runtime's)`);
    }
    if (bodies !== 0) {
      fail('2', `the fenced region holds ${bodies} closing-body token(s); it must hold none`);
    }
  }
  const bodyAfter = countTokens(text, 'body');
  const bodyPristine = countTokens(pristine, 'body');
  if (bodyAfter !== bodyPristine) {
    fail('2', `the file holds ${bodyAfter} closing-body token(s) but its canonical pristine text holds ${bodyPristine}; injection must not change the count`);
  }

  // 4 — the state island exists and parses (needed before 3, 5, 6 and 8 can say anything)
  const islandCount = countOccurrences(text, ISLAND_OPEN);
  const coreCount = countOccurrences(text, CORE_OPEN);
  let state = null;
  let island = null;
  if (islandCount !== 1) {
    fail('4', `expected exactly one state island (${ISLAND_OPEN}), found ${islandCount}`);
  }
  if (coreCount !== 1) {
    fail('4', `expected exactly one runtime script (${CORE_OPEN}), found ${coreCount}`);
  }
  if (islandCount === 1) {
    const open = text.indexOf(ISLAND_OPEN) + ISLAND_OPEN.length;
    // §7: the island's JSON cannot contain `<`, so the first close tag after it is its own.
    const close = text.indexOf('</script>', open);
    if (close === -1) {
      fail('4', 'the state island is never closed');
    } else {
      island = text.slice(open, close);
      try {
        state = JSON.parse(island);
      } catch (err) {
        fail('4', `the state island is not valid JSON: ${err.message}`);
      }
    }
  }

  // 5 — no unescaped angle brackets in the island
  if (island !== null) {
    const bad = /[<>]/.exec(island);
    if (bad) {
      const from = Math.max(0, bad.index - 30);
      fail('5', `unescaped "${bad[0]}" in the state island at island offset ${bad.index}: ${snip(island.slice(from, bad.index + 30))}`);
    }
  }

  // 3 — the sentinel attribute
  const attr = getDocIdAttr(text);
  if (!findHtmlTag(text)) {
    fail('3', 'no <html> element, so the data-fbw sentinel cannot be carried');
  } else if (attr === null) {
    fail('3', `<html> carries no ${DOCID_ATTR} attribute`);
  } else if (!/^[0-9a-f]{16}$/.test(attr)) {
    fail('3', `${DOCID_ATTR}="${snip(attr)}" is not 16 lowercase hex characters`);
  } else if (state && state.docId !== attr) {
    fail('3', `${DOCID_ATTR}="${attr}" does not match state.docId "${snip(state?.docId)}"`);
  }

  // 6 — state shape
  if (state !== null) {
    for (const problem of validateState(state)) fail('6', problem);
  }

  // 7 — runtime byte-match
  if (parsed) {
    if (runtime && typeof runtime.text === 'string') {
      if (parsed.runtime !== runtime.text) {
        fail('7', `the embedded runtime does not byte-match ${runtime.path} (embedded ${parsed.runtime.length} chars, artifact ${runtime.text.length} chars)`);
      }
    } else {
      notes.push('invariant 7 skipped: no runtime artifact could be resolved to compare against');
    }
    // Source-level invariant (§8): the embedded runtime must not carry a body-closing token.
    const stray = parsed.runtime.toLowerCase().indexOf('</body');
    if (stray !== -1) {
      fail('S1', `the embedded runtime contains the literal "</body" at block offset ${stray}`);
    }
  }

  // 8 — docId is the hash of the pristine text.
  //
  // Not applicable to a file the widget saved from a DOM snapshot (save rung 4,
  // the last resort when the original bytes cannot be read). Re-serialising the
  // DOM normalises attribute quoting, entity encoding and tag shape, so the
  // pristine text legitimately differs from the one the docId was derived from.
  // The widget records that by setting state.snapshot, and the flag is the only
  // thing that can excuse this invariant.
  if (state && state.snapshot === true) {
    notes.push('invariant 8 not applicable: this file was saved from a DOM snapshot, so its bytes are a re-rendering of the original document rather than the original');
  } else {
    const expected = docIdOf(pristine);
    if (state && typeof state.docId === 'string' && state.docId !== expected) {
      fail('8', `state.docId "${snip(state.docId)}" does not match sha256(canonical pristine text) "${expected}"`);
    }
  }

  // 9 — no prior-generation markers. Scoped to the document outside the fbw block: a comment
  // that quotes an old marker is reviewer text, not a leftover widget.
  const outside = removeRegions(text, regions);
  const markers = findMarkers(outside);
  if (markers.length > 0) {
    const listed = markers.map((m) => `${m.text} (${m.gen}, offset ${m.at})`).join('; ');
    fail('9', `prior-generation marker(s) remain: ${listed}`);
  } else if (leftoverMarkers.length > 0) {
    fail('9', `prior-generation marker(s) remain: ${leftoverMarkers.map((m) => m.text).join(', ')}`);
  }

  return { valid: failures.length === 0, failures, notes, state, docId: state?.docId ?? null };
}
