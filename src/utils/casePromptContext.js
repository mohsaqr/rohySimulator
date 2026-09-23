import { formatRadiologyAsMarkdown } from '../data/aiPromptContext.js';
import { formatHistoryAsMarkdown } from '../data/historyGroups.js';
import { LEGACY_SCOPE_BY_CONTEXT_FILTER, KNOWLEDGE_SCOPES, scopeAtLeast } from '../../server/shared/agentKnowledge.js';
import { isRoomEnabled } from '../../server/shared/caseRooms.js';

function clean(value) {
    if (value == null) return '';
    const text = String(value).trim();
    return text.length > 0 ? text : '';
}

function firstValue(obj, keys) {
    for (const key of keys) {
        const value = clean(obj?.[key]);
        if (value) return value;
    }
    return '';
}

function sameText(a, b) {
    return clean(a).toLowerCase() === clean(b).toLowerCase();
}

const STRUCTURED_FIELDS = [
    { key: 'chiefComplaint', label: 'Chief Complaint', aliases: ['chiefComplaint'], clinicalKey: 'chiefComplaint' },
    { key: 'hpi', label: 'History of Present Illness', aliases: ['hpi', 'historyOfPresentIllness', 'present_illness'], clinicalKey: 'hpi' },
    { key: 'pmh', label: 'Past Medical History', aliases: ['pmh', 'pastMedicalHistory', 'pastMedical'], clinicalKey: 'pastMedical' },
    { key: 'psh', label: 'Past Surgical History', aliases: ['psh', 'pastSurgicalHistory', 'pastSurgical'], clinicalKey: 'pastSurgical' },
    { key: 'medications', label: 'Current Medications', aliases: ['medications'] },
    { key: 'allergies', label: 'Allergies', aliases: ['allergies'], clinicalKey: 'allergies' },
    { key: 'socialHistory', label: 'Social History', aliases: ['socialHistory', 'social'], clinicalKey: 'social' },
    { key: 'familyHistory', label: 'Family History', aliases: ['familyHistory', 'family'], clinicalKey: 'family' },
    { key: 'ros', label: 'Review of Systems', aliases: ['ros', 'reviewOfSystems'] },
    { key: 'additionalNotes', label: 'Additional Notes for AI', aliases: ['additionalNotes', 'aiNotes'] },
];

// Resolve a case config's history to one flat object keyed by the canonical
// STRUCTURED_FIELDS keys (chiefComplaint, hpi, pmh, medications, allergies, …),
// regardless of which shape the case was authored/stored in:
//
//   - wizard cases write `structuredHistory` (with historical key aliases like
//     historyOfPresentIllness / pastMedicalHistory),
//   - seeded/imported cases carry only the canonical runtime mirror
//     `clinicalRecords.history` (keys hpi / pastMedical / …).
//
// structuredHistory wins, clinicalRecords.history fills the gaps — the same
// precedence the prompt builders in this file use. Only non-empty fields are
// present in the result. Shared with CaseSummaryModal (bug report 2.9.15 #16),
// which previously read keys nothing ever wrote and read structuredHistory only.
export function resolveCaseHistory(config = {}) {
    const structured = (config?.structuredHistory && typeof config.structuredHistory === 'object')
        ? config.structuredHistory : {};
    const clinicalHistory = (config?.clinicalRecords?.history && typeof config.clinicalRecords.history === 'object')
        ? config.clinicalRecords.history : {};
    const resolved = {};
    for (const field of STRUCTURED_FIELDS) {
        const value = firstValue(structured, field.aliases)
            || (field.clinicalKey ? clean(clinicalHistory[field.clinicalKey]) : '');
        if (value) resolved[field.key] = value;
    }
    return resolved;
}

// Allergies are authored in two places — the demographics tab and the
// structured-history tab. Historically only the structured-history value
// reached the prompt, so demographics-tab entries were silently dropped.
// Pass `demographics` here and structuredHistory wins, demographics fills in.
export function formatStructuredHistoryForPrompt(structuredHistory, { omitMirroredHistory = null, demographics = null } = {}) {
    if (!structuredHistory || typeof structuredHistory !== 'object') {
        const fallbackAllergies = clean(demographics?.allergies);
        return fallbackAllergies ? `- Allergies: ${fallbackAllergies}` : '';
    }
    const lines = [];
    for (const field of STRUCTURED_FIELDS) {
        let value = firstValue(structuredHistory, field.aliases);
        if (field.key === 'allergies' && !value) {
            value = clean(demographics?.allergies);
        }
        if (!value) continue;
        if (omitMirroredHistory && field.clinicalKey && sameText(value, omitMirroredHistory[field.clinicalKey])) {
            continue;
        }
        lines.push(`- ${field.label}: ${value}`);
    }
    return lines.join('\n');
}

// Demographic fields the case editor lets authors fill in. The persona
// header emits one line per non-empty field — no `Unknown` placeholders
// so the model can't latch onto fake data.
const DEMOGRAPHIC_FIELDS = [
    { key: 'age',           label: 'Age',             format: (v) => `${v} years old` },
    { key: 'gender',        label: 'Gender' },
    { key: 'dob',           label: 'Date of birth' },
    { key: 'mrn',           label: 'MRN' },
    { key: 'weight',        label: 'Weight' },
    { key: 'height',        label: 'Height' },
    { key: 'bloodType',     label: 'Blood type' },
    { key: 'language',      label: 'Preferred language' },
    { key: 'ethnicity',     label: 'Ethnicity' },
    { key: 'occupation',    label: 'Occupation' },
    { key: 'maritalStatus', label: 'Marital status' },
];

// Personality sliders the case editor saves under config.personality. Each
// entry maps a slider value to a short prose directive the model can act on.
// `defaultValue` marks the value emitted when the author hasn't touched the
// slider — those are dropped from the prompt so only intentional choices
// flow through and the prompt stays tight.
const PERSONALITY_FIELDS = [
    {
        key: 'communicationStyle',
        label: 'Communication style',
        defaultValue: 'normal',
        directives: {
            verbose: 'verbose — give detailed, sometimes rambling answers',
            brief: 'brief — keep answers short and to the point',
            tangential: 'tangential — drift off-topic before circling back',
            guarded: 'guarded — hesitate before sharing personal details',
        },
    },
    {
        key: 'emotionalState',
        label: 'Emotional state',
        defaultValue: 'neutral',
        directives: {
            calm: 'calm — speak steadily and without urgency',
            anxious: 'anxious — show worry and tension in your words',
            fearful: 'fearful — sound scared about what is happening',
            angry: 'angry / frustrated — let irritation show through',
            sad: 'sad / tearful — sound low and on the edge of tears',
            stoic: 'stoic — minimise emotional expression even if hurting',
            distressed: 'distressed — words come out strained and breaking',
        },
    },
    {
        key: 'painTolerance',
        label: 'Pain tolerance',
        defaultValue: 'normal',
        directives: {
            high: 'high — minimise how much pain you express',
            low: 'low — express discomfort readily when relevant',
            dramatic: 'dramatic — express pain intensely when clinically relevant',
        },
    },
    {
        key: 'cooperativeness',
        label: 'Cooperativeness',
        defaultValue: 'cooperative',
        directives: {
            very_cooperative: 'very cooperative — answer fully and proactively',
            neutral: 'neutral — answer when asked but volunteer little',
            reluctant: 'reluctant — answer with hesitation, occasionally push back',
            uncooperative: 'uncooperative — resist questions, give partial answers',
        },
    },
    {
        key: 'healthLiteracy',
        label: 'Health literacy',
        defaultValue: 'average',
        directives: {
            high: 'high — comfortable with medical terms (has medical background)',
            low: 'low — ask for plain-language explanations of medical terms',
        },
    },
];

// Build the persona-behaviour block. Emits one directive line per slider
// the author has set to a non-default value. Returns '' when every slider
// is at its default — no point telling the model "communication style:
// normal" twelve cases in a row.
export function formatPersonalityForPrompt(personality = {}) {
    if (!personality || typeof personality !== 'object') return '';
    const lines = [];
    for (const field of PERSONALITY_FIELDS) {
        const value = clean(personality[field.key]);
        if (!value || value === field.defaultValue) continue;
        const directive = field.directives[value];
        if (!directive) continue;
        lines.push(`- ${field.label}: ${directive}`);
    }
    return lines.join('\n');
}

// Build the persona-header demographics block. Emits one line per authored
// field; absent fields are omitted entirely (no fake defaults).
export function formatPersonaDemographicsForPrompt(demographics = {}) {
    if (!demographics || typeof demographics !== 'object') return '';
    const lines = [];
    for (const field of DEMOGRAPHIC_FIELDS) {
        const raw = demographics[field.key];
        const value = clean(raw);
        if (!value) continue;
        const display = field.format ? field.format(value) : value;
        lines.push(`- ${field.label}: ${display}`);
    }
    const allergies = clean(demographics.allergies);
    if (allergies) lines.push(`- Known allergies: ${allergies}`);
    const ec = demographics.emergencyContact || {};
    const ecParts = [clean(ec.name), clean(ec.relationship), clean(ec.phone)].filter(Boolean);
    if (ecParts.length) lines.push(`- Emergency contact: ${ecParts.join(' · ')}`);
    return lines.join('\n');
}

export function formatCaseVitalsForPrompt(config = {}) {
    const v = config.initialVitals || config.initial_vitals || null;
    const legacy = !v && ['hr', 'spo2', 'rr', 'temp', 'sbp', 'dbp', 'etco2'].some(k => config[k] != null)
        ? {
            hr: config.hr,
            spo2: config.spo2,
            rr: config.rr,
            temp: config.temp,
            bpSys: config.sbp,
            bpDia: config.dbp,
            etco2: config.etco2,
        }
        : null;
    const vitals = v || legacy;
    if (!vitals || typeof vitals !== 'object') return '';

    const lines = [];
    if (vitals.hr != null) lines.push(`- HR: ${vitals.hr} bpm`);
    if (vitals.bpSys != null || vitals.bpDia != null) lines.push(`- BP: ${vitals.bpSys ?? '?'}/${vitals.bpDia ?? '?'} mmHg`);
    if (vitals.spo2 != null) lines.push(`- SpO2: ${vitals.spo2}%`);
    if (vitals.rr != null) lines.push(`- RR: ${vitals.rr}/min`);
    if (vitals.temp != null) lines.push(`- Temperature: ${vitals.temp} C`);
    if (vitals.etco2 != null) lines.push(`- ETCO2: ${vitals.etco2} mmHg`);
    if (vitals.rhythm) lines.push(`- Rhythm: ${vitals.rhythm}`);
    if (vitals.conditions && typeof vitals.conditions === 'object') {
        const active = Object.entries(vitals.conditions)
            .filter(([, value]) => value !== false && value != null && value !== 0)
            .map(([key, value]) => value === true ? key : `${key}: ${value}`);
        if (active.length) lines.push(`- ECG/monitor conditions: ${active.join(', ')}`);
    }
    return lines.join('\n');
}

export function formatCaseRadiologyForPrompt(config = {}) {
    const studies = Array.isArray(config.radiology) ? config.radiology : [];
    if (!studies.length) return '';
    return formatRadiologyAsMarkdown(studies.map(study => ({
        type: study.modality || study.type,
        name: study.studyName || study.name,
        date: study.date,
        findings: study.findings,
        interpretation: study.interpretation,
    })));
}

export function formatPhysicalExamConfigForPrompt(config = {}) {
    const physical = config.physical_exam;
    if (!physical || typeof physical !== 'object') return '';
    const lines = [];
    for (const [region, exams] of Object.entries(physical)) {
        if (!exams || typeof exams !== 'object') continue;
        for (const [technique, finding] of Object.entries(exams)) {
            const text = clean(finding?.finding);
            if (!text) continue;
            const abnormal = finding.abnormal ? ' (abnormal)' : '';
            lines.push(`- ${region} / ${technique}${abnormal}: ${text}`);
        }
    }
    return lines.join('\n');
}

export function formatConfiguredLabsForPrompt(config = {}) {
    const labs = config.investigations?.labs;
    if (!Array.isArray(labs) || labs.length === 0) return '';
    return labs.map(lab => {
        const value = lab.current_value != null ? ` = ${lab.current_value}${lab.unit ? ` ${lab.unit}` : ''}` : '';
        const flags = [
            lab.is_abnormal ? 'abnormal' : '',
            lab.turnaround_minutes != null ? `${lab.turnaround_minutes} min turnaround` : '',
        ].filter(Boolean);
        return `- ${lab.test_name || 'Lab test'}${value}${flags.length ? ` (${flags.join(', ')})` : ''}`;
    }).join('\n');
}

function formatClinicalRecords(config = {}, { respectAiAccess = true } = {}) {
    const records = config.clinicalRecords || {};
    const access = records.aiAccess || {};
    const allowed = (key, defaultValue) => !respectAiAccess || (access[key] ?? defaultValue);
    const sections = [];

    if (allowed('history', true)) {
        const history = formatHistoryAsMarkdown(records.history);
        if (history) sections.push(['Medical History', history]);
    }

    if (allowed('physicalExam', true) && records.physicalExam && typeof records.physicalExam === 'object') {
        const lines = Object.entries(records.physicalExam)
            .map(([key, value]) => clean(value) ? `- ${key}: ${clean(value)}` : '')
            .filter(Boolean)
            .join('\n');
        if (lines) sections.push(['Physical Examination', lines]);
    }

    if (allowed('medications', true) && Array.isArray(records.medications) && records.medications.length) {
        const meds = records.medications.map(m =>
            `- ${[m.name, m.dose, m.route, m.frequency].filter(Boolean).join(' ')}${m.indication ? ` (for ${m.indication})` : ''}`
        ).join('\n');
        if (meds) sections.push(['Current Medications', meds]);
    }

    // The Records → Radiology UI surface was removed (bug report 2.9.15 #6 —
    // no authoring path could populate it), but imported/hand-authored case
    // JSON with clinicalRecords.radiology is still honoured here for AI context.
    if (allowed('radiology', false) && Array.isArray(records.radiology) && records.radiology.length) {
        const radiology = formatRadiologyAsMarkdown(records.radiology);
        if (radiology) sections.push(['Radiology Studies', radiology]);
    }

    if (allowed('procedures', true) && Array.isArray(records.procedures) && records.procedures.length) {
        const procedures = records.procedures.map(p =>
            `- ${p.name || 'Procedure'}${p.date ? ` (${p.date})` : ''}: ${p.indication || 'No indication documented'}${p.findings ? ` - Findings: ${p.findings}` : ''}${p.complications ? ` - Complications: ${p.complications}` : ''}`
        ).join('\n');
        if (procedures) sections.push(['Procedures', procedures]);
    }

    if (allowed('notes', false) && Array.isArray(records.notes) && records.notes.length) {
        const notes = records.notes.map(n =>
            `- ${n.type || 'Note'}${n.title ? `: ${n.title}` : ''}${n.date ? ` (${n.date})` : ''}: ${n.content || 'No content'}`
        ).join('\n');
        if (notes) sections.push(['Clinical Notes', notes]);
    }

    return sections;
}

// `answerKey` gates the two sections that ARE the answer: a stored
// differential and a stored management plan. The patient path always filtered
// them out with an ad-hoc regex on the titles; the discussion path did not,
// which is how a family member came to be handed the differential. One rule,
// one place, opt-in.
function formatLegacyClinicalRecords(config = {}, { answerKey = false } = {}) {
    const legacy = config.clinical_records;
    if (!legacy || typeof legacy !== 'object') return [];
    const sections = [];
    const historyLines = [
        clean(legacy.chief_complaint) && `- Chief Complaint: ${clean(legacy.chief_complaint)}`,
        clean(legacy.present_illness) && `- Present Illness: ${clean(legacy.present_illness)}`,
        Array.isArray(legacy.risk_factors) && legacy.risk_factors.length && `- Risk Factors: ${legacy.risk_factors.join('; ')}`,
    ].filter(Boolean).join('\n');
    if (historyLines) sections.push(['Legacy Clinical History', historyLines]);
    if (legacy.physical_exam && typeof legacy.physical_exam === 'object') {
        const exam = Object.entries(legacy.physical_exam)
            .filter(([, value]) => clean(value))
            .map(([key, value]) => `- ${key}: ${clean(value)}`)
            .join('\n');
        if (exam) sections.push(['Legacy Physical Examination', exam]);
    }
    if (answerKey && Array.isArray(legacy.differential_diagnosis) && legacy.differential_diagnosis.length) {
        sections.push(['Differential Diagnosis', legacy.differential_diagnosis.map(x => `- ${x}`).join('\n')]);
    }
    if (answerKey && Array.isArray(legacy.management_plan) && legacy.management_plan.length) {
        sections.push(['Management Plan', legacy.management_plan.map(x => `- ${x}`).join('\n')]);
    }
    return sections;
}

function caseSummary(activeCase = {}) {
    const cfg = activeCase.config || {};
    const demo = cfg.demographics || {};
    const parts = [
        `Case: ${activeCase.name || 'Unnamed'}`,
        cfg.patient_name ? `Patient: ${cfg.patient_name}` : '',
        demo.age ? `Age: ${demo.age}` : '',
        demo.gender ? `Gender: ${demo.gender}` : '',
        demo.weight ? `Weight: ${demo.weight}` : '',
        demo.height ? `Height: ${demo.height}` : '',
        activeCase.description ? `Description: ${activeCase.description}` : '',
    ].filter(Boolean);
    return parts.join('\n');
}

export function buildPatientCaseDesignContext(activeCase) {
    if (!activeCase) return '';
    const cfg = activeCase.config || {};
    const sections = [['Case Summary', caseSummary(activeCase)]];
    const mirroredHistory = cfg.clinicalRecords?.history || null;

    const structured = formatStructuredHistoryForPrompt(cfg.structuredHistory, {
        omitMirroredHistory: mirroredHistory,
        demographics: cfg.demographics,
    });
    if (structured) sections.push(['Structured Patient Story', structured]);

    const vitals = formatCaseVitalsForPrompt(cfg);
    if (vitals) sections.push(['Configured Initial Vitals', vitals]);

    const physical = formatPhysicalExamConfigForPrompt(cfg);
    if (physical) sections.push(['Configured Physical Exam Findings', physical]);

    // answerKey stays off: a patient does not know their own differential.
    // (This used to be a regex filter on the section titles here; the rule now
    // lives in formatLegacyClinicalRecords so both callers obey it.)
    sections.push(...formatLegacyClinicalRecords(cfg));

    const body = sections
        .filter(([, content]) => clean(content))
        .map(([title, content]) => `### ${title}\n${content}`)
        .join('\n\n');

    return body
        ? `\n---\n## CASE DESIGN CONTEXT (Hidden from learner)\n${body}\n`
        : '';
}

/**
 * The case context block given to an agent whose situation the browser builds.
 *
 * `scope` is a KNOWLEDGE_SCOPES value (server/shared/agentKnowledge.js). The
 * four legacy `context_filter` values are still accepted and mapped, so an
 * agent nobody has migrated keeps the sections it had:
 *
 *   minimal -> none      vitals -> summary      history -> history      full -> chart
 *
 * `answerKey` is what `full` used to imply and no longer does. It adds the
 * "### Authoring Expectations" block — the expected diagnosis, the expected
 * treatment plan and the learning objectives — and it gates the stored
 * differential and management plan inside the legacy records. It is OFF by
 * default: until this argument existed, the only way to give an agent the
 * configured results was to give it the answer at the same time, which is why
 * the seeded consultant was coaching a learner towards a diagnosis it had
 * been handed on a plate.
 *
 * @param {object|null} activeCase
 * @param {string} [scope]  a scope, or a legacy context_filter value
 * @param {object} [options]
 * @param {boolean} [options.answerKey=false]
 * @returns {string} '' for `none`/`handover` and for a case with no content
 */
export function buildDiscussionCaseContext(activeCase, scope = 'chart', { answerKey = false } = {}) {
    if (!activeCase) return '';
    // A legacy value maps; a scope passes through; anything else reads as the
    // narrowest thing rather than the widest.
    const resolved = KNOWLEDGE_SCOPES.includes(scope)
        ? scope
        : (LEGACY_SCOPE_BY_CONTEXT_FILTER[scope] || 'none');
    // `handover` is assembled SERVER-side (services/situationBrief.js) from
    // rows the server read itself, so there is nothing for the browser to
    // contribute here.
    if (resolved === 'none' || resolved === 'handover') return '';

    const cfg = activeCase.config || {};
    const deep = scopeAtLeast(resolved, 'history');
    const chart = resolved === 'chart';
    // Reproduces the old ladder exactly: `history` carried no vitals, while
    // `vitals` and `full` both did.
    const withVitals = resolved === 'summary' || chart;

    const sections = [['Summary', caseSummary(activeCase)]];

    const structured = formatStructuredHistoryForPrompt(cfg.structuredHistory, { demographics: cfg.demographics });
    if (structured && deep) {
        sections.push(['Structured History', structured]);
    } else if (cfg.structuredHistory?.chiefComplaint) {
        sections.push(['Chief Complaint', cfg.structuredHistory.chiefComplaint]);
    }

    if (deep) {
        sections.push(...formatClinicalRecords(cfg, { respectAiAccess: false }));
        sections.push(...formatLegacyClinicalRecords(cfg, { answerKey }));
    }

    if (withVitals) {
        const vitals = formatCaseVitalsForPrompt(cfg);
        if (vitals) sections.push(['Initial Vitals', vitals]);
    }

    if (chart) {
        // A room the case switched off (config.rooms) was never open to the
        // learner, so its results are not part of the case they worked:
        // examination findings go with both the examination room and the
        // bedside, which examines too.
        const room = (key) => isRoomEnabled(cfg, key);
        const physical = (room('examination') || room('room3d')) ? formatPhysicalExamConfigForPrompt(cfg) : '';
        if (physical) sections.push(['Configured Physical Exam Findings', physical]);
        const radiology = room('radiology') ? formatCaseRadiologyForPrompt(cfg) : '';
        if (radiology) sections.push(['Configured Radiology Results', radiology]);
        const labs = room('lab') ? formatConfiguredLabsForPrompt(cfg) : '';
        if (labs) sections.push(['Configured Investigation Results', labs]);
    }

    if (chart && answerKey) {
        const expectations = [
            clean(cfg.diagnosis || cfg.expected_diagnosis) && `- Expected diagnosis: ${clean(cfg.diagnosis || cfg.expected_diagnosis)}`,
            clean(cfg.treatment_plan) && `- Expected treatment plan: ${clean(cfg.treatment_plan)}`,
            Array.isArray(cfg.learning_objectives)
                ? `- Learning objectives: ${cfg.learning_objectives.join('; ')}`
                : clean(cfg.learning_objectives) && `- Learning objectives: ${clean(cfg.learning_objectives)}`,
        ].filter(Boolean).join('\n');
        if (expectations) sections.push(['Authoring Expectations', expectations]);
    }

    const body = sections
        .filter(([, content]) => clean(content))
        .map(([title, content]) => `### ${title}\n${content}`)
        .join('\n\n');

    // The closing note used to end "ask the learner about what they did rather
    // than assuming", which now contradicts the encounter record block the
    // server appends a few lines later ("Rely on it instead of asking the
    // learner to recall what they did"). Both sentences shipped in the same
    // prompt. What remains is the half that is still true: the configured case
    // is what was AUTHORED, not what happened.
    return body
        ? `\n\n=== CASE CONTEXT ===\n${body}\n=== END CONTEXT ===\n`
            + `\nNote: this is how the case was authored. What the learner actually ordered, examined, found and treated in this session may differ from it.\n`
        : '';
}
