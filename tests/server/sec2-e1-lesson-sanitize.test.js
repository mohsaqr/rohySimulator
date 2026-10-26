// The lesson scrub reads tags the way a browser does, and runs to a fixpoint.
//
// Regression lock: three bypasses of the SEC-52 scrub (security audit
// 2026-10-26, L4-03): an unquoted attribute value holding a quote hid the
// next tag from the scrub but not from the browser; removing an inner
// <script> re-joined the outer pieces into a <script> (single pass); and SVG
// <animate>/<set> wrote a javascript: URL into href after the scan.
//
// Judged by what a real HTML parser builds from the output (jsdom, the same
// tokenizer a browser runs), not by string matching.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { sanitizeLessonHtml } from '../../server/lib/lessonSanitize.js';

const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'background', 'to', 'from', 'by', 'values'];

/** Everything a parsed document could execute or redirect with. */
function dangers(html) {
    const { document } = new JSDOM(`<!doctype html><body>${html}</body>`).window;
    const found = [];
    for (const el of document.querySelectorAll('*')) {
        const name = el.localName.toLowerCase();
        if (['script', 'base', 'meta', 'animate', 'set', 'animatemotion', 'animatetransform'].includes(name)) found.push(`<${name}>`);
        for (const attr of el.attributes) {
            const attrName = attr.name.toLowerCase();
            if (attrName.startsWith('on')) found.push(`${name}[${attrName}]`);
            if (attrName === 'srcdoc') found.push(`${name}[srcdoc]`);
            // eslint-disable-next-line no-control-regex -- a browser strips these from a URL before reading its scheme
            if (URL_ATTRS.includes(attrName) && /(?:^|;)\s*(?:javascript|vbscript):/i.test(attr.value.replace(/[\s\u0000-\u001f]/g, ''))) {
                found.push(`${name}[${attrName}=${attr.value}]`);
            }
        }
    }
    return found;
}

const BYPASSES = [
    ['an unquoted value holding quotes hides the next tag', `<a title=x'"y=" > <img src=x onerror=alert(1)> "'>`],
    ['an inner <script> re-forms an outer one', '<scr<script>ipt>alert(1)</scr<script>ipt>'],
    ['nested re-forming, three deep', '<scr<scr<script>ipt>ipt>alert(1)</scr<scr<script>ipt>ipt>'],
    ['SVG animate writes javascript: into href', '<svg><a><animate attributeName="href" to="javascript:alert(1)"/><text y="20">x</text></a></svg>'],
    ['SVG set with a values list', '<svg><a><set attributeName="href" values="#;javascript:alert(1)"/><text>x</text></a></svg>'],
    ['a tag hidden in a quoted value that a comment ends early', '<!-- <x title="--><img src=x onerror=alert(1)>"> -->'],
    ['a tag hidden in a quoted value inside <textarea>', '<textarea><x title="</textarea><img src=x onerror=alert(1)>"></textarea>'],
    ['a breakout tag inside SVG <style>', '<svg><style><img src=x onerror=alert(1)></style></svg>'],
    ['CDATA in SVG hiding a tag', '<svg><![CDATA[ > <x title="]]><img src=x onerror=alert(1)>"> ]]></svg>'],
    ['a bogus comment ending at the first >', '</ <x title="> <img src=x onerror=alert(1)>">'],
    ['a tag name that swallows the next tag', '<a<img src=x onerror=alert(1)>'],
    ['an unterminated tag at the end', '<p>x</p><img src=x onerror=alert(1)'],
    ['<base> rewriting every relative URL', '<base href="https://evil.example/"><a href="/x">x</a>'],
    ['<meta> refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example/">'],
    ['an SVG document in a data: URL', '<iframe src="data:image/svg+xml,<svg onload=alert(1)>"></iframe>'],
    ['NUL inside the handler name', '<img src=x o\u0000nerror=alert(1)>'],
];

describe('sanitizeLessonHtml — bypasses of the regex scrub', () => {
    it.each(BYPASSES)('%s', (_label, html) => {
        const out = sanitizeLessonHtml(html);
        expect(dangers(out)).toEqual([]);
        expect(sanitizeLessonHtml(out)).toBe(out); // a fixpoint
    });

    it('the harness itself sees the attacks in the raw input', () => {
        // Sanity check of dangers(): without the scrub most inputs are live.
        const live = BYPASSES.filter(([, html]) => dangers(html).length > 0).length;
        expect(live).toBeGreaterThanOrEqual(12);
    });
});

describe('sanitizeLessonHtml — keeps the DOM of authored markup', () => {
    it.each([
        '<p title="a<b">ok</p>',
        '<lecture-mcq data-q=\'{"a":"<b>"}\'>q</lecture-mcq>',
        '<img src="data:image/jpeg;base64,/9j/4AAQ" alt="x">',
        '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
        '<!-- a comment --><p>after</p>',
    ])('%s', (html) => {
        const parse = (h) => new JSDOM(`<!doctype html><body>${h}</body>`).window.document.body.innerHTML;
        expect(parse(sanitizeLessonHtml(html))).toBe(parse(html));
    });
});
