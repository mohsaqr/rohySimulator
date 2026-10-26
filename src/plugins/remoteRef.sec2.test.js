// `remote:` references stay inside their plugin's content.
//
// Regression lock: resolveRemoteRef encoded segments with encodeURIComponent,
// which leaves `.` and `..` alone, so `remote:../../auth/verify` became
// `/api/plugins/pathology/../../auth/verify` — which the browser normalises to
// `/api/auth/verify`: case material choosing a cookie-authenticated GET to any
// /api route for every learner who opened it (security audit 2026-10-26, L5-04).
import { describe, it, expect } from 'vitest';
import { resolveRemoteRef, resolveRemoteRefs } from './context.js';

describe('resolveRemoteRef refuses references that leave the plugin', () => {
    it.each([
        'remote:../../auth/verify',
        'remote:tiles/../../../auth/verify',
        'remote:./x/../../admin',
        'remote:..',
        'remote:.',
        'remote://evil.example/x.dzi',
        'remote:https://evil.example/x.dzi',
        'remote:tiles\\..\\..\\auth',
        'remote:',
    ])('%s resolves to nothing', (ref) => {
        expect(resolveRemoteRef(ref, 'pathology')).toBe('');
    });

    it('a resolved address never climbs out of /api/plugins/<id>/', () => {
        const doc = { slides: [{ dzi: 'remote:../../users' }, { dzi: 'remote:tiles/a.dzi' }] };
        const resolved = resolveRemoteRefs(doc, 'pathology');
        expect(resolved.slides[0].dzi).toBe('');
        expect(new URL(resolved.slides[1].dzi, 'https://rohy.example').pathname).toBe('/api/plugins/pathology/tiles/a.dzi');
    });

    it.each([
        ['remote:tiles/a b.dzi', '/api/plugins/pathology/tiles/a%20b.dzi'],
        ['remote:/tiles/x.dzi', '/api/plugins/pathology/tiles/x.dzi'],
        ['remote:dicom/normal/ct_chest/s1/', '/api/plugins/pathology/dicom/normal/ct_chest/s1'],
        ['remote:_o/0123abcd.dzi', '/api/plugins/pathology/_o/0123abcd.dzi'],
        ['remote:tiles/..foo/x.dzi', '/api/plugins/pathology/tiles/..foo/x.dzi'],
    ])('still resolves an ordinary reference: %s', (ref, expected) => {
        expect(resolveRemoteRef(ref, 'pathology')).toBe(expected);
    });
});
