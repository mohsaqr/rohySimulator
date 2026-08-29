// RPS-1 §16 — the vendoring contract.
//
// rohy carries byte-identical copies of packages that live in their own repos:
// pathoyon's client and server halves, radoyon's client half. They are copied
// rather than depended on because rohy ships a Docker image and an air-gap
// source bundle, and a `file:../Radoyon` dependency resolves on a developer's
// laptop and nowhere else.
//
// THE FAILURE THIS GATE EXISTS FOR
//
// `src/components/pacs/` sat frozen at one upstream commit while both repos
// moved on, and nothing in rohy said so or could have. `portability.test.js`
// checks imports, not currency. The room's own tests exercise rohy's frozen
// copy, so they stay green against stale code. Byte-identity checked at the
// moment of copying is not the same as knowing, later, what you have.
//
// WHAT A STAMP CAN AND CANNOT PROVE
//
// It proves PROVENANCE (which package, version and commit this is) and
// INTEGRITY (nobody edited the copy in place). It cannot prove CURRENCY on its
// own: a copy three commits behind hashes perfectly against its own stamp.
// Staleness needs the upstream checkout, which CI does not have — so this file
// fails on a missing or mismatched stamp, and `npm run vendor:check` reports
// staleness on a machine where upstream is present.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VENDORED, STAMP_FILE, REPO_ROOT, hashTree, readStamp, verify } from '../../scripts/vendor-plugins.mjs';

describe('RPS-1 §16 — every vendored package is stamped and unmodified', () => {
    it('the registry is not empty, so this file cannot pass vacuously', () => {
        expect(VENDORED.length).toBeGreaterThanOrEqual(3);
        expect(VENDORED.map((e) => e.id)).toEqual(expect.arrayContaining(['pathology', 'pathology-server', 'pacs']));
    });

    it.each(VENDORED.map((e) => [e.id, e]))('%s: matches its stamp', (_id, entry) => {
        const result = verify(entry);
        // The whole result is asserted, so a failure names the reason rather
        // than printing `false !== true`.
        expect({ id: entry.id, ok: result.ok, reason: result.reason })
            .toEqual({ id: entry.id, ok: true, reason: 'matches its stamp' });
    });

    it.each(VENDORED.map((e) => [e.id, e]))('%s: its stamp carries usable provenance', (_id, entry) => {
        const stamp = readStamp(entry);
        expect(stamp).toBeTruthy();
        expect(stamp.package).toBe(entry.package);
        // A commit is what makes the copy reproducible; a version alone is not,
        // because a package can move without bumping.
        expect(stamp.commit).toMatch(/^[0-9a-f]{7,40}$/);
        expect(stamp.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(stamp.files).toBeGreaterThan(0);
        expect(stamp.hostOwned).toEqual(entry.hostOwned);
    });

    // The files rohy owns inside a vendored folder must survive re-vendoring;
    // if the copy deleted them, the gate on that package would disappear with
    // them and nothing would notice.
    it.each(VENDORED.map((e) => [e.id, e]))('%s: keeps the files rohy owns', (_id, entry) => {
        entry.hostOwned.forEach((file) => {
            expect({ file, present: existsSync(join(REPO_ROOT, entry.into, file)) })
                .toEqual({ file, present: true });
        });
    });

    // Non-vacuity: prove the hash actually responds to content.
    it('detects an edit to a vendored file', () => {
        const entry = VENDORED[0];
        const dir = join(REPO_ROOT, entry.into);
        const before = hashTree(dir, entry.hostOwned).sha256;
        expect(before).toBe(readStamp(entry).sha256);

        // Hash a tree with one byte changed, without touching the real one.
        const digestOf = (mutate) => {
            const { files } = hashTree(dir, entry.hostOwned);
            const d = createHash('sha256');
            files.forEach((f) => {
                d.update(f);
                const body = readFileSync(join(dir, f));
                d.update(f === files[0] ? mutate(body) : body);
            });
            return d.digest('hex');
        };
        expect(digestOf((b) => Buffer.concat([b, Buffer.from('//')]))).not.toBe(before);
    });

    // The stamp itself must not be part of what it describes, or writing it
    // would invalidate it.
    it('excludes the stamp and the host-owned files from the hash it records', () => {
        const entry = VENDORED[0];
        const { files } = hashTree(join(REPO_ROOT, entry.into), entry.hostOwned);
        expect(files).not.toContain(STAMP_FILE);
        entry.hostOwned.forEach((f) => expect(files).not.toContain(f));
    });
});
