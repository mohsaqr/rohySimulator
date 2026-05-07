// AI prompt context formatters.
//
// These helpers shape clinical-record data into markdown blocks that get
// concatenated into the patient AI's system prompt by ChatInterface.
// Keeping each formatter pure (input → string, no side effects) makes them
// trivially testable and lets the same shape be reused by other AI surfaces
// (e.g. discussant, debriefer) without re-implementing the formatting.
//
// Empty inputs return an empty string. Callers are responsible for skipping
// the surrounding "## SECTION" wrapper when the formatter returns "".

// ---------- Radiology ----------
// Each study: { type, name, date, findings, interpretation, imageUrl }
// We never feed imageUrl to the LLM — it's a binary asset, not text context.
export function formatRadiologyAsMarkdown(studies) {
    if (!Array.isArray(studies) || studies.length === 0) return '';
    return studies.map(s => {
        const head = [s.type || 'Imaging study', s.name, s.date]
            .filter(Boolean)
            .join(' · ');
        const body = [
            s.findings && `Findings: ${s.findings.trim()}`,
            s.interpretation && `Interpretation: ${s.interpretation.trim()}`,
        ].filter(Boolean).join('\n  ');
        return body ? `- ${head}\n  ${body}` : `- ${head}`;
    }).join('\n');
}

// ---------- Vitals ----------
// Live vitals from PatientRecord.current_state.vitals. The model uses these
// to answer "how do you feel" / "what's your heart rate" with the actual
// monitor reading instead of guessing. Null/undefined slots are skipped so
// a partially-populated vital set still produces useful context.
const VITAL_LABELS = [
    { key: 'hr',     label: 'Heart rate',       unit: 'bpm' },
    { key: 'rr',     label: 'Respiratory rate', unit: '/min' },
    { key: 'spo2',   label: 'SpO₂',             unit: '%' },
    { key: 'temp',   label: 'Temperature',      unit: '°C' },
    { key: 'pain',   label: 'Pain',             unit: '/10' },
];

export function formatVitalsAsMarkdown(vitals) {
    if (!vitals || typeof vitals !== 'object') return '';
    const lines = [];
    // BP gets special formatting (sys/dia from two fields).
    if (Number.isFinite(vitals.bp_sys) && Number.isFinite(vitals.bp_dia)) {
        lines.push(`- Blood pressure: ${vitals.bp_sys}/${vitals.bp_dia} mmHg`);
    }
    for (const v of VITAL_LABELS) {
        const value = vitals[v.key];
        if (value == null || !Number.isFinite(value)) continue;
        lines.push(`- ${v.label}: ${value}${v.unit ? ` ${v.unit}` : ''}`);
    }
    return lines.join('\n');
}

// ---------- Recent session activity ----------
// Closes the feedback loop so the AI knows what the student has already done.
// Without this, the AI treats every turn as fresh and would happily repeat
// answers the student already heard or fail to acknowledge prior actions.
//
// We summarise (not dump) — the events array can grow large; we cap at the
// last `limit` events to bound prompt size, and we stringify each event with
// its verb-specific shape (the PatientRecord verbs OBTAINED, EXAMINED,
// ELICITED, NOTED, ORDERED, ADMINISTERED, CHANGED, EXPRESSED).

const VERB_RENDERERS = {
    OBTAINED:     (e) => `obtained history (${e.category || 'unspecified'})${e.content ? `: ${truncate(e.content, 80)}` : ''}`,
    EXAMINED:     (e) => `examined ${e.region || 'patient'}${e.technique ? ` via ${e.technique}` : ''}`,
    ELICITED:     (e) => `elicited ${e.test_name || e.category || 'finding'}${e.value ? ` = ${e.value}${e.unit ? ` ${e.unit}` : ''}` : ''}`,
    NOTED:        (e) => `noted ${e.trigger || 'event'}${e.action ? ` (${e.action})` : ''}`,
    ORDERED:      (e) => `ordered ${e.category || 'item'}${e.item ? `: ${e.item}` : ''}`,
    ADMINISTERED: (e) => `administered ${e.item || e.category || 'treatment'}${e.dose ? ` ${e.dose}` : ''}${e.route ? ` ${e.route}` : ''}`,
    CHANGED:      (e) => `${e.parameter || 'parameter'} changed${e.value != null ? ` to ${e.value}${e.unit ? ` ${e.unit}` : ''}` : ''}`,
    EXPRESSED:    (e) => `patient expressed ${e.type || 'something'}${e.content ? `: ${truncate(e.content, 80)}` : ''}`,
};

function truncate(s, n) {
    const str = String(s);
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

export function formatRecentActivityAsMarkdown(events, limit = 10) {
    if (!Array.isArray(events) || events.length === 0) return '';
    const recent = events.slice(-limit);
    return recent.map(e => {
        const renderer = VERB_RENDERERS[e.verb];
        const summary = renderer ? renderer(e) : `${e.verb || 'event'}`;
        const time = Number.isFinite(e.time) ? `t+${e.time}m` : '—';
        return `- [${time}] ${summary}`;
    }).join('\n');
}
