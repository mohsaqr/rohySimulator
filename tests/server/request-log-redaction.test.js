// Request-log path redaction (middleware/requestLogger.js).
//
// Regression lock: the access log recorded req.originalUrl verbatim, so every previewed invite token (/api/auth/invite/<token>) and any ?token= value sat in the logs, usable by anyone with log access until claimed (security audit 2026-10-24)
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { redactRequestPath, requestLoggerMiddleware } from '../../server/middleware/requestLogger.js';

describe('redactRequestPath', () => {
    it.each([
        ['/api/auth/invite/abc123DEF', '/api/auth/invite/[redacted]'],
        ['/rohy/api/auth/invite/abc123?x=1', '/rohy/api/auth/invite/[redacted]?x=1'],
        ['/api/x?token=s3cret&y=2', '/api/x?token=[redacted]&y=2'],
        ['/api/x?a=1&invite_token=s3cret', '/api/x?a=1&invite_token=[redacted]'],
        ['/api/x?TOKEN=s3cret#frag', '/api/x?TOKEN=[redacted]#frag'],
    ])('%s → %s', (input, expected) => {
        expect(redactRequestPath(input)).toBe(expected);
    });

    it('leaves paths without credentials untouched', () => {
        for (const p of ['/api/cases/12', '/api/auth/login', '/api/x?tokens_used=5', '/api/x?page=2']) {
            expect(redactRequestPath(p)).toBe(p);
        }
        expect(redactRequestPath(undefined)).toBeUndefined();
    });
});

describe('requestLoggerMiddleware', () => {
    it('logs the redacted path, never the invite token', async () => {
        const written = [];
        const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { written.push(String(chunk)); return true; });
        try {
            const mw = requestLoggerMiddleware();
            const req = Object.assign(new EventEmitter(), {
                method: 'GET', path: '/api/auth/invite/SECRET-TOKEN-1',
                originalUrl: '/api/auth/invite/SECRET-TOKEN-1', url: '/api/auth/invite/SECRET-TOKEN-1',
                headers: {}, request_id: 'r1',
            });
            const res = Object.assign(new EventEmitter(), {
                statusCode: 404, getHeader: () => undefined, write: () => true, end: () => true,
            });
            mw(req, res, () => {});
            res.emit('finish');
        } finally {
            spy.mockRestore();
        }
        const requestLines = written.filter((line) => line.includes('"event":"request"') || line.includes('"event":"http_error"'));
        expect(requestLines.length).toBe(2);
        for (const line of requestLines) {
            expect(line).not.toContain('SECRET-TOKEN-1');
            expect(line).toContain('/api/auth/invite/[redacted]');
        }
    });
});
