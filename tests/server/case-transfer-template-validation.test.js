// readCaseDocument — what an imported persona template may carry.
//
// Regression lock: an imported case file wrote template avatar_url, role_title, context_filter, config and memory_access into agent_templates unvalidated — a javascript:/data: avatar, an unknown context_filter, a megabyte config row (security audit 2026-10-24)
import { describe, it, expect } from 'vitest';

process.env.ROHY_DB = ':memory:';
process.env.ROHY_NO_AUTO_SEED = '1';
const {
    readCaseDocument, CASE_DOCUMENT_FORMAT, CASE_DOCUMENT_VERSION,
    TEMPLATE_CONTEXT_FILTERS, TEMPLATE_ROLE_TITLE_MAX, TEMPLATE_CONFIG_MAX_BYTES,
} = await import('../../server/services/caseTransfer.js');

function docWith(template) {
    return {
        rohy_export: { format: CASE_DOCUMENT_FORMAT, format_version: CASE_DOCUMENT_VERSION },
        case: { name: 'Imported case' },
        related: { agents: [{ template: { agent_type: 'nurse', name: 'Nurse Joy', ...template } }] },
    };
}
const errorFor = (template) => readCaseDocument(docWith(template)).problem?.error ?? null;

describe('imported template validation', () => {
    it('accepts what an export from this server looks like', () => {
        expect(errorFor({
            role_title: 'Charge nurse',
            avatar_url: 'rb_medical_female_01.glb',
            context_filter: 'history',
            config: { knowledge: { scope: 'summary' } },
            memory_access: { history: true },
        })).toBeNull();
        expect(errorFor({ avatar_url: '/uploads/nurse.png' })).toBeNull();
        expect(errorFor({ avatar_url: './avatars/nurse.glb' })).toBeNull();
        expect(errorFor({ avatar_url: 'https://cdn.example.org/a.png' })).toBeNull();
        expect(errorFor({ avatar_url: null, context_filter: null, config: null })).toBeNull();
    });

    it('allows exactly the legacy context_filter ladder', () => {
        expect(TEMPLATE_CONTEXT_FILTERS).toEqual(['minimal', 'vitals', 'history', 'full']);
        for (const value of TEMPLATE_CONTEXT_FILTERS) expect(errorFor({ context_filter: value })).toBeNull();
        expect(errorFor({ context_filter: 'everything' })).toMatch(/context_filter must be one of/);
    });

    it.each([
        'javascript:alert(1)',
        'data:image/svg+xml,<svg onload=alert(1)>',
        'http://insecure.example.org/a.png',
        '/uploads/../server/.env',
        '/etc/passwd',
        'https://user:pw@example.org/a.png',
        'a b.png',
    ])('refuses avatar_url %s', (avatar) => {
        expect(errorFor({ avatar_url: avatar })).toMatch(/avatar_url/);
    });

    it('bounds role_title', () => {
        expect(errorFor({ role_title: 'x'.repeat(TEMPLATE_ROLE_TITLE_MAX) })).toBeNull();
        expect(errorFor({ role_title: 'x'.repeat(TEMPLATE_ROLE_TITLE_MAX + 1) })).toMatch(/role_title/);
        expect(errorFor({ role_title: 42 })).toMatch(/role_title/);
    });

    it('requires config / memory_access to be plain objects of bounded size', () => {
        expect(errorFor({ config: ['a'] })).toMatch(/config must be an object/);
        expect(errorFor({ memory_access: 'yes' })).toMatch(/memory_access must be an object/);
        const big = { blob: 'x'.repeat(TEMPLATE_CONFIG_MAX_BYTES) };
        expect(errorFor({ config: big })).toMatch(/config must serialise/);
        expect(errorFor({ memory_access: big })).toMatch(/memory_access must serialise/);
    });

    it('reports the problem with the invalid_case_file code', () => {
        expect(readCaseDocument(docWith({ context_filter: 'x' })).problem.code).toBe('invalid_case_file');
    });
});
