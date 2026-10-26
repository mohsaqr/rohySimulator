// Regression lock: the canonical invite link `/register?invite=<token>` (and
// other credential-bearing query keys, and a raw JWT in the path) was written
// to the request log verbatim — only `…token=` keys were redacted
// (security audit 2026-10-26, L1-05 / L6-08).

import { describe, expect, it } from 'vitest';
import { redactRequestPath } from '../../server/middleware/requestLogger.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwidSI6ImEifQ.abcdefghijklmnopqrst';

describe('redactRequestPath — credential query keys and tokens (L1-05)', () => {
    it.each([
        ['/register?invite=ABCDEFGHJKLM', '/register?invite=[redacted]'],
        ['/rohy/register?invite=ABCD-EFGH-JKLM', '/rohy/register?invite=[redacted]'],
        ['/?invite_code=S&x=1', '/?invite_code=[redacted]&x=1'],
        ['/api/x?join_code=ABCD1234', '/api/x?join_code=[redacted]'],
        ['/api/x?code=123&page=2', '/api/x?code=[redacted]&page=2'],
        ['/api/x?api_key=sk-1&key=2', '/api/x?api_key=[redacted]&key=[redacted]'],
        ['/api/x?client_secret=s', '/api/x?client_secret=[redacted]'],
        ['/api/x?jwt=abc', '/api/x?jwt=[redacted]'],
        ['/api/x?auth=zzz#f', '/api/x?auth=[redacted]#f'],
        [`/api/x/${JWT}/y`, '/api/x/[redacted]/y'],
        [`/api/x?q=${JWT}`, '/api/x?q=[redacted]'],
    ])('%s → %s', (input, expected) => {
        expect(redactRequestPath(input)).toBe(expected);
    });

    it('leaves ordinary keys readable (a key must END in a credential word)', () => {
        for (const p of ['/api/x?tokens_used=5', '/api/x?keyword=abc', '/api/x?author=bob', '/api/x?page=2']) {
            expect(redactRequestPath(p)).toBe(p);
        }
    });
});
