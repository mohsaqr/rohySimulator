// Characterization of the Patient template resolver, extracted verbatim out
// of ChatInterface's agents loader. These tests pin the behaviour the chat
// room has today, so the 3D room now sharing it cannot change what the chat
// hears — and so the deliberate asymmetry (a female case never silently gets
// a male template) is recorded rather than looking like an oversight.

import { describe, it, expect, vi } from 'vitest';
import { resolvePatientTemplate, normalizePatientAgent } from './patientTemplate';

const template = (id, gender, extra = {}) => ({
    id,
    agent_type: 'patient',
    is_default: 1,
    name: `${gender} default`,
    config: JSON.stringify({ voice: { gender, case_voice: `${gender}-voice` } }),
    ...extra,
});

const caseOf = (gender) => ({ id: 'case-1', config: { demographics: { gender } } });

describe('resolvePatientTemplate', () => {
    it('prefers a per-case attached patient over any platform default', async () => {
        const fetchTemplates = vi.fn();
        const resolved = await resolvePatientTemplate(
            [{ agent_type: 'patient', id: 7, name: 'Mr Okonkwo', config: '{"voice":{"case_voice":"am_adam"}}' }],
            caseOf('Female'),
            fetchTemplates,
        );
        expect(resolved.config.voice.case_voice).toBe('am_adam');
        // The attached row settles it; the platform list is never fetched.
        expect(fetchTemplates).not.toHaveBeenCalled();
    });

    it('ignores a disabled attached patient and falls to the defaults', async () => {
        const resolved = await resolvePatientTemplate(
            [{ agent_type: 'patient', enabled: 0, id: 7, config: '{}' }],
            caseOf('Male'),
            async () => [template(1, 'male')],
        );
        expect(resolved.config.voice.gender).toBe('male');
    });

    it('matches the default template to the case gender', async () => {
        const templates = [template(1, 'female'), template(2, 'male')];
        const male = await resolvePatientTemplate([], caseOf('Male'), async () => templates);
        expect(male.config.voice.case_voice).toBe('male-voice');

        const female = await resolvePatientTemplate([], caseOf('Female'), async () => templates);
        expect(female.config.voice.case_voice).toBe('female-voice');
    });

    it('gives a non-binary or unspecified case the first non-female template', async () => {
        const templates = [template(1, 'female'), template(2, 'male')];
        for (const gender of ['Non-binary', 'Other', '']) {
            const resolved = await resolvePatientTemplate([], caseOf(gender), async () => templates);
            expect(resolved.config.voice.gender).toBe('male');
        }
    });

    it('refuses to give a female case a male template — a misconfig must be visible', async () => {
        const resolved = await resolvePatientTemplate(
            [], caseOf('Female'), async () => [template(2, 'male')],
        );
        expect(resolved).toBeNull();
    });

    it('survives a failed template fetch without a template', async () => {
        const resolved = await resolvePatientTemplate(
            [], caseOf('Male'), async () => { throw new Error('offline'); },
        );
        expect(resolved).toBeNull();
    });

    it('stamps the case it resolved for, so a case switch cannot cross personas', async () => {
        const resolved = await resolvePatientTemplate([], caseOf('Male'), async () => [template(1, 'male')]);
        expect(resolved._caseId).toBe('case-1');
    });
});

describe('normalizePatientAgent', () => {
    it('lets per-case overrides win over the template defaults', () => {
        const normalised = normalizePatientAgent({
            id: 3,
            agent_template_id: 9,
            name: 'Default Patient',
            name_override: 'Mrs Okonkwo',
            system_prompt: 'base',
            system_prompt_override: 'case specific',
            config_override: '{"voice":{"case_voice":"af_bella"}}',
        }, 'case-2');

        expect(normalised.templateId).toBe(9);
        expect(normalised.name).toBe('Mrs Okonkwo');
        expect(normalised.systemPrompt).toBe('case specific');
        expect(normalised.config.voice.case_voice).toBe('af_bella');
        expect(normalised._caseId).toBe('case-2');
    });

    it('returns null for a missing row rather than an empty persona', () => {
        expect(normalizePatientAgent(null)).toBeNull();
    });
});
