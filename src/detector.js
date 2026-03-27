/**
 * Element detector — browser-inspect style.
 *
 * Default: highlights the exact element under the cursor.
 * Scroll wheel: navigate up (parent) / down (child) the DOM tree.
 */

let _depthOffset = 0;   // positive = walk up, negative = not used (can't go deeper than leaf)
let _leafEl = null;      // the raw elementFromPoint result

/**
 * Build the ancestor chain from leaf up to (but excluding) body/html.
 */
function ancestorChain(el) {
  const chain = [];
  let cur = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    chain.push(cur);
    cur = cur.parentElement;
  }
  return chain; // [leaf, parent, grandparent, ...]
}

/**
 * Set the leaf element (called on mousemove when cursor hits a new element).
 * Resets depth offset so highlight snaps to the element directly under cursor.
 */
export function setLeaf(el) {
  if (el !== _leafEl) {
    _leafEl = el;
    _depthOffset = 0;
  }
}

/**
 * Adjust depth: +1 = select parent, -1 = select child (toward leaf).
 * Returns the newly resolved element, or null.
 */
export function adjustDepth(delta) {
  _depthOffset = Math.max(0, _depthOffset + delta);
  return resolve();
}

/**
 * Resolve current target based on leaf + depth offset.
 */
export function resolve() {
  if (!_leafEl) return null;

  // Opt-in check: if any ancestor has data-sticky-id and depth lands on it, prefer it
  const chain = ancestorChain(_leafEl);
  if (chain.length === 0) return null;

  const idx = Math.min(_depthOffset, chain.length - 1);
  _depthOffset = idx; // clamp so it doesn't drift past root
  return chain[idx];
}

export function clearCache() {
  _depthOffset = 0;
  _leafEl = null;
}
