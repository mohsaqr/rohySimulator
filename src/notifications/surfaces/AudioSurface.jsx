import { useEffect, useMemo, useRef } from 'react';
import { useNotifications } from '../useNotifications';
import { SURFACES, AUDIO_PATTERNS } from '../types';

// Single Web Audio context owned by this surface. The legacy `useAlarms` hook
// suffered from the audio-context init being gated on a click handler that
// only fired sometimes; this surface listens globally and resumes whenever it
// can, so the moment any user gesture happens the audio is ready.
let ctx = null;
function getCtx() {
    if (!ctx && typeof window !== 'undefined') {
        const Klass = window.AudioContext || window.webkitAudioContext;
        if (Klass) ctx = new Klass();
    }
    return ctx;
}

// Pick the audio pattern that should play right now. We pick the loudest
// (URGENT > BEEP > CHIME > NONE) among active audio-routed notifications so
// a critical alarm overrides a warning beep even while both are visible.
function pickPattern(audioActive) {
    const order = [AUDIO_PATTERNS.URGENT, AUDIO_PATTERNS.BEEP, AUDIO_PATTERNS.CHIME];
    for (const pat of order) {
        if (audioActive.some(n => n.audioPattern === pat)) return pat;
    }
    return AUDIO_PATTERNS.NONE;
}

export default function AudioSurface() {
    const { active, prefs } = useNotifications();

    // Filter to active audio-routed notifications. routedSurfaces is computed
    // at notify() time and respects audioMuted, so this list is empty when
    // the user has muted audio — no need to re-check the pref here.
    const audioActive = useMemo(() => {
        return active.filter(n => Array.isArray(n.routedSurfaces) && n.routedSurfaces.includes(SURFACES.AUDIO));
    }, [active]);

    const pattern = pickPattern(audioActive);

    // Resume audio context on any user gesture and when the tab regains focus.
    useEffect(() => {
        const tryResume = () => {
            const c = getCtx();
            if (c && c.state === 'suspended') c.resume().catch(() => {});
        };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') tryResume();
        };
        const events = ['click', 'keydown', 'touchstart', 'pointerdown'];
        events.forEach(e => document.addEventListener(e, tryResume, { passive: true }));
        document.addEventListener('visibilitychange', onVisibility);
        // Also try once immediately — some browsers allow it, some don't.
        tryResume();
        return () => {
            events.forEach(e => document.removeEventListener(e, tryResume));
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    // Drive the oscillator. We rebuild the oscillator on every pattern change
    // (cheap, and avoids leaked nodes). Silent pattern stops the loop.
    const oscRef = useRef(null);
    const gainRef = useRef(null);
    const intervalRef = useRef(null);

    useEffect(() => {
        const c = getCtx();
        if (!c) return;

        const stop = () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            if (oscRef.current) {
                try { oscRef.current.stop(); } catch { /* already stopped */ }
                try { oscRef.current.disconnect(); } catch { /* ignore */ }
                oscRef.current = null;
            }
            if (gainRef.current) {
                try { gainRef.current.disconnect(); } catch { /* ignore */ }
                gainRef.current = null;
            }
        };

        if (pattern === AUDIO_PATTERNS.NONE) {
            stop();
            return undefined;
        }

        const freq = prefs.audioFrequencies?.[pattern] ?? 800;
        const volume = prefs.audioVolume ?? 0.1;

        // (Re)build oscillator chain.
        stop();
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, c.currentTime);
        gain.gain.setValueAtTime(0, c.currentTime);
        osc.connect(gain);
        gain.connect(c.destination);
        try { osc.start(); } catch { /* already started */ }
        oscRef.current = osc;
        gainRef.current = gain;

        // URGENT = 200ms-on, 200ms-off, 200ms-on, 600ms-off (1.2s period).
        // BEEP   = 200ms-on, 800ms-off (1s period).
        // CHIME  = single 400ms tone every 4s.
        const beat = pattern === AUDIO_PATTERNS.URGENT
            ? () => {
                const t = c.currentTime;
                gain.gain.setValueAtTime(volume, t);
                gain.gain.setValueAtTime(0, t + 0.2);
                gain.gain.setValueAtTime(volume, t + 0.4);
                gain.gain.setValueAtTime(0, t + 0.6);
            }
            : pattern === AUDIO_PATTERNS.CHIME
                ? () => {
                    const t = c.currentTime;
                    gain.gain.setValueAtTime(volume, t);
                    gain.gain.setValueAtTime(0, t + 0.4);
                }
                : () => {
                    const t = c.currentTime;
                    gain.gain.setValueAtTime(volume, t);
                    gain.gain.setValueAtTime(0, t + 0.2);
                };

        beat();
        const periodMs = pattern === AUDIO_PATTERNS.URGENT ? 1200 : pattern === AUDIO_PATTERNS.CHIME ? 4000 : 1000;
        intervalRef.current = setInterval(beat, periodMs);

        return stop;
    }, [pattern, prefs.audioFrequencies, prefs.audioVolume]);

    return null; // pure side-effect surface
}
