import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ALLOWLIST = [
    'server/dbAdapter.js',
    'server/db.js',
    'server/observability.js',
    'server/migrationRunner.js',
    'server/seeders/',
    'scripts/',
];

function isAllowlisted(filePath) {
    const relative = path.relative(REPO_ROOT, filePath);
    return ALLOWLIST.some((entry) => relative === entry || relative.startsWith(entry));
}

function findDirectDbAccess() {
    let raw = '';
    try {
        raw = execSync(
            `grep -rn --include='*.js' -E "\\\\bdb\\\\.(run|get|all|exec)\\\\b" ${path.join(REPO_ROOT, 'server')} ${path.join(REPO_ROOT, 'scripts')} 2>/dev/null || true`,
            { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
        );
    } catch {
        return [];
    }

    return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const m = line.match(/^([^:]+):(\d+):(.*)$/);
            if (!m) return null;
            return { filePath: m[1], line: m[2], content: m[3].trim() };
        })
        .filter(Boolean)
        .filter((finding) => !isAllowlisted(finding.filePath));
}

describe('database adapter boundary', () => {
    it('keeps route and middleware persistence calls behind dbAdapter', () => {
        const direct = findDirectDbAccess();
        if (direct.length > 0) {
            const report = direct
                .map((item) => `  ${path.relative(REPO_ROOT, item.filePath)}:${item.line}\n    ${item.content}`)
                .join('\n');
            throw new Error(`Found direct sqlite db access; use dbAdapter instead:\n${report}`);
        }

        expect(direct).toEqual([]);
    });
});
