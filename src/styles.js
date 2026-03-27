// CSS for elements inside the Shadow DOM (FAB, popover, confirm, toast)
const SHADOW_CSS = `
.fbw-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  transition: background-color 0.2s, transform 0.15s;
  font-size: 20px;
  line-height: 1;
  color: #fff;
}
.fbw-fab:hover { transform: scale(1.08); }
.fbw-fab:focus-visible { outline: 2px solid #f5c518; outline-offset: 3px; box-shadow: 0 0 0 4px rgba(245,197,24,0.35); }
.fbw-fab--idle { background-color: #f5c518; color: #000; }
.fbw-fab--active { background-color: #dc2626; }

.fbw-popover {
  position: fixed;
  z-index: var(--fbw-z-popover, 99995);
  width: 320px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.18);
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #1f2937;
}

.fbw-popover__label {
  font-weight: 600;
  margin-bottom: 4px;
  font-size: 13px;
  color: #6b7280;
}

.fbw-popover__selected-text {
  background: #fef3c7;
  border-left: 3px solid #f59e0b;
  padding: 6px 10px;
  margin-bottom: 10px;
  font-size: 13px;
  border-radius: 2px;
  max-height: 60px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}

.fbw-popover__textarea {
  width: 100%;
  min-height: 80px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
  background: #f5c518;
  color: #000;
}
.fbw-popover__textarea:focus {
  border-color: var(--fbw-accent, #4f46e5);
  box-shadow: 0 0 0 2px rgba(79,70,229,0.15);
}

.fbw-popover__hint {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  text-align: right;
}

.fbw-popover__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.fbw-popover__btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  transition: background 0.15s;
}
.fbw-popover__btn:hover { background: #f3f4f6; }
.fbw-popover__btn:focus-visible { outline: 2px solid var(--fbw-accent, #4f46e5); outline-offset: 2px; }

.fbw-popover__btn--submit {
  background: var(--fbw-accent, #4f46e5);
  color: #fff;
  border-color: transparent;
}
.fbw-popover__btn--submit:hover { opacity: 0.9; background: var(--fbw-accent, #4f46e5); }
.fbw-popover__btn--submit:disabled { opacity: 0.5; cursor: not-allowed; }

.fbw-toast {
  position: fixed;
  bottom: 84px;
  right: 24px;
  background: #059669;
  color: #fff;
  padding: 10px 18px;
  border-radius: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: var(--fbw-z-popover, 99995);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.2s, transform 0.2s;
}
.fbw-toast--visible { opacity: 1; transform: translateY(0); }
.fbw-toast--error { background: #dc2626; }

.fbw-confirm {
  position: fixed;
  z-index: var(--fbw-z-popover, 99995);
  width: 320px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.18);
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #1f2937;
}
.fbw-confirm__title {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 8px;
}
.fbw-confirm__message {
  color: #6b7280;
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.5;
}
.fbw-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
`;

// CSS for elements in the light DOM (overlay, highlight, crosshair cursor)
const LIGHT_CSS = `
.fbw-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.08);
  pointer-events: none;
  z-index: var(--fbw-z, 99990);
}

.fbw-highlight {
  position: fixed;
  border: 2px solid var(--fbw-accent, #4f46e5);
  background: rgba(79, 70, 229, 0.08);
  pointer-events: none;
  z-index: var(--fbw-z-highlight, 99991);
  transition: top 0.12s, left 0.12s, width 0.12s, height 0.12s;
  border-radius: 4px;
}

.fbw-cursor-crosshair, .fbw-cursor-crosshair * { cursor: crosshair !important; }
`;

let shadowTarget = null;

export function injectCSS(shadowRoot) {
  // Check DOM directly instead of boolean flags — resilient to external host removal
  if (shadowRoot && !shadowRoot.querySelector('style[data-fbw]')) {
    shadowTarget = shadowRoot;
    const style = document.createElement('style');
    style.setAttribute('data-fbw', '');
    style.textContent = SHADOW_CSS;
    shadowRoot.appendChild(style);
  }

  if (!document.querySelector('style[data-fbw-light]')) {
    const style = document.createElement('style');
    style.setAttribute('data-fbw-light', '');
    style.textContent = LIGHT_CSS;
    document.head.appendChild(style);
  }
}

export function removeCSS() {
  if (shadowTarget) {
    const el = shadowTarget.querySelector('style[data-fbw]');
    if (el) el.remove();
    shadowTarget = null;
  }
  const lightEl = document.querySelector('style[data-fbw-light]');
  if (lightEl) lightEl.remove();
}
