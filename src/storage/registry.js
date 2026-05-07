/**
 * rohy_* localStorage namespace registry.
 *
 * The audit (client-app-shell-auth-session.md) flagged that the app accumulates
 * `rohy_*` localStorage keys without a documented owner or cleanup policy. The
 * patient-record persistence rule says the session lives until Exit/End/Logout/
 * case-switch — but each new key the app introduces is one more thing that has
 * to be *remembered* in those four cleanup paths. Miss one and you ship a
 * leak: e.g. user A logs out, user B logs in, and one of A's keys carries
 * over into B's session.
 *
 * This module is the single source of truth for every persistent key the app
 * writes. Every entry declares:
 *   - `key` — the literal localStorage key (or a `(...args) => string` builder
 *     for per-session/per-user keys).
 *   - `owner` — the file/module that owns reads + writes.
 *   - `purpose` — one-line description of what's stored.
 *   - `lifetime` — when the key is cleared. One of:
 *       'session'   — cleared on Exit/End/case-switch (session ends)
 *       'logout'    — cleared on logout
 *       'forever'   — never auto-cleared (user-preference, only the user
 *                     toggles it off via UI)
 *       'derived'   — managed entirely by another subsystem (e.g. notifications
 *                     center handles its own scoped keys + retention)
 *       'cookie'    — NOT a localStorage key — a `rohy_*`-named cookie that
 *                     the server sets and the client only READS. Listed here
 *                     so the registry's grep-the-source contract covers
 *                     cookies too (otherwise apiClient's reference to a CSRF
 *                     cookie would look like an unregistered key).
 *
 * The companion test (`registry.test.js`) asserts that every literal `rohy_*`
 * key found in `src/` appears in this registry — adding a key without
 * declaring it here will fail the test, prompting the author to also wire it
 * into the right cleanup path.
 */

export const STORAGE_REGISTRY = Object.freeze({
    // ── App shell + persistence rule ────────────────────────────────────────
    rohy_active_session: {
        owner: 'src/App.jsx',
        purpose: 'Active case + sessionId blob restored on refresh.',
        lifetime: 'session',
    },
    rohy_chat_history: {
        owner: 'src/App.jsx + src/components/chat/ChatInterface.jsx',
        purpose: 'Patient chat transcript cache for fast restore.',
        lifetime: 'session',
    },
    rohy_view: {
        owner: 'src/App.jsx',
        purpose: 'Last surface (settings tab / wizard step / TNA / debrief / persona editor) so refresh restores the breadcrumb.',
        lifetime: 'logout',
    },
    // Per-session debrief history. Built with `rohy_discussion_history_${sid}`.
    rohy_discussion_history: {
        keyBuilder: (sessionId) => `rohy_discussion_history_${sessionId}`,
        owner: 'src/hooks/useDiscussionEngine.js',
        purpose: 'Discussant chat transcript per session.',
        lifetime: 'session',
    },
    // ── Settings & editor state ─────────────────────────────────────────────
    rohy_editing_case: {
        owner: 'src/components/settings/ConfigPanel.jsx',
        purpose: 'In-progress case-edit stash so navigating away preserves wizard state.',
        lifetime: 'session',
    },
    rohy_lab_settings: {
        owner: 'src/components/orders/OrdersDrawer.jsx (presumed)',
        purpose: 'User preference: lab turnaround / instant-results toggle.',
        lifetime: 'forever',
    },
    rohy_monitor_settings: {
        owner: 'src/components/monitor/PatientMonitor.jsx (presumed)',
        purpose: 'User preference: monitor thresholds / display toggles.',
        lifetime: 'forever',
    },
    rohy_show_lab_ranges: {
        owner: 'src/components/investigations/LabResultsModal.jsx',
        purpose: 'User preference: show reference ranges in lab modal.',
        lifetime: 'forever',
    },
    rohy_show_lab_flags: {
        owner: 'src/components/investigations/LabResultsModal.jsx',
        purpose: 'User preference: show H/L flags in lab modal.',
        lifetime: 'forever',
    },
    // ── Bodymap editor (admin) ──────────────────────────────────────────────
    rohy_bodymap_regions: {
        owner: 'src/components/examination/BodyMap.jsx + BodyMapDebug.jsx',
        purpose: 'Cached bodymap polygon regions (server-backed, localStorage is fast-path).',
        lifetime: 'forever',
    },
    // ── Diagnostic bar ──────────────────────────────────────────────────────
    rohy_diag_bar_enabled: {
        keyBuilder: (userIdOrAnon) => `rohy_diag_bar_enabled_${userIdOrAnon}`,
        owner: 'src/components/debug/DiagnosticBar.jsx',
        purpose: 'Per-user toggle for the dev diagnostic bar.',
        lifetime: 'forever',
    },
    // ── Auth cookies (server-set, not localStorage) ────────────────────────
    rohy_auth: {
        owner: 'server/middleware/auth.js + server/routes.js (login/logout)',
        purpose: 'HttpOnly JWT auth cookie (audit #4). Client never reads.',
        lifetime: 'cookie',
    },
    rohy_csrf: {
        owner: 'server/middleware/csrf.js + src/services/apiClient.js',
        purpose: 'Double-submit CSRF token (audit #4 / CSRF). Client JS reads, server validates against X-CSRF-Token header.',
        lifetime: 'cookie',
    },
    // ── Notifications (managed by notifications/persistence.js) ─────────────
    rohy_notification_prefs: {
        keyBuilder: (userIdOrAnon) => `rohy_notification_prefs:${userIdOrAnon}`,
        owner: 'src/notifications/persistence.js',
        purpose: 'Per-user notification preferences (sound, DND, batch size).',
        lifetime: 'derived',
    },
    rohy_notification_snoozed: {
        keyBuilder: (userIdOrAnon) => `rohy_notification_snoozed:${userIdOrAnon}`,
        owner: 'src/notifications/persistence.js',
        purpose: 'Per-user snoozed notification keys with `until` timestamps.',
        lifetime: 'derived',
    },
    rohy_notification_acked: {
        keyBuilder: (userIdOrAnon) => `rohy_notification_acked:${userIdOrAnon}`,
        owner: 'src/notifications/persistence.js',
        purpose: 'Per-user set of acknowledged notification keys (suppressed until resolve()).',
        lifetime: 'derived',
    },
});

/**
 * Returns the registered set of literal key prefixes — useful for tests that
 * walk localStorage to assert no unknown rohy_* keys were ever written.
 */
export function registeredKeyPrefixes() {
    return Object.keys(STORAGE_REGISTRY);
}

/**
 * Returns true when `key` matches a registered entry exactly OR when it
 * matches a `keyBuilder`-style entry's prefix.
 */
export function isRegisteredKey(key) {
    if (!key || typeof key !== 'string') return false;
    if (key in STORAGE_REGISTRY) return true;
    for (const entry of Object.values(STORAGE_REGISTRY)) {
        if (typeof entry.keyBuilder !== 'function') continue;
        // Probe the builder with a sentinel to learn its concrete prefix.
        const probe = entry.keyBuilder('__probe__');
        const prefix = probe.replace(/__probe__.*$/, '');
        if (key.startsWith(prefix)) return true;
    }
    return false;
}
