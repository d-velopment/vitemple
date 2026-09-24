import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, transformWithEsbuild, type Plugin } from 'vite';
import { reactivityRuntime } from './reactivity.js';

export interface CompileOptions { outdir: string; params?: Record<string, unknown> }
const rewriteTsImports = (code: string) => code.replace(/((?:from\s*|import\s*)['"])(\.\.?\/[^'"]+?)(['"])/g, (_m, before, specifier, after) => before + (/.tsx?$/.test(specifier) ? specifier.replace(/\.tsx?$/, '.js') : specifier) + after);
function rewriteInlineImports(code: string, sourceFile: string, pageSourceDirectory: string): string {
  return code.replace(/((?:from\s*|import\s*)['"])(\.\.?\/[^'"]+?)(['"])/g, (_match, before, specifier, after) => {
    const suffixIndex = specifier.search(/[?#]/);
    const sourceSpecifier = suffixIndex === -1 ? specifier : specifier.slice(0, suffixIndex);
    const suffix = suffixIndex === -1 ? '' : specifier.slice(suffixIndex);
    const sourceDependency = path.resolve(path.dirname(sourceFile), sourceSpecifier);
    const outputDependency = sourceDependency.replace(/\.tsx?$/, '.js');
    let outputSpecifier = path.relative(pageSourceDirectory, outputDependency).split(path.sep).join('/');
    if (!outputSpecifier.startsWith('.')) outputSpecifier = `./${outputSpecifier}`;
    return before + outputSpecifier + suffix + after;
  });
}
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

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

type CollectedStyle = { css: string; source: string };
async function expand(entry: string, stack: string[], styles: CollectedStyle[], scripts = new Set<string>(), params: Record<string, string> = {}, templateScripts: string[] = [], pageSourceDirectory = path.dirname(path.resolve(entry))): Promise<string> {
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
      else if (type === 'script' || type === 'ts' || type === 'js') { scripts.add(target); const code = await readFile(target, 'utf8'); const isTypeScript = type === 'ts' || /\.tsx?$/.test(target); const inlineCode = rewriteInlineImports(code, target, pageSourceDirectory); const js = isTypeScript ? (await transformWithEsbuild(inlineCode, target, { loader: 'ts', format: 'esm' })).code : inlineCode; replacement = `<script type="module" data-source="${path.basename(target)}">${js}</script>`; }
    else if (type === 'template') {
      let content = await expand(target, [...stack, filename], styles, scripts, passedAttributes, templateScripts, pageSourceDirectory);
      const embeddedScripts = content.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) ?? [];
      for (const script of embeddedScripts) {
        const body = script.replace(/^<script\b[^>]*>|<\/script\s*>$/gi, '').replace(/^\s*import\s+\{\s*(?:shared|store)\s*\}\s+from\s+['"]\.\/temple-runtime\.js['"];?\s*$/gim, '');
        const initializer = `<script type="module">document.addEventListener('DOMContentLoaded', () => {\n${body}\n});</script>`;
        if (!templateScripts.includes(initializer)) templateScripts.push(initializer);
      }
      content = content.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
      const name = get(match[1], 'name');
      const id = name ? ` id="${name.replaceAll('"', '&quot;')}"` : '';
      const templateAttributes = Object.entries(passedAttributes)
        .filter(([key]) => key !== 'src' && key !== 'type' && key !== 'name')
        .map(([key, value]) => ` ${key}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join('');
      const nameAttribute = name ? ` name="${name.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"` : '';
      replacement = `<template data-source="${path.basename(target)}"${id}${nameAttribute}${templateAttributes}>${content}</template>`;
    }
    else replacement = await expand(target, [...stack, filename], styles, scripts, passedAttributes, templateScripts, pageSourceDirectory);
    cleaned = cleaned.slice(0, match.index) + replacement + cleaned.slice(match.index + match[0].length); slotRe.lastIndex = match.index + replacement.length;
  }
  const inlineRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let inline: RegExpExecArray | null;
  while ((inline = inlineRe.exec(cleaned))) {
    const attributes = inline[1]; const sourceCode = inline[2];
    // Slot scripts are already handled by the slot branch. Scripts with
    // module syntax must stay at module scope, but type="ts" still needs its
    // TypeScript syntax removed before all inline scripts are combined.
    if (/\bdata-source\s*=|\bdata-temple-scoped\s*=/.test(attributes)) continue;
    const isTypeScript = /\b(?:lang|type)\s*=\s*(?:["']ts["']|ts)(?:\s|$)/i.test(attributes);
    const hasModuleSyntax = /\bimport\s|\bexport\s/.test(sourceCode);
    if (hasModuleSyntax && !isTypeScript) continue;
    const inlineCode = hasModuleSyntax ? rewriteInlineImports(sourceCode, filename, pageSourceDirectory) : sourceCode;
    const js = isTypeScript ? (await transformWithEsbuild(inlineCode, filename, { loader: 'ts', format: 'esm' })).code : inlineCode;
    // Keep import/export at module scope; isolate ordinary inline scripts once.
    const body = hasModuleSyntax ? js : `(() => {\n${js}\n})();`;
    const wrapped = `<script type="module" data-temple-scoped="true">${body}</script>`;
    cleaned = cleaned.slice(0, inline.index) + wrapped + cleaned.slice(inline.index + inline[0].length);
    inlineRe.lastIndex = inline.index + wrapped.length;
  }
  return cleaned;
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

function cssResourceUrls(css: string): string[] {
  return [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|@import\s+(?:url\()?\s*(?:"([^"]*)"|'([^']*)')/gi)]
    .map(match => match[1] ?? match[2] ?? match[3]?.trim() ?? match[4] ?? match[5] ?? '');
}

function localResourceUrls(html: string): string[] {
  const urls: string[] = [];
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) urls.push(...cssResourceUrls(style[1]));
  const source = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const tag of source.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    if (tag[1].toLowerCase() === 'script') continue;
    for (const attribute of tag[2].matchAll(/\b(href|src|poster|background|data|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      if (attribute[1].toLowerCase() === 'srcset') {
        if (/\bdata:/i.test(value)) continue;
        for (const candidate of value.split(',')) urls.push(candidate.trim().split(/\s+/, 1)[0]);
      } else {
        urls.push(value);
      }
    }
  }
  return urls;
}

function localUrlPath(value: string): string | undefined {
  const url = value.trim();
  if (!url || url.startsWith('#') || url.startsWith('//') || url.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(url)) return;
  const pathname = url.split(/[?#]/, 1)[0];
  if (!pathname) return;
  try { return decodeURIComponent(pathname); } catch { return; }
}

async function copyLocalAsset(
  value: string,
  referringFile: string,
  sourceRoot: string,
  outputRoot: string,
  copied: Set<string>,
): Promise<void> {
  const pathname = localUrlPath(value);
  if (!pathname) return;
  const sourceFile = path.resolve(path.dirname(referringFile), pathname);
  const relative = path.relative(sourceRoot, sourceFile);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
  if (/\.html?$/i.test(sourceFile)) return; // Pages are compiled separately.
  try {
    if (!(await stat(sourceFile)).isFile()) return;
  } catch { return; }
  if (copied.has(sourceFile)) return;
  copied.add(sourceFile);

  const outputFile = path.join(outputRoot, relative);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await copyFile(sourceFile, outputFile);

  if (/\.css$/i.test(sourceFile)) {
    const css = await readFile(sourceFile, 'utf8');
    for (const cssUrl of cssResourceUrls(css)) await copyLocalAsset(cssUrl, sourceFile, sourceRoot, outputRoot, copied);
  }
}

async function copyLocalAssets(
  html: string,
  page: string,
  sourceRoot: string,
  outputRoot: string,
  copied: Set<string>,
): Promise<void> {
  for (const url of localResourceUrls(html)) await copyLocalAsset(url, page, sourceRoot, outputRoot, copied);
}

async function compilePage(entry: string, outdir: string, storageKey: string): Promise<{ html: string; expandedHtml: string; styles: CollectedStyle[] }> {
  await mkdir(outdir, { recursive: true });
  const styles: CollectedStyle[] = []; const scripts = new Set<string>(); const templateScripts: string[] = [];
  const expandedHtml = await expand(entry, [], styles, scripts, {}, templateScripts);
  for (const script of scripts) await copyImports(script, path.dirname(path.resolve(entry)), outdir);
  const html = path.join(outdir, path.basename(entry));
  // Keep the authored document structure. Only inject collected styles into an
  // authored <head>; never synthesize doctype/html/head/body elements.
  const styleMarkup = styles.map(s => `<style data-source="${s.source}">${minifyCss(s.css)}</style>`).join('');
  const scriptsMarkup = templateScripts.join('\n');
  const withScripts = /<\/body\s*>/i.test(expandedHtml) ? expandedHtml.replace(/<\/body\s*>/i, () => `${scriptsMarkup}\n</body>`) : expandedHtml + scriptsMarkup;
  const scriptBlocks = withScripts.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) ?? [];
  const scriptCode = scriptBlocks.map(script => script.replace(/^<script\b[^>]*>|<\/script\s*>$/gi, '').replace(/^\s*import\s+\{\s*shared\s*\}\s+from\s+['"]\.\/temple-runtime\.js['"];?\s*$/gim, '')).join('\n');
  const withoutScripts = withScripts.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const minifiedScript = (await transformWithEsbuild(`${reactivityRuntime(storageKey)}\n${scriptCode}`, path.join(outdir, 'temple-bundle.ts'), {
    loader: 'ts', format: 'esm', target: 'es2022', minify: true,
  })).code;
  const combinedScript = `<script type="module">${minifiedScript}</script>`;
  const withHeadAssets = /<head\b[^>]*>/i.test(withoutScripts)
    ? withoutScripts.replace(/(<head\b[^>]*>)/i, `$1${styleMarkup}`)
    : withoutScripts;
  const output = /<\/body\s*>/i.test(withHeadAssets) ? withHeadAssets.replace(/<\/body\s*>/i, () => `${combinedScript}\n</body>`) : withHeadAssets + combinedScript;
  // Production output is intentionally compact: one physical line.
  const compact = formatHtml(output).replace(/\n/g, '').replace(/ {2,}/g, ' ').trim();
  const trimmedBlocks = compact
    .replace(/(<[A-Za-z][\w:-]*(?:\s[^>]*)?>)\s+/g, '$1')
    .replace(/\s+(<\/[A-Za-z][\w:-]*\s*>)/g, '$1')
    .replace(/(<(?:style|script)\b[^>]*>)\s*([\s\S]*?)\s*(<\/(?:style|script)\s*>)/gi, (_match, open, content, close) => `${open}${content.trim()}${close}`);
  await writeFile(html, trimmedBlocks + '\n');
  return { html, expandedHtml, styles };
}

function localAnchorHrefs(html: string): string[] {
  const hrefs: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)) {
    const href = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('//') || href.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    hrefs.push(href);
  }
  return hrefs;
}

async function resolveLinkedPage(href: string, referringPage: string, sourceRoot: string): Promise<string | undefined> {
  const pathname = href.split(/[?#]/, 1)[0];
  if (!pathname) return;
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(pathname); } catch { return; }
  const target = path.resolve(path.dirname(referringPage), decodedPath);
  const relative = path.relative(sourceRoot, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;

  const candidates = path.extname(target)
    ? (/\.html?$/i.test(target) ? [target] : [])
    : (pathname.endsWith('/') ? [path.join(target, 'index.html')] : [`${target}.html`, path.join(target, 'index.html')]);
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch { /* A missing or non-page link is an ordinary browser URL. */ }
  }
}

async function resolveStorageKey(entryFile: string): Promise<string> {
  let directory = path.dirname(entryFile);
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as { name?: unknown };
      if (typeof manifest.name === 'string' && manifest.name.trim()) return `vitemple-store:${manifest.name.trim()}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return 'vitemple-store';
}

export async function compile(entry: string, options: CompileOptions): Promise<{ javascript: string; html: string }> {
  const entryFile = path.resolve(entry);
  const sourceRoot = path.dirname(entryFile);
  const storageKey = await resolveStorageKey(entryFile);
  const outputRoot = path.resolve(options.outdir);
  const pending = [entryFile];
  const compiled = new Set<string>();
  const copiedAssets = new Set<string>();
  let rootResult: { javascript: string; html: string } | undefined;

  while (pending.length) {
    const page = pending.shift()!;
    if (compiled.has(page)) continue;
    compiled.add(page);
    const relativeDirectory = path.relative(sourceRoot, path.dirname(page));
    const pageOutdir = path.join(outputRoot, relativeDirectory);
    const result = await compilePage(page, pageOutdir, storageKey);
    await copyLocalAssets(result.expandedHtml, page, sourceRoot, outputRoot, copiedAssets);
    for (const style of result.styles) {
      for (const url of cssResourceUrls(style.css)) await copyLocalAsset(url, page, sourceRoot, outputRoot, copiedAssets);
    }
    if (page === entryFile) rootResult = { javascript: '', html: result.html };

    for (const href of localAnchorHrefs(result.expandedHtml)) {
      const linkedPage = await resolveLinkedPage(href, page, sourceRoot);
      if (linkedPage && !compiled.has(linkedPage)) pending.push(linkedPage);
    }
  }

  return rootResult!;
}
