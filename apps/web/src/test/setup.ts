import '@testing-library/jest-dom/vitest';

// Node v25+ ships a built-in `localStorage`/`sessionStorage` stub on globalThis
// that is non-functional unless `--localstorage-file` is provided. Vitest 4's
// populateGlobal() skips copying happy-dom's storage objects because the keys
// already exist on the global. Reinstall happy-dom's Storage here so zustand's
// `persist` middleware (and any production code touching localStorage) sees a
// working API.
// Background: vitest-dev/vitest issue 8757.
const StorageCtor = (globalThis as unknown as { Storage?: new () => Storage }).Storage;
if (typeof StorageCtor === 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new StorageCtor(),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new StorageCtor(),
    writable: true,
    configurable: true,
  });
}
