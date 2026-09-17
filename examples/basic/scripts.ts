import {} from "./components/extra.ts"; 

// Shared state store
store.set({ counter: 0, selectedPage: '1' });
store.subscribe((state) => {
  document.title = `Temple counter: ${state.counter} · Page ${state.selectedPage}`;
});

// Reuse the same component with different props and unified script
const template = document.querySelector<HTMLTemplateElement>('#pageNumber');
const container = document.querySelector('.paging');
if (template && container) {
  for (let index = 1; index <= 10; index += 1) {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const element = fragment.querySelector('section');
    
    if (element) element.dataset.value = String(index);

    container.append(fragment);
  }
}

console.info('Temple example loaded');
