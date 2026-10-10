// Whether a case's course materials are open for one learner.
//
// The gate (cases.config.courseGate, shared/caseCourse.js) has two
// conditions, both measured from what the server already records:
// - time: minutes since the learner FIRST started the case (the earliest of
//   their sessions on it), so leaving and re-entering does not reset it;
// - slides: every pathology slide of the case opened at least once
//   (OPENED_SLIDE learning events). Slides are matched against the case as it
//   is stored now — an author who rebuilds the slide set asks for it again.
//
// The slide condition rests on events the learner's own browser reports. That
// is enough to open teaching material; it is not an exam lock. The time
// condition is the server's clock and the server's session row.
//
// A gate, once open, stays open: the first start time only moves back and an
// opened slide stays opened.

import dbAdapter from '../dbAdapter.js';
import { normaliseCourseGate } from '../shared/caseCourse.js';
import { timeMs } from '../shared/time.js';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseConfig(config) {
    if (isPlainObject(config)) return config;
    if (typeof config !== 'string' || !config) return {};
    try {
        const parsed = JSON.parse(config);
        return isPlainObject(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/** The case's pathology slides as `{id, label}`, in manifest order. */
export function caseSlides(config) {
    const slides = parseConfig(config).pathology?.manifest?.slides;
    if (!Array.isArray(slides)) return [];
    return slides
        .filter((slide) => isPlainObject(slide) && typeof slide.id === 'string')
        .map((slide) => ({ id: slide.id, label: typeof slide.label === 'string' ? slide.label : slide.id }));
}

/**
 * The gate state of one case for one learner.
 *
 * @param {{tenantId: number, userId: number, caseRow: {id: number, config: unknown}, now?: number}} args
 * @returns {Promise<{
 *   configured: boolean, unlocked: boolean,
 *   afterMinutes?: number, allSlidesOpened?: boolean,
 *   startedAt?: string|null, unlockAt?: string|null, remainingSeconds?: number|null,
 *   slides?: {id: string, label: string, opened: boolean}[]
 * }>}
 */
export async function courseGateState({ tenantId, userId, caseRow, now = Date.now() }) {
    const config = parseConfig(caseRow.config);
    const { gate } = normaliseCourseGate(config.courseGate);
    if (!gate) return { configured: false, unlocked: true };

    const first = await dbAdapter.get(
        `SELECT MIN(start_time) AS started FROM sessions
          WHERE tenant_id = ? AND user_id = ? AND case_id = ? AND deleted_at IS NULL`,
        [tenantId, userId, caseRow.id]
    );
    const startedMs = first?.started ? timeMs(first.started) : null;
    const started = Number.isFinite(startedMs);

    const slides = gate.allSlidesOpened ? caseSlides(config) : [];
    let openedIds = new Set();
    if (slides.length) {
        const rows = await dbAdapter.all(
            `SELECT DISTINCT object_id FROM learning_events
              WHERE tenant_id = ? AND user_id = ? AND case_id = ? AND verb = 'OPENED_SLIDE' AND object_id IS NOT NULL`,
            [tenantId, userId, caseRow.id]
        );
        openedIds = new Set(rows.map((row) => row.object_id));
    }
    const slideStates = slides.map((slide) => ({ ...slide, opened: openedIds.has(slide.id) }));

    const unlockMs = started ? startedMs + gate.afterMinutes * 60_000 : null;
    const timeMet = started && now >= unlockMs;
    const slidesMet = slideStates.every((slide) => slide.opened);
    return {
        configured: true,
        unlocked: Boolean(timeMet && slidesMet),
        afterMinutes: gate.afterMinutes,
        allSlidesOpened: gate.allSlidesOpened,
        startedAt: started ? new Date(startedMs).toISOString() : null,
        unlockAt: started ? new Date(unlockMs).toISOString() : null,
        remainingSeconds: started ? Math.max(0, Math.ceil((unlockMs - now) / 1000)) : null,
        slides: slideStates,
    };
}

// The state of a lesson whose case is gone: locked, with nothing left to meet.
const GONE_CASE_STATE = Object.freeze({
    configured: true,
    unlocked: false,
    caseGone: true,
    afterMinutes: 0,
    allSlidesOpened: false,
    startedAt: null,
    unlockAt: null,
    remainingSeconds: null,
    slides: [],
});

/**
 * Gate states for several cases at once, keyed by case id — one lookup per
 * case, for a lesson list that may point at the same case many times. A case
 * that is gone (deleted, other tenant) keeps its lessons locked: the material
 * behind a gate usually explains the case, and deleting the case is not a
 * decision to publish it. An educator opens such a lesson by saving the
 * course locks of any case in the course (PUT /cases/:caseId/course-locks).
 *
 * @returns {Promise<Map<number, object>>}
 */
export async function courseGateStates({ tenantId, userId, caseIds, now = Date.now() }) {
    const states = new Map();
    for (const caseId of new Set(caseIds)) {
        const caseRow = await dbAdapter.get(
            'SELECT id, config FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
            [caseId, tenantId]
        );
        states.set(caseId, caseRow
            ? await courseGateState({ tenantId, userId, caseRow, now })
            : GONE_CASE_STATE);
    }
    return states;
}
