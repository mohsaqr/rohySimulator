// The case document inside a case package: the whole authored case, not just
// its `cases` row.
//
// A case is more than the row. Its agents (case_agents), its labs and imaging
// (case_investigations) and its treatment rubric (case_treatments) live in
// their own tables. This module reads them into one document and writes them
// back. Media is not its business — services/casePackage.js carries the files
// and rewrites the references in the document before it reaches here.
//
// Ids never travel. Agent templates are matched by (agent_type, name, prompt)
// and medications by code, then name.
//
// Import is split in two so the write transaction stays short: prepareCaseRelated()
// does every lookup BEFORE the transaction opens; insertCaseRelated() runs inside
// it and only inserts — on whatever connection the caller passes, because a
// transaction on rohy's shared connection would take in other requests' writes
// (and roll them back with its own). casePackage.js runs it in dbAdapter.isolatedTransaction.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dbAdapter from '../dbAdapter.js';
import { isSpecialistType } from '../shared/specialties.js';
import { configOverrideProblem } from '../routes/agents-routes.js';
import { normalizeCaseTreatmentFlags } from '../routes/orders-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CASE_DOCUMENT_FORMAT = 'rohy.case';
export const CASE_DOCUMENT_VERSION = 2;

// Bounds on one document. A real case is far below these; they exist so a
// crafted package cannot turn one import into an unbounded write.
export const CASE_IMPORT_LIMITS = Object.freeze({ agents: 50, investigations: 2000, treatments: 1000 });

// How many "<name> (imported N)" copies of one persona an import will try
// before falling back to the server's default persona of that type.
const MAX_IMPORTED_COPIES = 5;

const TREATMENT_TYPES = ['medication', 'iv_fluid', 'oxygen', 'nursing'];

let APP_VERSION = 'unknown';
try {
    APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version || 'unknown';
} catch { /* metadata only — a document without it is still complete */ }
export { APP_VERSION };

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isOptionalNumber = (value) => value === undefined || value === null || Number.isFinite(value);
const isOptionalString = (value) => value === undefined || value === null || typeof value === 'string';

/** A JSON column as a value: parsed when it is JSON, the raw text when not. */
function readJsonColumn(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return value; }
}

/** The inverse of readJsonColumn: text stays text, anything else is JSON. */
function writeJsonColumn(value) {
    if (value === null || value === undefined) return null;
    return typeof value === 'string' ? value : JSON.stringify(value);
}

const flag = (value) => (value ? 1 : 0);
const samePrompt = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

/**
 * Build the case document for one case.
 *
 * @param {object} opts
 * @param {number|string} opts.caseId
 * @param {number} opts.tenant  the caller's tenant; another tenant's case is not found
 * @returns {Promise<object|null>} the document, or null when there is no such live case
 */
export async function buildCaseDocument({ caseId, tenant }) {
    const row = await dbAdapter.get(
        'SELECT * FROM cases WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
        [caseId, tenant]
    );
    if (!row) return null;

    // A row whose template was soft-deleted is hidden at runtime, so it is
    // not part of the case a learner meets — and not exported.
    const agentRows = await dbAdapter.all(
        `SELECT ca.*, t.agent_type, t.name AS template_name, t.role_title, t.avatar_url,
                t.system_prompt AS template_system_prompt, t.context_filter, t.communication_style,
                t.config AS template_config, t.memory_access
           FROM case_agents ca
           JOIN agent_templates t ON t.id = ca.agent_template_id
          WHERE ca.case_id = ? AND t.deleted_at IS NULL
          ORDER BY ca.id`,
        [row.id]
    );
    const investigationRows = await dbAdapter.all(
        'SELECT * FROM case_investigations WHERE case_id = ? AND deleted_at IS NULL ORDER BY id',
        [row.id]
    );
    const treatmentRows = await dbAdapter.all(
        `SELECT ct.*, m.medication_code, m.generic_name
           FROM case_treatments ct
           LEFT JOIN medications m ON m.id = ct.medication_id AND m.deleted_at IS NULL
          WHERE ct.case_id = ?
          ORDER BY ct.id`,
        [row.id]
    );

    // The template's LLM routing (provider, model, key, endpoint) is left out:
    // it names this install's accounts, and a key must never leave the server.
    const agents = agentRows.map((a) => ({
        template: {
            agent_type: a.agent_type,
            name: a.template_name,
            role_title: a.role_title,
            avatar_url: a.avatar_url,
            system_prompt: a.template_system_prompt,
            context_filter: a.context_filter,
            communication_style: a.communication_style,
            config: readJsonColumn(a.template_config),
            memory_access: readJsonColumn(a.memory_access),
        },
        enabled: Boolean(a.enabled),
        name_override: a.name_override,
        system_prompt_override: a.system_prompt_override,
        availability_type: a.availability_type,
        available_from_minute: a.available_from_minute,
        auto_arrive_minute: a.auto_arrive_minute,
        depart_at_minute: a.depart_at_minute,
        response_time_min: a.response_time_min,
        response_time_max: a.response_time_max,
        config_override: readJsonColumn(a.config_override),
    }));
    const investigations = investigationRows.map((i) => ({
        investigation_type: i.investigation_type,
        test_name: i.test_name,
        test_group: i.test_group,
        gender_category: i.gender_category,
        unit: i.unit,
        result_data: readJsonColumn(i.result_data),
        normal_samples: readJsonColumn(i.normal_samples),
        image_url: i.image_url,
        turnaround_minutes: i.turnaround_minutes,
        is_abnormal: Boolean(i.is_abnormal),
        current_value: i.current_value,
        min_value: i.min_value,
        max_value: i.max_value,
    }));
    const treatments = treatmentRows.map((t) => ({
        treatment_type: t.treatment_type,
        treatment_name: t.treatment_name,
        medication: t.medication_code || t.generic_name
            ? { medication_code: t.medication_code, generic_name: t.generic_name }
            : null,
        is_available: Boolean(t.is_available),
        is_expected: Boolean(t.is_expected),
        is_contraindicated: Boolean(t.is_contraindicated),
        points_if_ordered: t.points_if_ordered,
        feedback_if_ordered: t.feedback_if_ordered,
        feedback_if_missed: t.feedback_if_missed,
        custom_effect_override: readJsonColumn(t.custom_effect_override),
    }));

    return {
        rohy_export: {
            format: CASE_DOCUMENT_FORMAT,
            format_version: CASE_DOCUMENT_VERSION,
            exported_at: new Date().toISOString(),
            app_version: APP_VERSION,
            source_case_code: row.case_code,
        },
        case: {
            name: row.name,
            description: row.description,
            system_prompt: row.system_prompt,
            config: readJsonColumn(row.config),
            scenario: readJsonColumn(row.scenario),
            patient_gender: row.patient_gender,
        },
        related: { agents, investigations, treatments },
    };
}

const problem = (error, code = 'invalid_case_file') => ({ problem: { error, code } });

function agentProblem(agent, index) {
    const where = `related.agents[${index}]`;
    if (!isPlainObject(agent)) return `${where} must be an object`;
    const tpl = agent.template;
    if (!isPlainObject(tpl) || !isNonEmptyString(tpl.agent_type) || !isNonEmptyString(tpl.name)) {
        return `${where}.template needs agent_type and name`;
    }
    if (!isOptionalString(tpl.system_prompt)) return `${where}.template.system_prompt must be text`;
    for (const key of ['name_override', 'system_prompt_override', 'availability_type']) {
        if (!isOptionalString(agent[key])) return `${where}.${key} must be text`;
    }
    for (const key of ['available_from_minute', 'auto_arrive_minute', 'depart_at_minute', 'response_time_min', 'response_time_max']) {
        if (!isOptionalNumber(agent[key])) return `${where}.${key} must be a number`;
    }
    const override = configOverrideProblem(agent.config_override ?? null, tpl.agent_type);
    if (override) return `${where}.config_override: ${override.error}`;
    return null;
}

function investigationProblem(inv, index) {
    const where = `related.investigations[${index}]`;
    if (!isPlainObject(inv)) return `${where} must be an object`;
    if (!isNonEmptyString(inv.investigation_type) || !isNonEmptyString(inv.test_name)) {
        return `${where} needs investigation_type and test_name`;
    }
    for (const key of ['test_group', 'gender_category', 'unit', 'image_url']) {
        if (!isOptionalString(inv[key])) return `${where}.${key} must be text`;
    }
    for (const key of ['turnaround_minutes', 'current_value', 'min_value', 'max_value']) {
        if (!isOptionalNumber(inv[key])) return `${where}.${key} must be a number`;
    }
    return null;
}

function treatmentProblem(t, index) {
    const where = `related.treatments[${index}]`;
    if (!isPlainObject(t)) return `${where} must be an object`;
    if (!TREATMENT_TYPES.includes(t.treatment_type)) {
        return `${where}.treatment_type must be one of ${TREATMENT_TYPES.join(', ')}`;
    }
    if (!isNonEmptyString(t.treatment_name)) return `${where}.treatment_name is required`;
    if (!isOptionalNumber(t.points_if_ordered)) return `${where}.points_if_ordered must be a number`;
    if (t.medication !== undefined && t.medication !== null && !isPlainObject(t.medication)) {
        return `${where}.medication must be an object or null`;
    }
    return null;
}

/**
 * Validate a case document before anything is written.
 *
 * @param {object} doc  the parsed case.json
 * @returns {{caseFields: object, related: {agents: object[], investigations: object[], treatments: object[]}}
 *          | {problem: {error: string, code: string}}}
 */
export function readCaseDocument(doc) {
    const meta = doc?.rohy_export;
    if (!isPlainObject(meta) || meta.format !== CASE_DOCUMENT_FORMAT) {
        return problem(`Not a Rohy case document (rohy_export.format must be "${CASE_DOCUMENT_FORMAT}")`);
    }
    if (!Number.isInteger(meta.format_version) || meta.format_version < CASE_DOCUMENT_VERSION) {
        return problem(`Unsupported case document version ${meta.format_version}; export it again from its source`, 'unsupported_case_format');
    }
    if (meta.format_version > CASE_DOCUMENT_VERSION) {
        return problem(
            `This case was exported by a newer Rohy (case format ${meta.format_version}); this server reads ${CASE_DOCUMENT_VERSION}`,
            'unsupported_case_format'
        );
    }
    const caseFields = doc.case;
    if (!isPlainObject(caseFields) || !isNonEmptyString(caseFields.name)) return problem('case.name is required');
    if (caseFields.config !== undefined && caseFields.config !== null && !isPlainObject(caseFields.config)) {
        return problem('case.config must be an object');
    }

    const raw = doc.related ?? {};
    if (!isPlainObject(raw)) return problem('related must be an object');
    const related = {};
    for (const key of ['agents', 'investigations', 'treatments']) {
        const list = raw[key] ?? [];
        if (!Array.isArray(list)) return problem(`related.${key} must be an array`);
        if (list.length > CASE_IMPORT_LIMITS[key]) {
            return problem(`A case may carry at most ${CASE_IMPORT_LIMITS[key]} ${key}`, 'case_import_too_large');
        }
        related[key] = list;
    }
    const why = related.agents.map(agentProblem).find(Boolean)
        || related.investigations.map(investigationProblem).find(Boolean)
        || related.treatments.map(treatmentProblem).find(Boolean);
    if (why) return problem(why);

    return { caseFields, related };
}

function importedNames(name) {
    return [
        name,
        `${name} (imported)`,
        ...Array.from({ length: MAX_IMPORTED_COPIES - 1 }, (_, i) => `${name} (imported ${i + 2})`),
    ];
}

/**
 * Decide, OUTSIDE any transaction, which template each agent attaches to.
 *
 * A persona is reused only when this server's template of the same type and
 * name carries the SAME prompt. Two installs can both have a "Default Patient"
 * that say different things; attaching the local one would silently change
 * the case. A differing one gets an "(imported)" copy instead.
 */
async function planTemplate({ tpl, tenant, index, warnings }) {
    const field = `related.agents[${index}].template`;
    const fileHasPrompt = isNonEmptyString(tpl.system_prompt);
    const free = [];
    for (const name of importedNames(tpl.name)) {
        const existing = await dbAdapter.get(
            `SELECT id, system_prompt FROM agent_templates
              WHERE tenant_id = ? AND agent_type = ? AND name = ? AND deleted_at IS NULL
              ORDER BY id LIMIT 1`,
            [tenant, tpl.agent_type, name]
        );
        if (existing && (!fileHasPrompt || samePrompt(existing.system_prompt, tpl.system_prompt))) {
            return { templateId: existing.id };
        }
        if (!existing) free.push(name);
    }
    const fallback = await dbAdapter.get(
        `SELECT MIN(id) AS id FROM agent_templates
          WHERE tenant_id = ? AND agent_type = ? AND is_default = 1 AND deleted_at IS NULL`,
        [tenant, tpl.agent_type]
    );
    if (fileHasPrompt && free.length > 0) {
        return { create: { tpl, names: free, field }, fallbackId: fallback?.id ?? null };
    }
    if (fallback?.id) {
        warnings.push({ field, received: tpl.name, hint: `The persona could not be recreated; this server's default ${tpl.agent_type} stands in, with the case's own overrides.` });
        return { templateId: fallback.id };
    }
    warnings.push({ field, received: tpl.name, hint: `No ${tpl.agent_type} persona exists on this server; the agent was skipped.` });
    return { skip: true };
}

const MEDICATION_BY_CODE_SQL = `SELECT id FROM medications
    WHERE deleted_at IS NULL AND (scope = 'platform' OR (scope = 'tenant' AND tenant_id = ?))
      AND medication_code = ? ORDER BY id LIMIT 1`;
const MEDICATION_BY_NAME_SQL = `SELECT id FROM medications
    WHERE deleted_at IS NULL AND (scope = 'platform' OR (scope = 'tenant' AND tenant_id = ?))
      AND lower(generic_name) = lower(?) ORDER BY id LIMIT 1`;

async function resolveMedication({ medication, tenant }) {
    if (!isPlainObject(medication)) return null;
    if (isNonEmptyString(medication.medication_code)) {
        const byCode = await dbAdapter.get(MEDICATION_BY_CODE_SQL, [tenant, medication.medication_code]);
        if (byCode) return byCode.id;
    }
    if (isNonEmptyString(medication.generic_name)) {
        const byName = await dbAdapter.get(MEDICATION_BY_NAME_SQL, [tenant, medication.generic_name]);
        if (byName) return byName.id;
    }
    return null;
}

/**
 * Every lookup the import needs, done BEFORE the write transaction opens.
 *
 * @returns {Promise<{agents: object[], treatments: object[], warnings: object[]}>} the plan
 */
export async function prepareCaseRelated({ tenant, related }) {
    const warnings = [];
    const agents = [];
    // One specialist per specialty per case — runtime state is keyed by type
    // (agents-routes POST /cases/:caseId/agents enforces the same).
    const specialistTypes = new Set();
    for (const [index, agent] of related.agents.entries()) { // sequential: one sqlite handle
        const type = agent.template.agent_type;
        if (isSpecialistType(type) && specialistTypes.has(type)) {
            warnings.push({ field: `related.agents[${index}]`, received: agent.template.name, hint: `A case holds one ${type}; this one was skipped.` });
            continue;
        }
        const plan = await planTemplate({ tpl: agent.template, tenant, index, warnings });
        if (plan.skip) continue;
        if (isSpecialistType(type)) specialistTypes.add(type);
        agents.push({ agent, ...plan });
    }
    const treatments = [];
    for (const [index, t] of related.treatments.entries()) {
        const medicationId = await resolveMedication({ medication: t.medication, tenant });
        if (t.medication && !medicationId) {
            warnings.push({
                field: `related.treatments[${index}].medication`,
                received: t.medication.medication_code || t.medication.generic_name || null,
                hint: 'No matching medication on this server; the treatment is kept by name without the catalogue link.',
            });
        }
        treatments.push({ t, medicationId });
    }
    return { agents, treatments, investigations: related.investigations, warnings };
}

async function createTemplate({ tx, create, fallbackId, tenant, userId, warnings, createdTemplates, cache }) {
    const { tpl, names, field } = create;
    const key = `${tpl.agent_type}\u0000${tpl.name}\u0000${tpl.system_prompt}`;
    if (cache.has(key)) return cache.get(key);
    for (const name of names) {
        try {
            const inserted = await tx.run(
                `INSERT INTO agent_templates
                 (agent_type, name, role_title, avatar_url, system_prompt, context_filter,
                  communication_style, is_default, config, memory_access, created_by, tenant_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
                [
                    tpl.agent_type, name, tpl.role_title ?? null, tpl.avatar_url ?? null,
                    tpl.system_prompt, tpl.context_filter ?? 'full', tpl.communication_style ?? null,
                    writeJsonColumn(tpl.config), writeJsonColumn(tpl.memory_access), userId, tenant,
                ]
            );
            createdTemplates.push({ id: inserted.lastID, agent_type: tpl.agent_type, name });
            if (name !== tpl.name) {
                warnings.push({ field, received: tpl.name, hint: `This server's persona of that name says something different; the case's own was created as "${name}".` });
            }
            cache.set(key, inserted.lastID);
            return inserted.lastID;
        } catch (err) {
            // (agent_type, name) is unique across the whole database, so a
            // soft-deleted template or another tenant's can hold a name the
            // lookup saw as free. Try the next one; anything else is real.
            if (!/UNIQUE/i.test(err.message)) throw err;
        }
    }
    if (fallbackId) {
        warnings.push({ field, received: tpl.name, hint: `The persona could not be recreated; this server's default ${tpl.agent_type} stands in, with the case's own overrides.` });
        return fallbackId;
    }
    warnings.push({ field, received: tpl.name, hint: `No ${tpl.agent_type} persona exists on this server; the agent was skipped.` });
    return null;
}

/**
 * Write the related rows of a freshly inserted case from a prepared plan.
 * Call INSIDE the import's transaction, with its handle (`tx.run(sql,
 * params)` → `{lastID, changes}`, from dbAdapter.isolatedTransaction): a failure here must take the case row with
 * it. Only inserts — every lookup happened in prepareCaseRelated().
 *
 * @returns {Promise<{imported: {agents: number, investigations: number, treatments: number},
 *                    createdTemplates: object[], warnings: object[]}>}
 */
export async function insertCaseRelated({ tx = dbAdapter, caseId, tenant, userId, plan }) {
    const warnings = [];
    const createdTemplates = [];
    const cache = new Map();
    const imported = { agents: 0, investigations: 0, treatments: 0 };

    for (const entry of plan.agents) {
        const templateId = entry.templateId
            ?? await createTemplate({ tx, create: entry.create, fallbackId: entry.fallbackId, tenant, userId, warnings, createdTemplates, cache });
        if (!templateId) continue;
        const { agent } = entry;
        await tx.run(
            `INSERT INTO case_agents
             (case_id, tenant_id, agent_template_id, enabled, name_override, system_prompt_override,
              availability_type, available_from_minute, auto_arrive_minute, depart_at_minute,
              response_time_min, response_time_max, config_override)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                caseId, tenant, templateId, flag(agent.enabled ?? true),
                agent.name_override ?? null, agent.system_prompt_override ?? null,
                agent.availability_type ?? 'present', agent.available_from_minute ?? 0,
                agent.auto_arrive_minute ?? null, agent.depart_at_minute ?? null,
                agent.response_time_min ?? 0, agent.response_time_max ?? 0,
                agent.config_override ? JSON.stringify(agent.config_override) : null,
            ]
        );
        imported.agents++;
    }

    for (const inv of plan.investigations) {
        await tx.run(
            `INSERT INTO case_investigations
             (case_id, investigation_type, test_name, test_group, gender_category, unit,
              result_data, normal_samples, image_url, turnaround_minutes, is_abnormal,
              current_value, min_value, max_value, tenant_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                caseId, inv.investigation_type, inv.test_name, inv.test_group ?? null,
                inv.gender_category ?? null, inv.unit ?? null,
                writeJsonColumn(inv.result_data), writeJsonColumn(inv.normal_samples),
                inv.image_url ?? null,
                // null = follow the case default (bug report 2.9.15 #4) — kept as null.
                inv.turnaround_minutes ?? null,
                flag(inv.is_abnormal), inv.current_value ?? null, inv.min_value ?? null,
                inv.max_value ?? null, tenant,
            ]
        );
        imported.investigations++;
    }

    for (const { t, medicationId } of plan.treatments) {
        const flags = normalizeCaseTreatmentFlags(t);
        await tx.run(
            `INSERT INTO case_treatments
             (case_id, treatment_type, medication_id, treatment_name,
              is_available, is_expected, is_contraindicated,
              points_if_ordered, feedback_if_ordered, feedback_if_missed,
              custom_effect_override, tenant_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                caseId, t.treatment_type, medicationId, t.treatment_name,
                flags.is_available, flags.is_expected, flags.is_contraindicated,
                t.points_if_ordered ?? 0, t.feedback_if_ordered || null, t.feedback_if_missed || null,
                t.custom_effect_override ? JSON.stringify(t.custom_effect_override) : null,
                tenant,
            ]
        );
        imported.treatments++;
    }

    return { imported, createdTemplates, warnings };
}
