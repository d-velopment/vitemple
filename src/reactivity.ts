/**
 * Provides the browser-side reactive store runtime as source text for the compiler to embed in generated pages.
 * Store persistence and subscriptions remain inside this runtime, so compiled pages do not need a separate runtime file.
 */
// ----------------------------------------------------------------- Embedded browser store runtime
// Generates the self-contained browser store module embedded by the compiler.
export const reactivityRuntime = (storageKey = "vitemple-store") => `
  // ----------------------------------------------------------------- Store creation and session restoration
  // Creates the single store instance shared by scripts in the compiled page.
  const store = (() => {
    const storageKey = ${JSON.stringify(storageKey)};
    let current = {};

    try {
      const saved = sessionStorage.getItem(storageKey);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          current = parsed;
        }
      }
    } catch {}

    // Saves the latest store value to this tab's session storage when available.
    const persist = (value) => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(value));
      } catch {}
    };

    const listeners = new Set();

    return {
      // Exposes the current state object to scripts that read the store.
      get value() {
        return current;
      },

      // Replaces state, persists it, and notifies subscribers when its identity changes.
      set value(next) {
        if (!Object.is(current, next)) {
          current = next;
          persist(current);
          listeners.forEach(
            // Sends the current state to each registered subscriber.
            (listener) => listener(current),
          );
        }
      },

      // Replaces the store value through the public store API.
      set(next) {
        this.value = next;
      },

      // Initializes only keys absent from the current or session-restored state.
      init(initial) {
        const next = { ...current };
        let changed = false;

        for (const key of Object.keys(initial)) {

          if (!Object.prototype.hasOwnProperty.call(current, key)) {
            next[key] = initial[key];
            changed = true;
          }

        }

        if (changed) {
          this.value = next;
        }
      },

      // Computes a new state object from the current value and stores it.
      update(updater) {
        this.value = updater(current);
      },

      // Registers and immediately calls a subscriber, returning a function to remove it.
      subscribe(listener) {
        listeners.add(listener);
        listener(current);

        // Removes this listener from future store notifications.
        return () => listeners.delete(listener);
      },
    };
  })();

  export { store };
`;
