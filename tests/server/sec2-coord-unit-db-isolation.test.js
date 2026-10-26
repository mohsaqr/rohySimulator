// Regression lock: in-process server tests must never open the developer's
// live server/database.sqlite. tests/server-setup.js defaults ROHY_DB to a
// temp file; this pins that default.
import { describe, it, expect } from 'vitest';
import path from 'node:path';

describe('server test setup isolates the unit-test database', () => {
    it('ROHY_DB is set and does not point into server/', () => {
        expect(process.env.ROHY_DB).toBeTruthy();
        const resolved = path.resolve(process.env.ROHY_DB);
        const devDb = path.resolve('server/database.sqlite');
        expect(resolved).not.toBe(devDb);
        expect(resolved.startsWith(path.resolve('server') + path.sep)).toBe(false);
    });
});
