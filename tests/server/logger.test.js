import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, _effectiveLevelForTest } from '../../server/logger.js';

let stdoutSpy;
let stderrSpy;
let originalEnv;

beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.LOG_FORMAT = 'json';
    process.env.NODE_ENV = 'test';
    delete process.env.LOG_LEVEL;
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
    process.env = originalEnv;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
});

function lastJsonOnStdout() {
    const calls = stdoutSpy.mock.calls;
    if (!calls.length) return null;
    const last = calls[calls.length - 1][0];
    return JSON.parse(last.trim());
}

function lastJsonOnStderr() {
    const calls = stderrSpy.mock.calls;
    if (!calls.length) return null;
    const last = calls[calls.length - 1][0];
    return JSON.parse(last.trim());
}

describe('logger — JSON output shape', () => {
    it('emits one JSON object per line with ts/level/component/msg', () => {
        const log = logger('auth');
        log.info('login ok');
        const entry = lastJsonOnStdout();
        expect(entry.level).toBe('info');
        expect(entry.component).toBe('auth');
        expect(entry.msg).toBe('login ok');
        expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('merges extra fields into the JSON output', () => {
        logger('auth').info('login', { user_id: 7, ip: '1.2.3.4' });
        const entry = lastJsonOnStdout();
        expect(entry.user_id).toBe(7);
        expect(entry.ip).toBe('1.2.3.4');
    });

    it('coerces non-string msg to a string', () => {
        logger('x').info(42);
        const entry = lastJsonOnStdout();
        expect(entry.msg).toBe('42');
    });
});

describe('logger — level routing (stdout vs stderr)', () => {
    it('info goes to stdout', () => {
        logger('x').info('hi');
        expect(stdoutSpy).toHaveBeenCalledTimes(1);
        expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('warn goes to stderr', () => {
        logger('x').warn('uh');
        expect(stderrSpy).toHaveBeenCalledTimes(1);
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('error goes to stderr', () => {
        logger('x').error('boom');
        expect(stderrSpy).toHaveBeenCalledTimes(1);
        const entry = lastJsonOnStderr();
        expect(entry.level).toBe('error');
    });
});

describe('logger — LOG_LEVEL filter', () => {
    it('LOG_LEVEL=warn drops info + debug', () => {
        process.env.LOG_LEVEL = 'warn';
        const log = logger('x');
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        // Only warn + error should have emitted.
        expect(stderrSpy).toHaveBeenCalledTimes(2);
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('default LOG_LEVEL=info passes info+ but not debug', () => {
        const log = logger('x');
        log.debug('d');
        log.info('i');
        expect(stdoutSpy).toHaveBeenCalledTimes(1); // info only
    });
});

describe('logger — child logger', () => {
    it('auto-merges baseline fields into every emit', () => {
        const log = logger('http').child({ request_id: 'req-42' });
        log.info('hi', { user: 'alice' });
        const entry = lastJsonOnStdout();
        expect(entry.request_id).toBe('req-42');
        expect(entry.user).toBe('alice');
        expect(entry.component).toBe('http');
    });

    it('emit-time fields override child baseline on key collision', () => {
        const log = logger('http').child({ request_id: 'baseline' });
        log.info('hi', { request_id: 'overridden' });
        const entry = lastJsonOnStdout();
        expect(entry.request_id).toBe('overridden');
    });
});

describe('_effectiveLevelForTest', () => {
    it('reflects the LOG_LEVEL env var', () => {
        process.env.LOG_LEVEL = 'error';
        expect(_effectiveLevelForTest()).toBe('error');
        process.env.LOG_LEVEL = 'debug';
        expect(_effectiveLevelForTest()).toBe('debug');
    });

    it('accepts ROHY_LOG_LEVEL as the server-wide level fallback', () => {
        delete process.env.LOG_LEVEL;
        process.env.ROHY_LOG_LEVEL = 'debug';
        expect(_effectiveLevelForTest()).toBe('debug');
    });

    it('defaults to info when LOG_LEVEL is unset', () => {
        delete process.env.LOG_LEVEL;
        delete process.env.ROHY_LOG_LEVEL;
        expect(_effectiveLevelForTest()).toBe('info');
    });

    it('defaults to info on an unknown level (no crash)', () => {
        process.env.LOG_LEVEL = 'wat';
        expect(_effectiveLevelForTest()).toBe('info');
    });
});
