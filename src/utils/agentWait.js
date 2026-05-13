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

const WAIT_PHASES = {
    consultant: [
        'Paging the consultant…',
        'Reviewing the chart and current vitals',
        'Considering differentials and next steps',
        'On the way to the bedside'
    ],
    relative: [
        'Reaching the family…',
        'Family on the way from the waiting area',
        'Family is approaching the room'
    ],
    nurse: [
        'Paging the nurse…',
        'Wrapping up another patient',
        'On the way over'
    ]
};
const DEFAULT_WAIT_PHASES = ['Paging…', 'On the way…', 'Almost here…'];

export function pickWaitPhase(agentType, pagedAt, arrivesAt, now) {
    const phases = WAIT_PHASES[agentType] || DEFAULT_WAIT_PHASES;
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
