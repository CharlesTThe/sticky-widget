let popoverEl = null;
let confirmEl = null;
let focusTrapHandler = null;
let container = document.body;
let shadowRootRef = null;

/**
 * Set the container where popover/confirm elements are appended.
 * Call once during init with the shadow root.
 */
export function setContainer(root) {
  container = root;
  shadowRootRef = root;
}

/**
 * Show the feedback popover near a target element.
 * @param {DOMRect} targetRect - bounding rect of the target
 * @param {string|null} selectedText - pre-selected text, if any
 * @param {Function} onSubmit - called with { comment }
 * @param {Function} onCancel - called on cancel
 */
export function show(targetRect, selectedText, onSubmit, onCancel) {
  remove();

  popoverEl = document.createElement('div');
  popoverEl.className = 'fbw-popover';

  let html = '';

  if (selectedText) {
    html += `<div class="fbw-popover__label">Selected text</div>`;
    html += `<div class="fbw-popover__selected-text">${escapeHtml(selectedText)}</div>`;
  }

  html += `<div class="fbw-popover__label">Your comment</div>`;
  html += `<textarea class="fbw-popover__textarea" placeholder="What's on your mind?" autofocus></textarea>`;
  html += `<div class="fbw-popover__hint">Press Ctrl+Enter to submit</div>`;
  html += `<div class="fbw-popover__actions">`;
  html += `<button class="fbw-popover__btn fbw-popover__btn--cancel" type="button">Cancel</button>`;
  html += `<button class="fbw-popover__btn fbw-popover__btn--submit" type="button" disabled>Submit</button>`;
  html += `</div>`;

  popoverEl.innerHTML = html;
  container.appendChild(popoverEl);

  // Position
  position(popoverEl, targetRect);

  // Wire events
  const textarea = popoverEl.querySelector('.fbw-popover__textarea');
  const submitBtn = popoverEl.querySelector('.fbw-popover__btn--submit');
  const cancelBtn = popoverEl.querySelector('.fbw-popover__btn--cancel');

  textarea.addEventListener('input', () => {
    submitBtn.disabled = !textarea.value.trim();
  });

  let submitted = false;
  const doSubmit = () => {
    if (submitted) return;
    const comment = textarea.value.trim();
    if (!comment) return;
    submitted = true;
    submitBtn.disabled = true;
    onSubmit({ comment });
  };

  // Ctrl+Enter / Cmd+Enter to submit
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doSubmit();
    }
  });

  submitBtn.addEventListener('click', doSubmit);

  cancelBtn.addEventListener('click', () => {
    handleCancelAttempt(textarea, onCancel);
  });

  // Stop clicks inside popover from propagating to document capture listener
  popoverEl.addEventListener('click', (e) => e.stopPropagation());
  popoverEl.addEventListener('mousedown', (e) => e.stopPropagation());

  // Focus trapping
  installFocusTrap(popoverEl);

  // Focus textarea after positioning
  requestAnimationFrame(() => textarea.focus());
}

/**
 * Handle cancel/close attempt — show confirmation if there's unsaved text.
 */
function handleCancelAttempt(textarea, onCancel) {
  if (textarea && textarea.value.trim()) {
    showConfirmDialog(
      'Discard comment?',
      'Your comment will be lost. Press "Submit" to save it.',
      () => { removeConfirm(); onCancel(); },
      () => { removeConfirm(); textarea.focus(); }
    );
  } else {
    onCancel();
  }
}

/**
 * Attempt to close the popover from an outside click.
 * Returns true if close should proceed, false if blocked by confirm dialog.
 */
export function attemptClose(onSubmitCb, onCancel) {
  if (!popoverEl) return true;
  if (confirmEl) return false; // confirm already open

  const textarea = popoverEl.querySelector('.fbw-popover__textarea');
  if (textarea && textarea.value.trim()) {
    showConfirmDialog(
      'Discard comment?',
      'Your comment will be lost. Press "Submit" to save it.',
      () => { removeConfirm(); onCancel(); },
      () => {
        removeConfirm();
        if (textarea) textarea.focus();
      },
      onSubmitCb ? () => {
        removeConfirm();
        const comment = textarea.value.trim();
        if (comment) onSubmitCb({ comment });
      } : null
    );
    return false;
  }
  return true;
}

function showConfirmDialog(title, message, onDiscard, onGoBack, onSubmit) {
  removeConfirm();

  confirmEl = document.createElement('div');
  confirmEl.className = 'fbw-confirm';

  let html = `<div class="fbw-confirm__title">${escapeHtml(title)}</div>`;
  html += `<div class="fbw-confirm__message">${escapeHtml(message)}</div>`;
  html += `<div class="fbw-confirm__actions">`;
  html += `<button class="fbw-popover__btn fbw-popover__btn--cancel" type="button">Discard</button>`;
  if (onSubmit) {
    html += `<button class="fbw-popover__btn fbw-popover__btn--submit" type="button">Submit</button>`;
  }
  html += `<button class="fbw-popover__btn" type="button" style="background:#4f46e5;color:#fff;border-color:transparent;">Go back</button>`;
  html += `</div>`;

  confirmEl.innerHTML = html;

  // Position in center of viewport
  confirmEl.style.top = '50%';
  confirmEl.style.left = '50%';
  confirmEl.style.transform = 'translate(-50%, -50%)';

  container.appendChild(confirmEl);

  const buttons = confirmEl.querySelectorAll('button');
  const discardBtn = buttons[0];
  const submitBtnOrGoBack = onSubmit ? buttons[1] : null;
  const goBackBtn = onSubmit ? buttons[2] : buttons[1];

  discardBtn.addEventListener('click', onDiscard);
  goBackBtn.addEventListener('click', onGoBack);
  if (onSubmit && submitBtnOrGoBack) {
    submitBtnOrGoBack.addEventListener('click', onSubmit);
  }

  // Stop propagation
  confirmEl.addEventListener('click', (e) => e.stopPropagation());
  confirmEl.addEventListener('mousedown', (e) => e.stopPropagation());

  // Focus "Go back" by default (safest action)
  requestAnimationFrame(() => goBackBtn.focus());
}

function removeConfirm() {
  if (confirmEl) {
    confirmEl.remove();
    confirmEl = null;
  }
}

function installFocusTrap(container) {
  uninstallFocusTrap();
  focusTrapHandler = (e) => {
    if (e.key !== 'Tab') return;

    // If confirm dialog is open, trap focus there instead
    const trapTarget = confirmEl || container;
    const focusable = trapTarget.querySelectorAll('textarea, button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // In Shadow DOM, document.activeElement returns the shadow host;
    // use shadowRoot.activeElement to get the actual focused element.
    const active = shadowRootRef ? shadowRootRef.activeElement : document.activeElement;

    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', focusTrapHandler, true);
}

function uninstallFocusTrap() {
  if (focusTrapHandler) {
    document.removeEventListener('keydown', focusTrapHandler, true);
    focusTrapHandler = null;
  }
}

function position(el, targetRect) {
  const pad = 8;
  const gap = 8;

  // Try below
  let top = targetRect.bottom + gap;
  let left = targetRect.left;

  const elRect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // If overflows bottom, place above
  if (top + elRect.height > vh - pad) {
    top = targetRect.top - elRect.height - gap;
  }

  // Clamp top
  if (top < pad) top = pad;

  // If overflows right, shift left
  if (left + elRect.width > vw - pad) {
    left = vw - elRect.width - pad;
  }
  if (left < pad) left = pad;

  el.style.top = top + 'px';
  el.style.left = left + 'px';
}

export function remove() {
  uninstallFocusTrap();
  removeConfirm();
  if (popoverEl) {
    popoverEl.remove();
    popoverEl = null;
  }
}

export function isOpen() {
  return popoverEl !== null;
}

export function isConfirmOpen() {
  return confirmEl !== null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
