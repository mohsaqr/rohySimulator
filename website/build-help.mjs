// Generates website/help.html from the repository README.md.
//
//   node website/build-help.mjs            (run from anywhere)
//
// The output is deterministic: the same README produces a byte-identical
// help.html. Edit README.md and re-run; help.html itself is generated and is
// overwritten on every run.
//
// The page shell, the Markdown pipeline and the slug function come from
// build-docs.mjs, so the header nav, the footer and every heading id on this
// page match the rendered documentation. Run build-docs.mjs first: a README
// link into docs/ becomes a link to the rendered page when that page exists.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBody, shell, subnavHtml } from './build-docs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const README = join(REPO_ROOT, 'README.md');
const OUT = join(HERE, 'help.html');
const ASSETS = join(HERE, 'assets');
const BLOB = 'https://github.com/mohsaqr/rohySimulator/blob/main/';

// A link to a rendered documentation page stays on this site. A website/ path
// becomes a sibling page. Anything else in the repository becomes a GitHub
// blob link, and an absolute URL is left alone.
function rewriteHref(href) {
    if (/^(https?:|mailto:|#|\/\/)/.test(href)) return href;
    if (href.startsWith('website/')) return href.slice('website/'.length);
    const clean = href.replace(/^\.\//, '');
    const [path, frag] = clean.split('#');
    const hash = frag === undefined ? '' : `#${frag}`;
    if (path.startsWith('docs/') && path.endsWith('.md')) {
        const rendered = `docs/${path.slice('docs/'.length).replace(/\.md$/, '.html')}`;
        if (existsSync(join(HERE, rendered))) return `${rendered}${hash}`;
    }
    return BLOB + clean;
}

// Screenshots live in website/assets/ under their basename.
function rewriteImgSrc(src) {
    if (/^(https?:|data:|\/\/)/.test(src)) return src;
    const base = src.split('/').pop();
    if (!existsSync(join(ASSETS, base))) {
        throw new Error(`image referenced by README.md is missing from website/assets/: ${base}`);
    }
    return `assets/${base}`;
}

const escapedTokens = [];
const { body, sections } = renderBody(readFileSync(README, 'utf8'), {
    rewriteHref, rewriteImgSrc, escapedTokens,
});

const description = 'The Rohy reference: status, requirements, install, the rooms, '
    + 'features, architecture, configuration, testing, documentation and licence.';

const html = shell({
    depth: 0,
    title: 'Help · Rohy',
    description,
    current: 'help',
    eyebrow: 'Help',
    headline: 'The Rohy <span class="accent">reference.</span>',
    lead: 'This page is generated from the repository README. It records what the '
        + 'platform is made of and how it is installed, configured, tested and '
        + 'licensed, with every figure taken from the source it describes.',
    subnav: subnavHtml(sections),
    body,
});

writeFileSync(OUT, html, 'utf8');
if (escapedTokens.length) {
    console.log(`escaped in README.md: ${[...new Set(escapedTokens)].sort().join(' ')}`);
}
console.log(`help.html written: ${sections.length} sections, ${html.length} bytes`);