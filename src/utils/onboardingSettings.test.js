import { describe, it, expect } from 'vitest';
import { parseOnboardingSettings } from './onboardingSettings';

describe('parseOnboardingSettings', () => {
    it('returns {} for missing prefs / missing column', () => {
        expect(parseOnboardingSettings(null)).toEqual({});
        expect(parseOnboardingSettings(undefined)).toEqual({});
        expect(parseOnboardingSettings({})).toEqual({});
        expect(parseOnboardingSettings({ onboarding_settings: null })).toEqual({});
    });

    it('parses the JSON-string storage form', () => {
        const prefs = { onboarding_settings: '{"first_run_done":1,"voice_mode":true}' };
        expect(parseOnboardingSettings(prefs)).toEqual({ first_run_done: 1, voice_mode: true });
    });

    it('passes an already-parsed object through', () => {
        const prefs = { onboarding_settings: { oyon_consent: false } };
        expect(parseOnboardingSettings(prefs)).toEqual({ oyon_consent: false });
    });

    it('returns {} on malformed JSON instead of throwing', () => {
        expect(parseOnboardingSettings({ onboarding_settings: 'not json' })).toEqual({});
        expect(parseOnboardingSettings({ onboarding_settings: 'null' })).toEqual({});
    });
});
