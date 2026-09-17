/** Browser runtime emitted as a normal ES module. */
export const reactivityRuntime = `
  let current = {};
  const listeners = new Set();
  export const store = {
    get value() { return current; },
    set value(next) { if (!Object.is(current, next)) { current = next; listeners.forEach((listener) => listener(current)); } },
    set(next) { this.value = next; },
    update(updater) { this.value = updater(current); },
    subscribe(listener) { listeners.add(listener); listener(current); return () => listeners.delete(listener); }
  };
`;
