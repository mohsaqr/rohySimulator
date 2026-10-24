// sanitizeLessonHtml — the write-time scrub for teacher-authored lesson HTML.
//
// Regression lock: the old on*-handler regex required whitespace before the attribute name, so `<img src="x"/onerror=…>` and `<img src="x"onerror=…>` kept their handler; srcdoc/formaction and entity-encoded javascript: URLs also passed (security audit 2026-10-24)
import { describe, it, expect } from 'vitest';
import { sanitizeLessonHtml } from '../../server/lib/lessonSanitize.js';

const EXECUTES = /on[a-z]+\s*=|srcdoc|formaction|javascript|vbscript|data:text\/html/i;

describe('sanitizeLessonHtml — event handlers however introduced', () => {
    it.each([
        ['slash before the handler', '<img src="x"/onerror=alert(1)>'],
        ['closing quote straight into the handler', '<img src="x"onerror=alert(1)>'],
        ['whitespace (the case that always worked)', '<img src=x onerror="alert(1)">'],
        ['slash right after the tag name', '<svg/onload=alert(1)>'],
        ['upper case', '<IMG SRC="x" ONERROR="alert(1)">'],
        ['spaces around =', '<body onload =  "alert(1)">'],
        ['an unquoted value holding a stray quote', "<img src=x' onerror=alert(1)>"],
    ])('%s', (_label, html) => {
        const out = sanitizeLessonHtml(html);
        expect(out).not.toMatch(/on(error|load)/i);
    });

    it('keeps the attribute that came before the handler intact', () => {
        expect(sanitizeLessonHtml('<img src="x"onerror=alert(1)>')).toBe('<img src="x">');
        expect(sanitizeLessonHtml('<img src="x"/onerror=alert(1)>')).toBe('<img src="x"/>');
    });
});

describe('sanitizeLessonHtml — dangerous URLs and document-carrying attributes', () => {
    it.each([
        ['srcdoc', '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'],
        ['formaction', '<button formaction="javascript:alert(1)">b</button>'],
        ['xlink:href javascript:', '<svg><a xlink:href="javascript:alert(1)">x</a></svg>'],
        ['data:text/html src', '<iframe src="data:text/html,<b>x</b>"></iframe>'],
        ['tab inside the scheme (entity)', '<a href="java&#x09;script:alert(1)">x</a>'],
        ['named-entity colon', '<a href="javascript&colon;alert(1)">x</a>'],
        ['decimal-entity scheme', '<a href="&#106;avascript:alert(1)">x</a>'],
        ['leading space + mixed case', '<a href=" JaVaScRiPt:alert(1)">x</a>'],
        ['unquoted value', '<a href=javascript:alert(1)>x</a>'],
        ['vbscript:', '<a href="vbscript:msgbox(1)">x</a>'],
    ])('%s is removed', (_label, html) => {
        expect(sanitizeLessonHtml(html)).not.toMatch(EXECUTES);
    });

    it('removes <script> blocks and stray script tags', () => {
        expect(sanitizeLessonHtml('<script>alert(1)</script><p>k</p>')).toBe('<p>k</p>');
        expect(sanitizeLessonHtml('<p>a</p><script src="x.js">')).toBe('<p>a</p>');
    });
});

describe('sanitizeLessonHtml — leaves authored markup alone', () => {
    it.each([
        '<lecture-mcq data-q="1" class="a">q</lecture-mcq>',
        '<a href="https://example.org/online=1">a link whose path contains on…=</a>',
        '<p>He said "onwards=go" and left.</p>',
        '<img src="/uploads/a.png" alt="a > b" title=\'x onload=y\'>',
        '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>',
        '<img src="data:image/png;base64,iVBORw0KGgo=">',
        '<br/>',
        '<img src="a.png" />',
        '<img/src=x/onerror=alert(1)>', // a browser reads src="x/onerror=alert(1)": no handler exists
    ])('%s', (html) => {
        expect(sanitizeLessonHtml(html)).toBe(html);
    });

    it('passes non-strings and empty strings through', () => {
        expect(sanitizeLessonHtml('')).toBe('');
        expect(sanitizeLessonHtml(null)).toBe(null);
        expect(sanitizeLessonHtml(undefined)).toBe(undefined);
    });

    it('is idempotent', () => {
        const dirty = '<img src="x"/onerror=alert(1)><a href="javascript:1" title="t">x</a><p>ok</p>';
        const once = sanitizeLessonHtml(dirty);
        expect(sanitizeLessonHtml(once)).toBe(once);
    });
});
