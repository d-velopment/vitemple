import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

/** Scope every selector compound, so descendant selectors cannot leak into children. */
export function scopeCSS(css: string, scope: string, filename: string): string {
  const root = postcss.parse(css, { from: filename });
  // Animation names are left intact; use component-specific names in this first version.
  root.walkRules(rule => {
    let parent: postcss.Node | undefined = rule.parent;
    while (parent) {
      if (parent.type === 'atrule' && /keyframes$/i.test((parent as postcss.AtRule).name)) return;
      parent = parent.parent;
    }
    rule.selector = selectorParser(selectors => {
      selectors.each(selector => {
        let compound: typeof selector.nodes = [];
        const flush = () => {
          if (!compound.length) return;
          const marker = selectorParser.attribute({ attribute: scope, value: undefined, raws: {} });
          const pseudo = compound.find(node => node.type === 'pseudo');
          if (pseudo) selector.insertBefore(pseudo, marker);
          else selector.insertAfter(compound[compound.length - 1], marker);
          compound = [];
        };
        for (const node of [...selector.nodes]) {
          if (node.type === 'combinator') flush();
          else compound.push(node);
        }
        flush();
      });
    }).processSync(rule.selector);
  });
  return root.toString();
}
