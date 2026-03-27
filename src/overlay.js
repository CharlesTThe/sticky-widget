let overlayEl = null;
let highlightEl = null;

export function createOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.className = 'fbw-overlay';
  document.body.appendChild(overlayEl);
}

export function removeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  removeHighlight();
}

export function showHighlight(rect) {
  if (!highlightEl) {
    highlightEl = document.createElement('div');
    highlightEl.className = 'fbw-highlight';
    document.body.appendChild(highlightEl);
  }
  highlightEl.style.top = rect.top + 'px';
  highlightEl.style.left = rect.left + 'px';
  highlightEl.style.width = rect.width + 'px';
  highlightEl.style.height = rect.height + 'px';
}

export function removeHighlight() {
  if (highlightEl) {
    highlightEl.remove();
    highlightEl = null;
  }
}
