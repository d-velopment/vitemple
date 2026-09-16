declare module '*.html?temple' {
  const mount: (target: Node, params?: Record<string, unknown>) => {
    nodes: Node[];
    destroy(): void;
  };
  export default mount;
}
