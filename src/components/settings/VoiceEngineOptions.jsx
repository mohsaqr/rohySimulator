// Voice 2.0 picker plumbing shared by the case editor, the persona editor,
// and the settings tab (VOICE2_PLAN.md §6.2). One implementation so the
// three surfaces can never drift:
//
//   useAllVoices()          — fetches GET /tts/voices (all providers, with
//                             usability + reason) once per mount.
//   <VoiceEngineOptions/>   — <optgroup> tree: every USABLE engine's voices
//                             grouped engine → language with a free/paid
//                             badge; unusable engines render as a disabled
//                             group naming the reason (discoverable, not
//                             hidden).
//   <VoiceSubstitutionNote/> — the amber truth-clause line: when the saved
//                             value can't play, say what WILL play (or that
//                             playback fails loudly). Mirrors the stale-
//                             avatar warning pattern.
//
// Picking any voice offered here is a complete, valid choice — each voice
// plays on its own engine; there is no platform engine to switch.

import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/apiClient.js';
import { isPaidProvider } from '../../utils/voiceResolver.js';
import { voiceGenderLabel, groupVoicesByLanguage } from '../../utils/voiceCatalogue.js';

export function useAllVoices() {
    const [providers, setProviders] = useState(null); // null = loading
    useEffect(() => {
        let cancelled = false;
        apiFetch('/tts/voices')
            .then(d => { if (!cancelled) setProviders(d?.providers || []); })
            .catch(() => { if (!cancelled) setProviders([]); });
        return () => { cancelled = true; };
    }, []);
    return providers;
}

export function engineBadge(providerId, t) {
    return isPaidProvider(providerId) ? t('voice_engine_paid') : t('voice_engine_free');
}

export function VoiceEngineOptions({ providers, t }) {
    if (!Array.isArray(providers)) return null;
    return providers.map(p => {
        if (!p.usable) {
            return (
                <optgroup key={p.id} label={`${p.id} — ${t('voice_engine_unavailable')}`}>
                    <option value="" disabled>{p.reason || t('voice_engine_unavailable')}</option>
                </optgroup>
            );
        }
        return groupVoicesByLanguage(p.voices || []).map(group => (
            <optgroup
                key={`${p.id}:${group.language || 'other'}`}
                label={`${p.id} · ${engineBadge(p.id, t)} — ${group.language || t('voice_group_other')}`}
            >
                {group.voices.map(v => {
                    const genderLabel = voiceGenderLabel(v);
                    return (
                        <option key={v.filename} value={v.filename}>
                            {(v.displayName || v.filename) + (genderLabel ? ` — ${genderLabel}` : '')}
                        </option>
                    );
                })}
            </optgroup>
        ));
    });
}

// Truth clause for editors (v1.4 sovereignty semantics): whatever will
// actually happen at play time is rendered right under the picker. Two
// stories:
//   - the configured voice can't play → amber loud-fail line (configured
//     voices are LITERAL — no stand-in exists to name);
//   - nothing configured, the language default will play → subdued info
//     line (the fallback is what the learner hears — the editor says so).
export function VoiceSubstitutionNote({ resolved, t }) {
    if (!resolved) return null;
    if (resolved.substituted && resolved.file && resolved.substitutionReason === 'not_configured') {
        return (
            <p className="text-[11px] text-neutral-400 mt-1">
                {t('voice_default_note', { playing: resolved.file })}
            </p>
        );
    }
    if (!resolved.file && resolved.tier === 'invalid') {
        return (
            <p className="text-[11px] text-amber-400 mt-1">
                {t('voice_unplayable_note', {
                    requested: resolved.requestedFile,
                    provider: resolved.provider || '?'
                })}
            </p>
        );
    }
    return null;
}
