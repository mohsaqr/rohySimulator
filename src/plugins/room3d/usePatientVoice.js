import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceService } from '../../services/voiceService';
import { resolveVoice } from '../../utils/voiceResolver';
import { useVoice } from '../../contexts/VoiceContext';
import { apiFetch } from '../../services/apiClient.js';

/**
 * The patient's voice in the 3D room.
 *
 * Everything here is wiring: `resolveVoice` decides WHICH voice (case
 * override → persona template → platform default for the language, failing
 * loudly rather than substituting), and `VoiceService.speak` does the
 * speaking through the same server TTS the chat room uses. This hook only
 * connects them to a room that already writes the patient's lines, and
 * mirrors the resulting state into VoiceContext so anything else watching
 * `speaking` / `visemes` stays in sync.
 *
 * Voice settings are fetched here rather than assumed: ChatInterface is the
 * only writer of `voiceSettings` today, so a room that opens before the chat
 * has fetched them would otherwise resolve against nothing. DiscussionScreen
 * defends the same way.
 *
 * Two ways to speak, one resolver and one audio path behind them: `speak`
 * for a line the room already knows (a wince, a scripted reaction), and
 * `beginSession` for a reply still being written by the model.
 *
 * Both report whether the line will actually be heard. A room whose voice is
 * off still has to SHOW what the patient said, so the caller must be able to
 * tell silence-by-configuration from silence-by-nothing-to-say.
 *
 * @param {{activeCase: object|null, enabled: boolean}} options
 * @return {{speak: (line: string) => boolean,
 *   beginSession: () => ({enqueue: (s: string) => void,
 *     flush: () => Promise<void>, cancel: () => void}|null),
 *   stop: () => void, speaking: boolean, available: boolean,
 *   voiceFile: string|null}}
 */
export default function usePatientVoice({ activeCase, enabled = true, onVisemes = null, patientTemplate = null }) {
    const { voiceSettings, setVoiceSettings, setSpeaking, setVisemes } = useVoice();
    // Only the fetched fallback is state; the provider's copy wins when it
    // has one, so nothing is mirrored (and no state is set during render).
    const [fetchedSettings, setFetchedSettings] = useState(null);
    const settings = voiceSettings ?? fetchedSettings;
    const [speaking, setLocalSpeaking] = useState(false);
    // Whether the last utterance failed to produce audio at all (a TTS error,
    // a provider whose model will not load). The room needs this to fall back
    // to showing the line: a caption waiting on audio that never arrives is
    // a patient who appears not to answer.
    const [audioFailed, setAudioFailed] = useState(false);
    // The room may speak before React has re-rendered with new settings.
    const settingsRef = useRef(settings);
    const enabledRef = useRef(enabled);
    // Mouth shapes go straight to the 3D room through this ref rather than
    // through React state: they arrive at frame rate, and a render per
    // viseme would be the whole room re-rendering while the patient talks.
    const onVisemesRef = useRef(onVisemes);
    useEffect(() => {
        settingsRef.current = settings;
        enabledRef.current = enabled;
        onVisemesRef.current = onVisemes;
    });

    useEffect(() => {
        if (voiceSettings) return undefined;
        let cancelled = false;
        apiFetch('/platform-settings/voice')
            .then((payload) => {
                if (cancelled || !payload) return;
                setFetchedSettings(payload);
                setVoiceSettings(payload);
            })
            .catch(() => {
                // Voice simply stays unavailable; the room is still usable.
            });
        return () => { cancelled = true; };
    }, [voiceSettings, setVoiceSettings]);

    // Every mouth shape goes to both faces: VoiceContext drives Rohy's own
    // avatar, the ref drives the 3D room's. One voice stream, so the two can
    // never be out of sync with each other.
    const emitVisemes = useCallback((map) => {
        setVisemes(map);
        onVisemesRef.current?.(map);
    }, [setVisemes]);

    const stop = useCallback(() => {
        VoiceService.cancelSpeech();
        setLocalSpeaking(false);
        setSpeaking(false);
        emitVisemes({ viseme_sil: 1 });
    }, [setSpeaking, emitVisemes]);

    // Never leave a voice running when the learner leaves the room.
    useEffect(() => stop, [stop]);

    // The one place the room decides WHICH voice. Returns null when the room
    // must stay silent — muted, voice mode off, or a configured voice that
    // cannot play here (the resolver refuses to substitute another patient's
    // voice, and this hook refuses to paper over that).
    const resolveForSpeaking = useCallback(() => {
        if (!enabledRef.current) return null;
        const current = settingsRef.current;
        if (!current?.voice_mode_enabled) return null;
        const resolved = resolveVoice({
            voice: activeCase?.config?.voice,
            // The persona tier. Without it every case with no explicit voice
            // falls through to the platform's per-language default — which
            // is female, so a male patient answers in a woman's voice.
            templateVoice: patientTemplate?.config?.voice ?? null,
            voiceSettings: current,
            language: activeCase?.config?.language,
        });
        return resolved.file ? resolved : null;
    }, [activeCase, patientTemplate]);

    // Speaking state is identical whichever path produced the audio, so both
    // the scripted line and the streamed reply share these handlers.
    const speechHandlers = useCallback(() => ({
        onStart: () => {
            setLocalSpeaking(true);
            setSpeaking(true);
            setAudioFailed(false);
        },
        onVisemes: emitVisemes,
        onEnd: () => {
            setLocalSpeaking(false);
            setSpeaking(false);
            emitVisemes({ viseme_sil: 1 });
        },
        onError: () => {
            setLocalSpeaking(false);
            setSpeaking(false);
            setAudioFailed(true);
            emitVisemes({ viseme_sil: 1 });
        },
    }), [setSpeaking, emitVisemes]);

    /**
     * A streaming utterance, for a reply that arrives token by token.
     *
     * The room hands each COMPLETED sentence to `enqueue` as the model
     * finishes it, so the patient starts talking while the model is still
     * writing — perceived latency becomes one sentence, not one reply.
     * Same resolver, same audio path, same speaking state as `speak`.
     *
     * @return {{enqueue: (s: string) => void, flush: () => Promise<void>,
     *   cancel: () => void}|null} null when the room must stay silent.
     */
    const beginSession = useCallback(() => {
        const resolved = resolveForSpeaking();
        if (!resolved) return null;
        return VoiceService.beginSpeechSession({
            voice: resolved.file,
            rate: resolved.rate,
            pitch: resolved.pitch,
            provider: resolved.provider,
            language: activeCase?.config?.language,
            ...speechHandlers(),
        });
    }, [activeCase, resolveForSpeaking, speechHandlers]);

    // Returns whether the line will actually be heard, so the caller can tell
    // a silent room (muted, voice mode off, or a voice that cannot play) from
    // a speaking one and caption accordingly.
    const speak = useCallback((line) => {
        const text = typeof line === 'string' ? line.trim() : '';
        if (!text) return false;
        const resolved = resolveForSpeaking();
        if (!resolved) return false;

        VoiceService.speak({
            text,
            voice: resolved.file,
            rate: resolved.rate,
            pitch: resolved.pitch,
            provider: resolved.provider,
            language: activeCase?.config?.language,
            ...speechHandlers(),
        });
        return true;
    }, [activeCase, resolveForSpeaking, speechHandlers]);

    const resolvedForStatus = settings
        ? resolveVoice({
            voice: activeCase?.config?.voice,
            templateVoice: patientTemplate?.config?.voice ?? null,
            voiceSettings: settings,
            language: activeCase?.config?.language,
        })
        : { file: null };

    return {
        speak,
        beginSession,
        stop,
        speaking,
        audioFailed,
        available: Boolean(settings?.voice_mode_enabled && resolvedForStatus.file),
        voiceFile: resolvedForStatus.file,
    };
}
