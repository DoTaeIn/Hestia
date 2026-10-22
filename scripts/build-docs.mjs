/** Static developer docs only. Never copy application files, env or internal notes. */
import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { resolve, relative, dirname, basename, extname, sep } from 'node:path';
import { Marked } from 'marked';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs-site');
const repository = process.env.GITHUB_REPOSITORY || 'DoTaeIn/Hestia';
const revision = process.env.GITHUB_SHA || 'HEAD';
if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w./-]+$/.test(revision)) throw new Error('Invalid source repository/ref');
const files = [
  ...(await readdir(resolve(root, 'docs/developers'))).filter(f => f.endsWith('.md')).map(f => 'docs/developers/' + f),
  ...(await readdir(resolve(root, 'docs/releases'))).filter(f => f.endsWith('.md')).map(f => 'docs/releases/' + f),
  'docs/DEPLOYMENT.md', 'docs/PRODUCTION-SECURITY.md', 'docs/SECURITY-REVIEW.md', 'supabase/README.md', 'LICENSE.md',
];
const pages = new Map(files.map(file => [file.toLowerCase(), file]));
const outputName = file => file === 'docs/developers/index.md' ? 'index.html' : file.replace(/\.md$/, '.html');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = text => text.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-');
async function canonical(path) {
  let current = root;
  for (const part of path.split('/')) {
    const match = (await readdir(current)).find(name => name.toLowerCase() === part.toLowerCase());
    if (!match) throw new Error('Broken documentation link: ' + path);
    current = resolve(current, match);
  }
  return relative(root, current).split(sep).join('/');
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const titles = new Map();
for (const file of files) titles.set(file, (await readFile(resolve(root, file), 'utf8')).match(/^# (.+)$/m)?.[1] || basename(file));
for (const file of files) {
  const target = outputName(file);
  const hrefTo = page => relative(dirname(target), outputName(page)).split(sep).join('/') || 'index.html';
  const renderer = {
    heading({ tokens, depth }) { const text = this.parser.parseInline(tokens); return `<h${depth} id="${escape(slug(text))}">${text}</h${depth}>\n`; },
    html({ text }) { return escape(text); },
  };
  const markdown = new Marked({ gfm: true, renderer, async: true, walkTokens: async token => {
    if (token.type !== 'link' && token.type !== 'image') return;
    const href = token.href;
    if (/^(https?:|mailto:|#)/i.test(href)) return;
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) throw new Error('Unsupported link in ' + file);
    const [, path, suffix = ''] = href.match(/^([^?#]*)(.*)$/);
    const absolute = resolve(root, dirname(file), decodeURIComponent(path));
    const local = relative(root, absolute).split(sep).join('/');
    if (local.startsWith('../') || local === '..') throw new Error('Link escapes repository');
    const page = pages.get(local.toLowerCase());
    if (page) token.href = hrefTo(page) + suffix;
    else {
      const source = await canonical(local);
      const kind = (await stat(resolve(root, source))).isDirectory() ? 'tree' : 'blob';
      token.href = `https://github.com/${repository}/${kind}/${revision}/${source.split('/').map(encodeURIComponent).join('/')}${suffix}`;
    }
  }});
  const body = await markdown.parse(await readFile(resolve(root, file), 'utf8'));
  const nav = [...titles].map(([page, title]) => `<a href="${escape(hrefTo(page))}"${page === file ? ' aria-current="page"' : ''}>${escape(title)}</a>`).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(titles.get(file))} · Hestia</title><link rel="stylesheet" href="${escape(relative(dirname(target), 'style.css').split(sep).join('/'))}"></head><body><a class="skip" href="#content">본문으로</a><aside><a class="brand" href="${escape(hrefTo('docs/developers/index.md'))}">HESTIA <small>Developer docs</small></a><nav aria-label="문서">${nav}</nav></aside><main id="content"><article>${body}</article><footer>Hestia Preview 0.1 · <a href="https://github.com/${repository}">GitHub</a></footer></main></body></html>`;
  await mkdir(dirname(resolve(out, target)), { recursive: true });
  await writeFile(resolve(out, target), html);
}
await writeFile(resolve(out, 'style.css'), `:root{color-scheme:light dark;--bg:#fafaf8;--panel:#f0f1ec;--text:#242b29;--muted:#5d6964;--line:#dce0da;--accent:#246550}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.8 system-ui,sans-serif}a{color:var(--accent);text-underline-offset:3px}aside{position:fixed;inset:0 auto 0 0;width:270px;padding:32px 22px;border-right:1px solid var(--line);overflow:auto}.brand{display:block;text-decoration:none;letter-spacing:.2em;font-weight:700}.brand small{display:block;letter-spacing:0;color:var(--muted);font-weight:400}nav{margin-top:28px}nav a{display:block;padding:7px 10px;border-radius:6px;text-decoration:none;color:var(--muted)}nav a:hover,nav a[aria-current]{background:var(--panel);color:var(--accent)}main{margin-left:270px;padding:48px clamp(24px,6vw,90px);max-width:1350px}article{max-width:900px}h1,h2,h3{line-height:1.4;scroll-margin-top:24px}h1{font-size:2.2rem;margin-top:0}h2{margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:8px}pre{background:var(--panel);padding:20px;border-radius:8px;overflow:auto;font-size:.88rem}code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}p code,li code{background:var(--panel);padding:2px 5px;border-radius:4px}table{display:block;overflow:auto;border-collapse:collapse}td,th{border:1px solid var(--line);padding:9px 14px;text-align:left}blockquote{border-left:3px solid var(--accent);margin-left:0;padding-left:20px;color:var(--muted)}img{max-width:100%}footer{margin-top:60px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}.skip{position:fixed;top:-100px}.skip:focus{top:8px;background:var(--bg);padding:8px;z-index:1}@media(prefers-color-scheme:dark){:root{--bg:#171d1b;--panel:#222c27;--text:#e0e8e2;--muted:#a4b5aa;--line:#35443c;--accent:#8ad3ad}}@media(max-width:800px){aside{position:static;width:auto;padding:22px;border-right:0;border-bottom:1px solid var(--line)}nav{display:flex;flex-wrap:wrap;gap:3px;margin-top:15px}nav a{font-size:.9rem;padding:4px 9px}main{margin:0;padding:28px 20px}h1{font-size:1.8rem}}`);
await writeFile(resolve(out, '.nojekyll'), '');
console.log(`Built ${files.length} documentation pages in docs-site/ (no app build or credentials required)`);
