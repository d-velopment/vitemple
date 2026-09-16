/** Small browser-only helpers used by generated components. */
export interface ComponentInstance {
  nodes: Node[];
  destroy(): void;
}

export type Component<P = Record<string, unknown>> = (
  target: Node,
  params?: P,
) => ComponentInstance;

export function installStyle(id: string, css: string, document: Document): void {
  if (document.head.querySelector(`style[data-temple-style="${id}"]`)) return;
  const style = document.createElement('style');
  style.dataset.templeStyle = id;
  style.textContent = css;
  document.head.append(style);
}

export function installScript(src: string, document: Document): void {
  const url = new URL(src, document.baseURI).href;
  if (Array.from(document.head.querySelectorAll('script[src]')).some(
    script => (script as HTMLScriptElement).src === url,
  )) return;
  const script = document.createElement('script');
  script.type = 'module';
  script.src = url;
  document.head.append(script);
}

export function setAttribute(element: Element, name: string, value: unknown): void {
  if (value === false || value == null) return;
  element.setAttribute(name, value === true ? '' : String(value));
}

export function instance(nodes: Node[], cleanups: (() => void)[]): ComponentInstance {
  let destroyed = false;
  return {
    nodes,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        for (const cleanup of cleanups.reverse()) cleanup();
      } finally {
        for (const node of nodes) node.parentNode?.removeChild(node);
      }
    },
  };
}
