import { injectCSS, removeCSS } from './styles.js';
import * as detector from './detector.js';
import * as overlay from './overlay.js';
import * as popover from './popover.js';
import * as selection from './selection.js';
import * as selectorGen from './selector-generator.js';
import * as store from './storage.js';
import * as consoleCapture from './console-capture.js';

const STATES = { IDLE: 'IDLE', ACTIVE: 'ACTIVE', POPOVER_OPEN: 'POPOVER_OPEN' };

let state = STATES.IDLE;
let config = {};
let fabEl = null;
let currentTarget = null;
let rafId = null;
let shadowHost = null;
let shadow = null;
let initialized = false;
let destroying = false;
let pendingBoot = null;
let toastTimers = [];

// Bound handlers (for cleanup)
let onMouseMove = null;
let onClickCapture = null;
let onKeyDown = null;
let onMouseUp = null;
let onWheel = null;
let _pendingSelection = null;

function setState(next) {
  state = next;
}

function createFAB() {
  fabEl = document.createElement('button');
  fabEl.className = 'fbw-fab fbw-fab--idle';
  fabEl.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  fabEl.setAttribute('aria-label', 'Toggle sticky widget');
  fabEl.style.zIndex = (config.zIndexBase || 99999) + '';

  fabEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state === STATES.IDLE) {
      enterActiveMode();
    } else {
      exitToIdle();
    }
  });

  if (config.position === 'bottom-left') {
    fabEl.style.right = 'auto';
    fabEl.style.left = '24px';
  }

  shadow.appendChild(fabEl);
}

function enterActiveMode() {
  if (!initialized || !fabEl) return;
  setState(STATES.ACTIVE);
  fabEl.className = 'fbw-fab fbw-fab--active';
  fabEl.style.zIndex = (config.zIndexBase || 99999) + '';
  document.documentElement.classList.add('fbw-cursor-crosshair');
  overlay.createOverlay();
  bindListeners();
  if (config.onOpen) config.onOpen();
}

function exitToIdle() {
  setState(STATES.IDLE);
  if (fabEl) {
    fabEl.className = 'fbw-fab fbw-fab--idle';
    fabEl.style.zIndex = (config.zIndexBase || 99999) + '';
  }
  document.documentElement.classList.remove('fbw-cursor-crosshair');
  overlay.removeOverlay();
  popover.remove();
  unbindListeners();
  currentTarget = null;
  detector.clearCache();
  if (config.onClose) config.onClose();
}

function bindListeners() {
  let lastHighlighted = null;

  function updateHighlight() {
    const target = detector.resolve();
    if (target && target !== lastHighlighted) {
      lastHighlighted = target;
      overlay.showHighlight(target.getBoundingClientRect());
    } else if (!target) {
      overlay.removeHighlight();
      lastHighlighted = null;
    }
  }

  onMouseMove = (e) => {
    if (state !== STATES.ACTIVE) return;
    if (rafId !== null) return; // throttle to rAF
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (state !== STATES.ACTIVE) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === shadowHost || el === fabEl || el.closest('.fbw-popover') || el.closest('.fbw-fab') || el.closest('.fbw-confirm')) {
        overlay.removeHighlight();
        lastHighlighted = null;
        return;
      }

      detector.setLeaf(el);
      updateHighlight();
    });
  };

  // Scroll wheel: navigate up/down DOM tree (like browser inspect)
  onWheel = (e) => {
    if (state !== STATES.ACTIVE) return;
    e.preventDefault();
    e.stopPropagation();
    // scroll up = select parent (+1), scroll down = select child (-1)
    const delta = e.deltaY > 0 ? 1 : -1;
    detector.adjustDepth(delta);
    updateHighlight();
  };

  onClickCapture = (e) => {
    if (e.target === shadowHost) return;

    if (state === STATES.ACTIVE) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      detector.setLeaf(el);
      currentTarget = detector.resolve();
      if (!currentTarget) return;

      const rect = currentTarget.getBoundingClientRect();
      const selectedText = _pendingSelection;
      _pendingSelection = null;

      overlay.showHighlight(rect);
      setState(STATES.POPOVER_OPEN);

      popover.show(
        rect,
        selectedText ? selectedText.text : null,
        ({ comment }) => {
          submitEntry(comment, selectedText ? selectedText.text : null);
        },
        () => {
          popover.remove();
          setState(STATES.ACTIVE);
        }
      );
    } else if (state === STATES.POPOVER_OPEN) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const canClose = popover.attemptClose(
        ({ comment }) => {
          submitEntry(comment, null);
        },
        () => {
          popover.remove();
          setState(STATES.ACTIVE);
        }
      );

      if (canClose) {
        popover.remove();
        setState(STATES.ACTIVE);
      }
    }
  };

  onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (popover.isConfirmOpen()) return;
      if (state === STATES.POPOVER_OPEN) {
        const canClose = popover.attemptClose(
          ({ comment }) => {
            submitEntry(comment, null);
          },
          () => {
            popover.remove();
            setState(STATES.ACTIVE);
          }
        );
        if (canClose) {
          popover.remove();
          setState(STATES.ACTIVE);
        }
      } else if (state === STATES.ACTIVE) {
        exitToIdle();
      }
    }
  };

  onMouseUp = () => {
    if (state !== STATES.ACTIVE) return;
    _pendingSelection = selection.capture();
  };

  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mousemove', onMouseMove, false);
  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('keydown', onKeyDown, false);
}

function unbindListeners() {
  if (onMouseUp) document.removeEventListener('mouseup', onMouseUp, true);
  if (onMouseMove) document.removeEventListener('mousemove', onMouseMove, false);
  if (onWheel) document.removeEventListener('wheel', onWheel, true);
  if (onClickCapture) document.removeEventListener('click', onClickCapture, true);
  if (onKeyDown) document.removeEventListener('keydown', onKeyDown, false);
  onMouseUp = null;
  onMouseMove = null;
  onWheel = null;
  onClickCapture = null;
  onKeyDown = null;
  _pendingSelection = null;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function collectMetadata() {
  return {
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screenSize: `${screen.width}x${screen.height}`,
    language: navigator.language,
    url: window.location.href,
    referrer: document.referrer || null,
    timestamp: new Date().toISOString(),
  };
}

function submitEntry(comment, selectedText) {
  if (!initialized || !currentTarget) return;

  // Guard against detached DOM nodes (e.g. React re-render removed the element)
  if (!document.contains(currentTarget)) {
    popover.remove();
    exitToIdle();
    return;
  }

  const rect = currentTarget.getBoundingClientRect();
  const label = currentTarget.getAttribute('aria-label')
    || currentTarget.getAttribute('data-sticky-id')
    || (currentTarget.innerText || '').slice(0, 80).trim()
    || null;

  const entry = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'stw-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    timestamp: new Date().toISOString(),
    pageUrl: window.location.href,
    target: {
      selector: selectorGen.build(currentTarget),
      tagName: currentTarget.tagName.toLowerCase(),
      id: currentTarget.id || null,
      label: label,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    },
    selectedText: selectedText || null,
    comment: comment,
    metadata: collectMetadata(),
    consoleLogs: consoleCapture.getEntries(),
  };

  // Attach user info if provided via config
  if (config.user) {
    entry.user = {
      name: config.user.name || null,
      email: config.user.email || null,
    };
  }

  store.add(entry);
  if (config.onSubmit) config.onSubmit(entry);

  if (config.postUrl) {
    fetch(config.postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        showToast('Submitted. Thank you!');
      })
      .catch((err) => {
        console.warn('[StickyWidget] POST failed:', err);
        showToast('Failed to submit. Please try again.', true);
        if (config.onError) config.onError(err, entry);
      });
  } else {
    showToast('Recorded. Thank you!');
  }

  popover.remove();
  exitToIdle();
}

function showToast(message, isError = false) {
  if (!shadow) return;

  const toast = document.createElement('div');
  toast.className = 'fbw-toast' + (isError ? ' fbw-toast--error' : '');
  toast.textContent = message;

  if (config.position === 'bottom-left') {
    toast.style.right = 'auto';
    toast.style.left = '24px';
  }

  shadow.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('fbw-toast--visible');
  });

  const fadeTimer = setTimeout(() => {
    toast.classList.remove('fbw-toast--visible');
    const removeTimer = setTimeout(() => toast.remove(), 200);
    toastTimers.push(removeTimer);
  }, 2500);
  toastTimers.push(fadeTimer);
}

// --- Public API ---

function init(options = {}) {
  // Guard against double init — destroy previous instance first
  if (initialized) destroy();

  config = { ...options };

  const boot = () => {
    pendingBoot = null;

    // Create Shadow DOM host
    shadowHost = document.createElement('div');
    shadowHost.id = 'fbw-root';
    shadowHost.style.position = 'fixed';
    shadowHost.style.top = '0';
    shadowHost.style.left = '0';
    shadowHost.style.width = '0';
    shadowHost.style.height = '0';
    shadowHost.style.overflow = 'visible';
    shadowHost.style.zIndex = (config.zIndexBase || 99999) + '';
    document.body.appendChild(shadowHost);
    shadow = shadowHost.attachShadow({ mode: 'open' });

    // Set CSS custom properties on the shadow host (for shadow DOM elements)
    // and on documentElement (for light DOM overlay/highlight)
    if (config.accentColor) {
      shadowHost.style.setProperty('--fbw-accent', config.accentColor);
      document.documentElement.style.setProperty('--fbw-accent', config.accentColor);
    }
    if (config.zIndexBase) {
      shadowHost.style.setProperty('--fbw-z-popover', (config.zIndexBase + 5) + '');
      document.documentElement.style.setProperty('--fbw-z', config.zIndexBase + '');
      document.documentElement.style.setProperty('--fbw-z-highlight', (config.zIndexBase + 1) + '');
    }

    // Inject CSS into shadow root (isolated from host page)
    injectCSS(shadow);

    // Tell popover module to render inside shadow root
    popover.setContainer(shadow);

    createFAB();

    // Install console capture by default (can be disabled via config)
    if (config.captureConsole !== false) {
      consoleCapture.install();
    }

    initialized = true;
  };

  // Guard against calling init() before DOM is ready (async script loading)
  if (document.readyState === 'loading') {
    pendingBoot = boot;
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

function open() {
  if (!initialized) return;
  if (state === STATES.IDLE) enterActiveMode();
}

function close() {
  if (!initialized) return;
  if (state !== STATES.IDLE) exitToIdle();
}

function getEntries() {
  return store.getAll();
}

function clearEntries() {
  store.clear();
}

function destroy() {
  // Cancel pending boot if destroy() called before DOMContentLoaded
  if (pendingBoot) {
    document.removeEventListener('DOMContentLoaded', pendingBoot);
    pendingBoot = null;
  }

  if (!initialized || destroying) return;
  destroying = true;

  exitToIdle();

  // Clear pending toast timers
  toastTimers.forEach(t => clearTimeout(t));
  toastTimers = [];

  if (fabEl) {
    fabEl.remove();
    fabEl = null;
  }
  removeCSS();
  consoleCapture.uninstall();
  consoleCapture.clear();
  document.documentElement.style.removeProperty('--fbw-accent');
  document.documentElement.style.removeProperty('--fbw-z');
  document.documentElement.style.removeProperty('--fbw-z-highlight');
  if (shadowHost) {
    shadowHost.remove();
    shadowHost = null;
    shadow = null;
  }

  initialized = false;
  destroying = false;
}

const StickyWidget = { init, open, close, getEntries, clearEntries, destroy };

export default StickyWidget;
