/**
 * Provides native DOM helpers used by generated components to install shared assets, set attributes, and clean up inserted nodes.
 * Rendering and reactive store behavior are owned by the compiler and emitted runtime modules.
 */
export interface ComponentInstance {
  nodes: Node[];

  // Runs component cleanup callbacks in reverse order and removes the instance’s nodes from the DOM.
  destroy(): void;
}

// Describes the mount function returned by an imported HTML component.
export type Component<P = Record<string, unknown>> = (
  target: Node,
  params?: P,
) => ComponentInstance;

// ----------------------------------------------------------------- Shared component assets
// Installs a component stylesheet in the document head once per style identifier.
export function installStyle(
  id: string,
  css: string,
  document: Document,
): void {
  if (document.head.querySelector(`style[data-temple-style="${id}"]`)) return;

  const style = document.createElement("style");
  style.dataset.templeStyle = id;
  style.textContent = css;
  document.head.append(style);
}

// Installs an external module script in the document head only when that URL is not already present.
export function installScript(src: string, document: Document): void {
  const url = new URL(src, document.baseURI).href;
  if (
    Array.from(document.head.querySelectorAll("script[src]")).some(

      // Checks whether any item satisfies the requested condition.
      (script) => (script as HTMLScriptElement).src === url,

    )
  )
    return;

  const script = document.createElement("script");
  script.type = "module";
  script.src = url;
  document.head.append(script);
}

// ----------------------------------------------------------------- DOM attributes and component lifecycle
// Sets a DOM attribute while converting boolean and nullish values to native HTML attribute behavior.
export function setAttribute(
  element: Element,
  name: string,
  value: unknown,
): void {
  if (value === false || value == null) return;

  element.setAttribute(name, value === true ? "" : String(value));
}

// Creates a component instance that owns its rendered nodes and cleanup callbacks.
export function instance(
  nodes: Node[],
  cleanups: /* Handles the callback passed to this operation. */ (() => void)[],
): ComponentInstance {
  let destroyed = false;
  return {
    nodes,

    // Runs component cleanup callbacks in reverse order and removes the instance’s nodes from the DOM.
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
