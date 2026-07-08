// Helpers for the "agent is on the way" countdown card.
//
// The server stamps `arrives_at` on agent_session_state when the
// learner pages an agent (see migration 0024). These pure functions
// turn that timestamp pair (paged_at, arrives_at) plus the current
// clock into the three things the card needs to render:
//
//   - a rotating "what they're doing right now" line
//   - a mm:ss countdown
//   - a 0–100 progress percent for the bar
//
// Kept here (not inline in ChatInterface) so they're unit-testable and
// don't poke at module-level state — fast-refresh hates components
// sharing a file with non-component exports.

// I18N: phases are chat-namespace translation KEYS, not display strings —
// the render site wraps the result in t(). The English copy lives in
// src/locales/en/chat.json (wait_consultant_0 = "Paging the consultant…",
// etc.); this module stays translation-free so it remains a pure,
// clock-in/key-out unit-testable helper.
const WAIT_PHASE_KEYS = {
    consultant: [
        'wait_consultant_0',
        'wait_consultant_1',
        'wait_consultant_2',
        'wait_consultant_3'
    ],
    relative: [
        'wait_relative_0',
        'wait_relative_1',
        'wait_relative_2'
    ],
    nurse: [
        'wait_nurse_0',
        'wait_nurse_1',
        'wait_nurse_2'
    ]
};
const DEFAULT_WAIT_PHASE_KEYS = ['wait_default_0', 'wait_default_1', 'wait_default_2'];

export function pickWaitPhase(agentType, pagedAt, arrivesAt, now) {
    const phases = WAIT_PHASE_KEYS[agentType] || DEFAULT_WAIT_PHASE_KEYS;
    if (!pagedAt || !arrivesAt) return phases[0];
    const start = new Date(pagedAt).getTime();
    const end = new Date(arrivesAt).getTime();
    const total = Math.max(1, end - start);
    const elapsed = Math.max(0, now - start);
    const frac = Math.min(0.999, elapsed / total);
    return phases[Math.floor(frac * phases.length)];
}

export function formatRemaining(arrivesAt, now) {
    if (!arrivesAt) return '';
    const ms = new Date(arrivesAt).getTime() - now;
    if (ms <= 0) return '0:00';
    const sec = Math.ceil(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export function waitProgressPct(pagedAt, arrivesAt, now) {
    if (!pagedAt || !arrivesAt) return 0;
    const start = new Date(pagedAt).getTime();
    const end = new Date(arrivesAt).getTime();
    const total = Math.max(1, end - start);
    const pct = ((now - start) / total) * 100;
    return Math.max(0, Math.min(100, pct));
}
