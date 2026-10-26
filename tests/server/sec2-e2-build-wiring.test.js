// Wiring requested by other lanes (security audit 2026-10-26):
//   - lane E1: the build must not snapshot the live public/uploads into dist/ → frontend/ (L4-05/L6-12)
//   - lane D:  server.js starts (and stops) the in-process retention scheduler (F-33)

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('vite build drops the live uploads directory', () => {
    // Regression lock: frontend/uploads held a copy of every upload, served after the original was deleted.
    it('removes <outDir>/uploads after the bundle is written, and nothing else', async () => {
        const config = (await import('../../vite.config.js')).default;
        const plugin = config.plugins.find((p) => p?.name === 'rohy-no-live-uploads-in-dist');
        expect(plugin).toBeTruthy();
        expect(plugin.apply).toBe('build');

        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-sec2-e2-vite-'));
        try {
            fs.mkdirSync(path.join(root, 'dist', 'uploads', 'bodymap'), { recursive: true });
            fs.writeFileSync(path.join(root, 'dist', 'uploads', 'bodymap', 'x.png'), 'x');
            fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<html></html>');
            fs.mkdirSync(path.join(root, 'dist', 'sounds'));
            fs.writeFileSync(path.join(root, 'dist', 'sounds', 'normal-heart.mp3'), 'x');
            plugin.configResolved({ root, build: { outDir: 'dist' } });
            plugin.closeBundle();
            expect(fs.existsSync(path.join(root, 'dist', 'uploads'))).toBe(false);
            expect(fs.existsSync(path.join(root, 'dist', 'index.html'))).toBe(true);
            expect(fs.existsSync(path.join(root, 'dist', 'sounds', 'normal-heart.mp3'))).toBe(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('server.js runs the retention scheduler', () => {
    const server = fs.readFileSync(path.join(repoRoot, 'server', 'server.js'), 'utf8');

    // Regression lock: retention_days was stored and never applied (no scheduler was started).
    it('starts it after migrations and stops it on shutdown', () => {
        expect(server).toContain("import { startRetentionScheduler } from './lib/retention.js';");
        const start = server.indexOf('retentionScheduler = startRetentionScheduler();');
        expect(start).toBeGreaterThan(server.indexOf('await dbReady'));
        expect(server).toContain('retentionScheduler?.stop();');
    });
});
