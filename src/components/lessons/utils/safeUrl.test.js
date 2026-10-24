// The one URL allow-list of the lessons module (links, iframes, file addresses).
import { describe, it, expect } from 'vitest';
import { safeHref, safeEmbedSrc, safeFileHref } from './safeUrl.js';

describe('lesson URL allow-lists', () => {
    it('keeps http(s), gives a bare www. host https, and refuses every other scheme', () => {
        expect(safeHref('https://a.example/x')).toBe('https://a.example/x');
        expect(safeHref('  http://a.example ')).toBe('http://a.example');
        expect(safeHref('www.a.example')).toBe('https://www.a.example');
        ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//a.example', '/uploads/a.pdf', '', null, undefined]
            .forEach((u) => expect(safeHref(u)).toBe(''));
        expect(safeEmbedSrc).toBe(safeHref);
    });

    it('lets a file address be this server\'s /uploads or /api path, or http(s)', () => {
        expect(safeFileHref('/uploads/a.pdf')).toBe('/uploads/a.pdf');
        expect(safeFileHref('/api/x')).toBe('/api/x');
        expect(safeFileHref('https://cdn.example/a.pdf')).toBe('https://cdn.example/a.pdf');
        ['javascript:alert(1)', 'data:application/pdf;base64,AA', './uploads/a.pdf', '/etc/passwd', '//evil.example/a', '/uploadsx/a']
            .forEach((u) => expect(safeFileHref(u)).toBe(''));
    });
});
