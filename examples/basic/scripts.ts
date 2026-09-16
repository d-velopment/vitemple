import {} from "./components/extra.ts"; 

const template = document.querySelector<HTMLTemplateElement>('#pageNumber');
const container = document.querySelector('.paging');

if (template && container) {
  for (let index = 1; index <= 10; index += 1) {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const heading = fragment.querySelector('span');
    if (heading) heading.textContent = String(index);
    container.append(fragment);
  }
}

console.info('Temple example loaded');
export {};
