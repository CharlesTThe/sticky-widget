/**
 * Build a stable CSS selector path for a given element.
 */
export function build(el) {
  if (!el || el === document.body || el === document.documentElement) {
    return el ? el.tagName.toLowerCase() : '';
  }

  // If element has a unique ID, use it directly
  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
    return `#${CSS.escape(el.id)}`;
  }

  const parts = [];
  let current = el;

  while (current && current !== document.body && current !== document.documentElement) {
    let segment = current.tagName.toLowerCase();

    if (current.id && document.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    // Use data-sticky-id if present
    const fbId = current.getAttribute('data-sticky-id');
    if (fbId) {
      parts.unshift(`[data-sticky-id="${fbId}"]`);
      break;
    }

    // Add nth-child for disambiguation among same-tag siblings
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current.tagName
      );
      if (siblings.length > 1) {
        segment += `:nth-child(${Array.from(parent.children).indexOf(current) + 1})`;
      }
    }

    parts.unshift(segment);
    current = current.parentElement;
  }

  return parts.join(' > ');
}
