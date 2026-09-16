import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, transformWithEsbuild, type Plugin } from 'vite';
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

export interface CompileOptions { outdir: string; params?: Record<string, unknown> }
type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const attrs = (n: Element) => Object.fromEntries(n.attrs.map(a => [a.name, a.value]));
const rewriteTsImports = (code: string) => code.replace(/((?:from\s*|import\s*)['"])(\.\.?\/[^'"]+?)(['"])/g, (_m, before, specifier, after) => before + (/.tsx?$/.test(specifier) ? specifier.replace(/\.tsx?$/, '.js') : specifier) + after);
function slotAttributes(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) result[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  return result;
}
function interpolateParams(source: string, params: Record<string, string>): string {
  const replace = (text: string) => text.replace(/\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (match, key) => params[key] ?? match);
  // Keep style blocks byte-identical across slot instances so CSS remains shared.
  return source.split(/(<style\b[^>]*>[\s\S]*?<\/style\s*>)/gi)
    .map((part, index) => index % 2 ? part : replace(part)).join('');
}

function formatHtml(source: string): string {
  const tokens = source.replace(/>\s+</g, '><').match(/<![^>]*>|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<[^>]+>|[^<]+/gi) ?? [];
  const lines: string[] = []; let depth = 0;
  for (const token of tokens) {
    const text = token.trim(); if (!text) continue;
    if (/^<\/(html|head|body|main|section|article|div|p|h[1-6]|ul|ol|li|button|footer|script|style)\b/i.test(text)) depth = Math.max(0, depth - 1);
    if (/^<script\b[\s\S]*<\/script>/i.test(text) || /^<style\b[\s\S]*<\/style>/i.test(text)) {
      const m = text.match(/^(<[^>]+>)([\s\S]*?)(<\/[^>]+>)$/); if (m) {
        lines.push('  '.repeat(depth) + m[1]);
        const blockLines = m[2].replace(/^\s*\n|\n\s*$/g, '').split(/\r?\n/);
        const indents = blockLines.filter(line => line.trim()).map(line => line.match(/^\s*/)?.[0].length ?? 0);
        const commonIndent = indents.length ? Math.min(...indents) : 0;
        for (const line of blockLines) { if (line.trim()) lines.push('  '.repeat(depth + 1) + line.slice(commonIndent)); }
        lines.push('  '.repeat(depth) + m[3]); continue;
      }
    }
    lines.push('  '.repeat(depth) + text);
    if (/^<(html|head|body|main|section|article|div|p|h[1-6]|ul|ol|li|button|footer)\b/i.test(text) && !/\/\s*>$/.test(text)) depth++;
  }
  return lines.join('\n') + '\n';
}

type CollectedStyle = { css: string; source: string };
async function expand(entry: string, stack: string[], styles: CollectedStyle[], scripts = new Set<string>(), params: Record<string, string> = {}): Promise<string> {
  const filename = path.resolve(entry);
  if (stack.includes(filename)) throw new Error(`Circular component import: ${[...stack, filename].join(' -> ')}`);
  const source = interpolateParams(await readFile(filename, 'utf8'), params);
  // Textual expansion preserves the author's doctype and document elements.
  const styleRe = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
  let cleaned = source.replace(styleRe, tag => { const css = tag.replace(/^<style\b[^>]*>|<\/style\s*>$/gi, ''); if (!styles.some(s => s.css === css)) styles.push({ css, source: path.basename(filename) }); return ''; });
  const slotRe = /<slot\b([^>]*?)(?:\/\s*>|>\s*<\/slot\s*>)/gi;
  const get = (text: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(text)?.[1];
  let match: RegExpExecArray | null;
  while ((match = slotRe.exec(cleaned))) {
    const src = get(match[1], 'src');
    if (!src) continue;
    const target = path.resolve(path.dirname(filename), src); const type = get(match[1], 'type') ?? path.extname(target).slice(1);
    const passedAttributes = slotAttributes(match[1]);
    let replacement = '';
    if (type === 'css') { const css = await readFile(target, 'utf8'); if (!styles.some(s => s.css === css)) styles.push({ css, source: path.basename(target) }); }
      else if (type === 'script' || type === 'ts' || type === 'js') { scripts.add(target); const code = await readFile(target, 'utf8'); const isTypeScript = type === 'ts' || /\.tsx?$/.test(target); const js = isTypeScript ? (await transformWithEsbuild(rewriteTsImports(code), target, { loader: 'ts', format: 'esm' })).code : rewriteTsImports(code); replacement = `<script type="module" data-source="${path.basename(target)}">${js}</script>`; }
    else if (type === 'template') {
      const content = await expand(target, [...stack, filename], styles, scripts, passedAttributes);
      const name = get(match[1], 'name');
      const id = name ? ` id="${name.replaceAll('"', '&quot;')}"` : '';
      const templateAttributes = Object.entries(passedAttributes)
        .filter(([key]) => key !== 'src' && key !== 'type' && key !== 'name')
        .map(([key, value]) => ` ${key}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join('');
      const nameAttribute = name ? ` name="${name.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"` : '';
      replacement = `<template data-source="${path.basename(target)}"${id}${nameAttribute}${templateAttributes}>${content}</template>`;
    }
    else replacement = await expand(target, [...stack, filename], styles, scripts, passedAttributes);
    cleaned = cleaned.slice(0, match.index) + replacement + cleaned.slice(match.index + match[0].length); slotRe.lastIndex = match.index + replacement.length;
  }
  const inlineRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let inline: RegExpExecArray | null;
  while ((inline = inlineRe.exec(cleaned))) {
    const attributes = inline[1]; const sourceCode = inline[2];
    // Slot scripts carrying data-source are already compiled modules. Imports
    // and exports also require module semantics, so leave those scripts alone.
    if (/\bdata-source\s*=|\bdata-temple-scoped\s*=|\bimport\s|\bexport\s/.test(attributes + sourceCode)) continue;
    const isTypeScript = /\blang\s*=\s*["']ts["']|\btype\s*=\s*["']ts["']/.test(attributes);
    // Transpile TypeScript without asking esbuild for its own IIFE: the
    // compiler adds exactly one isolation wrapper below.
    const js = isTypeScript ? (await transformWithEsbuild(sourceCode, filename, { loader: 'ts', format: 'esm' })).code : sourceCode;
    const wrapped = `<script data-temple-scoped="true">(() => {\n${js}\n})();</script>`;
    cleaned = cleaned.slice(0, inline.index) + wrapped + cleaned.slice(inline.index + inline[0].length);
    inlineRe.lastIndex = inline.index + wrapped.length;
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

async function copyImports(file: string, sourceRoot: string, outdir: string, seen = new Set<string>(), writeCurrent = false): Promise<void> {
  file = path.resolve(file); if (seen.has(file)) return; seen.add(file);
  let code: string; try { code = await readFile(file, 'utf8'); } catch { return; }
  const imports = [...code.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g)].map(m => m[2]);
  const rewritten = code.replace(/((?:from\s*|import\s*)['"])(\.\.?\/[^'"]+?)(['"])/g, (_m, before, specifier, after) => {
    return before + (/\.tsx?$/.test(specifier) ? specifier.replace(/\.tsx?$/, '.js') : specifier) + after;
  });
  if (writeCurrent) {
    const outputFile = /\.tsx?$/.test(file) ? file.replace(/\.tsx?$/, '.js') : file;
    const outputCode = /\.tsx?$/.test(file) ? (await transformWithEsbuild(rewritten, file, { loader: 'ts', format: 'esm' })).code : rewritten;
    const outputDestination = path.join(outdir, path.relative(sourceRoot, outputFile));
    await mkdir(path.dirname(outputDestination), { recursive: true });
    await writeFile(outputDestination, outputCode);
  }
  for (const specifier of imports) {
    const dependency = path.resolve(path.dirname(file), specifier);
    await copyImports(dependency, sourceRoot, outdir, seen, true);
  }
}

export function temple(): Plugin {
  return { name: 'temple', enforce: 'pre', async load(id) { if (!id.endsWith('?temple')) return; const styles: CollectedStyle[] = []; return `export default ${JSON.stringify(await expand(id.slice(0, -7), [], styles))};`; } };
}

export async function compile(entry: string, options: CompileOptions): Promise<{ javascript: string; html: string }> {
  const outdir = path.resolve(options.outdir); await mkdir(outdir, { recursive: true });
  const styles: CollectedStyle[] = []; const scripts = new Set<string>(); const body = await expand(entry, [], styles, scripts);
  for (const script of scripts) await copyImports(script, path.dirname(path.resolve(entry)), outdir);
  const html = path.join(outdir, 'index.html');
  // Keep the authored document structure. Only inject collected styles into an
  // authored <head>; never synthesize doctype/html/head/body elements.
  const styleMarkup = styles.map(s => `<style data-source="${s.source}">${s.css}</style>`).join('');
  const output = /<head\b[^>]*>/i.test(body)
    ? body.replace(/(<head\b[^>]*>)/i, `$1${styleMarkup}`)
    : body;
  await writeFile(html, formatHtml(output));
  return { javascript: '', html };
}
