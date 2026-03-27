/**
 * Captures console errors/warnings and unhandled errors.
 * Buffers the last N entries for attachment to submissions.
 */

const MAX_ENTRIES = 50;
let buffer = [];
let installed = false;
let origConsoleError = null;
let origConsoleWarn = null;
let onError = null;
let onUnhandledRejection = null;

function truncate(str, max = 1000) {
  if (typeof str !== 'string') {
    try { str = JSON.stringify(str); } catch { str = String(str); }
  }
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function addEntry(level, args) {
  const entry = {
    level,
    message: Array.from(args).map(a => truncate(a)).join(' '),
    timestamp: new Date().toISOString(),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function install() {
  if (installed) return;
  installed = true;

  // Intercept console.error
  origConsoleError = console.error;
  console.error = function (...args) {
    addEntry('error', args);
    origConsoleError.apply(console, args);
  };

  // Intercept console.warn
  origConsoleWarn = console.warn;
  console.warn = function (...args) {
    addEntry('warn', args);
    origConsoleWarn.apply(console, args);
  };

  // Capture unhandled errors (named reference for cleanup)
  onError = (event) => {
    addEntry('error', [`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`]);
  };
  window.addEventListener('error', onError);

  // Capture unhandled promise rejections (named reference for cleanup)
  onUnhandledRejection = (event) => {
    addEntry('error', [`Unhandled rejection: ${truncate(event.reason)}`]);
  };
  window.addEventListener('unhandledrejection', onUnhandledRejection);
}

export function uninstall() {
  if (!installed) return;
  installed = false;
  if (origConsoleError) console.error = origConsoleError;
  if (origConsoleWarn) console.warn = origConsoleWarn;
  origConsoleError = null;
  origConsoleWarn = null;
  if (onError) window.removeEventListener('error', onError);
  if (onUnhandledRejection) window.removeEventListener('unhandledrejection', onUnhandledRejection);
  onError = null;
  onUnhandledRejection = null;
}

export function getEntries() {
  return [...buffer];
}

export function clear() {
  buffer = [];
}
