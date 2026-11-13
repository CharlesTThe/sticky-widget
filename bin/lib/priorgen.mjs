// Detection, stripping and migration of the three earlier widget generations (§6).
//
// Migration never fails the run: losing the strip because one seed entry is malformed would
// be strictly worse than dropping that entry with a counted warning.

import { createHash } from 'node:crypto';
import { scanComments, scanElements } from './html.mjs';

/** Detection markers, longest/most specific first so classification is not fooled by overlap. */
export const MARKERS = [
  { text: 'STICKY_FEEDBACK_V2_SEED', gen: 'v2' },
  { text: 'sticky-feedback-v2 drop-in', gen: 'v2' },
  { text: 'fbw2-root', gen: 'v2' },
  { text: 'FEEDBACK_EDIT_SEED', gen: 'fbe' },
  { text: 'fbe-root', gen: 'fbe' },
  { text: 'STICKY_FEEDBACK', gen: 'v1' },
  { text: 'sticky-feedback', gen: 'v1' },
];

const EPOCH = '1970-01-01T00:00:00.000Z';

export function findMarkers(text) {
  const hits = [];
  for (const m of MARKERS) {
    const at = text.indexOf(m.text);
    if (at !== -1) hits.push({ ...m, at });
  }
  return hits;
}

export function hasMarker(text) {
  return MARKERS.some((m) => text.includes(m.text));
}

/**
 * Which generations are present. `STICKY_FEEDBACK` is a substring of `STICKY_FEEDBACK_V2_SEED`
 * and `sticky-feedback` of the v2 fence, so the v1 test runs on a copy with the newer markers
 * blanked out — otherwise every v2 file would also report as v1.
 */
const CLASSIFY = [
  { text: 'STICKY_FEEDBACK_V2_SEED', gen: 'v2' },
  { text: 'STICKY_FEEDBACK_V2', gen: 'v2' },
  { text: 'sticky-feedback-v2', gen: 'v2' }, // the drop-in fence and its closing comment
  { text: 'fbw2-root', gen: 'v2' },
  { text: 'FEEDBACK_EDIT_SEED', gen: 'fbe' },
  { text: 'fbe-root', gen: 'fbe' },
];

export function detectGenerations(text) {
  const gens = new Set();
  let residue = text;
  for (const m of CLASSIFY) {
    if (!residue.includes(m.text)) continue;
    gens.add(m.gen);
    residue = residue.split(m.text).join('');
  }
  for (const m of MARKERS) {
    if (m.gen === 'v1' && residue.includes(m.text)) gens.add('v1');
  }
  return [...gens].sort();
}

function containsMarker(source) {
  for (const m of MARKERS) if (source.includes(m.text)) return true;
  return false;
}

/**
 * Widen a cut to its whole line when the removed markup is the only thing on that line.
 *
 * Without this the stripper leaves behind the blank line the markup sat in, so the pristine
 * text of an upgraded file differs from the pristine text of the same document injected
 * clean — different whitespace, different sha256, different docId. `findFbwRegions` already
 * folds the newlines its own block owns, for exactly this reason (§4: same input, same
 * output); this is the prior-generation half of the same rule.
 *
 * Only a whole line is absorbed, and only one: a cut with anything else on its line is
 * removed verbatim. Consecutive cuts each take their own line and cannot overlap, because a
 * cut sharing a line with another is by definition not alone on it.
 */
function widenToWholeLine(text, cut) {
  let start = cut.start;
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
  if (start !== 0 && text[start - 1] !== '\n') return cut;

  let end = cut.end;
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
  if (text[end] === '\r') end++;
  if (end < text.length && text[end] !== '\n') return cut;
  if (text[end] === '\n') end++;

  return { start, end };
}

/**
 * §2.2 — remove every prior-generation region. The contract names the detection markers but
 * not the markup they sit in, so removal is structural: any comment, any <script>/<style>
 * whose body carries a marker, and any element whose *open tag* carries one (that is where
 * `id="fbw2-root"` and `class="sticky-feedback-btn"` live) goes, outermost first.
 */
export function stripPriorRegions(text) {
  let current = text;
  let removed = 0;
  for (let pass = 0; pass < 64; pass++) {
    if (!hasMarker(current)) break;
    const cuts = [];

    for (const c of scanComments(current)) {
      if (containsMarker(current.slice(c.start, c.end))) cuts.push(c);
    }
    for (const el of scanElements(current)) {
      const openTag = current.slice(el.openStart, el.openEnd);
      const whole = current.slice(el.openStart, el.end);
      const inert = el.name === 'script' || el.name === 'style';
      if (containsMarker(openTag) || (inert && containsMarker(whole))) {
        cuts.push({ start: el.openStart, end: el.end });
      }
    }
    if (cuts.length === 0) break;

    // Keep only the outermost cuts so a nested match does not splice a hole in its parent.
    cuts.sort((a, b) => a.start - b.start || b.end - a.end);
    const outer = [];
    for (const c of cuts) {
      const prev = outer[outer.length - 1];
      if (prev && c.start < prev.end) continue;
      outer.push(c);
    }

    let next = '';
    let last = 0;
    for (const c of outer) {
      const cut = widenToWholeLine(current, c);
      next += current.slice(last, Math.max(last, cut.start));
      last = Math.max(last, cut.end);
      removed++;
    }
    next += current.slice(last);
    if (next === current) break;
    current = next;
  }
  return { text: current, removed, leftover: findMarkers(current) };
}

/** Index of the bracket matching the one at `open`, honouring string literals. */
function matchBracket(text, open) {
  const closer = text[open] === '[' ? ']' : '}';
  const opener = text[open];
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const SEED_NAMES = [
  { name: 'STICKY_FEEDBACK_V2_SEED', gen: 'v2' },
  { name: 'FEEDBACK_EDIT_SEED', gen: 'fbe' },
];

/** Pull the `…_SEED = [ … ]` arrays out of the raw text, before anything is stripped. */
export function extractSeeds(text) {
  const found = [];
  for (const { name, gen } of SEED_NAMES) {
    let cursor = 0;
    while (true) {
      const at = text.indexOf(name, cursor);
      if (at === -1) break;
      cursor = at + name.length;
      const bracket = text.indexOf('[', cursor);
      if (bracket === -1) break;
      // Only an assignment counts; `SEED.forEach(` and `SEED[0]` are references, not the array.
      if (!/^[\s=:]*$/.test(text.slice(cursor, bracket))) continue;
      if (!/^\[\s*[{\]]/.test(text.slice(bracket, bracket + 8))) continue;
      const close = matchBracket(text, bracket);
      if (close === -1) {
        found.push({ gen, entries: [], error: `${name} array is unterminated` });
        continue;
      }
      const source = text.slice(bracket, close + 1);
      try {
        const entries = JSON.parse(source);
        if (Array.isArray(entries)) found.push({ gen, entries, error: null });
        else found.push({ gen, entries: [], error: `${name} is not an array` });
      } catch (err) {
        found.push({ gen, entries: [], error: `${name} is not valid JSON: ${err.message}` });
      }
      cursor = close + 1;
    }
  }
  return found;
}

function toIso(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim() !== '') {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  // No usable clock in the source. Injection must stay a pure function (§4), so the current
  // time is not an option; epoch-0 keeps the comment and flags itself in the UI.
  return null;
}

function stableId(entry) {
  return 'c-' + createHash('sha256').update(JSON.stringify(entry)).digest('hex').slice(0, 12);
}

/** §6 field mapping. Returns null for an entry with nothing worth keeping. */
export function migrateSeedEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

  const text = typeof entry.comment === 'string' ? entry.comment
    : typeof entry.text === 'string' ? entry.text
      : null;
  if (text === null) return null;

  const rawId = entry.id === undefined || entry.id === null ? null : String(entry.id);
  const id = rawId === null || rawId === ''
    ? stableId(entry)
    : (rawId.startsWith('c-') ? rawId : 'c-' + rawId);

  const createdAt = toIso(entry.timestamp) ?? EPOCH;
  const updatedAt = toIso(entry.editedAt ?? entry.timestamp) ?? createdAt;

  const target = entry.target && typeof entry.target === 'object' ? entry.target : {};
  const selector = typeof target.selector === 'string' ? target.selector : null;
  // §6: an unrooted selector is discarded. v2's unrooted nth-child paths are exactly the
  // locators that collided on twin cards, so carrying them over would import the bug.
  const path = selector && /^\s*(html|body)\b/i.test(selector) ? selector.trim() : null;
  const aria = typeof target.label === 'string' && target.label !== '' ? target.label : null;
  const tag = typeof target.tagName === 'string' && target.tagName !== ''
    ? target.tagName.toLowerCase()
    : null;
  const exact = typeof entry.selectedText === 'string' && entry.selectedText !== ''
    ? entry.selectedText
    : null;

  const anchor = {
    tag,
    id: null,
    path,
    aria,
    sig: null,
    quote: exact === null ? null : { exact, prefix: null, suffix: null },
    hint: null,
  };
  if (!anchor.path && !anchor.aria && !anchor.quote) return null; // no locator survives

  let author = null;
  if (typeof entry.user === 'string' && entry.user !== '') author = { name: entry.user, email: null };
  else if (entry.user && typeof entry.user === 'object') {
    author = {
      name: typeof entry.user.name === 'string' ? entry.user.name : null,
      email: typeof entry.user.email === 'string' ? entry.user.email : null,
    };
  }

  return {
    id,
    schemaVersion: 1,
    createdAt,
    updatedAt,
    author,
    text,
    originalText: typeof entry.originalComment === 'string' ? entry.originalComment : null,
    resolved: entry.resolved === true,
    anchor,
  };
}

/** Migrate every seed found in the raw text. Never throws. */
export function migrateSeeds(rawText) {
  const comments = [];
  const warnings = [];
  const counts = { v1: 0, v2: 0, fbe: 0, dropped: 0 };
  for (const seed of extractSeeds(rawText)) {
    if (seed.error) {
      warnings.push(seed.error);
      continue;
    }
    for (const entry of seed.entries) {
      const migrated = migrateSeedEntry(entry);
      if (migrated === null) {
        counts.dropped++;
        continue;
      }
      counts[seed.gen]++;
      comments.push(migrated);
    }
  }
  if (counts.dropped > 0) {
    warnings.push(`${counts.dropped} prior-generation comment(s) had no mappable text or locator and were dropped`);
  }
  return { comments, counts, warnings };
}
