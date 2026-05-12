import { describe, expect, it } from 'vitest';
import { resolveAvatarId } from './resolveAvatar.js';
import { PROVIDER_FALLBACK_VOICE } from './voiceFallbacks.js';
import { resolveVoice } from './voiceResolver.js';

const PROVIDERS = ['piper', 'kokoro', 'google', 'openai'];
const SLOTS = ['male', 'female', 'child'];

const DEMO = {
    male: { gender: 'male', age: 42 },
    female: { gender: 'female', age: 42 },
    child: { gender: 'female', age: 9 },
};

const VOICE_ID = {
    piper: {
        male: 'piper-male.onnx',
        female: 'piper-female.onnx',
        child: 'piper-child.onnx',
        override: 'piper-override.onnx',
    },
    kokoro: {
        male: 'am_michael',
        female: 'af_bella',
        child: 'af_heart',
        override: 'am_adam',
    },
    google: {
        male: 'en-US-Chirp3-HD-Charon',
        female: 'en-US-Chirp3-HD-Aoede',
        child: 'en-US-Chirp3-HD-Leda',
        override: 'en-US-Neural2-D',
    },
    openai: {
        male: 'onyx',
        female: 'nova',
        child: 'shimmer',
        override: 'echo',
    },
};

function voiceSettings(activeProvider) {
    const out = {
        tts_provider: activeProvider,
        tts_rate: 0.88,
        tts_pitch: -1.5,
    };
    for (const provider of PROVIDERS) {
        for (const slot of SLOTS) {
            out[`voice_${provider}_${slot}`] = VOICE_ID[provider][slot];
        }
    }
    return out;
}

function personaDefaults() {
    const out = {
        default_rate_male: 1.11,
        default_pitch_male: 2.25,
        default_rate_female: 0.91,
        default_pitch_female: -2.25,
        default_rate_child: 1.05,
        default_pitch_child: 1.25,
    };
    for (const provider of PROVIDERS) {
        for (const slot of SLOTS) {
            out[`default_voice_${provider}_${slot}`] = `${VOICE_ID[provider][slot]}::persona`;
        }
    }
    return out;
}

const avatarManifest = {
    all: [
        { id: 'avatar-male.glb', label: 'Adult Male', gender: 'male', age: 'middle' },
        { id: 'avatar-female.glb', label: 'Adult Female', gender: 'female', age: 'middle' },
        { id: 'avatar-child-male.glb', label: 'Male Child', gender: 'male', age: 'child' },
        { id: 'avatar-child-female.glb', label: 'Female Child', gender: 'female', age: 'child' },
        { id: 'avatar-fallback.glb', label: 'Fallback' },
    ],
    male: { middle: ['avatar-male.glb'] },
    female: { middle: ['avatar-female.glb'] },
    child: ['avatar-child-male.glb', 'avatar-child-female.glb'],
    fallback: ['avatar-fallback.glb'],
};

const avatarDefaults = {
    default_avatar_male: 'avatar-male.glb',
    default_avatar_female: 'avatar-female.glb',
    default_avatar_child: 'avatar-child-female.glb',
};

// 2026-05-12 — voice resolver collapsed to two tiers. Legacy platform fields
// (`voice_<provider>_<slot>` from the Voice tab, `default_voice_<provider>_<slot>`
// from the Avatars tab) are no longer read. case_voice is THE source; if it's
// blank, the resolver falls through to PROVIDER_FALLBACK_VOICE (or null for
// piper). The assertions below lock that contract explicitly: legacy fields
// are present in the fixtures but MUST be ignored.

describe('exhaustive TTS inherit/override audit (case_voice is the only voice source)', () => {
    it('without case_voice, every provider × slot falls through to the hardcoded fallback (or null for piper)', () => {
        const platformAvatars = personaDefaults();
        for (const provider of PROVIDERS) {
            for (const slot of SLOTS) {
                const resolved = resolveVoice({
                    voice: {},
                    voiceSettings: voiceSettings(provider), // legacy slot keys present
                    platformAvatars,                       // legacy persona-voice keys present
                    ...DEMO[slot],
                });
                const hardcoded = PROVIDER_FALLBACK_VOICE[provider]?.[slot] || null;
                expect(resolved, `${provider}/${slot}`).toMatchObject({
                    provider,
                    file: hardcoded,
                    tier: hardcoded ? 'hardcoded' : null,
                    // Rate/pitch chain is independent of which voice file is
                    // picked — persona default beats voice-settings global.
                    rate: platformAvatars[`default_rate_${slot}`],
                    pitch: platformAvatars[`default_pitch_${slot}`],
                });
            }
        }
    });

    it('case_voice is THE source for every provider × slot — legacy fields are ignored', () => {
        for (const provider of PROVIDERS) {
            for (const slot of SLOTS) {
                const resolved = resolveVoice({
                    voice: {
                        case_voice: VOICE_ID[provider].override,
                        tts_rate: 1.23,
                        tts_pitch: 4.5,
                    },
                    voiceSettings: voiceSettings(provider),
                    platformAvatars: personaDefaults(),
                    ...DEMO[slot],
                });

                expect(resolved, `${provider}/${slot}`).toMatchObject({
                    provider,
                    file: VOICE_ID[provider].override,
                    tier: 'override',
                    rate: 1.23,
                    pitch: 4.5,
                });
            }
        }
    });

    it('provider override is honored even without case_voice (still falls to hardcoded)', () => {
        for (const platformProvider of PROVIDERS) {
            for (const providerOverride of PROVIDERS) {
                for (const slot of SLOTS) {
                    const resolved = resolveVoice({
                        voice: { tts_provider: providerOverride },
                        voiceSettings: voiceSettings(platformProvider),
                        platformAvatars: {},
                        ...DEMO[slot],
                    });
                    const hardcoded = PROVIDER_FALLBACK_VOICE[providerOverride]?.[slot] || null;
                    expect(resolved, `${platformProvider}->${providerOverride}/${slot}`).toMatchObject({
                        provider: providerOverride,
                        file: hardcoded,
                        tier: hardcoded ? 'hardcoded' : null,
                    });
                }
            }
        }
    });
});

describe('Cartesian TTS resolver audit — every inherit and override branch', () => {
    const providerOptions = [
        { label: 'inherit undefined', value: undefined },
        { label: 'inherit empty string', value: '' },
        ...PROVIDERS.map(provider => ({ label: `override ${provider}`, value: provider })),
    ];
    const personaModes = ['none', 'matching', 'wrong-provider', 'wrong-slot'];
    const voiceSlotModes = ['none', 'matching', 'wrong-provider', 'wrong-slot'];
    const caseVoiceModes = ['none', 'set'];

    function otherProvider(provider) {
        return PROVIDERS.find(p => p !== provider);
    }

    function otherSlot(slot) {
        return SLOTS.find(s => s !== slot);
    }

    function makeVoiceSettingsFor({ platformProvider, effectiveProvider, slot, voiceSlotMode }) {
        const out = { tts_provider: platformProvider };
        if (voiceSlotMode === 'matching') {
            out[`voice_${effectiveProvider}_${slot}`] = `voice-slot:${effectiveProvider}:${slot}`;
        }
        if (voiceSlotMode === 'wrong-provider') {
            out[`voice_${otherProvider(effectiveProvider)}_${slot}`] = `wrong-provider-slot:${slot}`;
        }
        if (voiceSlotMode === 'wrong-slot') {
            out[`voice_${effectiveProvider}_${otherSlot(slot)}`] = `wrong-slot:${effectiveProvider}`;
        }
        return out;
    }

    function makePersonaDefaultsFor({ effectiveProvider, slot, personaMode }) {
        const out = {};
        if (personaMode === 'matching') {
            out[`default_voice_${effectiveProvider}_${slot}`] = `persona:${effectiveProvider}:${slot}`;
        }
        if (personaMode === 'wrong-provider') {
            out[`default_voice_${otherProvider(effectiveProvider)}_${slot}`] = `wrong-provider-persona:${slot}`;
        }
        if (personaMode === 'wrong-slot') {
            out[`default_voice_${effectiveProvider}_${otherSlot(slot)}`] = `wrong-slot-persona:${effectiveProvider}`;
        }
        return out;
    }

    // New (post-2026-05-12) contract: ONLY case_voice picks the voice file.
    // The platform `voice_<provider>_<slot>` and `default_voice_<provider>_<slot>`
    // entries are present in the fixtures but the resolver must ignore them.
    // So `personaMode` and `voiceSlotMode` no longer affect the expected file
    // — but the test still iterates over them to prove the resolver doesn't
    // accidentally start reading them again.
    function expectedTier({ provider, slot, caseVoiceMode, personaMode: _personaMode, voiceSlotMode: _voiceSlotMode }) {
        if (caseVoiceMode === 'set') {
            return { file: `case:${provider}:${slot}`, tier: 'override' };
        }
        const hardcoded = PROVIDER_FALLBACK_VOICE[provider]?.[slot] || null;
        return hardcoded
            ? { file: hardcoded, tier: 'hardcoded' }
            : { file: null, tier: null };
    }

    it('checks the full provider x slot x platform x case-provider x case-voice x persona x voice-slot grid', () => {
        let checked = 0;

        for (const platformProvider of PROVIDERS) {
            for (const providerOption of providerOptions) {
                const effectiveProvider = providerOption.value || platformProvider;
                for (const slot of SLOTS) {
                    for (const caseVoiceMode of caseVoiceModes) {
                        for (const personaMode of personaModes) {
                            for (const voiceSlotMode of voiceSlotModes) {
                                const voice = {};
                                if (providerOption.value !== undefined) voice.tts_provider = providerOption.value;
                                if (caseVoiceMode === 'set') voice.case_voice = `case:${effectiveProvider}:${slot}`;

                                const resolved = resolveVoice({
                                    voice,
                                    voiceSettings: makeVoiceSettingsFor({
                                        platformProvider,
                                        effectiveProvider,
                                        slot,
                                        voiceSlotMode,
                                    }),
                                    platformAvatars: makePersonaDefaultsFor({
                                        effectiveProvider,
                                        slot,
                                        personaMode,
                                    }),
                                    ...DEMO[slot],
                                });
                                const expected = expectedTier({
                                    provider: effectiveProvider,
                                    slot,
                                    caseVoiceMode,
                                    personaMode,
                                    voiceSlotMode,
                                });

                                checked += 1;
                                expect(resolved, [
                                    `platform=${platformProvider}`,
                                    `caseProvider=${providerOption.label}`,
                                    `slot=${slot}`,
                                    `caseVoice=${caseVoiceMode}`,
                                    `persona=${personaMode}`,
                                    `voiceSlot=${voiceSlotMode}`,
                                ].join(' / ')).toMatchObject({
                                    provider: effectiveProvider,
                                    file: expected.file,
                                    tier: expected.tier,
                                });
                            }
                        }
                    }
                }
            }
        }

        expect(checked).toBe(2304);
    });

    it('checks rate and pitch precedence across override, persona default, global default, and empty values', () => {
        const valueModes = ['missing', 'empty', 'number', 'numeric-string', 'invalid'];
        const toValue = (mode, n) => {
            if (mode === 'missing') return undefined;
            if (mode === 'empty') return '';
            if (mode === 'number') return n;
            if (mode === 'numeric-string') return String(n);
            return 'not-a-number';
        };
        const expectedValue = (caseMode, personaMode, globalMode, caseValue, personaValue, globalValue) => {
            for (const [mode, value] of [
                [caseMode, caseValue],
                [personaMode, personaValue],
                [globalMode, globalValue],
            ]) {
                if (mode === 'missing' || mode === 'empty' || mode === 'invalid') continue;
                return Number(value);
            }
            return undefined;
        };
        let checked = 0;

        for (const slot of SLOTS) {
            for (const caseMode of valueModes) {
                for (const personaMode of valueModes) {
                    for (const globalMode of valueModes) {
                        const caseRate = toValue(caseMode, 1.23);
                        const personaRate = toValue(personaMode, 0.87);
                        const globalRate = toValue(globalMode, 1.05);
                        const casePitch = toValue(caseMode, 4.5);
                        const personaPitch = toValue(personaMode, -2.5);
                        const globalPitch = toValue(globalMode, 1.5);

                        const voice = { tts_provider: 'google' };
                        if (caseMode !== 'missing') {
                            voice.tts_rate = caseRate;
                            voice.tts_pitch = casePitch;
                        }
                        const platformAvatars = {};
                        if (personaMode !== 'missing') {
                            platformAvatars[`default_rate_${slot}`] = personaRate;
                            platformAvatars[`default_pitch_${slot}`] = personaPitch;
                        }
                        const settings = {
                            tts_provider: 'google',
                            voice_google_male: 'voice-male',
                            voice_google_female: 'voice-female',
                            voice_google_child: 'voice-child',
                        };
                        if (globalMode !== 'missing') {
                            settings.tts_rate = globalRate;
                            settings.tts_pitch = globalPitch;
                        }

                        const resolved = resolveVoice({
                            voice,
                            voiceSettings: settings,
                            platformAvatars,
                            ...DEMO[slot],
                        });

                        checked += 1;
                        expect(resolved.rate, `${slot}/${caseMode}/${personaMode}/${globalMode}/rate`)
                            .toBe(expectedValue(caseMode, personaMode, globalMode, caseRate, personaRate, globalRate));
                        expect(resolved.pitch, `${slot}/${caseMode}/${personaMode}/${globalMode}/pitch`)
                            .toBe(expectedValue(caseMode, personaMode, globalMode, casePitch, personaPitch, globalPitch));
                    }
                }
            }
        }

        expect(checked).toBe(375);
    });
});

describe('exhaustive avatar inherit/override audit', () => {
    it('inherits male/female/child platform avatar defaults by demographic slot', () => {
        for (const slot of SLOTS) {
            const resolved = resolveAvatarId({
                avatarId: '',
                gender: DEMO[slot].gender,
                manifest: avatarManifest,
                platformAvatars: avatarDefaults,
                patient: { id: `patient-${slot}`, ...DEMO[slot] },
            });

            expect(resolved, slot).toBe(avatarDefaults[`default_avatar_${slot}`]);
        }
    });

    it('explicit known avatars override inherited defaults for every demographic slot', () => {
        for (const slot of SLOTS) {
            const resolved = resolveAvatarId({
                avatarId: 'avatar-fallback.glb',
                gender: DEMO[slot].gender,
                manifest: avatarManifest,
                platformAvatars: avatarDefaults,
                patient: { id: `patient-${slot}`, ...DEMO[slot] },
            });

            expect(resolved, slot).toBe('avatar-fallback.glb');
        }
    });

    it('stale explicit avatars and mismatched platform defaults fall through to demographic picks', () => {
        const mismatchedDefaults = {
            default_avatar_male: 'avatar-female.glb',
            default_avatar_female: 'avatar-male.glb',
            default_avatar_child: 'avatar-male.glb',
        };

        expect(resolveAvatarId({
            avatarId: 'deleted.glb',
            gender: 'male',
            manifest: avatarManifest,
            platformAvatars: mismatchedDefaults,
            patient: { id: 'adult-male', gender: 'male', age: 42 },
        })).toBe('avatar-male.glb');

        expect(resolveAvatarId({
            avatarId: 'deleted.glb',
            gender: 'female',
            manifest: avatarManifest,
            platformAvatars: mismatchedDefaults,
            patient: { id: 'adult-female', gender: 'female', age: 42 },
        })).toBe('avatar-female.glb');

        expect(resolveAvatarId({
            avatarId: 'deleted.glb',
            gender: 'female',
            manifest: avatarManifest,
            platformAvatars: mismatchedDefaults,
            patient: { id: 'child-female', gender: 'female', age: 9 },
        })).toBe('avatar-child-female.glb');
    });
});

describe('Cartesian avatar resolver audit — explicit, platform default, demographic, fallback', () => {
    const explicitModes = ['none', 'matching', 'mismatched', 'stale'];
    const platformModes = ['none', 'matching', 'mismatched', 'stale'];

    const matchingAvatar = {
        male: 'avatar-male.glb',
        female: 'avatar-female.glb',
        child: 'avatar-child-female.glb',
    };
    const mismatchedAvatar = {
        male: 'avatar-female.glb',
        female: 'avatar-male.glb',
        child: 'avatar-male.glb',
    };

    function avatarForMode(mode, slot) {
        if (mode === 'none') return '';
        if (mode === 'matching') return matchingAvatar[slot];
        if (mode === 'mismatched') return mismatchedAvatar[slot];
        return 'deleted-avatar.glb';
    }

    it('checks every explicit-avatar state against every platform-default state and slot', () => {
        let checked = 0;

        for (const slot of SLOTS) {
            for (const explicitMode of explicitModes) {
                for (const platformMode of platformModes) {
                    const explicit = avatarForMode(explicitMode, slot);
                    const platformDefault = avatarForMode(platformMode, slot);
                    const resolved = resolveAvatarId({
                        avatarId: explicit,
                        gender: DEMO[slot].gender,
                        manifest: avatarManifest,
                        platformAvatars: {
                            [`default_avatar_${slot}`]: platformDefault,
                        },
                        patient: { id: `avatar-${slot}-${explicitMode}-${platformMode}`, ...DEMO[slot] },
                    });

                    const expected = explicitMode === 'matching' || explicitMode === 'mismatched'
                        ? explicit
                        : platformMode === 'matching'
                            ? platformDefault
                            : matchingAvatar[slot];

                    checked += 1;
                    expect(resolved, `${slot}/${explicitMode}/${platformMode}`).toBe(expected);
                }
            }
        }

        expect(checked).toBe(48);
    });

    it('falls back to manifest fallback when no slot default or demographic pool can resolve', () => {
        const sparseManifest = {
            all: [{ id: 'only-fallback.glb', label: 'Only Fallback' }],
            fallback: ['only-fallback.glb'],
        };
        let checked = 0;

        for (const slot of SLOTS) {
            for (const platformMode of ['none', 'stale']) {
                const resolved = resolveAvatarId({
                    avatarId: platformMode === 'stale' ? 'deleted-explicit.glb' : '',
                    gender: DEMO[slot].gender,
                    manifest: sparseManifest,
                    platformAvatars: {
                        [`default_avatar_${slot}`]: platformMode === 'stale' ? 'deleted-default.glb' : '',
                    },
                    patient: { id: `fallback-${slot}-${platformMode}`, ...DEMO[slot] },
                });
                checked += 1;
                expect(resolved, `${slot}/${platformMode}`).toBe('only-fallback.glb');
            }
        }

        expect(checked).toBe(6);
    });
});
