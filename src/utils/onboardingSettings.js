// user_preferences.onboarding_settings arrives as a JSON string (SQLite JSON
// column passed through redactRow untouched) or, defensively, an object.
// Single parser shared by FirstRunGate, ChatInterface and OyonCaptureWidget
// so the tolerant-parse rule lives in one place.
//
// Shape (all keys optional): { first_run_done, voice_mode, oyon_consent }.

export function parseOnboardingSettings(prefs) {
    const raw = prefs?.onboarding_settings;
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw) || {}; } catch { return {}; }
}
