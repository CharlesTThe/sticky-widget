// Text-level HTML primitives shared by the injector and the validator.
//
// Everything here operates on the document *text* and never normalises it: BOM, line
// endings, doctype casing and whitespace are the host file's business (architecture.md §2.4).
// Nothing in this file knows anything about the widget runtime — that is an opaque blob.

export const BLOCK_VERSION = 1;
export const FENCE_BEGIN_PREFIX = '<!--fbw:begin ';
export const FENCE_END = '<!--fbw:end-->';
export const ISLAND_OPEN = '<script type="application/json" id="fbw-state">';
export const CORE_OPEN = '<script id="fbw-core">';
export const SCRIPT_CLOSE = '</script>';
export const DOCID_ATTR = 'data-fbw';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** The exact byte layout from §1. Reproducibility depends on this being the only producer. */
export function buildBlock(stateText, runtimeText) {
  return (
    '\n' + FENCE_BEGIN_PREFIX + BLOCK_VERSION + '-->' +
    '\n' + ISLAND_OPEN + stateText + SCRIPT_CLOSE +
    '\n' + CORE_OPEN + runtimeText + SCRIPT_CLOSE +
    '\n' + FENCE_END + '\n'
  );
}

/** Same-length blanking that keeps newlines, so masked offsets map 1:1 onto the original. */
function blank(s) {
  return s.replace(/[^\n]/g, ' ');
}

/**
 * Elements whose content the HTML parser treats as text rather than markup. A `</body>` or
 * `<html` inside one of these is characters on the page, not a tag, so the injector must not
 * aim at it. `script` and `style` are raw text; `textarea` and `title` are escapable raw text;
 * the rest are legacy raw-text elements that still parse that way.
 *
 * `pre` is deliberately absent: its content IS parsed markup, so a `</body>` inside a `<pre>`
 * really does close the body and must keep counting.
 */
const RAW_TEXT_OPEN = /^<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b/i;
// Longest name above is `<noframes` (9) plus a delimiter; 12 leaves room without scanning far.
const RAW_TEXT_LOOKAHEAD = 12;

/**
 * Blank out everything that is not markup: comment bodies (including their delimiters) and
 * the *contents* of every raw-text element. Offsets are preserved, so a match found in the
 * masked copy can be sliced straight out of the original.
 *
 * This exists because host pages legitimately carry `</body>` inside JS string literals (§1)
 * and `<html` inside comments; a naive scan picks the wrong one and corrupts the document.
 *
 * The `textarea`/`title` cases are not hypothetical. A page that shows example markup in a
 * textarea, or names a tag in its title, and omits the optional `</body>` end tag, puts its
 * only closing-body token inside text — and the whole block was injected there, rendered as
 * page content, with the runtime never executing and `verify` reporting the file as valid.
 */
export function maskInert(text) {
  let out = '';
  let last = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text.charCodeAt(i) !== 60 /* '<' */) { i++; continue; }
    if (text.startsWith('<!--', i)) {
      const found = text.indexOf('-->', i + 4);
      const end = found === -1 ? n : found + 3;
      out += text.slice(last, i) + blank(text.slice(i, end));
      last = end;
      i = end;
      continue;
    }
    const open = RAW_TEXT_OPEN.exec(text.slice(i, i + RAW_TEXT_LOOKAHEAD));
    if (open) {
      const gt = findTagEnd(text, i);
      if (gt === -1) break;
      const closeRe = new RegExp('</' + open[1] + '\\s*>', 'gi');
      closeRe.lastIndex = gt;
      const m = closeRe.exec(text);
      const contentEnd = m ? m.index : n;
      out += text.slice(last, gt) + blank(text.slice(gt, contentEnd));
      last = contentEnd;
      i = contentEnd;
      continue;
    }
    i++;
  }
  return out + text.slice(last);
}

/** Index just past the `>` of the tag starting at `start`, honouring quoted attribute values. */
export function findTagEnd(text, start) {
  let quote = null;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '>') return i + 1;
  }
  return -1;
}

/**
 * The real `</body>`: the last one that is actual markup. §1 specifies `lastIndexOf`; masking
 * inert regions first is the same answer for every sane document and the right one when a
 * trailing script carries the literal in a string.
 */
export function findBodyClose(text, masked = maskInert(text)) {
  const re = /<\/body\s*>/gi;
  let last = -1;
  let m;
  while ((m = re.exec(masked)) !== null) last = m.index;
  return last;
}

/**
 * Count closing tags for one element, case-insensitively, over the raw text.
 * Invariant 2 compares these counts before and after injection, so this must see literals
 * inside scripts too — the point is that the injector never changes the number.
 */
export function countTokens(text, tagName) {
  const re = new RegExp('</' + tagName + '\\s*>', 'gi');
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

export function findHtmlClose(text, masked = maskInert(text)) {
  const re = /<\/html\s*>/gi;
  let last = -1;
  let m;
  while ((m = re.exec(masked)) !== null) last = m.index;
  return last;
}

/** Range of the opening `<html …>` tag, or null. Comments before it are ignored. */
export function findHtmlTag(text, masked = maskInert(text)) {
  const m = /<html\b/i.exec(masked);
  if (!m) return null;
  const end = findTagEnd(text, m.index);
  if (end === -1) return null;
  return { start: m.index, end };
}

export function getDocIdAttr(text) {
  const tag = findHtmlTag(text);
  if (!tag) return null;
  const m = /\sdata-fbw\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(text.slice(tag.start, tag.end));
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

/** §2.3 — strip the sentinel attribute, scoped to the `<html>` tag so nothing else is touched. */
export function stripDocIdAttr(text) {
  const tag = findHtmlTag(text);
  if (!tag) return text;
  const source = text.slice(tag.start, tag.end);
  const stripped = source.replace(/\sdata-fbw\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  if (stripped === source) return text;
  return text.slice(0, tag.start) + stripped + text.slice(tag.end);
}

export function setDocIdAttr(text, docId) {
  const tag = findHtmlTag(text);
  if (!tag) return null;
  const insertAt = tag.start + '<html'.length;
  return text.slice(0, insertAt) + ` ${DOCID_ATTR}="${docId}"` + text.slice(insertAt);
}

export function extractTitle(text) {
  const masked = maskInert(text);
  const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/di.exec(masked);
  if (!m || !m.indices || !m.indices[1]) return null;
  const [s, e] = m.indices[1];
  const raw = text.slice(s, e).replace(/\s+/g, ' ').trim();
  return raw === '' ? null : raw;
}

/**
 * Every `<!--fbw:begin …-->` … `<!--fbw:end-->` region, in document order.
 *
 * The surrounding newlines the block owns (§1) are folded into the region so that removing it
 * reproduces the pristine text byte-for-byte — otherwise the docId of an injected file would
 * never match the docId it was built with.
 */
export function findFbwRegions(text) {
  const regions = [];
  let i = 0;
  while (i < text.length) {
    const begin = text.indexOf(FENCE_BEGIN_PREFIX, i);
    if (begin === -1) break;
    const beginEnd = text.indexOf('-->', begin);
    if (beginEnd === -1) {
      regions.push({ start: begin, end: text.length, version: null, terminated: false, body: '' });
      break;
    }
    const version = Number.parseInt(text.slice(begin + FENCE_BEGIN_PREFIX.length, beginEnd).trim(), 10);
    const end = text.indexOf(FENCE_END, beginEnd + 3);
    if (end === -1) {
      // Unterminated fence: drop the marker only. Swallowing to EOF would destroy the tail of
      // the document; verify will reject the result loudly instead.
      regions.push({ start: begin, end: beginEnd + 3, version, terminated: false, body: '' });
      i = beginEnd + 3;
      continue;
    }
    let start = begin;
    let stop = end + FENCE_END.length;
    const body = text.slice(begin, stop);
    if (start > 0 && text[start - 1] === '\n') start -= 1;
    if (text[stop] === '\n') stop += 1;
    regions.push({ start, end: stop, version, terminated: true, body });
    i = stop;
  }
  return regions;
}

export function removeRegions(text, regions) {
  if (regions.length === 0) return text;
  let out = '';
  let last = 0;
  for (const r of regions) {
    out += text.slice(last, r.start);
    last = r.end;
  }
  return out + text.slice(last);
}

const REGION_LAYOUT = new RegExp(
  '^\\n?<!--fbw:begin (\\d+)-->' +
  '\\n<script type="application/json" id="fbw-state">([\\s\\S]*?)</script>' +
  '\\n<script id="fbw-core">([\\s\\S]*?)</script>' +
  '\\n<!--fbw:end-->\\n?$'
);

/** Parse one region against the fixed §1 layout. Returns null if the layout has drifted. */
export function parseRegion(text, region) {
  const m = REGION_LAYOUT.exec(text.slice(region.start, region.end));
  if (!m) return null;
  return { version: Number.parseInt(m[1], 10), island: m[2], runtime: m[3] };
}

export function countOccurrences(text, needle) {
  let n = 0;
  let i = 0;
  while (true) {
    const found = text.indexOf(needle, i);
    if (found === -1) return n;
    n++;
    i = found + needle.length;
  }
}

/**
 * Every element in the document, with comment and script/style bodies handled correctly.
 * Used only by the prior-generation stripper.
 */
export function scanElements(text) {
  const elements = [];
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    if (text.startsWith('<!--', lt)) {
      const e = text.indexOf('-->', lt + 4);
      i = e === -1 ? text.length : e + 3;
      continue;
    }
    if (text.startsWith('<!', lt) || text.startsWith('<?', lt)) {
      const e = text.indexOf('>', lt);
      i = e === -1 ? text.length : e + 1;
      continue;
    }
    const head = text.slice(lt, lt + 64);
    const close = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>/.exec(head);
    if (close) {
      const name = close[1].toLowerCase();
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) {
          stack[k].end = lt + close[0].length;
          elements.push(stack[k]);
          stack.length = k;
          break;
        }
      }
      i = lt + close[0].length;
      continue;
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(head);
    if (!open) { i = lt + 1; continue; }
    const name = open[1].toLowerCase();
    const openEnd = findTagEnd(text, lt);
    if (openEnd === -1) break;
    const el = { name, openStart: lt, openEnd, end: openEnd };
    if (name === 'script' || name === 'style') {
      const closeRe = new RegExp('</' + name + '\\s*>', 'gi');
      closeRe.lastIndex = openEnd;
      const m = closeRe.exec(text);
      el.end = m ? m.index + m[0].length : text.length;
      elements.push(el);
      i = el.end;
      continue;
    }
    if (VOID_ELEMENTS.has(name) || text[openEnd - 2] === '/') {
      elements.push(el);
    } else {
      stack.push(el);
    }
    i = openEnd;
  }
  for (const el of stack) elements.push(el); // unclosed: treated as just its open tag
  elements.sort((a, b) => a.openStart - b.openStart);
  return elements;
}

/** Every HTML comment in the document, as {start, end}. */
export function scanComments(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('<!--', i);
    if (start === -1) break;
    const found = text.indexOf('-->', start + 4);
    const end = found === -1 ? text.length : found + 3;
    out.push({ start, end });
    i = end;
  }
  return out;
}
