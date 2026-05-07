// Canonical history grouping. Single source of truth for the 7 history
// fields: which group each belongs to, the visible label, and the order
// they're presented in. Imported by:
//
//   - ClinicalRecordsEditor (instructor authoring UI)
//   - ClinicalRecordsPanel  (student viewing UI)
//   - ChatInterface         (AI patient system prompt builder)
//
// Keep this file structural — no UI-specific properties (placeholders,
// row counts, highlight colours). Consumers extend it with their own
// UI metadata as needed.

export const HISTORY_GROUPS = Object.freeze([
    {
        key: 'presentHistory',
        label: 'Present History',
        fields: [
            { key: 'chiefComplaint', label: 'Chief Complaint' },
            { key: 'hpi', label: 'History of Present Illness' },
        ],
    },
    {
        key: 'pastMedical',
        label: 'Past Medical',
        fields: [
            { key: 'pastMedical', label: 'Past Medical History' },
            { key: 'pastSurgical', label: 'Past Surgical History' },
            { key: 'allergies', label: 'Allergies' },
        ],
    },
    {
        key: 'personalSocial',
        label: 'Personal & Social',
        fields: [
            { key: 'social', label: 'Social History' },
            { key: 'family', label: 'Family History' },
        ],
    },
]);

// Flat → grouped markdown for AI consumption. Empty groups are omitted so
// the model isn't shown empty section headings (token waste + confusion).
// Output shape matches what the editor/viewer render visually so the LLM
// sees the same structure the human authors do.
//
// Returns an empty string when no field has content — caller decides
// whether to skip the surrounding "## CLINICAL RECORDS" wrapper.
export function formatHistoryAsMarkdown(history) {
    if (!history || typeof history !== 'object') return '';
    const sections = [];
    for (const group of HISTORY_GROUPS) {
        const filled = group.fields.filter(f => {
            const v = history[f.key];
            return typeof v === 'string' && v.trim().length > 0;
        });
        if (filled.length === 0) continue;
        const lines = [`**${group.label}:**`];
        for (const field of filled) {
            lines.push(`- ${field.label}: ${history[field.key].trim()}`);
        }
        sections.push(lines.join('\n'));
    }
    return sections.join('\n\n');
}
