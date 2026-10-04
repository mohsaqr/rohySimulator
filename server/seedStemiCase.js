// Boot upgrader: bring each tenant's default STEMI case to v2
// (seeders/stemiV2.js), once, without overwriting an educator's work.
//
// Per tenant, the first boot after the upgrade does exactly one of:
//
//   FRESH       the case was seeded as v2 (config.seed_revision) — attach its
//               agents and rubric, which seeders/cases.js cannot (it runs
//               before the agent templates are guaranteed and holds no
//               rubric table logic).
//   IN PLACE    the shipped case is still exactly as shipped — replace its
//               content with v2 and attach the agents and rubric.
//   ALONGSIDE   an educator has changed it (its content, its agents, its
//               rubric, or its name — a renamed case is found by the prompt it
//               shipped with) — leave it alone and add "… (v2)" beside it, in
//               the default course, not the default case.
//   NOTHING     the tenant deleted the case, or never had it: respect that.
//
// "Exactly as shipped" is strict on purpose: never edited through the editor
// (no version bump, no case_versions row, no last_modified_by), a system
// prompt equal to one of the prompts ever shipped (seeders/stemiLegacy.js),
// no rubric rows, and no agents beyond the specialists the server stands on
// every case. When in doubt it is ALONGSIDE: a duplicate case costs an
// educator a click; an overwritten one costs them their work.
//
// A platform_settings marker per tenant makes it run once — an educator who
// later removes the nurse does not get her back on the next boot. Each tenant
// is one transaction. Non-fatal: a failure is logged and the server boots.
// Running sessions keep their frozen case snapshot either way.

import dbAdapter from './dbAdapter.js';
import { logger } from './logger.js';
import { caseCodeFor } from './shared/caseCode.js';
import { validatePluginDocuments } from './shared/pluginDocument.js';
import { PLUGIN_MANIFESTS } from './shared/plugins/manifests.generated.js';
import { STANDING_SPECIALIST_TYPES, MATERIAL_SPECIALIST_TYPES } from './shared/specialties.js';
import { LEGACY_STEMI_NAME, LEGACY_STEMI_SYSTEM_PROMPTS } from './seeders/stemiLegacy.js';
import {
    STEMI_SEED_REVISION, STEMI_V2_CASE, STEMI_V2_ALONGSIDE_NAME, STEMI_V2_AGENTS, STEMI_V2_TREATMENTS,
} from './seeders/stemiV2.js';

const log = logger('seed-stemi-case');

/** The per-tenant run-once marker. */
export const stemiMarkerKey = (tenant) => `seed.stemi_v2.tenant.${tenant}`;

const SERVER_ATTACHED_TYPES = [...new Set([...STANDING_SPECIALIST_TYPES, ...MATERIAL_SPECIALIST_TYPES])];

function parseObject(raw) {
    try {
        const value = JSON.parse(raw || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

/** Is this shipped case still exactly as it shipped? */
async function isUntouched(row, tenant) {
    if (Number(row.version ?? 1) > 1 || row.last_modified_by != null || row.created_by != null) return false;
    if (!LEGACY_STEMI_SYSTEM_PROMPTS.includes(row.system_prompt)) return false;
    const versions = await dbAdapter.get('SELECT COUNT(*) AS n FROM case_versions WHERE case_id = ?', [row.id]);
    if (versions.n > 0) return false;
    const rubric = await dbAdapter.get('SELECT COUNT(*) AS n FROM case_treatments WHERE case_id = ?', [row.id]);
    if (rubric.n > 0) return false;
    const agents = await dbAdapter.all(
        `SELECT t.agent_type, ca.name_override, ca.system_prompt_override, ca.config_override
           FROM case_agents ca JOIN agent_templates t ON t.id = ca.agent_template_id
          WHERE ca.case_id = ? AND ca.tenant_id = ?`,
        [row.id, tenant]
    );
    return agents.every((a) => SERVER_ATTACHED_TYPES.includes(a.agent_type)
        && a.name_override == null && a.system_prompt_override == null && a.config_override == null);
}

async function attachAgents(caseId, tenant) {
    let attached = 0;
    for (const spec of STEMI_V2_AGENTS) { // sequential: one transaction, one handle
        const template = await dbAdapter.get(
            `SELECT id FROM agent_templates
              WHERE tenant_id = ? AND agent_type = ? AND name = ? AND deleted_at IS NULL
              ORDER BY is_default DESC, id LIMIT 1`,
            [tenant, spec.agent_type, spec.template_name]
        );
        if (!template) {
            log.warn('stemi v2 agent template missing; not attached', { tenant_id: tenant, agent_type: spec.agent_type, name: spec.template_name });
            continue;
        }
        const { changes } = await dbAdapter.run(
            `INSERT INTO case_agents
               (case_id, tenant_id, agent_template_id, enabled, name_override, system_prompt_override,
                availability_type, available_from_minute, config_override)
             SELECT ?, ?, ?, 1, ?, ?, ?, 0, ?
              WHERE NOT EXISTS (SELECT 1 FROM case_agents WHERE case_id = ? AND agent_template_id = ?)`,
            [caseId, tenant, template.id, spec.name_override ?? null, spec.system_prompt_override ?? null,
             spec.availability_type, JSON.stringify(spec.config_override), caseId, template.id]
        );
        attached += changes;
    }
    return attached;
}

async function attachRubric(caseId, tenant) {
    const existing = await dbAdapter.get('SELECT COUNT(*) AS n FROM case_treatments WHERE case_id = ?', [caseId]);
    if (existing.n > 0) return 0;
    for (const t of STEMI_V2_TREATMENTS) { // sequential: ordered ids, the editor reads them back in order
        await dbAdapter.run(
            `INSERT INTO case_treatments
               (case_id, treatment_type, treatment_name, is_available, is_expected, is_contraindicated,
                points_if_ordered, feedback_if_ordered, feedback_if_missed, tenant_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [caseId, t.treatment_type, t.treatment_name, t.is_available ? 1 : 0, t.is_expected ? 1 : 0,
             t.is_contraindicated ? 1 : 0, t.points_if_ordered, t.feedback_if_ordered ?? null,
             t.feedback_if_missed ?? null, tenant]
        );
    }
    return STEMI_V2_TREATMENTS.length;
}

async function replaceInPlace(caseId, tenant) {
    const c = STEMI_V2_CASE;
    await dbAdapter.run(
        `UPDATE cases SET description = ?, system_prompt = ?, config = ?, scenario = ?, patient_name = ?,
                patient_gender = ?, patient_age = ?, chief_complaint = ?, difficulty_level = ?,
                estimated_duration_minutes = ?, learning_objectives = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND tenant_id = ?`,
        [c.description, c.system_prompt, c.config, c.scenario, c.patient_name, c.patient_gender, c.patient_age,
         c.chief_complaint, c.difficulty_level, c.estimated_duration_minutes, c.learning_objectives, caseId, tenant]
    );
}

async function insertAlongside(tenant) {
    const c = STEMI_V2_CASE;
    const { lastID } = await dbAdapter.run(
        `INSERT INTO cases (name, description, system_prompt, config, scenario, patient_name, patient_gender,
                            patient_age, chief_complaint, difficulty_level, estimated_duration_minutes,
                            learning_objectives, is_available, is_default, tenant_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, CURRENT_TIMESTAMP)`,
        [STEMI_V2_ALONGSIDE_NAME, c.description, c.system_prompt, c.config, c.scenario, c.patient_name,
         c.patient_gender, c.patient_age, c.chief_complaint, c.difficulty_level, c.estimated_duration_minutes,
         c.learning_objectives, tenant]
    );
    await dbAdapter.run('UPDATE cases SET case_code = ? WHERE id = ?', [caseCodeFor(JSON.parse(c.config), lastID), lastID]);
    // Beside the original in the tenant's default course, so learners who see
    // one see the other.
    await dbAdapter.run(
        `INSERT INTO cohort_cases (cohort_id, case_id)
         SELECT co.id, ? FROM cohorts co
          WHERE co.tenant_id = ? AND co.is_default = 1 AND co.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM cohort_cases cc WHERE cc.cohort_id = co.id AND cc.case_id = ? AND cc.deleted_at IS NULL)`,
        [lastID, tenant, lastID]
    );
    return lastID;
}

/**
 * Upgrade one tenant. Returns what was done: 'fresh' | 'in_place' |
 * 'alongside' | 'nothing' | 'done' (marker already set).
 */
export async function upgradeStemiCaseForTenant(tenant) {
    const marker = await dbAdapter.get('SELECT setting_value FROM platform_settings WHERE setting_key = ?', [stemiMarkerKey(tenant)]);
    if (marker) return 'done';

    return dbAdapter.transaction(async () => {
        // The shipped case by its name; failing that, a renamed one by the
        // prompt it shipped with (a rename is an edit, so it gets v2 beside
        // it, never in place).
        const byName = await dbAdapter.get(
            `SELECT id, name, system_prompt, config, version, created_by, last_modified_by
               FROM cases WHERE tenant_id = ? AND name = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`,
            [tenant, LEGACY_STEMI_NAME]
        );
        const renamed = byName ? null : await dbAdapter.get(
            `SELECT id, name, system_prompt, config, version, created_by, last_modified_by
               FROM cases WHERE tenant_id = ? AND deleted_at IS NULL
                AND system_prompt IN (${LEGACY_STEMI_SYSTEM_PROMPTS.map(() => '?').join(', ')}) ORDER BY id LIMIT 1`,
            [tenant, ...LEGACY_STEMI_SYSTEM_PROMPTS]
        );
        const row = byName ?? renamed;
        let outcome;
        let caseId = null;
        if (!row) {
            // Deleted, or never seeded in this tenant: respect that.
            outcome = 'nothing';
        } else if (renamed) {
            outcome = 'alongside';
            caseId = await insertAlongside(tenant);
        } else if (parseObject(row.config).seed_revision === STEMI_SEED_REVISION) {
            outcome = 'fresh';
            caseId = row.id;
        } else if (await isUntouched(row, tenant)) {
            outcome = 'in_place';
            caseId = row.id;
            await replaceInPlace(caseId, tenant);
        } else {
            outcome = 'alongside';
            caseId = await insertAlongside(tenant);
        }
        const agents = caseId ? await attachAgents(caseId, tenant) : 0;
        const treatments = caseId ? await attachRubric(caseId, tenant) : 0;
        await dbAdapter.run(
            'INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO NOTHING',
            [stemiMarkerKey(tenant), JSON.stringify({ outcome, case_id: caseId, revision: STEMI_SEED_REVISION })]
        );
        log.info('default STEMI case upgraded', { tenant_id: tenant, outcome, case_id: caseId, agents, treatments });
        return outcome;
    });
}

/** Every tenant that has cases. Non-fatal. */
export async function seedStemiCase() {
    try {
        // The content is checked here, not trusted: the seeder bypasses the
        // case routes' validators, so a bad document would otherwise reach
        // learners unvalidated.
        const problem = validatePluginDocuments(JSON.parse(STEMI_V2_CASE.config), PLUGIN_MANIFESTS);
        if (problem) {
            log.error('stemi v2 content fails plugin validation; not upgraded', { error: problem });
            return;
        }
        const tenants = await dbAdapter.all('SELECT DISTINCT tenant_id FROM cases WHERE tenant_id IS NOT NULL ORDER BY tenant_id');
        for (const { tenant_id: tenant } of tenants) { // sequential: one transaction per tenant
            await upgradeStemiCaseForTenant(tenant);
        }
    } catch (err) {
        log.error('default STEMI case upgrade failed', { error: err.message, fatal: false });
    }
}

export default seedStemiCase;
