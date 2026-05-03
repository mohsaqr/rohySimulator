import { SOURCES, SEVERITY, SURFACES, AUDIO_PATTERNS } from './types';

// Default routing matrix. Maps `${source}/${severity}` → list of surfaces.
// Producers can override per-notification, but this is the fallback the
// center uses when `surfaces` is not specified on a notify() call.
export const DEFAULT_ROUTING = {
    [`${SOURCES.CLINICAL}/${SEVERITY.CRITICAL}`]: [SURFACES.BANNER, SURFACES.AUDIO, SURFACES.HISTORY, SURFACES.BACKEND],
    [`${SOURCES.CLINICAL}/${SEVERITY.ERROR}`]: [SURFACES.BANNER, SURFACES.AUDIO, SURFACES.HISTORY, SURFACES.BACKEND],
    [`${SOURCES.CLINICAL}/${SEVERITY.WARNING}`]: [SURFACES.BANNER, SURFACES.AUDIO, SURFACES.HISTORY, SURFACES.BACKEND],
    [`${SOURCES.CLINICAL}/${SEVERITY.INFO}`]: [SURFACES.HISTORY, SURFACES.BACKEND],

    [`${SOURCES.SYSTEM}/${SEVERITY.CRITICAL}`]: [SURFACES.TOAST, SURFACES.BANNER, SURFACES.HISTORY, SURFACES.CONSOLE],
    [`${SOURCES.SYSTEM}/${SEVERITY.ERROR}`]: [SURFACES.TOAST, SURFACES.HISTORY, SURFACES.CONSOLE],
    [`${SOURCES.SYSTEM}/${SEVERITY.WARNING}`]: [SURFACES.TOAST, SURFACES.HISTORY, SURFACES.CONSOLE],
    [`${SOURCES.SYSTEM}/${SEVERITY.INFO}`]: [SURFACES.TOAST],
    [`${SOURCES.SYSTEM}/${SEVERITY.DEBUG}`]: [SURFACES.CONSOLE],

    [`${SOURCES.USER}/${SEVERITY.SUCCESS}`]: [SURFACES.TOAST],
    [`${SOURCES.USER}/${SEVERITY.INFO}`]: [SURFACES.TOAST],
    [`${SOURCES.USER}/${SEVERITY.WARNING}`]: [SURFACES.TOAST],
    [`${SOURCES.USER}/${SEVERITY.ERROR}`]: [SURFACES.TOAST, SURFACES.HISTORY],

    [`${SOURCES.TELEMETRY}/${SEVERITY.CRITICAL}`]: [SURFACES.BACKEND, SURFACES.CONSOLE],
    [`${SOURCES.TELEMETRY}/${SEVERITY.ERROR}`]: [SURFACES.BACKEND, SURFACES.CONSOLE],
    [`${SOURCES.TELEMETRY}/${SEVERITY.WARNING}`]: [SURFACES.BACKEND],
    [`${SOURCES.TELEMETRY}/${SEVERITY.INFO}`]: [SURFACES.BACKEND],
    [`${SOURCES.TELEMETRY}/${SEVERITY.DEBUG}`]: [SURFACES.BACKEND],
};

// Default toast/banner TTL in ms by severity. 0 = sticky until dismissed/resolved.
// Tuned for users with their attention divided across multiple panels — short
// enough that toasts don't pile up, long enough to read + reach for the X.
// Hover-on-toast pauses the timer (see ToastSurface), so anyone who sees a
// toast and wants to keep it just hovers — no scramble to read it.
export const DEFAULT_TTL_MS = {
    [SEVERITY.DEBUG]: 3000,
    [SEVERITY.INFO]: 6000,
    [SEVERITY.SUCCESS]: 5000,
    [SEVERITY.WARNING]: 10000,
    [SEVERITY.ERROR]: 15000,
    [SEVERITY.CRITICAL]: 0, // sticky — clinical critical never auto-dismisses
};

// Default audio pattern by severity.
export const DEFAULT_AUDIO_PATTERN = {
    [SEVERITY.DEBUG]: AUDIO_PATTERNS.NONE,
    [SEVERITY.INFO]: AUDIO_PATTERNS.NONE,
    [SEVERITY.SUCCESS]: AUDIO_PATTERNS.NONE,
    [SEVERITY.WARNING]: AUDIO_PATTERNS.BEEP,
    [SEVERITY.ERROR]: AUDIO_PATTERNS.BEEP,
    [SEVERITY.CRITICAL]: AUDIO_PATTERNS.URGENT,
};

// Initial preferences. These are what new users see and what every component
// falls back to before user prefs load. Anything user-tweakable lives here.
export const DEFAULT_PREFS = {
    // Global kill switch. true = silence everything except clinical/critical.
    dnd: false,

    // Time-bounded "Pause All". Epoch ms. While now < pausedUntil, behaves as DND.
    pausedUntil: 0,

    // Hide notifications below this severity. 'debug' = show all.
    minSeverity: SEVERITY.INFO,

    // Per-source mutes. If a source is muted, ALL its notifications drop
    // (except clinical/critical, which always escapes).
    mutedSources: [],

    // Surface-level mutes. If true, that surface is stripped from every
    // notification's surface list. audioMuted is the most user-visible —
    // matches the existing "mute alarms" Bell icon.
    audioMuted: false,
    bannerMuted: false,
    consoleMuted: false, // false in dev = noisy console. true = silent.

    // Default snooze duration in minutes when user clicks "Snooze".
    snoozeDuration: 5,

    // Toast queue management.
    toastDedupeWindowMs: 3000,
    toastMaxVisible: 5,

    // Backend telemetry batching.
    telemetryBatchSize: 10,
    telemetryFlushIntervalMs: 5000,

    // Audio frequencies (Hz) per pattern. Tweakable per user preference.
    audioFrequencies: {
        [AUDIO_PATTERNS.BEEP]: 800,
        [AUDIO_PATTERNS.URGENT]: 1000,
        [AUDIO_PATTERNS.CHIME]: 600,
    },

    // Audio volume 0-1.
    audioVolume: 0.1,
};

// History cap. Older entries are dropped to keep memory bounded.
export const HISTORY_CAP = 200;
