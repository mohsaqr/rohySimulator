// Renders every Markdown document in the repository into website/docs/ as
// HTML that wears the site's own shell.
//
//   node website/build-docs.mjs            (run from anywhere)
//
// Sources: docs/**/*.md (the whole tree apart from .vitepress/), CHANGELOG.md
// and LICENSE. README.md is handled by build-help.mjs, which imports the shell
// and the Markdown pipeline from this file so both generators emit identical
// chrome.
//
// The output is deterministic: two runs over an unchanged source tree produce
// byte-identical files. File lists are sorted and nothing carries a timestamp.
//
// Everything under website/docs/ is generated. Edit the Markdown and re-run.

import {
    copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
    rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DOCS_SRC = join(REPO_ROOT, 'docs');
const DOCS_OUT = join(HERE, 'docs');
const ASSETS = join(HERE, 'assets');
const REPO = 'https://github.com/mohsaqr/rohySimulator';
const BLOB = `${REPO}/blob/main/`;
const TREE = `${REPO}/tree/main/`;

// ── Text helpers ─────────────────────────────────────────────────────

export const escapeHtml = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Strip inline markup and entities from a heading, then slugify. The same
// slug is written onto the heading id and into the subnav href, so the two can
// never disagree.
export const slugify = (html) => html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

// GitHub's slug keeps the gap a removed character leaves behind, so
// "Deploy verification & live monitoring" becomes "…verification--live…".
// Both spellings occur in the documentation, so a heading whose two slugs
// differ also gets the GitHub one as an alias anchor.
export const githubSlug = (html) => html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');

export const relPrefix = (depth) => (depth === 0 ? '' : '../'.repeat(depth));

const textOf = (html) => html.replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

// ── The page shell, shared by every generator ────────────────────────

const NAV = [
    { href: 'index.html', label: 'Overview', key: 'overview' },
    { href: 'rooms.html', label: 'Rooms', key: 'rooms' },
    { href: 'screenshots.html', label: 'Screenshots', key: 'screenshots' },
    { href: 'whats-new.html', label: "What's new", key: 'whats-new' },
    { href: 'docs/index.html', label: 'Docs', key: 'docs' },
    { href: 'help.html', label: 'Help', key: 'help' },
    { href: 'index.html#install', label: 'Install', key: 'install', cls: 'optional' },
    { href: 'about.html', label: 'About the author', key: 'about' },
];

const FOOTER_DOCS = [
    { href: 'docs/index.html', label: 'Docs home' },
    { href: 'docs/INSTALL.html', label: 'Install' },
    { href: 'docs/DEPLOY.html', label: 'Deploy' },
    { href: 'docs/UPDATING.html', label: 'Updating' },
    { href: 'docs/trainee/index.html', label: 'Trainee guides' },
    { href: 'docs/reference/index.html', label: 'Reference' },
];

export function navHtml(rel, current) {
    const items = NAV.map((n) => {
        const cls = n.cls ? ` class="${n.cls}"` : '';
        const cur = n.key === current ? ' aria-current="page"' : '';
        return `            <a href="${rel}${n.href}"${cls}${cur}>${n.label}</a>`;
    }).join('\n');
    return `<header class="nav">
    <div class="wrap">
        <a class="brand" href="${rel}index.html">
            <span class="brand-dot"></span>
            <span>rohy</span>
        </a>
        <nav class="nav-links" aria-label="Site">
${items}
            <a class="nav-cta" href="${REPO}" target="_blank" rel="noopener">GitHub →</a>
        </nav>
    </div>
</header>`;
}

export function footerHtml(rel) {
    const docs = FOOTER_DOCS
        .map((d) => `                <a href="${rel}${d.href}">${d.label}</a>`)
        .join('\n');
    return `<footer>
    <div class="wrap">
        <div class="footer-grid">
            <div class="footer-brand">
                <a class="brand" href="${rel}index.html">
                    <span class="brand-dot"></span>
                    <span>rohy</span>
                </a>
                <p>
                    AI-enabled virtual patient simulation platform for clinical reasoning research
                    and education. Built by Mohammed Saqr, Professor of Computer Science,
                    University of Eastern Finland.
                </p>
            </div>
            <div class="footer-col">
                <h4>Pages</h4>
                <a href="${rel}index.html">Overview</a>
                <a href="${rel}rooms.html">Rooms</a>
                <a href="${rel}screenshots.html">Screenshots</a>
                <a href="${rel}whats-new.html">What's new</a>
                <a href="${rel}help.html">Help</a>
                <a href="${rel}about.html">About the author</a>
                <a href="${rel}index.html#install">Install</a>
            </div>
            <div class="footer-col">
                <h4>Project</h4>
                <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>
                <a href="${BLOB}README.md" target="_blank" rel="noopener">README</a>
                <a href="${REPO}/releases" target="_blank" rel="noopener">Releases</a>
                <a href="${rel}docs/license.html">License</a>
            </div>
            <div class="footer-col">
                <h4>Docs</h4>
${docs}
            </div>
        </div>
        <div class="footer-bottom">
            <span>© 2026 Mohammed Saqr · <a href="${rel}docs/license.html">Carm Research License v1.4</a> · <a href="https://www.saqr.me" target="_blank" rel="noopener">saqr.me</a></span>
            <span>Free for research, teaching, personal learning and non-profit use. Commercial use requires a paid licence.</span>
        </div>
    </div>
</footer>`;
}

// One template for every generated page. `depth` is how many directories the
// output file sits below website/, which fixes every relative path on the page.
export function shell({
    depth, title, description, ogImage = 'assets/patient-room.jpg', current,
    eyebrow, headline, lead, subnav = '', sidebar = '', body, bodyClass = 'md-body',
}) {
    const rel = relPrefix(depth);
    const subnavHtml = subnav
        ? `\n        <nav class="subnav" aria-label="On this page">
            <span class="subnav-label">On this page</span>
${subnav}
        </nav>`
        : '';
    const leadHtml = lead ? `\n        <p class="sub">${lead}</p>` : '';
    const main = sidebar
        ? `<section class="tight">
    <div class="wrap">
        <div class="docs-layout">
${sidebar}
            <article class="${bodyClass}">
${body.trimEnd()}
            </article>
        </div>
    </div>
</section>`
        : `<section class="tight">
    <div class="wrap">
        <article class="${bodyClass}">
${body.trimEnd()}
        </article>
    </div>
</section>`;

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="theme-color" content="#09090b">

    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${rel}${ogImage}">
    <meta property="og:type" content="article">
    <meta name="twitter:card" content="summary">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="${rel}site.css">
</head>
<body>

<!-- ── Fixed nav (identical on every page) ───────────────────── -->
${navHtml(rel, current)}

<main>

<!-- ── Hero ──────────────────────────────────────────────────── -->
<section class="hero compact" id="top">
    <div class="wrap hero-inner">
        <span class="eyebrow accent">${escapeHtml(eyebrow)}</span>
        <h1>${headline}</h1>${leadHtml}${subnavHtml}
    </div>
</section>

<!-- ── Rendered Markdown ─────────────────────────────────────── -->
${main}

</main>

${footerHtml(rel)}

<script src="${rel}site.js"></script>
</body>
</html>
`;
}

// ── Markdown pipeline ────────────────────────────────────────────────

// YAML frontmatter, read far enough to find a `title:` and nothing more.
export function splitFrontmatter(src) {
    if (!/^---\r?\n/.test(src)) return { front: '', body: src };
    const end = src.indexOf('\n---', 4);
    if (end === -1) return { front: '', body: src };
    const nl = src.indexOf('\n', end + 1);
    return { front: src.slice(4, end), body: nl === -1 ? '' : src.slice(nl + 1) };
}

const frontTitle = (front) => {
    const m = front.match(/^title:\s*(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
};

const KNOWN_TAGS = new Set(('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr').split(' '));

// The operator manuals write shell placeholders such as <snapshot-name> in
// running prose. A browser drops them as unknown elements, so they are escaped
// and the list is reported per file.
//
// The pass runs over the converted HTML. By then `marked` has already escaped
// everything inside a code fence or a code span, so a literal `<token>` left
// in the string is prose and nothing else. Escaping the Markdown source
// instead misreads a code span that wraps across a line break.
// The generated reference tables write `&lt;token&gt;` inside code spans, so
// that VitePress' Vue compiler leaves the angle brackets alone. `marked`
// escapes the ampersand a second time and the reader sees `&lt;token&gt;`.
// Decoding the entity back inside code, and only inside code, prints the
// token the table means.
export function decodeEntitiesInCode(html) {
    return html.replace(/<code([^>]*)>([\s\S]*?)<\/code>/g, (_, attrs, inner) => {
        const fixed = inner
            .replace(/&amp;lt;/g, '&lt;')
            .replace(/&amp;gt;/g, '&gt;')
            .replace(/&amp;amp;/g, '&amp;');
        return `<code${attrs}>${fixed}</code>`;
    });
}

export function escapeUnknownTags(html, seen) {
    return html.replace(
        /<(\/?)([A-Za-z][\w.-]*)((?:\s[^<>]*)?)>/g,
        (whole, slash, tag, rest) => {
            if (KNOWN_TAGS.has(tag.toLowerCase())) return whole;
            seen.push(`<${slash}${tag}${rest}>`);
            return escapeHtml(whole);
        },
    );
}

const CALLOUT_KINDS = new Set(['tip', 'info', 'warning', 'danger', 'details']);
const DEFAULT_TITLE = { tip: 'Tip', info: 'Note', warning: 'Warning', danger: 'Important' };

// VitePress containers become callouts and disclosure blocks. The inner
// Markdown is converted on its own and parked behind a placeholder, so the
// outer conversion cannot fold the HTML back into a paragraph.
export function extractContainers(src, blocks) {
    const lines = src.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
        const open = lines[i].match(/^:::[ \t]*([A-Za-z]+)[ \t]*(.*)$/);
        if (!open || !CALLOUT_KINDS.has(open[1].toLowerCase())) { out.push(lines[i]); continue; }
        const kind = open[1].toLowerCase();
        const title = open[2].trim();
        const inner = [];
        let j = i + 1;
        for (; j < lines.length && lines[j].trim() !== ':::'; j += 1) inner.push(lines[j]);
        const id = `xcontainerplaceholder${blocks.length}x`;
        blocks.push({ kind, title, markdown: inner.join('\n') });
        out.push('', id, '');
        i = j;
    }
    return out.join('\n');
}

function renderContainer(block, convertInner) {
    const inner = convertInner(block.markdown).trim();
    if (block.kind === 'details') {
        const summary = escapeHtml(block.title || 'Details');
        return `<details class="callout callout-details"><summary>${summary}</summary>\n${inner}\n</details>`;
    }
    const title = block.title || DEFAULT_TITLE[block.kind];
    return `<aside class="callout callout-${block.kind}">\n<p class="callout-title">${escapeHtml(title)}</p>\n${inner}\n</aside>`;
}

// Converts one Markdown document into the body HTML plus the H2 list the
// "On this page" row is built from.
export function renderBody(markdown, { rewriteHref, rewriteImgSrc, dropFirstH1 = true, escapedTokens = [] }) {
    const blocks = [];
    const src = extractContainers(markdown, blocks);

    const convert = (md) => {
        let html = decodeEntitiesInCode(
            escapeUnknownTags(marked.parse(md, { async: false }), escapedTokens),
        );
        html = html
            .replace(/<img\s+src="([^"]*)"/g, (_, s) => `<img src="${escapeHtml(rewriteImgSrc(s))}"`)
            .replace(/<a\s+href="([^"]*)"/g, (_, h) => `<a href="${escapeHtml(rewriteHref(h))}"`);
        return html;
    };

    let body = convert(src);

    for (let i = 0; i < blocks.length; i += 1) {
        const id = `xcontainerplaceholder${i}x`;
        body = body.replace(new RegExp(`<p>${id}</p>`, 'g'), renderContainer(blocks[i], convert));
    }

    let h1 = '';
    body = body.replace(/^<h1[^>]*>([\s\S]*?)<\/h1>\s*/, (whole, inner) => {
        h1 = textOf(inner);
        return dropFirstH1 ? '' : whole;
    });

    // Ids on every heading level a link may target, deduplicated in document
    // order, with the GitHub spelling added as an alias when it differs.
    const used = new Map();
    const sections = [];
    body = body.replace(/<h([234])>([\s\S]*?)<\/h\1>/g, (_, level, inner) => {
        let id = slugify(inner) || 'section';
        const n = used.get(id) || 0;
        used.set(id, n + 1);
        if (n > 0) id = `${id}-${n}`;
        const alt = githubSlug(inner);
        const alias = alt && alt !== id && !used.has(alt)
            ? `<span class="anchor-alias" id="${alt}"></span>` : '';
        if (alias) used.set(alt, 1);
        if (level === '2') sections.push({ id, label: textOf(inner) });
        return `${alias}<h${level} id="${id}">${inner}</h${level}>`;
    });

    body = body.replace(/<table>/g, '<div class="table-wrap"><table>')
        .replace(/<\/table>/g, '</table></div>');

    return { body, sections, h1 };
}

export function subnavHtml(sections) {
    return sections
        .map((s) => `            <a href="#${s.id}">${escapeHtml(s.label)}</a>`)
        .join('\n');
}

// ── Source discovery ─────────────────────────────────────────────────

function walk(dir, out = []) {
    const entries = readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const e of entries) {
        if (e.name === '.vitepress') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
}

// ── Build ────────────────────────────────────────────────────────────

async function main() {
// Page names and sidebar labels derive from each document's H1. Historical
// records under design/ and the DOCUMENTATION-* files title themselves with an
// em dash ("RPS-1 — the Rohy Plugin Standard"); the site's style rule has no
// em dashes in prose, so derived names carry a colon instead. The source
// Markdown is left as it is.
function siteName(text) {
    return String(text).replace(/\s*[—–]\s*/g, ': ').replace(/:\s*:/g, ':').trim();
}

    const sources = walk(DOCS_SRC).map((abs) => {
        const rel = relative(DOCS_SRC, abs).split('\\').join('/');
        const raw = readFileSync(abs, 'utf8');
        const { front, body } = splitFrontmatter(raw);
        const h1 = body.match(/^#[ \t]+(.+)$/m);
        const name = siteName(frontTitle(front)
            || (h1 ? h1[1].replace(/`/g, '').trim() : basename(rel, '.md')));
        return {
            abs, rel, name,
            key: rel.replace(/\.md$/, ''),
            out: rel.replace(/\.md$/, '.html'),
        };
    });

    // Directories with no index.md get a generated one, so a link written as
    // `audits/` has somewhere to land.
    const dirs = new Set(sources.map((s) => dirname(s.rel)).filter((d) => d !== '.'));
    const generatedIndexes = [...dirs]
        .filter((d) => !sources.some((s) => s.key === `${d}/index`))
        .sort();

    const pages = new Map(); // key (docs-relative, no extension) → output path relative to website/
    for (const s of sources) pages.set(s.key, `docs/${s.out}`);
    for (const d of generatedIndexes) pages.set(`${d}/index`, `docs/${d}/index.html`);
    pages.set('changelog', 'docs/changelog.html');
    pages.set('license', 'docs/license.html');

    const missing = [];
    const escapedByFile = new Map();

    // Resolve a link written inside `docs/<srcDir>/…` to a path relative to
    // the page being written, in the order the plan fixes.
    const makeRewriter = (srcDir, outDir) => (href) => {
        if (!href) return href;
        if (/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(href)) return href;

        const [rawPath, frag] = href.split('#');
        const hash = frag === undefined ? '' : `#${frag}`;
        if (!rawPath) return href;

        // 1 & 3. Absolute VitePress paths are docs-root relative.
        // 2. Relative paths resolve against the directory of the source file.
        let target = rawPath.startsWith('/')
            ? rawPath.replace(/^\//, '')
            : join(srcDir, rawPath).split('\\').join('/');

        const escapedRoot = target.startsWith('..');
        if (!escapedRoot) {
            let key = target.replace(/\.md$/, '');
            if (key === '' || key.endsWith('/')) key = `${key}index`;
            if (!pages.has(key) && pages.has(`${key}/index`)) key = `${key}/index`;
            if (pages.has(key)) {
                const rel = relative(outDir, pages.get(key)).split('\\').join('/');
                return `${rel || basename(pages.get(key))}${hash}`;
            }
        }

        // 4. Anything else lives in the repository and not on this site.
        const repoPath = escapedRoot
            ? resolve('/docs', target).replace(/^\//, '')
            : `docs/${target}`;
        const abs = join(REPO_ROOT, repoPath);
        const isDir = rawPath.endsWith('/') || (existsSync(abs) && statSync(abs).isDirectory());
        return `${isDir ? TREE : BLOB}${repoPath.replace(/\/$/, '')}${hash}`;
    };

    // Screenshots already sit in website/assets/ byte-for-byte, so a docs page
    // points at that copy. Anything else under docs/images/ is copied across.
    const copiedImages = [];
    const makeImgRewriter = (srcDir, outDir, depth) => (src) => {
        if (/^(https?:|data:|\/\/)/.test(src)) return src;
        const repoPath = src.startsWith('/')
            ? `docs/${src.replace(/^\//, '')}`
            : `docs/${join(srcDir, src).split('\\').join('/')}`;
        const abs = join(REPO_ROOT, repoPath);
        const base = basename(repoPath);
        const inAssets = join(ASSETS, base);
        if (existsSync(abs) && existsSync(inAssets)
            && readFileSync(abs).equals(readFileSync(inAssets))) {
            return `${relPrefix(depth)}assets/${base}`;
        }
        if (existsSync(abs)) {
            const dest = join(HERE, 'docs', relative(DOCS_SRC, abs));
            copiedImages.push({ abs, dest });
            return relative(outDir, `docs/${relative(DOCS_SRC, abs)}`).split('\\').join('/');
        }
        missing.push(`image ${src} referenced from docs/${srcDir || '.'} has no file at ${repoPath}`);
        return src;
    };

    // ── Sidebar, from the VitePress configuration ────────────────────
    const config = (await import(pathToFileURL(join(DOCS_SRC, '.vitepress/config.mjs')).href)).default;
    const sidebarSpec = config.themeConfig.sidebar;
    const groups = [];
    const claimed = new Set();
    for (const prefix of Object.keys(sidebarSpec)) {
        for (const group of sidebarSpec[prefix]) {
            const items = group.items.map((it) => {
                const key = it.link.replace(/^\//, '').replace(/\/$/, '/index') || 'index';
                claimed.add(key);
                return { text: it.text, key };
            });
            groups.push({ text: group.text, items });
        }
    }
    const labels = new Map(sources.map((s) => [s.key, s.name]));
    labels.set('changelog', 'Changelog');
    labels.set('license', 'License');
    for (const d of generatedIndexes) {
        labels.set(`${d}/index`, `${d.charAt(0).toUpperCase()}${d.slice(1)}`);
    }
    const other = [...pages.keys()]
        .filter((k) => !claimed.has(k) && k !== 'index')
        .sort((a, b) => a.localeCompare(b, 'en'))
        .map((key) => ({ text: labels.get(key) || key, key }));
    groups.push({ text: 'Other documents', items: other });

    const sidebarFor = (currentKey, outDir) => {
        const parts = ['            <nav class="docs-sidebar" aria-label="Documentation">'];
        for (const g of groups) {
            const openHere = g.items.some((it) => it.key === currentKey);
            parts.push(`                <details class="docs-group"${openHere ? ' open' : ''}>`);
            parts.push(`                    <summary>${escapeHtml(g.text)}</summary>`);
            for (const it of g.items) {
                const href = pages.has(it.key)
                    ? relative(outDir, pages.get(it.key)).split('\\').join('/')
                    : null;
                if (!href) { missing.push(`sidebar entry ${it.key} has no rendered page`); continue; }
                const cur = it.key === currentKey ? ' aria-current="page"' : '';
                parts.push(`                    <a href="${href}"${cur}>${escapeHtml(it.text)}</a>`);
            }
            parts.push('                </details>');
        }
        parts.push('            </nav>');
        return parts.join('\n');
    };

    // ── Write the pages ─────────────────────────────────────────────
    if (existsSync(DOCS_OUT)) rmSync(DOCS_OUT, { recursive: true });
    const written = [];
    const write = (relPath, html) => {
        const abs = join(HERE, relPath);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, html, 'utf8');
        written.push(relPath);
    };

    const firstParagraph = (body) => {
        const m = body.match(/<p>([\s\S]*?)<\/p>/);
        const t = m ? textOf(m[1]).replace(/\s+/g, ' ').trim() : '';
        return t.length > 180 ? `${t.slice(0, 177)}…` : t;
    };

    const titleFor = (name) => `${name} · Rohy docs`;

    for (const s of sources) {
        const outPath = `docs/${s.out}`;
        const outDir = dirname(outPath);
        const depth = outPath.split('/').length - 1;
        const { front, body: mdBody } = splitFrontmatter(readFileSync(s.abs, 'utf8'));
        const escapedTokens = [];
        const { body, sections, h1 } = renderBody(mdBody, {
            rewriteHref: makeRewriter(dirname(s.rel) === '.' ? '' : dirname(s.rel), outDir),
            rewriteImgSrc: makeImgRewriter(dirname(s.rel) === '.' ? '' : dirname(s.rel), outDir, depth),
            escapedTokens,
        });
        if (escapedTokens.length) escapedByFile.set(s.rel, escapedTokens);

        const isHome = s.key === 'index';
        const name = isHome ? 'Documentation' : siteName(frontTitle(front) || h1 || s.name);
        const cards = isHome ? cardGrid(groups, pages, outDir) : '';
        write(outPath, shell({
            depth,
            title: isHome ? 'Rohy docs' : titleFor(name),
            description: firstParagraph(body) || `${name}. Rohy documentation.`,
            current: 'docs',
            eyebrow: isHome ? 'Documentation' : sectionLabel(s.rel),
            headline: escapeHtml(name),
            lead: '',
            subnav: subnavHtml(sections),
            sidebar: sidebarFor(s.key, outDir),
            body: body + cards,
        }));
    }

    for (const d of generatedIndexes) {
        const outPath = `docs/${d}/index.html`;
        const outDir = dirname(outPath);
        const depth = outPath.split('/').length - 1;
        const items = sources.filter((s) => dirname(s.rel) === d)
            .map((s) => {
                const href = relative(outDir, `docs/${s.out}`).split('\\').join('/');
                return `<li><a href="${href}">${escapeHtml(basename(s.rel, '.md'))}</a></li>`;
            }).join('\n');
        const name = `${d.charAt(0).toUpperCase()}${d.slice(1)}`;
        write(outPath, shell({
            depth,
            title: titleFor(name),
            description: `Every document under docs/${d}/.`,
            current: 'docs',
            eyebrow: 'Documentation',
            headline: escapeHtml(name),
            lead: `Every document under <code>docs/${escapeHtml(d)}/</code>.`,
            sidebar: sidebarFor(`${d}/index`, outDir),
            body: `<ul>\n${items}\n</ul>`,
        }));
    }

    // CHANGELOG and LICENSE from the repository root.
    {
        const outPath = 'docs/changelog.html';
        const escapedTokens = [];
        const { body, sections } = renderBody(readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'), {
            rewriteHref: (h) => (/^(https?:|mailto:|#)/.test(h) ? h : BLOB + h.replace(/^\.\//, '')),
            rewriteImgSrc: (s2) => s2,
            escapedTokens,
        });
        if (escapedTokens.length) escapedByFile.set('CHANGELOG.md', escapedTokens);
        write(outPath, shell({
            depth: 1,
            title: titleFor('Changelog'),
            description: 'Every released version of Rohy with the changes it carried.',
            current: 'docs',
            eyebrow: 'Documentation',
            headline: 'Changelog',
            lead: 'Every released version of Rohy with the changes it carried.',
            subnav: subnavHtml(sections.slice(0, 12)),
            sidebar: sidebarFor('changelog', 'docs'),
            body,
        }));
    }
    {
        const text = readFileSync(join(REPO_ROOT, 'LICENSE'), 'utf8');
        write('docs/license.html', shell({
            depth: 1,
            title: titleFor('License'),
            description: 'The Carm Research License v1.4, the licence Rohy is released under.',
            current: 'docs',
            eyebrow: 'Documentation',
            headline: 'License',
            lead: 'The Carm Research License v1.4, the licence Rohy is released under.',
            sidebar: sidebarFor('license', 'docs'),
            body: `<pre><code>${escapeHtml(text.trimEnd())}</code></pre>`,
        }));
    }

    for (const img of copiedImages.sort((a, b) => a.dest.localeCompare(b.dest, 'en'))) {
        mkdirSync(dirname(img.dest), { recursive: true });
        copyFileSync(img.abs, img.dest);
        written.push(relative(HERE, img.dest));
    }

    // ── Every rewritten in-site target must exist ───────────────────
    const targets = [];
    for (const relPath of written.filter((p) => p.endsWith('.html'))) {
        const html = readFileSync(join(HERE, relPath), 'utf8');
        const dir = dirname(relPath);
        for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
            const h = m[1];
            if (/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(h)) continue;
            const [p] = h.split('#');
            if (!p) continue;
            targets.push({ page: relPath, target: join(HERE, dir, p) , raw: h });
        }
    }
    for (const t of targets) {
        if (!existsSync(t.target)) missing.push(`${t.page} → ${t.raw}`);
    }

    // ── Report ──────────────────────────────────────────────────────
    for (const [file, toks] of [...escapedByFile.entries()].sort()) {
        console.log(`escaped in ${file}: ${[...new Set(toks)].sort().join(' ')}`);
    }
    console.log(`pages written: ${written.filter((p) => p.endsWith('.html')).length}`);
    console.log(`images copied: ${copiedImages.length} (screenshots reuse website/assets/)`);
    console.log(`link targets checked: ${targets.length}`);
    console.log(`missing link targets: ${missing.length}`);
    if (missing.length) {
        for (const m of missing.sort()) console.error(`  MISSING ${m}`);
        process.exitCode = 1;
    }
}

function sectionLabel(relPath) {
    const dir = dirname(relPath);
    if (dir === '.') return 'Documentation';
    const head = dir.split('/')[0];
    return head.charAt(0).toUpperCase() + head.slice(1);
}

function cardGrid(groups, pages, outDir) {
    const cards = groups.map((g) => {
        const links = g.items
            .filter((it) => pages.has(it.key))
            .map((it) => {
                const href = relative(outDir, pages.get(it.key)).split('\\').join('/');
                return `<a href="${href}">${escapeHtml(it.text)}</a>`;
            }).join('\n                ');
        return `        <div class="docs-card">
            <h3>${escapeHtml(g.text)}</h3>
            <div class="docs-card-links">
                ${links}
            </div>
        </div>`;
    }).join('\n');
    return `\n<div class="docs-cards">\n${cards}\n</div>\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
