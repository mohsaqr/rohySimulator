// Contract tests for deploy/systemd/*.example.
//
// Regression lock: rohy.service.example made the whole repository writable (ReadWritePaths=/opt/repos/rohy) so a compromised process could rewrite server/*.js, kept every capability and address family, bound 0.0.0.0 behind a same-host nginx, and no unit verified the audit chain (security audit 2026-10-24)
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'deploy', 'systemd');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');

/** key → [values] for the uncommented directives of one unit file. */
function directives(src) {
    const out = {};
    for (const line of src.split('\n')) {
        const m = line.match(/^([A-Za-z]+)=(.*)$/);
        if (m) (out[m[1]] ||= []).push(m[2]);
    }
    return out;
}

describe('rohy.service.example', () => {
    const d = directives(read('rohy.service.example'));

    it('does not make the repository writable, only its runtime-writable spots', () => {
        const paths = d.ReadWritePaths.join(' ').split(/\s+/).map((p) => p.replace(/^-/, ''));
        expect(paths).not.toContain('/opt/repos/rohy');
        expect(paths).toContain('/opt/repos/rohy/public/uploads');
        // Code directories stay read-only; server/data (lab edits, Piper) is the
        // one writable spot under server/.
        for (const p of paths.filter((x) => x.startsWith('/opt/repos/rohy'))) {
            expect(p).not.toMatch(/^\/opt\/repos\/rohy\/(server|frontend|src|node_modules)\/?$/);
            expect(p).not.toMatch(/^\/opt\/repos\/rohy\/(frontend|src|node_modules)\//);
        }
    });

    it('carries the kernel / capability / syscall hardening', () => {
        expect(d.CapabilityBoundingSet).toEqual(['']);
        expect(d.RestrictAddressFamilies).toEqual(['AF_INET AF_INET6 AF_UNIX']);
        expect(d.ProtectKernelTunables).toEqual(['yes']);
        expect(d.ProtectControlGroups).toEqual(['yes']);
        expect(d.SystemCallFilter).toEqual(['@system-service']);
        expect(d.NoNewPrivileges).toEqual(['yes']);
    });

    it('binds the Node listener to loopback behind nginx', () => {
        expect(d.Environment).toContain('ROHY_BIND=127.0.0.1');
    });
});

describe('rohy-audit-verify.service/.timer examples', () => {
    const svc = directives(read('rohy-audit-verify.service.example'));
    const timer = directives(read('rohy-audit-verify.timer.example'));

    it('runs the chain verifier as a oneshot whose failure is visible', () => {
        expect(svc.Type).toEqual(['oneshot']);
        expect(svc.ExecStart[0]).toMatch(/scripts\/verify-audit-chain\.js/);
        // A wrapper that swallowed the exit code (`|| true`, `; exit 0`) would
        // hide tampering behind a green unit.
        expect(svc.ExecStart[0]).not.toMatch(/\|\||exit 0|^-/);
        expect(fs.existsSync(path.join(DIR, '..', '..', 'scripts', 'verify-audit-chain.js'))).toBe(true);
    });

    it('is scheduled daily and catches up after downtime', () => {
        expect(timer.OnCalendar[0]).toMatch(/^\*-\*-\* \d\d:\d\d(:\d\d)?$/);
        expect(timer.Persistent).toEqual(['yes']);
        expect(timer.WantedBy).toEqual(['timers.target']);
    });
});
