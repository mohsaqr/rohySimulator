import { formatRadiologyAsMarkdown } from '../data/aiPromptContext.js';
import { formatHistoryAsMarkdown } from '../data/historyGroups.js';

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
            dramatic: 'dramatic — exaggerate pain and discomfort',
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

function formatLegacyClinicalRecords(config = {}) {
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
    if (Array.isArray(legacy.differential_diagnosis) && legacy.differential_diagnosis.length) {
        sections.push(['Differential Diagnosis', legacy.differential_diagnosis.map(x => `- ${x}`).join('\n')]);
    }
    if (Array.isArray(legacy.management_plan) && legacy.management_plan.length) {
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

    const legacySections = formatLegacyClinicalRecords(cfg)
        .filter(([title]) => !/Differential|Management/.test(title));
    sections.push(...legacySections);

    const body = sections
        .filter(([, content]) => clean(content))
        .map(([title, content]) => `### ${title}\n${content}`)
        .join('\n\n');

    return body
        ? `\n---\n## CASE DESIGN CONTEXT (Hidden from learner)\n${body}\n`
        : '';
}

export function buildDiscussionCaseContext(activeCase, contextFilter = 'full') {
    if (!activeCase || contextFilter === 'minimal') return '';
    const cfg = activeCase.config || {};
    const sections = [['Summary', caseSummary(activeCase)]];

    const structured = formatStructuredHistoryForPrompt(cfg.structuredHistory, { demographics: cfg.demographics });
    if (structured && ['history', 'full'].includes(contextFilter)) {
        sections.push(['Structured History', structured]);
    } else if (cfg.structuredHistory?.chiefComplaint) {
        sections.push(['Chief Complaint', cfg.structuredHistory.chiefComplaint]);
    }

    if (['history', 'full'].includes(contextFilter)) {
        sections.push(...formatClinicalRecords(cfg, { respectAiAccess: false }));
        sections.push(...formatLegacyClinicalRecords(cfg));
    }

    if (['vitals', 'full'].includes(contextFilter)) {
        const vitals = formatCaseVitalsForPrompt(cfg);
        if (vitals) sections.push(['Initial Vitals', vitals]);
    }

    if (contextFilter === 'full') {
        const physical = formatPhysicalExamConfigForPrompt(cfg);
        if (physical) sections.push(['Configured Physical Exam Findings', physical]);
        const radiology = formatCaseRadiologyForPrompt(cfg);
        if (radiology) sections.push(['Configured Radiology Results', radiology]);
        const labs = formatConfiguredLabsForPrompt(cfg);
        if (labs) sections.push(['Configured Investigation Results', labs]);

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

    return body
        ? `\n\n=== CASE CONTEXT ===\n${body}\n=== END CONTEXT ===\n`
            + `\nNote: the learner's actual orders, exam findings, lab results, and treatments performed in this session may differ from configured case expectations; ask the learner about what they did rather than assuming.\n`
        : '';
}
