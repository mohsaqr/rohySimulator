import { describe, it, expect } from 'vitest';
import {
    consentRank, consentSatisfies, needsConsentUpgrade, consentPromptMode, acceptableVersion, OYON_CONSENT_CAMERA_ONLY,
} from './oyonConsent.js';

describe('oyonConsent version logic', () => {
    it('ranks unknown versions below v1 so they can never satisfy a check', () => {
        expect(consentRank('oyon-consent-v1')).toBe(0);
        expect(consentRank('oyon-consent-v2')).toBe(1);
        expect(consentRank('made-up')).toBe(-1);
        expect(consentSatisfies('made-up', 'oyon-consent-v1')).toBe(false);
    });

    // Mirrors the server reading a NULL accepted_version as v1 — the only
    // contract that existed before the column did.
    it('reads a missing accepted version as v1, not as current', () => {
        expect(consentSatisfies(undefined, 'oyon-consent-v1')).toBe(true);
        expect(consentSatisfies(undefined, 'oyon-consent-v2')).toBe(false);
        expect(consentSatisfies(null, 'oyon-consent-v2')).toBe(false);
    });

    it('accepts an equal or newer contract', () => {
        expect(consentSatisfies('oyon-consent-v2', 'oyon-consent-v2')).toBe(true);
        expect(consentSatisfies('oyon-consent-v2', 'oyon-consent-v1')).toBe(true);
        expect(consentSatisfies('oyon-consent-v1', 'oyon-consent-v2')).toBe(false);
    });

    // An out-of-date bundle must re-prompt rather than assume it is current.
    it('treats an unrecognised requirement as unsatisfied', () => {
        expect(consentSatisfies('oyon-consent-v2', 'oyon-consent-v9')).toBe(false);
    });

    describe('consentPromptMode', () => {
        const v3 = 'oyon-consent-v3';
        it('asks again someone who agreed to an older contract', () => {
            expect(consentPromptMode({ granted: true, acceptedVersion: 'oyon-consent-v1', requiredVersion: v3 })).toBe('upgrade');
        });
        it('asks nobody who is on the current contract or declined', () => {
            expect(consentPromptMode({ granted: true, acceptedVersion: v3, requiredVersion: v3 })).toBeNull();
            expect(consentPromptMode({ granted: false, acceptedVersion: null, requiredVersion: v3 })).toBeNull();
        });
        // Regression lock: an admin or educator who never answered was never
        // asked anywhere, so capture never ran on their account.
        it('asks someone who has never answered, unless a welcome page is about to', () => {
            expect(consentPromptMode({ granted: undefined, requiredVersion: v3 })).toBe('first');
            expect(consentPromptMode({ granted: null, requiredVersion: v3 })).toBe('first');
            expect(consentPromptMode({ granted: undefined, requiredVersion: v3, awaitingFirstRun: true })).toBeNull();
        });
    });

    describe('needsConsentUpgrade', () => {
        it('prompts a learner who said yes to an older contract', () => {
            expect(needsConsentUpgrade({
                granted: true, acceptedVersion: 'oyon-consent-v1', requiredVersion: 'oyon-consent-v2',
            })).toBe(true);
        });

        // Declining is an answer. Re-asking every load would be nagging; the
        // learner can opt in from Settings → Oyon whenever they want.
        it('does not nag a learner who declined', () => {
            expect(needsConsentUpgrade({
                granted: false, acceptedVersion: 'oyon-consent-v1', requiredVersion: 'oyon-consent-v2',
            })).toBe(false);
        });

        // Never answered → the first-run card handles them, not this prompt.
        // "Never answered" is the ABSENCE of a grant, which the `granted` check
        // already covers; it is not a grant with a missing version.
        it('stays out of the way of a learner who has never answered', () => {
            expect(needsConsentUpgrade({
                granted: false, acceptedVersion: null, requiredVersion: 'oyon-consent-v2',
            })).toBe(false);
            expect(needsConsentUpgrade({
                granted: undefined, acceptedVersion: null, requiredVersion: 'oyon-consent-v2',
            })).toBe(false);
        });

        // Regression lock (QA-0019, external pilot v2.9.140): "the typing
        // monitor does not start even if typing monitoring is enabled".
        //
        // A grant stored WITHOUT a version — which is exactly what Settings →
        // Oyon wrote — used to return false here. That made the state
        // permanent: the signal gate read the missing version as v1 and refused
        // the widened scope, so typing and voice never captured, while this
        // prompt, the only path that could have repaired the record, declined
        // to ask. A stored grant is an answer, and a missing version means it
        // was given under v1 — precisely who this prompt exists for.
        it('prompts a learner whose grant predates versioning', () => {
            expect(needsConsentUpgrade({
                granted: true, acceptedVersion: null, requiredVersion: 'oyon-consent-v2',
            })).toBe(true);
            expect(needsConsentUpgrade({
                granted: true, acceptedVersion: undefined, requiredVersion: 'oyon-consent-v2',
            })).toBe(true);
        });

        // ...and the same record must still be read as NOT covering the signal
        // scope until it is repaired. Opening the gate on a versionless grant
        // would be consenting on the learner's behalf.
        it('a versionless grant does not satisfy the widened contract', () => {
            expect(consentSatisfies(null, 'oyon-consent-v2')).toBe(false);
            expect(consentSatisfies(undefined, 'oyon-consent-v2')).toBe(false);
        });

        it('is quiet once the learner is current', () => {
            expect(needsConsentUpgrade({
                granted: true, acceptedVersion: 'oyon-consent-v2', requiredVersion: 'oyon-consent-v2',
            })).toBe(false);
        });
    });

    // The whole QA-0019 repair path, in the order it happens. Each step is a
    // separate unit above; this pins the SEQUENCE, which is the part that was
    // broken — every individual rule was defensible on its own.
    it('the repair path: camera grant → prompt → widened grant → gate opens', () => {
        const required = 'oyon-consent-v2';

        // 1. The learner ticks the camera checkbox in Settings. It describes
        //    the camera and nothing else, so it records the camera contract.
        let accepted = OYON_CONSENT_CAMERA_ONLY;
        //    That does NOT cover typing, and must not.
        expect(consentSatisfies(accepted, required)).toBe(false);

        // 2. So the re-consent prompt has something to ask about. This is the
        //    step that used to return false and strand the learner forever.
        expect(needsConsentUpgrade({ granted: true, acceptedVersion: accepted, requiredVersion: required })).toBe(true);

        // 3. The learner reads the widened contract and accepts it.
        accepted = acceptableVersion(required);
        expect(accepted).toBe('oyon-consent-v2');

        // 4. The signal gate opens, and the prompt goes quiet.
        expect(consentSatisfies(accepted, required)).toBe(true);
        expect(needsConsentUpgrade({ granted: true, acceptedVersion: accepted, requiredVersion: required })).toBe(false);
    });

    it('never offers to accept a contract it cannot render', () => {
        expect(acceptableVersion('oyon-consent-v2')).toBe('oyon-consent-v2');
        expect(acceptableVersion('oyon-consent-v9')).toBe(OYON_CONSENT_CAMERA_ONLY);
    });
});
