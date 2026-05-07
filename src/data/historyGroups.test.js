// Lock the canonical history grouping + the markdown formatter that feeds
// the AI patient's system prompt. The formatter's output is read by the LLM
// as part of the `### Medical History` block in ChatInterface, so any
// regression here directly affects how the model presents the history.

import { describe, expect, it } from 'vitest';
import { HISTORY_GROUPS, formatHistoryAsMarkdown } from './historyGroups.js';

describe('HISTORY_GROUPS — canonical structure', () => {
    it('declares exactly three groups in clinical reading order', () => {
        expect(HISTORY_GROUPS.map(g => g.key)).toEqual([
            'presentHistory',
            'pastMedical',
            'personalSocial',
        ]);
    });

    it('covers all 7 history fields exactly once across groups', () => {
        const allKeys = HISTORY_GROUPS.flatMap(g => g.fields.map(f => f.key));
        expect(allKeys.sort()).toEqual(
            ['allergies', 'chiefComplaint', 'family', 'hpi', 'pastMedical', 'pastSurgical', 'social'].sort(),
        );
    });

    it('is frozen so consumers cannot mutate the canonical structure', () => {
        expect(() => HISTORY_GROUPS.push({ key: 'rogue' })).toThrow();
    });
});

describe('formatHistoryAsMarkdown — AI prompt shape', () => {
    it('renders all populated fields under their group heading', () => {
        const md = formatHistoryAsMarkdown({
            chiefComplaint: 'Chest pain 2h',
            hpi: 'Sudden substernal',
            pastMedical: 'HTN',
            pastSurgical: 'Appy 2010',
            allergies: 'PCN',
            social: '1ppd',
            family: 'Father MI',
        });
        expect(md).toContain('**Present History:**');
        expect(md).toContain('**Past Medical:**');
        expect(md).toContain('**Personal & Social:**');
        expect(md).toContain('- Chief Complaint: Chest pain 2h');
        expect(md).toContain('- History of Present Illness: Sudden substernal');
        expect(md).toContain('- Past Surgical History: Appy 2010');
        expect(md).toContain('- Family History: Father MI');
    });

    it('omits empty fields without leaving dangling labels', () => {
        const md = formatHistoryAsMarkdown({ chiefComplaint: 'Headache' });
        expect(md).toContain('**Present History:**');
        expect(md).toContain('- Chief Complaint: Headache');
        expect(md).not.toContain('History of Present Illness');
        expect(md).not.toContain('**Past Medical:**');
        expect(md).not.toContain('**Personal & Social:**');
    });

    it('omits a whole group when none of its fields are populated', () => {
        const md = formatHistoryAsMarkdown({
            chiefComplaint: 'CP',
            family: 'Father MI',
            // no Past Medical fields populated
        });
        expect(md).toContain('**Present History:**');
        expect(md).toContain('**Personal & Social:**');
        expect(md).not.toContain('**Past Medical:**');
    });

    it('renders groups in the canonical order regardless of input key order', () => {
        const md = formatHistoryAsMarkdown({
            family: 'F',
            chiefComplaint: 'CP',
            allergies: 'A',
        });
        const presentIdx = md.indexOf('Present History');
        const pastIdx = md.indexOf('Past Medical');
        const socialIdx = md.indexOf('Personal & Social');
        expect(presentIdx).toBeLessThan(pastIdx);
        expect(pastIdx).toBeLessThan(socialIdx);
    });

    it('treats whitespace-only fields as empty (no token waste in the prompt)', () => {
        const md = formatHistoryAsMarkdown({
            chiefComplaint: 'CP',
            hpi: '   ',
            pastMedical: '\n\t\n',
        });
        expect(md).toContain('- Chief Complaint: CP');
        expect(md).not.toContain('History of Present Illness');
        expect(md).not.toContain('Past Medical History');
    });

    it('returns empty string for null/undefined/non-object input', () => {
        expect(formatHistoryAsMarkdown(null)).toBe('');
        expect(formatHistoryAsMarkdown(undefined)).toBe('');
        expect(formatHistoryAsMarkdown('not an object')).toBe('');
        expect(formatHistoryAsMarkdown({})).toBe('');
    });

    it('trims surrounding whitespace from values to keep prompt clean', () => {
        const md = formatHistoryAsMarkdown({ chiefComplaint: '  Headache  \n' });
        expect(md).toContain('- Chief Complaint: Headache');
        expect(md).not.toContain('  Headache');
    });
});
