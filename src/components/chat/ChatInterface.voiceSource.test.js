// Regression lock: a reload restored a stale case copy from localStorage and the patient spoke with the persona voice instead of the configured one; the alarm-speech path failed silently (QA 2026-10-04, PRV-29)
//
// ChatInterface holds two copies of the case: `activeCase` (possibly restored
// from localStorage, so possibly older than the case) and `caseSnapshot` (the
// session's server snapshot, the truth for a running session). Patient voice
// must resolve from the snapshot first, and a configured voice that cannot
// play must be reported on the alarm-speech path too. Mounting the chat with a
// live session is heavy, so these are source contracts.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ChatInterface.jsx'), 'utf8');

describe('ChatInterface patient voice source', () => {
    it('never resolves the patient voice from the bare local activeCase copy', () => {
        expect(src).not.toMatch(/resolveSpeakerVoice\(\s*activeCase\?\.config\?\.voice/);
        const snapshotFirst = src.match(/resolveSpeakerVoice\(\(caseSnapshot\?\.config \?\? activeCase\?\.config\)\?\.voice/g) || [];
        expect(snapshotFirst.length).toBe(2); // the reply path and the alarm path
    });

    it('reports an unplayable configured voice on the alarm-speech path', () => {
        const alarmPath = src.slice(src.indexOf('const speakPatientAlarm = useCallback'), src.indexOf('const speakPatientAlarm = useCallback') + 1500);
        expect(alarmPath).toMatch(/r\.tier === 'invalid'/);
        expect(alarmPath).toMatch(/voice_wrong_provider/);
    });
});
