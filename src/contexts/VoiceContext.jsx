// Shared voice/avatar state. ChatInterface owns the writes (mic toggling,
// LLM/TTS lifecycle); PatientVisual reads to drive the 3D head where the
// patient photo used to be. Default values keep the rest of the app working
// even before ChatInterface mounts.

import { createContext, useContext, useState, useMemo } from 'react';

const VoiceContext = createContext(null);

export function VoiceProvider({ children }) {
    const [voiceMode, setVoiceMode] = useState(false);
    const [listening, setListening] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [visemes, setVisemes] = useState({ viseme_sil: 1 });
    const [voiceSettings, setVoiceSettings] = useState(null);
    const [headManifest, setHeadManifest] = useState(null);

    const value = useMemo(() => ({
        voiceMode, setVoiceMode,
        listening, setListening,
        speaking, setSpeaking,
        visemes, setVisemes,
        voiceSettings, setVoiceSettings,
        headManifest, setHeadManifest
    }), [voiceMode, listening, speaking, visemes, voiceSettings, headManifest]);

    return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
    const ctx = useContext(VoiceContext);
    if (!ctx) {
        // Safe defaults if used outside the provider — avoids crashes during
        // refactor or in storybook-style isolated mounts.
        return {
            voiceMode: false, setVoiceMode: () => {},
            listening: false, setListening: () => {},
            speaking: false, setSpeaking: () => {},
            visemes: { viseme_sil: 1 }, setVisemes: () => {},
            voiceSettings: null, setVoiceSettings: () => {},
            headManifest: null, setHeadManifest: () => {}
        };
    }
    return ctx;
}
