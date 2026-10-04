// The patient's system prompt, assembled from the session's case and its
// patient template. ONE implementation for both sides: the server builds the
// prompt the model actually receives (proxy-routes.js), and nothing the browser
// sends can replace it. This is a literal port of the assembly that used to
// live in ChatInterface.buildPatientSystemPrompt — section order and wording
// are unchanged, so the move does not change what the patient says.
//
// Pure: no I/O, no React, no clock. Callers pass the live state in.

import { roleAnchor } from './roleAnchor.js';
import { buildPersonaBlocks } from './personaBlocks.js';
import {
    formatPersonaDemographicsForPrompt,
    formatPersonalityForPrompt,
    buildPatientCaseDesignContext,
} from './casePromptContext.js';
import {
    formatRadiologyAsMarkdown,
    formatVitalsAsMarkdown,
    formatRecentActivityAsMarkdown,
    PATIENT_ACTIVITY_VERBS,
} from './aiPromptContext.js';
import { formatHistoryAsMarkdown } from './historyGroups.js';

const CLINICAL_RECORDS_HEADER = '\n---\n## CLINICAL RECORDS (Accessible to AI)\n';
const DEFAULT_AI_ACCESS = Object.freeze({
    history: true, physicalExam: true, medications: true, radiology: false, procedures: true, notes: false,
});

/**
 * @param {object} args
 * @param {{name?: string, system_prompt?: string, config?: object}} args.patientCase
 *   the session's case (snapshot first): config, authored system_prompt, name
 * @param {{name?: string, systemPrompt?: string, config?: object}|null} [args.template]
 *   the resolved patient template, or null
 * @param {object|null} [args.vitals] current vitals ({hr, rr, spo2, temp, pain, bp_sys, bp_dia})
 * @param {Array<object>} [args.events] the session's PatientRecord events
 * @returns {string} the patient's case prompt (before assembleSystemPrompt adds
 *   language lead, platform template, affect note and response contract)
 */
export function buildPatientSystemPrompt({ patientCase = {}, template = null, vitals = null, events = [] } = {}) {
    const config = patientCase.config || {};
    const demo = config.demographics || {};
    const trimOrEmpty = (v) => (v == null ? '' : String(v).trim());
    const personaRole = trimOrEmpty(config.persona_type) || 'the patient';
    // Never the case's authoring title (often the diagnosis).
    const personaName = trimOrEmpty(config.patient_name) || 'Patient';

    let prompt = roleAnchor({ role: personaRole, name: personaName });
    prompt += `## PERSONA\n`;
    prompt += `Role: ${personaRole}\n`;
    prompt += `Name: ${personaName}\n`;
    const demographicsBlock = formatPersonaDemographicsForPrompt(demo);
    if (demographicsBlock) prompt += `${demographicsBlock}\n`;

    const personalityBlock = formatPersonalityForPrompt(config.personality);
    if (personalityBlock) prompt += `\n## PATIENT BEHAVIOUR\n${personalityBlock}\n`;

    prompt += `\n## INSTRUCTIONS\n`;
    prompt += `${patientCase.system_prompt || 'You are a patient.'}\n`;
    prompt += `\nSpeak only what the patient would say aloud. Never use stage directions, narration, or asterisk-wrapped action descriptors (e.g. "*nods*", "*clutches chest*", "*sighs*"). Express feelings through words alone.\n`;

    if (template?.systemPrompt) {
        prompt += `\n## PATIENT PERSONA (from template "${template.name}")\n`;
        prompt += `${template.systemPrompt}\n`;
    }
    const personaBlocks = template ? buildPersonaBlocks(template.config) : '';
    if (personaBlocks) prompt += personaBlocks;

    // answerKey is the persona's explicit argument, off by default: a patient
    // does not know their own diagnosis.
    prompt += buildPatientCaseDesignContext(
        { name: patientCase.name, system_prompt: patientCase.system_prompt, config },
        { answerKey: template?.config?.knowledge?.answerKey === true },
    );

    if (config.constraints) prompt += `\n## CONSTRAINTS\n${config.constraints}\n`;

    if (config.pages && config.pages.length > 0) {
        prompt += '\n---\n## PATIENT MEDICAL RECORD (Hidden Context)\n';
        prompt += 'Only reveal this information if specifically asked or relevant to the history taking.\n';
        config.pages.forEach((page) => { prompt += `\n### ${page.title}\n${page.content}\n`; });
    }

    const clinicalRecords = config.clinicalRecords || {};
    const aiAccess = clinicalRecords.aiAccess || DEFAULT_AI_ACCESS;
    let hasAnyRecords = false;
    const recordsHeader = () => {
        if (!hasAnyRecords) { prompt += CLINICAL_RECORDS_HEADER; hasAnyRecords = true; }
    };

    if (aiAccess.history && clinicalRecords.history) {
        const historyMarkdown = formatHistoryAsMarkdown(clinicalRecords.history);
        if (historyMarkdown) { recordsHeader(); prompt += `\n### Medical History\n${historyMarkdown}\n`; }
    }
    if (aiAccess.physicalExam && clinicalRecords.physicalExam) {
        const pe = clinicalRecords.physicalExam;
        const peParts = [];
        if (pe.general) peParts.push(`General: ${pe.general}`);
        if (pe.heent) peParts.push(`HEENT: ${pe.heent}`);
        if (pe.cardiovascular) peParts.push(`Cardiovascular: ${pe.cardiovascular}`);
        if (pe.respiratory) peParts.push(`Respiratory: ${pe.respiratory}`);
        if (pe.abdomen) peParts.push(`Abdomen: ${pe.abdomen}`);
        if (pe.neurological) peParts.push(`Neurological: ${pe.neurological}`);
        if (pe.extremities) peParts.push(`Extremities/Skin: ${pe.extremities}`);
        if (peParts.length > 0) { recordsHeader(); prompt += `\n### Physical Examination\n${peParts.join('\n')}\n`; }
    }
    if (aiAccess.medications && clinicalRecords.medications?.length > 0) {
        recordsHeader();
        const medList = clinicalRecords.medications.map((m) =>
            `- ${m.name} ${m.dose} ${m.route} ${m.frequency}${m.indication ? ` (for ${m.indication})` : ''}`).join('\n');
        prompt += `\n### Current Medications\n${medList}\n`;
    }
    if (aiAccess.radiology && clinicalRecords.radiology?.length > 0) {
        const radiologyMarkdown = formatRadiologyAsMarkdown(clinicalRecords.radiology);
        if (radiologyMarkdown) { recordsHeader(); prompt += `\n### Radiology Studies\n${radiologyMarkdown}\n`; }
    }
    if (aiAccess.procedures && clinicalRecords.procedures?.length > 0) {
        recordsHeader();
        const procList = clinicalRecords.procedures.map((p) =>
            `- ${p.name}${p.date ? ` (${p.date})` : ''}: ${p.indication || 'No indication documented'}${p.findings ? ` - Findings: ${p.findings}` : ''}${p.complications ? ` - Complications: ${p.complications}` : ''}`).join('\n');
        prompt += `\n### Procedures\n${procList}\n`;
    }
    if (aiAccess.notes && clinicalRecords.notes?.length > 0) {
        recordsHeader();
        const noteList = clinicalRecords.notes.map((n) =>
            `#### ${n.type}${n.title ? `: ${n.title}` : ''} (${n.date || 'No date'}${n.author ? `, ${n.author}` : ''})\n${n.content || 'No content'}`).join('\n\n');
        prompt += `\n### Clinical Notes\n${noteList}\n`;
    }

    const vitalsMarkdown = formatVitalsAsMarkdown(vitals);
    if (vitalsMarkdown) {
        prompt += `\n---\n## CURRENT PATIENT STATE\n${vitalsMarkdown}\n`;
        prompt += `\nAnswer questions about how you currently feel in a way consistent with these vitals.\n`;
    }

    const recentActivity = formatRecentActivityAsMarkdown(events, 10, { verbs: PATIENT_ACTIVITY_VERBS });
    if (recentActivity) {
        prompt += `\n---\n## SESSION ACTIVITY SO FAR (clinician's actions this encounter)\n${recentActivity}\n`;
        prompt += `\nDo not repeat answers to questions that were already obtained above. Acknowledge prior actions when relevant.\n`;
    }

    return prompt;
}
