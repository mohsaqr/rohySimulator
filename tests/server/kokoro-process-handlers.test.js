// kokoro-js pulls in phonemizer, whose Emscripten code registers process-wide
// handlers that rethrow every unhandled rejection and uncaught exception. With
// them installed, one failed fire-and-forget write killed the server under load
// (stability run, rc.47). The server must carry none of them: not at boot, and
// not once the speech library has been loaded.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(script) {
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, KOKORO_DISABLED: '' }, timeout: 120_000,
    }).trim().split('\n').pop());
}

describe('the speech library leaves the process error handling alone', () => {
    it('adds no process handlers at import, nor once kokoro-js is loaded', () => {
        // Regression lock: phonemizer's rethrowing handlers turned any unhandled rejection into a crash
        const counts = run(`
            const count = () => ['uncaughtException', 'unhandledRejection'].reduce((n, e) => n + process.listeners(e).length, 0);
            const atStart = count();
            const mod = await import('./server/services/kokoroTts.js');
            const afterImport = count();
            await mod._kokoroLibForTest();
            console.log(JSON.stringify({ atStart, afterImport, afterLoad: count() }));
        `);
        expect(counts).toEqual({ atStart: 0, afterImport: 0, afterLoad: 0 });
    }, 150_000);
});
