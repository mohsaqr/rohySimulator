// Generates website/help.html from the repository README.md.
//
//   node website/build-help.mjs            (run from the repository root)
//
// The output is deterministic: the same README produces a byte-identical
// help.html. Edit README.md and re-run; help.html itself is generated and is
// overwritten on every run.
//
// The page shell (head, fixed header nav, footer, site.js) is copied from
// about.html so every page on the site carries identical chrome.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const README = join(REPO_ROOT, 'README.md');
const OUT = join(HERE, 'help.html');
const ASSETS = join(HERE, 'assets');
const BLOB = 'https://github.com/mohsaqr/rohySimulator/blob/main/';

// ── Helpers ──────────────────────────────────────────────────────────

const escapeHtml = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Strip inline markup and entities from a heading, then slugify. The same
// slug is written onto the <h2> id and into the subnav href, so the two can
// never disagree.
const slugify = (html) => html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

// A repository-relative path becomes a GitHub blob link; a website/ path
// becomes a sibling page on this site; an absolute URL is left alone.
function rewriteHref(href) {
    if (/^(https?:|mailto:|#|\/\/)/.test(href)) return href;
    if (href.startsWith('website/')) return href.slice('website/'.length);
    return BLOB + href.replace(/^\.\//, '');
}

// Screenshots live in website/assets/ under their basename.
function rewriteImgSrc(src) {
    if (/^(https?:|data:|\/\/)/.test(src)) return src;
    const base = src.split('/').pop();
    const local = join(ASSETS, base);
    if (!existsSync(local)) {
        throw new Error(`image referenced by README.md is missing from website/assets/: ${base}`);
    }
    return `assets/${base}`;
}

// ── Convert ──────────────────────────────────────────────────────────

const markdown = readFileSync(README, 'utf8');
let body = marked.parse(markdown, { async: false });

body = body
    .replace(/<img\s+src="([^"]*)"/g, (_, src) => `<img src="${escapeHtml(rewriteImgSrc(src))}"`)
    .replace(/<a\s+href="([^"]*)"/g, (_, href) => `<a href="${escapeHtml(rewriteHref(href))}"`);

// The README's single H1 becomes the hero headline, so drop it from the body.
body = body.replace(/^<h1>[\s\S]*?<\/h1>\s*/, '');

// Slug ids on the H2s, collected for the "On this page" row.
const sections = [];
body = body.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner) => {
    const id = slugify(inner);
    sections.push({ id, label: inner.replace(/<[^>]+>/g, '') });
    return `<h2 id="${id}">${inner}</h2>`;
});

// Every table scrolls inside its own container so the page never scrolls
// horizontally.
body = body.replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');

const subnav = sections
    .map((s) => `            <a href="#${s.id}">${s.label}</a>`)
    .join('\n');

// ── Page shell (identical chrome to about.html) ──────────────────────

const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Help — Rohy</title>
    <meta name="description" content="The Rohy reference: status, requirements, install, the rooms, features, architecture, configuration, testing, documentation and licence.">
    <meta name="theme-color" content="#09090b">

    <meta property="og:title" content="Help — Rohy">
    <meta property="og:description" content="The Rohy reference: status, requirements, install, the rooms, features, architecture, configuration, testing, documentation and licence.">
    <meta property="og:image" content="assets/patient-room.jpg">
    <meta property="og:type" content="article">
    <meta name="twitter:card" content="summary">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="site.css">
</head>
<body>

<!-- ── Fixed nav (identical on every page) ───────────────────── -->
<header class="nav">
    <div class="wrap">
        <a class="brand" href="index.html">
            <span class="brand-dot"></span>
            <span>rohy</span>
        </a>
        <nav class="nav-links" aria-label="Site">
            <a href="index.html">Overview</a>
            <a href="rooms.html">Rooms</a>
            <a href="whats-new.html">What's new</a>
            <a href="help.html" aria-current="page">Help</a>
            <a href="index.html#install" class="optional">Install</a>
            <a href="about.html">About the author</a>
            <a class="nav-cta" href="https://github.com/mohsaqr/rohySimulator" target="_blank" rel="noopener">GitHub →</a>
        </nav>
    </div>
</header>

<main>

<!-- ── Hero ──────────────────────────────────────────────────── -->
<section class="hero compact" id="top">
    <div class="wrap hero-inner">
        <span class="eyebrow accent">Help</span>
        <h1>The Rohy <span class="accent">reference.</span></h1>
        <p class="sub">
            This page is generated from the repository README. It records what the
            platform is made of and how it is installed, configured, tested and
            licensed, with every figure taken from the source it describes.
        </p>
        <nav class="subnav" aria-label="On this page">
            <span class="subnav-label">On this page</span>
${subnav}
        </nav>
    </div>
</section>

<!-- ── README ────────────────────────────────────────────────── -->
<section class="tight">
    <div class="wrap">
        <article class="md-body">
${body.trimEnd()}
        </article>
    </div>
</section>

</main>

<footer>
    <div class="wrap">
        <div class="footer-grid">
            <div class="footer-brand">
                <a class="brand" href="index.html">
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
                <a href="index.html">Overview</a>
                <a href="rooms.html">Rooms</a>
                <a href="whats-new.html">What's new</a>
                <a href="help.html">Help</a>
                <a href="about.html">About the author</a>
                <a href="index.html#install">Install</a>
            </div>
            <div class="footer-col">
                <h4>Project</h4>
                <a href="https://github.com/mohsaqr/rohySimulator" target="_blank" rel="noopener">GitHub</a>
                <a href="https://github.com/mohsaqr/rohySimulator/blob/main/README.md" target="_blank" rel="noopener">README</a>
                <a href="https://github.com/mohsaqr/rohySimulator/releases" target="_blank" rel="noopener">Releases</a>
                <a href="https://github.com/mohsaqr/rohySimulator/blob/main/LICENSE" target="_blank" rel="noopener">License</a>
            </div>
            <div class="footer-col">
                <h4>Docs</h4>
                <a href="https://rohy.lacarm.com/rohy/docs/trainee/" target="_blank" rel="noopener">Trainee guides</a>
                <a href="https://github.com/mohsaqr/rohySimulator/blob/main/docs/INSTALL.md" target="_blank" rel="noopener">Install</a>
                <a href="https://github.com/mohsaqr/rohySimulator/blob/main/docs/DEPLOY.md" target="_blank" rel="noopener">Deploy</a>
                <a href="https://github.com/mohsaqr/rohySimulator/blob/main/docs/UPDATING.md" target="_blank" rel="noopener">Updating</a>
                <a href="https://github.com/mohsaqr/rohySimulator/blob/main/migrations/MANIFEST.md" target="_blank" rel="noopener">Migrations</a>
            </div>
        </div>
        <div class="footer-bottom">
            <span>© 2026 Mohammed Saqr · <a href="https://github.com/mohsaqr/rohySimulator/blob/main/LICENSE" target="_blank" rel="noopener">Carm Research License v1.4</a> · <a href="https://www.saqr.me" target="_blank" rel="noopener">saqr.me</a></span>
            <span>Free for research, teaching, personal learning and non-profit use. Commercial use requires a paid licence.</span>
        </div>
    </div>
</footer>

<script src="site.js"></script>
</body>
</html>
`;

writeFileSync(OUT, html, 'utf8');
console.log(`help.html written: ${sections.length} sections, ${html.length} bytes`);
