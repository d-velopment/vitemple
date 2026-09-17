declare module '*.html?temple' {
  const mount: (target: Node, params?: Record<string, unknown>) => {
    nodes: Node[];
    destroy(): void;
  };
  export default mount;
}

interface TempleStore<T extends object = Record<string, unknown>> {
  value: T;
  set(next: T): void;
  update(updater: (current: T) => T): void;
  subscribe(listener: (value: T) => void): () => void;
}

declare const store: TempleStore<any>;
