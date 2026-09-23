// Standing specialists: the lab and radiology are on every case, and the
// pathologist and the cardiologist on every case that has slides or an ECG.
//
// The on-call phone lists the specialists attached to a case (case_agents),
// and every runtime path — paging, the brief, the conversation log, the LLM
// request log — is keyed on that row. So "the learner can always ring the lab"
// has to be a real row on every case, not a contact the client invents.
//
// Which specialties stand is the registry's call (shared/specialties.js
// STANDING_SPECIALIST_TYPES, MATERIAL_SPECIALIST_TYPES, hasSpecialtyMaterial);
// this module only attaches them. It runs:
//   - when a case is created or saved (POST/PUT /cases) and when a session
//     starts (POST /sessions), for that one case — the session start is the
//     runtime repair for a save whose attach failed, so a learner never waits
//     for a reboot;
//   - at boot, for every case — existing installs, seeded cases, and any
//     insert path that skipped the calls above. Same shape as ensureCaseCodes.
//
// Only ever ADDS. A case whose slides were later removed keeps its
// pathologist; with no material left it is removable again (see
// standsOnCase), so the educator decides.
//
// Idempotent and non-clobbering: a case that already holds a LIVE specialist
// of that type — enabled or DISABLED, from the default template or an
// educator's own — is left alone. Disabling is how an educator turns one off;
// removal is refused at the route, since this sweep would put it back.
//
// A row whose template was soft-deleted does NOT count. The runtime team
// (GET /sessions/:id/agents) already hides it, so counting it here left the
// phone with no lab while every repair path refused: the sweep saw the dead
// row, DELETE answered standing_specialist, and a fresh add answered
// specialty_already_attached.

import dbAdapter from '../dbAdapter.js';
import { logger } from '../logger.js';
import {
    MATERIAL_SPECIALIST_TYPES,
    STANDING_SPECIALIST_TYPES,
    hasSpecialtyMaterial,
} from '../shared/specialties.js';

const standingLog = logger('standing-specialists');

// One INSERT ... SELECT per specialty covers every case at once. The template
// is the tenant's own shipped default for that type (lowest id, not deleted);
// a tenant without one gets nothing rather than another tenant's persona.
// Availability matches what the case editor's single "add" produces: present,
// reachable at once, no response delay.
const ATTACH_SQL = `
    INSERT INTO case_agents
        (case_id, tenant_id, agent_template_id, enabled,
         availability_type, available_from_minute, response_time_min, response_time_max)
    SELECT c.id, c.tenant_id,
           (SELECT MIN(t.id) FROM agent_templates t
             WHERE t.tenant_id = c.tenant_id AND t.agent_type = ?
               AND t.is_default = 1 AND t.deleted_at IS NULL),
           1, 'present', 0, 0, 0
      FROM cases c
     WHERE c.deleted_at IS NULL
       AND (? IS NULL OR c.id = ?)
       AND EXISTS (
           SELECT 1 FROM agent_templates t
            WHERE t.tenant_id = c.tenant_id AND t.agent_type = ?
              AND t.is_default = 1 AND t.deleted_at IS NULL)
       AND NOT EXISTS (
           SELECT 1 FROM case_agents ca
             JOIN agent_templates t2 ON t2.id = ca.agent_template_id
            WHERE ca.case_id = c.id AND ca.tenant_id = c.tenant_id
              AND t2.agent_type = ? AND t2.deleted_at IS NULL)`;

// Which cases hold material for a with_material specialty is decided in JS,
// by the same hasSpecialtyMaterial() the case editor and the DELETE guard
// use — one definition, rather than a SQL json_* copy that could drift from
// it. The attach itself is still ATTACH_SQL scoped to that one case, so it
// keeps every guard above (live case, tenant template, no live slot).
async function casesWithMaterial(type, caseId) {
    const rows = await dbAdapter.all(
        `SELECT id, config FROM cases
          WHERE deleted_at IS NULL AND (? IS NULL OR id = ?)`,
        [caseId, caseId],
    );
    return rows.filter((row) => hasSpecialtyMaterial(type, row.config)).map((row) => row.id);
}

async function attach(caseId) {
    const attached = {};
    for (const type of STANDING_SPECIALIST_TYPES) {
        const result = await dbAdapter.run(ATTACH_SQL, [type, caseId, caseId, type, type]);
        attached[type] = result.changes;
    }
    for (const type of MATERIAL_SPECIALIST_TYPES) {
        attached[type] = 0;
        for (const id of await casesWithMaterial(type, caseId)) {
            const result = await dbAdapter.run(ATTACH_SQL, [type, id, id, type, type]);
            attached[type] += result.changes;
        }
    }
    const total = Object.values(attached).reduce((sum, n) => sum + n, 0);
    if (total > 0) {
        standingLog.info('standing specialists attached', { case_id: caseId, attached });
    }
    return { attached };
}

/**
 * Attach the standing specialists ONE case is missing.
 *
 * @param {object} opts
 * @param {number|string} opts.caseId  a positive integer id (a numeric string
 *        from a request body is accepted)
 * @returns {Promise<{attached: Record<string, number>}>} rows inserted per
 *          specialty (0 when the case already had one, or no template exists)
 * @throws {TypeError} when caseId is not a positive integer — never widened to
 *         a sweep: node-sqlite3 binds NaN as NULL, and NULL here means "every
 *         case"
 * @throws the sqlite error when a write fails (SQLITE_BUSY is retried inside
 *         dbAdapter.run first)
 */
export async function attachStandingSpecialists({ caseId } = {}) {
    const id = Number(caseId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new TypeError(`attachStandingSpecialists needs a positive integer caseId, got ${String(caseId)}`);
    }
    return attach(id);
}

/**
 * The boot sweep: attach the standing specialists every live case is missing.
 *
 * @returns {Promise<{attached: Record<string, number>}>} rows inserted per specialty
 */
export async function attachStandingSpecialistsToAllCases() {
    return attach(null);
}
