// Server-rendered encounter record — "what the learner actually did".
//
// The PatientRecord subsystem (src/services/PatientRecord/) has always logged
// every clinically relevant act a learner performs, in eight verbs, and synced
// them to `patient_record_events`. Until now nothing read them back: the only
// consumer was a debug panel (PatientRecordViewer), so the data was written,
// persisted, and never used. Meanwhile the discussant's case context ended
// with an apology for not having exactly this information — see
// `src/utils/casePromptContext.js`, "ask the learner about what they did
// rather than assuming".
//
// This module closes that loop. It renders the stored events into a prompt
// block that the LLM proxy appends server-side, on the same terms as the
// observed-affect note in `shared/affectNote.js`: rendered from DB rows the
// server trusts, never from client-supplied text.
//
// WHY SERVER-SIDE. The browser holds the same record in memory and could send
// it, but then the learner's own client would be dictating what the debriefing
// tutor believes they did — a learner could omit the step they skipped. The
// events are already persisted per session; reading them here makes the record
// authoritative.
//
// WHY AN ALLOWLIST, NOT A DENYLIST. `agentMaySeeRecord` names the agent types
// that receive the record rather than the ones that don't. A patient does not
// know their own troponin, and a relative does not know what was ordered from
// another room — handing either of them the record breaks the simulation's
// realism in a way that is hard to notice and impossible for a learner to
// challenge. A new agent type added later therefore receives nothing until
// somebody decides it should, which is the safe direction for a mistake.

// The named columns of `patient_record_events` are a LOSSY projection of the
// event. `patient-record-routes.js` writes nine of them — category, region,
// source, item, content, finding, value, unit, abnormal — and then stores the
// whole event again as JSON in `details`. Several verbs put their most
// clinically meaningful field only in that JSON:
//
//   EXAMINED      technique      auscultation vs palpation
//   ADMINISTERED  dose, route    "gave Aspirin" vs "gave Aspirin 300 mg PO"
//   CHANGED       parameter,     the from → to transition IS the event
//                 from, to
//   ELICITED      test_name      which test produced the value
//
// Rendering from the named columns alone therefore produces lines that are
// technically true and clinically useless. Each verb gets its own formatter,
// reading `details` for the fields the projection dropped.

// Agent types whose prompt may carry the encounter record. Everything absent
// from this set — patient, relative, other, and anything added later — gets
// nothing. See the module header for why this direction.
const RECORD_AGENT_TYPES = new Set([
    'discussant',
    'nurse',
    'consultant',
    'pharmacist',
    'technician',
]);

/**
 * May an agent of this type be told what the learner actually did?
 *
 * @param {string|null|undefined} agentType  `agent_templates.agent_type`.
 * @returns {boolean} true only for types in the allowlist; false for anything
 *   unknown, empty, or non-string.
 */
export function agentMaySeeRecord(agentType) {
    return typeof agentType === 'string' && RECORD_AGENT_TYPES.has(agentType.trim().toLowerCase());
}

/**
 * `details` JSON → object. Supplementary only: every field this recovers is an
 * enrichment on top of the named columns, which are authoritative and already
 * validated by the sync route's CHECK constraint. A malformed blob therefore
 * degrades one line's richness rather than failing the turn — the alternative
 * (throwing) would drop an entire debrief because one old row is unparseable.
 */
function parseDetails(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** `4` → `00:04`. Elapsed minutes, so no clock and no time zone is involved. */
function stamp(minutes) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m < 0) return '--:--';
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
}

function clean(value) {
    if (value == null) return '';
    return String(value).replace(/\s+/g, ' ').trim();
}

/** Join the truthy parts with a space — the common shape of every formatter. */
function phrase(...parts) {
    return parts.filter(Boolean).join(' ');
}

/** `'4.2'`, `'ng/mL'` → `'4.2 ng/mL'`. */
function measure(value, unit) {
    const v = clean(value);
    if (!v) return '';
    const u = clean(unit);
    return u ? `${v} ${u}` : v;
}

// One formatter per verb. Each returns the sentence WITHOUT the timestamp and
// without the abnormal marker — those are added once, by renderRow.
const VERB_FORMATTERS = {
    OBTAINED: (r, d) => phrase('asked about', clean(r.category) || clean(d.category), clean(r.content) && `— ${clean(r.content)}`),

    EXAMINED: (r, d) => {
        const technique = clean(d.technique);
        const detail = clean(d.technique_detail);
        const how = technique ? `(${phrase(technique, detail && `— ${detail}`)})` : '';
        return phrase('examined', clean(r.region) || clean(r.category), how);
    },

    ELICITED: (r, d) => {
        const what = clean(d.test_name) || clean(r.category) || clean(r.source);
        const value = measure(r.value, r.unit);
        return phrase('found', what && `${what}:`, clean(r.finding), value && `(${value})`);
    },

    NOTED: (r, d) => phrase('noted', clean(r.item), clean(d.action) && `→ ${clean(d.action)}`),

    ORDERED: (r, d) => {
        const status = clean(d.status);
        return phrase('ordered', clean(r.item), clean(r.category) && `(${clean(r.category)})`,
            status && status !== 'pending' ? `[${status}]` : '');
    },

    ADMINISTERED: (r, d) => phrase('gave', clean(r.item), clean(d.dose), clean(d.route),
        clean(d.response) && `→ ${clean(d.response)}`),

    // The transition is the whole event; a CHANGED row without from → to says
    // only that something moved.
    CHANGED: (r, d) => {
        const parameter = clean(d.parameter) || clean(r.item) || clean(r.category);
        const from = clean(d.from);
        const to = clean(d.to);
        const unit = clean(r.unit) || clean(d.unit);
        if (from && to) return phrase(parameter, `changed ${from} → ${to}`, unit);
        return phrase('observed change in', parameter, measure(r.value, unit));
    },

    EXPRESSED: (r, d) => phrase('was told', clean(d.type) && `(${clean(d.type)})`, clean(r.content)),
};

/**
 * One stored event → one prompt line, or '' when the row carries no substance.
 */
function renderRow(row) {
    if (!row || typeof row !== 'object') return '';
    const formatter = VERB_FORMATTERS[row.verb];
    if (!formatter) return '';

    const body = clean(formatter(row, parseDetails(row.details)));
    // A formatter that produced only its own lead-in ("examined", "gave")
    // describes nothing: the row is a stub. Costing prompt tokens to say a verb
    // fired teaches the model nothing, so drop it.
    if (!body || !/\s/.test(body)) return '';

    return `[${stamp(row.time_elapsed)}] ${body}${row.abnormal ? ' [ABNORMAL]' : ''}`;
}

/**
 * Render stored encounter events as a system-prompt block.
 *
 * @param {Array<object>} rows        `patient_record_events` rows, chronological.
 * @param {object} [options]
 * @param {number} [options.maxEvents=150]  Keep at most this many, MOST RECENT
 *   first-dropped-last: a long session's opening minutes matter least at
 *   debrief, so the tail is kept and the head is summarised as a count.
 * @returns {string} The block, or '' when there is nothing worth saying —
 *   `assembleSystemPrompt` filters empty blocks, so '' is the correct way to
 *   contribute nothing.
 */
export function renderEncounterRecord(rows, { maxEvents = 150 } = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return '';

    const lines = rows.map(renderRow).filter(Boolean);
    if (lines.length === 0) return '';

    const dropped = Math.max(0, lines.length - maxEvents);
    const kept = dropped ? lines.slice(dropped) : lines;
    const elided = dropped ? [`(… ${dropped} earlier action${dropped === 1 ? '' : 's'} omitted)`] : [];

    return [
        '=== WHAT THE LEARNER ACTUALLY DID THIS SESSION ===',
        'The following is the authoritative record of this learner\'s actions, in elapsed time from the start of the case.',
        'Rely on it instead of asking the learner to recall what they did; ask about their reasoning instead.',
        'An action that is absent did not happen — treat omissions as real, not as gaps in your information.',
        '',
        ...elided,
        ...kept,
        '=== END RECORD ===',
    ].join('\n');
}

/** Exported for the test that pins the allowlist against the authoring UI's AGENT_TYPES. */
export const RECORD_AGENT_TYPE_LIST = Object.freeze([...RECORD_AGENT_TYPES].sort());
