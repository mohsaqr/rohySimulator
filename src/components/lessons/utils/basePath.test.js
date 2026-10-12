// Lesson files are stored as `/uploads/…` (server-absolute). Displayed on an
// install served under a base path, they must carry it.
import { describe, it, expect, vi, afterEach } from 'vitest';

async function loadUnder(base) {
    vi.resetModules();
    vi.stubEnv('BASE_URL', base);
    const { withBasePath } = await import('./sanitize.js');
    const { resolveFileUrl } = await import('../api/client.js');
    return { withBasePath, resolveFileUrl };
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('lesson files under a base path', () => {
    it('prefixes stored /uploads/ and /api/ addresses, and only those', async () => {
        const { withBasePath, resolveFileUrl } = await loadUnder('/rohy/');
        expect(resolveFileUrl('/uploads/a.pdf')).toBe('/rohy/uploads/a.pdf');
        expect(resolveFileUrl('https://x.example/uploads/a.pdf')).toBe('https://x.example/uploads/a.pdf');
        expect(resolveFileUrl('./uploads/a.png')).toBe('./uploads/a.png');
        expect(resolveFileUrl(null)).toBe('');
        expect(withBasePath('<img src="/uploads/a.png"><a href=\'/uploads/b.pdf\'>b</a><a href="https://x.example/uploads/c">c</a><p>/uploads/d in prose</p>'))
            .toBe('<img src="/rohy/uploads/a.png"><a href=\'/rohy/uploads/b.pdf\'>b</a><a href="https://x.example/uploads/c">c</a><p>/uploads/d in prose</p>');
    });

    it('changes nothing at the root', async () => {
        const { withBasePath, resolveFileUrl } = await loadUnder('/');
        expect(resolveFileUrl('/uploads/a.pdf')).toBe('/uploads/a.pdf');
        expect(withBasePath('<img src="/uploads/a.png">')).toBe('<img src="/uploads/a.png">');
    });
});
