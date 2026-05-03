// Source channels — who produced the notification.
// User prefs can mute any of these independently.
export const SOURCES = {
    CLINICAL: 'clinical',     // vital alarms, contraindication warnings
    SYSTEM: 'system',         // API errors, TTS errors, validation failures
    USER: 'user',             // success/info confirmations from user actions
    TELEMETRY: 'telemetry',   // xAPI events, analytics
};

// Severity ladder (low → high). minSeverity pref filters below this threshold.
export const SEVERITIES = ['debug', 'info', 'success', 'warning', 'error', 'critical'];

export const SEVERITY = {
    DEBUG: 'debug',
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical',
};

// Surfaces — where a notification can be rendered/sent.
// Routing decides which subset of these fires per notification.
export const SURFACES = {
    TOAST: 'toast',       // bottom-right card
    BANNER: 'banner',     // top sticky banner (for clinical critical)
    AUDIO: 'audio',       // single oscillator, beep pattern by severity
    HISTORY: 'history',   // appended to history list (consumed by alarm tab)
    BACKEND: 'backend',   // POST batched to /api/learning-events/batch (telemetry) or /api/alarms/log
    CONSOLE: 'console',   // dev console only
};

export const AUDIO_PATTERNS = {
    BEEP: 'beep',
    URGENT: 'urgent',
    CHIME: 'chime',
    NONE: 'none',
};

export const severityRank = (s) => {
    const i = SEVERITIES.indexOf(s);
    return i < 0 ? 0 : i;
};
