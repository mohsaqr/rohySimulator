// Public entry point for the notification system. Producers import notify from
// here; surfaces and the settings tab import the rest.
export { NotificationProvider } from './NotificationContext';
export { useNotifications } from './useNotifications';
export { setExternalApi, getExternalApi } from './externalApi';
export { SOURCES, SEVERITY, SEVERITIES, SURFACES, AUDIO_PATTERNS } from './types';
export { DEFAULT_PREFS, DEFAULT_TTL_MS, DEFAULT_AUDIO_PATTERN, HISTORY_CAP } from './defaults';
