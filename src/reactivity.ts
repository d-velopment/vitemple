/** Browser runtime emitted as a normal ES module. */
export const reactivityRuntime = (storageKey = 'vitemple-store') => `
  const store = (() => {
    const storageKey = ${JSON.stringify(storageKey)};
    let current = {};
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
      }
    } catch {}
    const persist = (value) => {
      try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch {}
    };
    const listeners = new Set();
    return {
      get value() { return current; },
      set value(next) { if (!Object.is(current, next)) { current = next; persist(current); listeners.forEach((listener) => listener(current)); } },
      set(next) { this.value = next; },
      init(initial) {
        const next = { ...current };
        let changed = false;
        for (const key of Object.keys(initial)) {
          if (!Object.prototype.hasOwnProperty.call(current, key)) {
            next[key] = initial[key];
            changed = true;
          }
        }
        if (changed) this.value = next;
      },
      update(updater) { this.value = updater(current); },
      subscribe(listener) { listeners.add(listener); listener(current); return () => listeners.delete(listener); }
    };
  })();
  export { store };
`;
