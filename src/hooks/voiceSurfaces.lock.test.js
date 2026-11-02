// Regression lock: every voice surface goes through the one voice-conversation
// engine (src/hooks/useVoiceConversation.js). Before it, the patient chat, the
// on-call phone, the debrief and the Bedside room each carried their own
// copy of "start the recogniser, collect the words, send on end"; hands-free
// existed in one of them, and two copies could open the recogniser at once.
// No component or plugin may call VoiceService.startListening directly.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['src/components', 'src/plugins'];

function sourceFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        if (!/\.(jsx?|tsx?|mjs)$/.test(name) || /\.test\.|\.spec\./.test(name)) return [];
        return [path];
    });
}

describe('voice surfaces use the shared engine', () => {
    it('no file under src/components or src/plugins calls VoiceService.startListening', () => {
        const files = SCANNED.flatMap((d) => sourceFiles(join(ROOT, d)));
        expect(files.length).toBeGreaterThan(50);
        const offenders = files
            .filter((f) => /VoiceService\s*\??\.\s*startListening\b/.test(readFileSync(f, 'utf8')))
            .map((f) => relative(ROOT, f));
        expect(offenders).toEqual([]);
    });

    it('the engine is the one place that does', () => {
        const engine = readFileSync(join(ROOT, 'src/hooks/useVoiceConversation.js'), 'utf8');
        expect(engine).toMatch(/VoiceService\.startListening\(/);
    });
});
