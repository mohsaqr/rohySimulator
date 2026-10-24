// Pre-migration snapshot pruning (server/db.js pruneMigrationBackups).
//
// Regression lock: every release that shipped a migration left another full `<db>.bak.<ts>.<version>` copy beside the database and nothing ever removed them, so the disk filled release by release (security audit 2026-10-24)
import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ROHY_DB = ':memory:';
process.env.ROHY_NO_AUTO_SEED = '1';
const { pruneMigrationBackups, MIGRATION_BACKUPS_KEEP } = await import('../../server/db.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-bak-prune-'));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

function fixture(name, count) {
    const dir = fs.mkdtempSync(path.join(tmpRoot, `${name}-`));
    const dbPath = path.join(dir, 'database.sqlite');
    fs.writeFileSync(dbPath, 'db');
    const backups = Array.from({ length: count }, (_, i) => {
        const file = `${dbPath}.bak.2026-10-${String(i + 1).padStart(2, '0')}.00${i}`;
        fs.writeFileSync(file, 'x');
        // Distinct, increasing mtimes: index i is the (i+1)-th oldest.
        const t = new Date(Date.UTC(2026, 9, i + 1));
        fs.utimesSync(file, t, t);
        return file;
    });
    return { dir, dbPath, backups };
}
const quietLog = () => ({ info: vi.fn(), warn: vi.fn() });

describe('pruneMigrationBackups', () => {
    it('keeps the five newest snapshots by default and logs what it removed', async () => {
        expect(MIGRATION_BACKUPS_KEEP).toBe(5);
        const { dir, dbPath, backups } = fixture('eight', 8);
        const log = quietLog();
        const removed = await pruneMigrationBackups(dbPath, { log });
        expect(removed.sort()).toEqual(backups.slice(0, 3).sort());
        const left = fs.readdirSync(dir).filter((f) => f.includes('.bak.')).map((f) => path.join(dir, f)).sort();
        expect(left).toEqual(backups.slice(3).sort());
        expect(fs.existsSync(dbPath)).toBe(true);
        expect(log.info).toHaveBeenCalledWith('pre-migration backups pruned', expect.objectContaining({ kept: 5 }));
    });

    it('does nothing when there are no more than `keep` snapshots', async () => {
        const { dbPath, backups } = fixture('few', 3);
        const log = quietLog();
        expect(await pruneMigrationBackups(dbPath, { log })).toEqual([]);
        expect(backups.every((f) => fs.existsSync(f))).toBe(true);
        expect(log.info).not.toHaveBeenCalled();
    });

    it('touches only <db>.bak.* files, never the database, its WAL or another database\'s snapshots', async () => {
        const { dir, dbPath } = fixture('scoped', 7);
        const bystanders = ['database.sqlite-wal', 'database.sqlite-shm', 'other.sqlite.bak.2020-01-01.0001', 'notes.txt'];
        for (const f of bystanders) {
            fs.writeFileSync(path.join(dir, f), 'keep');
            const old = new Date(Date.UTC(2000, 0, 1));
            fs.utimesSync(path.join(dir, f), old, old);
        }
        await pruneMigrationBackups(dbPath, { keep: 1, log: quietLog() });
        for (const f of bystanders) expect(fs.existsSync(path.join(dir, f))).toBe(true);
        expect(fs.readdirSync(dir).filter((f) => f.startsWith('database.sqlite.bak.'))).toHaveLength(1);
    });

    it('reports an unreadable directory instead of throwing', async () => {
        const log = quietLog();
        await expect(pruneMigrationBackups(path.join(tmpRoot, 'missing', 'db.sqlite'), { log })).resolves.toEqual([]);
        expect(log.warn).toHaveBeenCalled();
    });
});
