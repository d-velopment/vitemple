import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, transformWithEsbuild, type Plugin } from 'vite';
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

export interface CompileOptions { outdir: string; params?: Record<string, unknown> }
type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const attrs = (n: Element) => Object.fromEntries(n.attrs.map(a => [a.name, a.value]));

function formatHtml(source: string): string {
  const tokens = source.replace(/>\s+</g, '><').match(/<![^>]*>|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<[^>]+>|[^<]+/gi) ?? [];
  const lines: string[] = []; let depth = 0;
  for (const token of tokens) {
    const text = token.trim(); if (!text) continue;
    if (/^<\/(html|head|body|main|section|article|div|p|h[1-6]|ul|ol|li|button|footer|script|style)\b/i.test(text)) depth = Math.max(0, depth - 1);
    if (/^<script\b[\s\S]*<\/script>/i.test(text) || /^<style\b[\s\S]*<\/style>/i.test(text)) {
      const m = text.match(/^(<[^>]+>)([\s\S]*?)(<\/[^>]+>)$/); if (m) { lines.push('  '.repeat(depth) + m[1]); for (const line of m[2].trim().split(/\r?\n/)) if (line.trim()) lines.push('  '.repeat(depth + 1) + line.trim()); lines.push('  '.repeat(depth) + m[3]); continue; }
    }
    lines.push('  '.repeat(depth) + text);
    if (/^<(html|head|body|main|section|article|div|p|h[1-6]|ul|ol|li|button|footer)\b/i.test(text) && !/\/\s*>$/.test(text)) depth++;
  }
  return lines.join('\n') + '\n';
}

async function expand(entry: string, stack: string[], styles: string[]): Promise<string> {
  const filename = path.resolve(entry);
  if (stack.includes(filename)) throw new Error(`Circular component import: ${[...stack, filename].join(' -> ')}`);
  const source = await readFile(filename, 'utf8');
  // Textual expansion preserves the author's doctype and document elements.
  const styleRe = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
  let cleaned = source.replace(styleRe, tag => { const css = tag.replace(/^<style\b[^>]*>|<\/style\s*>$/gi, ''); if (!styles.includes(css)) styles.push(css); return ''; });
  const slotRe = /<slot\b([^>]*?)(?:\/\s*>|>\s*<\/slot\s*>)/gi;
  const get = (text: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(text)?.[1];
  let match: RegExpExecArray | null;
  while ((match = slotRe.exec(cleaned))) {
    const src = get(match[1], 'src');
    if (!src) continue;
    const target = path.resolve(path.dirname(filename), src); const type = get(match[1], 'type') ?? path.extname(target).slice(1);
    let replacement = '';
    if (type === 'css') { const css = await readFile(target, 'utf8'); if (!styles.includes(css)) styles.push(css); }
    else if (type === 'script' || type === 'ts' || type === 'js') { const code = await readFile(target, 'utf8'); const js = type === 'ts' ? (await transformWithEsbuild(code, target, { loader: 'ts', format: 'esm' })).code : code; replacement = `<script type="module">${js}</script>`; }
    else replacement = await expand(target, [...stack, filename], styles);
    cleaned = cleaned.slice(0, match.index) + replacement + cleaned.slice(match.index + match[0].length); slotRe.lastIndex = match.index + replacement.length;
  }
  const inlineRe = /<script\b([^>]*\blang\s*=\s*["']ts["'][^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let inline: RegExpExecArray | null;
  while ((inline = inlineRe.exec(cleaned))) {
    const js = (await transformWithEsbuild(inline[2], filename, { loader: 'ts', format: 'esm' })).code;
    cleaned = cleaned.slice(0, inline.index) + `<script type="module">${js}</script>` + cleaned.slice(inline.index + inline[0].length);
    inlineRe.lastIndex = inline.index + js.length;
  }
  return cleaned;
  /*
  async function visit(node: Node): Promise<string> {
    if (!('tagName' in node)) return 'value' in node ? node.value : serialize(node as any);
    const element = node as Element; const a = attrs(element);
    if (element.tagName === 'style') { const css = element.childNodes.map(n => 'value' in n ? n.value : serialize(n as any)).join(''); if (!styles.includes(css)) styles.push(css); return ''; }
    if (element.tagName === 'script' && !a.src) {
      const code = element.childNodes.map(n => 'value' in n ? n.value : '').join('');
      const js = a.lang === 'ts' || a.type === 'ts' ? (await transformWithEsbuild(code, filename, { loader: 'ts', format: 'esm' })).code : code;
      return `<script${a.type ? ` type="${a.type}"` : ' type="module"'}>${js}</script>`;
    }
    if (element.tagName === 'slot' && a.src) {
      const target = path.resolve(path.dirname(filename), a.src);
      const type = a.type ?? path.extname(target).slice(1);
      if (type === 'css') { const css = await readFile(target, 'utf8'); if (!styles.includes(css)) styles.push(css); return ''; }
      if (type === 'script' || type === 'ts' || type === 'js') {
        const code = await readFile(target, 'utf8');
        const js = type === 'ts' ? (await transformWithEsbuild(code, target, { loader: 'ts', format: 'esm' })).code : code;
        return `<script type="module">${js}</script>`;
      }
      return expand(target, [...stack, filename], styles);
    }
    const children = element.tagName === 'template' ? (element as DefaultTreeAdapterMap['template']).content.childNodes : element.childNodes;
    const content = (await Promise.all(children.map(visit))).join('');
    const renderedAttrs = element.attrs.map(a => ` ${a.name}="${a.value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join('');
    return `<${element.tagName}${renderedAttrs}>${content}</${element.tagName}>`;
  }
  return (await Promise.all(fragment.childNodes.map(visit))).join('');
  */
}

export function temple(): Plugin {
  return { name: 'temple', enforce: 'pre', async load(id) { if (!id.endsWith('?temple')) return; const styles: string[] = []; return `export default ${JSON.stringify(await expand(id.slice(0, -7), [], styles))};`; } };
}

export async function compile(entry: string, options: CompileOptions): Promise<{ javascript: string; html: string }> {
  const outdir = path.resolve(options.outdir); await mkdir(outdir, { recursive: true });
  const styles: string[] = []; const body = await expand(entry, [], styles);
  const html = path.join(outdir, 'index.html');
  // Keep the authored document structure. Only inject collected styles into an
  // authored <head>; never synthesize doctype/html/head/body elements.
  const styleMarkup = styles.map(s => `<style>${s}</style>`).join('');
  const output = /<head\b[^>]*>/i.test(body)
    ? body.replace(/(<head\b[^>]*>)/i, `$1${styleMarkup}`)
    : body;
  await writeFile(html, formatHtml(output));
  return { javascript: '', html };
}
