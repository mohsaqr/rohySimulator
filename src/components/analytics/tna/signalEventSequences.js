// Typing and voice sequence builders — the Typing and Voice entries in the
// network-family Source dropdown, alongside Emotions / Locations / Gaze targets
// (windowSequences.js).
//
// Input: rows from GET /addons/oyon/signal-events (migration 0058), one per
// logged state. Output: one chronological sequence per CAPTURE, in the same
// { sequences, labels } shape the other builders return.
//
// Two rules copied from Oyon's own Dynamics view (tnaPooling.buildEventSequences):
//
//   - Chain per capture, not per session. `sequence_index` restarts at 0 for
//     every capture, so joining two captures of one session would invent a
//     transition from the first capture's last state to the second's first.
//   - Consecutive repeats are KEPT. Unlike the window sources, where a run of
//     identical windows is dwell sampled on a timer, each event here is a real
//     action: insert -> insert is typing fluently, and collapsing it would erase
//     exactly the fluency-versus-revision contrast the network is for.

/** Readable state names. Anything unlisted keeps its raw vocabulary name. */
export const TYPING_STATE_LABELS = Object.freeze({
    start: 'Start',
    insert: 'Insert',
    delete: 'Delete',
    replace: 'Replace',
    paste: 'Paste',
    undo: 'Undo',
    redo: 'Redo',
    correct: 'Correct',
    compose: 'Compose',
    composing: 'Composing',
    commit: 'Commit',
    move: 'Move caret',
    select: 'Select',
    deselect: 'Deselect',
    pause: 'Pause',
    submit: 'Send',
    abandon: 'Abandon',
});

export const VOICE_STATE_LABELS = Object.freeze({
    start: 'Turn start',
    speech: 'Speech',
    silence: 'Silence',
    pause: 'Pause',
    clipped: 'Clipped',
    muted: 'Muted',
    playback: 'Patient speaking',
    contaminated: 'Echo',
    end: 'Turn end',
});

const LABELS = { typing: TYPING_STATE_LABELS, voice: VOICE_STATE_LABELS };

function sequenceLabel(first) {
    const parts = [`Session ${first.session_id}`];
    const who = first.student_name_snapshot || (first.user_id != null ? `#${first.user_id}` : null);
    if (who) parts.push(String(who));
    const caseLabel = first.case_title_snapshot || (first.case_id != null ? `case ${first.case_id}` : null);
    if (caseLabel) parts.push(String(caseLabel));
    return parts.join(' · ');
}

function occurredMs(value) {
    if (typeof value !== 'string' || !value) return NaN;
    const iso = value.includes('T') ? value : value.replace(' ', 'T');
    return Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

/**
 * Per-capture state sequences for one modality.
 *
 * @param {Array<object>} events signal-event rows (any order)
 * @param {{ modality: 'typing'|'voice' }} options
 * @returns {{ sequences: string[][], labels: string[] }} sequences ordered by
 *   their first event's time (ties by session then capture id); sequences with
 *   fewer than 2 states dropped; labels align with sequences.
 */
export function eventsToSignalSequences(events, { modality } = {}) {
    const names = LABELS[modality];
    if (!names) throw new RangeError(`eventsToSignalSequences: unknown modality "${modality}"`);

    const groups = new Map();
    for (const event of Array.isArray(events) ? events : []) {
        if (!event || event.modality !== modality || event.session_id == null || event.capture_id == null) continue;
        if (!Number.isInteger(event.sequence_index)) continue;
        const key = `${event.session_id}::${event.capture_id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(event);
    }

    const built = [];
    for (const [key, rows] of groups) {
        rows.sort((a, b) => a.sequence_index - b.sequence_index);
        const sequence = rows.map((row) => names[row.state] || row.state);
        if (sequence.length < 2) continue;
        built.push({ key, sequence, label: sequenceLabel(rows[0]), startMs: occurredMs(rows[0].occurred_at) });
    }

    built.sort((a, b) => {
        const byTime = Number.isFinite(a.startMs) && Number.isFinite(b.startMs) ? a.startMs - b.startMs : 0;
        return byTime !== 0 ? byTime : a.key.localeCompare(b.key);
    });

    return {
        sequences: built.map((b) => b.sequence),
        labels: built.map((b) => b.label),
    };
}
