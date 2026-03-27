/**
 * Capture current text selection, if any.
 * Returns { text, anchorNode, focusNode } or null.
 */
export function capture() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;

  return {
    text: sel.toString().trim(),
    rangeCount: sel.rangeCount,
  };
}
