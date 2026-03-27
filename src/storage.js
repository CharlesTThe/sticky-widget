let store = [];

export function add(entry) {
  store.push(entry);
  return entry;
}

export function getAll() {
  return [...store];
}

export function clear() {
  store = [];
}
