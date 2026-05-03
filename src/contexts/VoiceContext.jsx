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
    // Platform-wide default avatars (per-gender). Used when a case has no
    // explicit avatar_id. Loaded once at app start; refreshed when admin
    // saves the Avatars settings tab.
    const [platformAvatars, setPlatformAvatars] = useState(null);
    // Active participant in the chat — patient or one of the agents. Lets
    // PatientVisual (sibling of ChatInterface in App.jsx) mirror whoever
    // the trainee is currently talking to. Shape:
    //   { avatar_id, avatar_camera, gender, name, age, id }
    const [activeParticipant, setActiveParticipant] = useState(null);

    const value = useMemo(() => ({
        voiceMode, setVoiceMode,
        listening, setListening,
        speaking, setSpeaking,
        visemes, setVisemes,
        voiceSettings, setVoiceSettings,
        headManifest, setHeadManifest,
        platformAvatars, setPlatformAvatars,
        activeParticipant, setActiveParticipant
    }), [voiceMode, listening, speaking, visemes, voiceSettings, headManifest, platformAvatars, activeParticipant]);

    return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
    const ctx = useContext(VoiceContext);
    if (!ctx) throw new Error('useVoice must be used within VoiceProvider');
    return ctx;
}
