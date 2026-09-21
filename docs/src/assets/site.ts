const counterStorageKey = 'vitemple-docs-counter';
let savedCounter = 0;
try {
  const stored = Number(sessionStorage.getItem(counterStorageKey));
  if (Number.isFinite(stored)) savedCounter = stored;
} catch {}

store.set({ counter: savedCounter });
store.subscribe((state) => {
  document.querySelectorAll('[data-count]').forEach((element) => { element.textContent = String(state.counter); });
  try { sessionStorage.setItem(counterStorageKey, String(state.counter)); } catch {}
});
document.querySelectorAll<HTMLButtonElement>('[data-counter]').forEach((button) => {
  button.addEventListener('click', () => store.update((state) => ({ ...state, counter: state.counter + Number(button.dataset.counter) })));
});
document.querySelectorAll<HTMLAnchorElement>('.sidebar [data-page]').forEach((link) => {
  if (link.dataset.page === document.body.dataset.page) link.setAttribute('aria-current', 'page');
});
document.querySelectorAll<HTMLButtonElement>('.copy').forEach((button) => {
  button.addEventListener('click', async () => {
    const code = button.closest('.codebox, .install')?.querySelector('code');
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent ?? '');
      button.textContent = 'Copied!';
    } catch {
      const range = document.createRange(); range.selectNodeContents(code);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      button.textContent = 'Select & copy';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  });
});
