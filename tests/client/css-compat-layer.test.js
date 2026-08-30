// Regression lock: the purple/violet/pink Tailwind compat layer in
// src/index.css remapped tint utilities with SUBSTRING attribute selectors —
// `[class*="bg-purple-50"]` also matches `hover:bg-purple-500` (the string
// "bg-purple-50" is a prefix of "bg-purple-500"), so solid accent CTAs were
// repainted with the near-white tint: the lab room's "Order N tests" button
// and selected rows rendered white-on-near-white at 1.19:1 contrast.
//
// The fix is `[class~="…-50"]` (exact whole-token match). This test fails if
// anyone reintroduces a substring selector for a `-50` tint, in either the
// scoped `.rohy-admin-light` block or the global compat block.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest runs from the repo root; import.meta.url is not a file: URL under
// the jsdom transform, so resolve from cwd instead.
const cssPath = resolve(process.cwd(), 'src/index.css');

describe('index.css compat layer — tint selectors are token-exact', () => {
    it('has no substring [class*="…-50"] selectors (they also match -500)', () => {
        const css = readFileSync(cssPath, 'utf8');
        const offenders = css
            .split('\n')
            .map((line, i) => ({ line: line.trim(), n: i + 1 }))
            .filter(({ line }) => /class\*="[^"]*-50"/.test(line));
        expect(offenders).toEqual([]);
    });

    it('the -50 tint selectors exist and use exact token matching', () => {
        const css = readFileSync(cssPath, 'utf8');
        // The tint remap itself must still be present — deleting it outright
        // would leak raw Tailwind purple into the themed UI.
        expect(css).toMatch(/\[class~="bg-purple-50"\]/);
        expect(css).toMatch(/\[class~="hover:bg-purple-50"\]:hover/);
    });
});
