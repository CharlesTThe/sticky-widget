// In-memory store for entries submitted during the current page session.
//
// Entries are cleared on page reload. This module exists so the widget can
// expose `getEntries()` for inspection/testing without forcing consumers to
// wire up persistence. For durable storage, configure `postUrl` and run the
// included Express router, or pass `onSubmit` and persist however you like.
//
// Real localStorage/IndexedDB persistence with a retry queue is tracked as a
// community contribution opportunity — see GitHub issues.

let entries = [];

export function add(entry) {
  entries.push(entry);
  return entry;
}

export function getAll() {
  return [...entries];
}

export function clear() {
  entries = [];
}
