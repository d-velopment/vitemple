/**
 * Connects the documentation site's interactive examples and navigation to the Vitemple store.
 * The shared counter persists through Vitemple's store runtime; this module only reflects state
 * into the page and handles user actions.
 */

// ----------------------------------------------------------------- Shared counter rendering and controls
store.init({ ...store.value, counter: 0 });

// Updates every counter display whenever the shared store changes.
store.subscribe(

  /* Handles the callback passed to subscribe. */ (state) => {
    document.querySelectorAll("[data-count]").forEach(

      /* Applies the required side effect to each item in the collection. */ (
        element,
      ) => {
        element.textContent = String(state.counter);
      },

    );
  },

);

// ----------------------------------------------------------------- Counter controls
// Applies the clicked counter button's signed increment to shared state.
document.querySelectorAll<HTMLButtonElement>("[data-counter]").forEach(

  /* Applies the required side effect to each item in the collection. */ (
    button,
  ) => {
    button.addEventListener(
      "click",

      /* Handles the click event and applies its associated interface behavior. */ () =>
        store.update(

          /* Handles the callback passed to update. */ (state) => ({
            ...state,
            counter: state.counter + Number(button.dataset.counter),
          }),

        ),

    );
  },

);

// ----------------------------------------------------------------- Current page navigation
// Marks the sidebar link that points to the page currently being displayed.
document.querySelectorAll<HTMLAnchorElement>(".sidebar [data-page]").forEach(

  /* Applies the required side effect to each item in the collection. */ (
    link,
  ) => {
    if (link.dataset.page === document.body.dataset.page) {
      link.setAttribute("aria-current", "page");
    }
  },

);

// ----------------------------------------------------------------- Code sample copy controls
// Copies the nearest code sample, falling back to selecting its contents when clipboard access fails.
document.querySelectorAll<HTMLButtonElement>(".copy").forEach(

  /* Applies the required side effect to each item in the collection. */ (
    button,
  ) => {
    button.addEventListener(
      "click",

      /* Handles the click event and applies its associated interface behavior. */ async () => {
        const code = button
          .closest(".codebox, .install")
          ?.querySelector("code");
        if (!code) return;

        try {
          await navigator.clipboard.writeText(code.textContent ?? "");
          button.textContent = "Copied!";
        } catch {
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          button.textContent = "Select & copy";
        }

        setTimeout(

          /* Runs the scheduled action after the configured delay. */ () => {
            button.textContent = "Copy";
          },

          1800,
        );
      },

    );
  },

);
