// The state island: build, escape, parse, validate, merge (§3, §5).

// 2 — a comment may now carry a `rewrite`, a change to the host element's own text. The bump
// is not cosmetic: a v1 runtime reading a v2 file would preserve the key and never apply it,
// so the page would show the original wording while the file and the JSON export both say it
// was changed. Silently showing the wrong text is worse than refusing the file, so the
// version says plainly that this file needs a runtime that understands rewrites.
export const STATE_VERSION = 2;
export const POSITIONS = ['bottom-right', 'bottom-left'];

const STATE_KEYS = ['v', 'docId', 'title', 'tool', 'config', 'comments', 'tombstones'];
const COMMENT_KEYS = [
  'id', 'schemaVersion', 'createdAt', 'updatedAt',
  'author', 'text', 'originalText', 'resolved', 'toolBuild', 'rewrite', 'anchor',
];
const CONFIG_KEYS = ['accent', 'position', 'captureConsole', 'author', 'endpoint', 'writeKey'];

const DOCID_RE = /^[0-9a-f]{16}$/;
// §6 mints ids by prefixing the prior-generation id with `c-`, which is not necessarily
// 12 hex digits, so the shape check is structural rather than the generator's exact format.
const COMMENT_ID_RE = /^c-[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
// The build hash: sha256 of the embedded runtime, first 12 hex. It is what ties a comment to
// the exact widget that wrote it, which is the only version claim here that cannot drift —
// a semver in package.json can be forgotten, the bytes cannot.
const BUILD_RE = /^[0-9a-f]{12}$/;

/**
 * §3 — escaping `<` and `>` is sufficient and complete: it makes `</script`, `<!--` and `]]>`
 * unrepresentable in the island by construction. Do not narrow this.
 */
export function escapeIsland(json) {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** Reorder to the documented key order, keeping unknown keys so a newer file loses nothing. */
function ordered(value, knownKeys) {
  const out = {};
  for (const k of knownKeys) if (Object.hasOwn(value, k)) out[k] = value[k];
  for (const k of Object.keys(value)) if (!knownKeys.includes(k)) out[k] = value[k];
  return out;
}

export function normaliseComment(comment) {
  const out = ordered(comment, COMMENT_KEYS);
  // Written explicitly, including as null, so that every comment in an island has the same
  // key set whatever version wrote it. A v1 comment read on upgrade gains both as null here.
  if (!Object.hasOwn(out, 'toolBuild')) out.toolBuild = null;
  if (!Object.hasOwn(out, 'rewrite')) out.rewrite = null;
  if (out.rewrite && typeof out.rewrite === 'object' && !Array.isArray(out.rewrite)) {
    out.rewrite = ordered(out.rewrite, ['from', 'to', 'at']);
  }
  if (out.anchor && typeof out.anchor === 'object' && !Array.isArray(out.anchor)) {
    out.anchor = ordered(out.anchor, ['tag', 'id', 'path', 'aria', 'sig', 'quote', 'hint']);
  }
  return out;
}

export function buildState({ docId, title, tool = null, config, comments, tombstones, extras = {} }) {
  const state = {
    v: STATE_VERSION,
    docId,
    title: title ?? null,
    tool: tool === null ? null : ordered(tool, ['name', 'version', 'build']),
    config: ordered(config, CONFIG_KEYS),
    comments: comments.map(normaliseComment),
    tombstones: tombstones.map((t) => ordered(t, ['id', 'deletedAt'])),
  };
  for (const [k, v] of Object.entries(extras)) {
    if (!STATE_KEYS.includes(k)) state[k] = v;
  }
  return state;
}

export function serialiseState(state) {
  return escapeIsland(JSON.stringify(state));
}

/** §5 merge: union by id, higher `updatedAt` wins, anything tombstoned is removed. */
export function mergeComments(lists, tombstones) {
  const byId = new Map();
  for (const list of lists) {
    for (const c of list) {
      if (!c || typeof c !== 'object' || typeof c.id !== 'string') continue;
      const prev = byId.get(c.id);
      if (!prev || String(c.updatedAt ?? '') > String(prev.updatedAt ?? '')) byId.set(c.id, c);
    }
  }
  const dead = new Set(tombstones.map((t) => t?.id).filter((id) => typeof id === 'string'));
  return [...byId.values()].filter((c) => !dead.has(c.id));
}

export function mergeTombstones(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const t of list) {
      if (!t || typeof t !== 'object' || typeof t.id !== 'string') continue;
      if (!byId.has(t.id)) byId.set(t.id, t);
    }
  }
  return [...byId.values()];
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * A rewrite records one change to the host element's own text: what it said when the reviewer
 * opened it, and what they typed instead. `from` is kept for the whole life of the entry —
 * it is what Revert restores, what the export diffs, and the only evidence of the original
 * wording once the page is showing the new text.
 */
function validateRewrite(rewrite, where, problems) {
  if (!isPlainObject(rewrite)) {
    problems.push(`${where}.rewrite must be null or an object`);
    return;
  }
  for (const key of ['from', 'to']) {
    if (typeof rewrite[key] !== 'string') problems.push(`${where}.rewrite.${key} must be a string`);
  }
  if (typeof rewrite.at !== 'string' || !ISO_RE.test(rewrite.at)) {
    problems.push(`${where}.rewrite.at ${JSON.stringify(rewrite.at)} is not an ISO-8601 UTC timestamp`);
  }
  if (rewrite.from === rewrite.to) {
    // A rewrite that changes nothing is not a record of anything, and it would draw a
    // "text changed" badge on an element whose text is exactly as the author wrote it.
    problems.push(`${where}.rewrite.from and .to are identical, so nothing was rewritten`);
  }
}

function validateAnchor(anchor, where, problems) {
  if (!isPlainObject(anchor)) {
    problems.push(`${where}.anchor is not an object`);
    return;
  }
  for (const [key, ok] of [
    ['tag', (v) => v === null || typeof v === 'string'],
    ['id', (v) => v === null || typeof v === 'string'],
    ['path', (v) => v === null || typeof v === 'string'],
    ['aria', (v) => v === null || typeof v === 'string'],
    ['sig', (v) => v === null || typeof v === 'string'],
  ]) {
    if (Object.hasOwn(anchor, key) && !ok(anchor[key])) {
      problems.push(`${where}.anchor.${key} must be a string or null`);
    }
  }
  if (Object.hasOwn(anchor, 'quote') && anchor.quote !== null) {
    if (!isPlainObject(anchor.quote) || typeof anchor.quote.exact !== 'string') {
      problems.push(`${where}.anchor.quote must be null or carry a string "exact"`);
    }
  }
  if (Object.hasOwn(anchor, 'hint') && anchor.hint !== null && !isPlainObject(anchor.hint)) {
    problems.push(`${where}.anchor.hint must be null or an object`);
  }
  const locators = [anchor.id, anchor.path, anchor.aria, anchor.sig, anchor.quote?.exact];
  if (!locators.some((l) => typeof l === 'string' && l !== '')) {
    problems.push(`${where}.anchor carries no usable locator`);
  }
}

/** Invariant 6: `state.v === STATE_VERSION` and every comment satisfies the Comment shape. */
export function validateState(state) {
  const problems = [];
  if (!isPlainObject(state)) return ['state is not a JSON object'];
  if (state.v !== STATE_VERSION) problems.push(`state.v is ${JSON.stringify(state.v)}, expected ${STATE_VERSION}`);
  if (typeof state.docId !== 'string' || !DOCID_RE.test(state.docId)) {
    problems.push(`state.docId ${JSON.stringify(state.docId)} is not 16 lowercase hex characters`);
  }
  if (!(state.title === null || typeof state.title === 'string')) {
    problems.push('state.title must be a string or null');
  }

  if (state.tool !== null && state.tool !== undefined) {
    if (!isPlainObject(state.tool)) {
      problems.push('state.tool must be an object or null');
    } else {
      if (typeof state.tool.name !== 'string') problems.push('state.tool.name must be a string');
      if (!(state.tool.version === null || typeof state.tool.version === 'string')) {
        problems.push('state.tool.version must be a string or null');
      }
      if (typeof state.tool.build !== 'string' || !BUILD_RE.test(state.tool.build)) {
        problems.push(`state.tool.build ${JSON.stringify(state.tool.build)} is not 12 lowercase hex characters`);
      }
    }
  }

  if (!isPlainObject(state.config)) {
    problems.push('state.config is not an object');
  } else {
    const { accent, position, captureConsole } = state.config;
    if (!(accent === null || typeof accent === 'string')) problems.push('state.config.accent must be a string or null');
    if (!POSITIONS.includes(position)) problems.push(`state.config.position must be one of ${POSITIONS.join(', ')}`);
    if (typeof captureConsole !== 'boolean') problems.push('state.config.captureConsole must be a boolean');
    const { endpoint } = state.config;
    if (endpoint !== undefined && !(typeof endpoint === 'string' && /^https?:\/\/\S+$/.test(endpoint))) {
      problems.push('state.config.endpoint must be an absolute http(s) URL');
    }
    const { writeKey } = state.config;
    if (writeKey !== undefined && !(typeof writeKey === 'string' && /^[!-~]{1,200}$/.test(writeKey))) {
      problems.push('state.config.writeKey must be printable ASCII without spaces');
    }
  }

  if (!Array.isArray(state.comments)) {
    problems.push('state.comments is not an array');
  } else {
    state.comments.forEach((c, i) => {
      const where = `comments[${i}]`;
      if (!isPlainObject(c)) {
        problems.push(`${where} is not an object`);
        return;
      }
      if (typeof c.id !== 'string' || !COMMENT_ID_RE.test(c.id)) {
        problems.push(`${where}.id ${JSON.stringify(c.id)} is not a "c-…" identifier`);
      }
      if (c.schemaVersion !== 1) problems.push(`${where}.schemaVersion must be 1`);
      for (const key of ['createdAt', 'updatedAt']) {
        if (typeof c[key] !== 'string' || !ISO_RE.test(c[key])) {
          problems.push(`${where}.${key} ${JSON.stringify(c[key])} is not an ISO-8601 UTC timestamp`);
        }
      }
      if (!(c.author === null || isPlainObject(c.author))) problems.push(`${where}.author must be an object or null`);
      if (typeof c.text !== 'string') problems.push(`${where}.text must be a string`);
      if (!(c.originalText === null || typeof c.originalText === 'string')) {
        problems.push(`${where}.originalText must be a string or null`);
      }
      if (typeof c.resolved !== 'boolean') problems.push(`${where}.resolved must be a boolean`);
      if (Object.hasOwn(c, 'toolBuild') && c.toolBuild !== null) {
        if (typeof c.toolBuild !== 'string' || !BUILD_RE.test(c.toolBuild)) {
          problems.push(`${where}.toolBuild ${JSON.stringify(c.toolBuild)} is not 12 lowercase hex characters or null`);
        }
      }
      if (Object.hasOwn(c, 'rewrite') && c.rewrite !== null) validateRewrite(c.rewrite, where, problems);
      validateAnchor(c.anchor, where, problems);
    });
    const seen = new Set();
    for (const c of state.comments) {
      if (isPlainObject(c) && typeof c.id === 'string') {
        if (seen.has(c.id)) problems.push(`duplicate comment id ${c.id}`);
        seen.add(c.id);
      }
    }
  }

  if (!Array.isArray(state.tombstones)) {
    problems.push('state.tombstones is not an array');
  } else {
    state.tombstones.forEach((t, i) => {
      if (!isPlainObject(t) || typeof t.id !== 'string') {
        problems.push(`tombstones[${i}] must carry a string id`);
        return;
      }
      if (typeof t.deletedAt !== 'string' || !ISO_RE.test(t.deletedAt)) {
        problems.push(`tombstones[${i}].deletedAt is not an ISO-8601 UTC timestamp`);
      }
    });
  }

  return problems;
}
