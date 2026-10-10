// The case questionnaire answers as CSV, for the educator's download.

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/** One row per answer (long format): the shape a spreadsheet or R reads directly. */
export function responsesToCsv({ responses }) {
    const header = ['username', 'questionnaire_id', 'attempt', 'submitted_at', 'score', 'max_score', 'question_id', 'question', 'answer'];
    const rows = responses.flatMap((response) => {
        const questions = response.questionnaire?.questions ?? [];
        return questions.map((question) => {
            const value = response.answers?.[question.id];
            const answer = value === undefined ? ''
                : question.type === 'text' ? value
                    : (Array.isArray(value) ? value : [value]).map((n) => question.options?.[n] ?? n).join('; ');
            return [response.username, response.questionnaireId, response.attempt, response.submittedAt,
                response.score, response.maxScore, question.id, question.text, answer];
        });
    });
    return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
