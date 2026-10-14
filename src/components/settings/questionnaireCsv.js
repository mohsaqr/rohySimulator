// The case questionnaire answers as CSV, for the educator's download.

// Every cell quoted. A cell that starts like a formula (=, +, -, @, tab, CR)
// gets a leading apostrophe, so a learner's free-text answer such as
// =HYPERLINK(...) is shown as text, not run by the spreadsheet — the guard
// the other CSV exports use (components/analytics/csvExport.js).
const csvCell = (value) => {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
};

/** One row per answer (long format): the shape a spreadsheet or R reads directly. */
export function responsesToCsv({ responses }) {
    // `late`: a pre-test answered after the course materials opened — no clean baseline.
    const header = ['username', 'questionnaire_id', 'attempt', 'late', 'submitted_at', 'score', 'max_score', 'question_id', 'question', 'answer'];
    const rows = responses.flatMap((response) => {
        const questions = response.questionnaire?.questions ?? [];
        return questions.map((question) => {
            const value = response.answers?.[question.id];
            const answer = value === undefined ? ''
                : question.type === 'text' ? value
                    : (Array.isArray(value) ? value : [value]).map((n) => question.options?.[n] ?? n).join('; ');
            return [response.username, response.questionnaireId, response.attempt, response.late === true, response.submittedAt,
                response.score, response.maxScore, question.id, question.text, answer];
        });
    });
    return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
