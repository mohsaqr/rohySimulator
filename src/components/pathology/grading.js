/**
 * Diagnosis grading.
 *
 * DELIBERATELY MODEST. Free-text diagnostic equivalence ("IDC grade 2" vs
 * "invasive ductal carcinoma, grade II") is not solvable by string matching,
 * and pretending otherwise produces confidently wrong feedback. So:
 *
 *   - the default grader is DETERMINISTIC and explicit: an author lists the
 *     accepted forms and/or the terms that must appear. It never guesses.
 *   - anything it cannot decide is returned as `correct: null` — undecided,
 *     not incorrect — so the UI can defer instead of failing a trainee on a
 *     synonym the author did not think of.
 *   - `gradeWithModel()` hands those undecided cases to Rohy's EXISTING
 *     llmService rather than shipping a second LLM client. Rohy already owns
 *     provider config, keys, timeouts and the debrief discussant; this
 *     package must not duplicate any of it.
 */

/** Lowercase, strip punctuation, fold roman numeral grades, collapse space. */
export function normaliseDiagnosis(text) {
    if (typeof text !== 'string') {
        throw new TypeError(`normaliseDiagnosis(): expected a string, received ${typeof text}`);
    }
    const roman = { i: '1', ii: '2', iii: '3', iv: '4' };
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        // Grade II → grade 2, so an author need not enumerate both.
        .map((word, i, words) => (words[i - 1] === 'grade' && roman[word] ? roman[word] : word))
        .join(' ');
}

/**
 * Grade a submission against an answer key.
 *
 * @param {string} submission
 * @param {object} answerKey
 * @param {string} answerKey.diagnosis      canonical expected answer
 * @param {string[]} [answerKey.accept]     additional accepted phrasings
 * @param {string[]} [answerKey.requireTerms] every term must appear (after
 *                                          normalisation) — use for answers
 *                                          where phrasing varies but the
 *                                          concepts are non-negotiable
 * @param {string[]} [answerKey.rejectTerms] any term present marks it wrong
 * @returns {{correct: (boolean|null), expected: string, matched: (string|null),
 *            normalised: string, basis: string}}
 *          `correct: null` means undecided — escalate, do not fail.
 */
export function gradeDiagnosis(submission, answerKey) {
    if (!answerKey || typeof answerKey.diagnosis !== 'string') {
        throw new TypeError('gradeDiagnosis(): answerKey.diagnosis (string) is required');
    }
    const normalised = normaliseDiagnosis(submission ?? '');
    const expected = answerKey.diagnosis;

    if (normalised === '') {
        return { correct: false, expected, matched: null, normalised, basis: 'empty' };
    }

    const rejected = (answerKey.rejectTerms ?? [])
        .map(normaliseDiagnosis)
        .find((term) => normalised.includes(term));
    if (rejected) {
        return { correct: false, expected, matched: rejected, normalised, basis: 'reject_term' };
    }

    const accepted = [expected, ...(answerKey.accept ?? [])].map(normaliseDiagnosis);
    const exact = accepted.find((a) => a === normalised);
    if (exact) return { correct: true, expected, matched: exact, normalised, basis: 'exact' };

    const contained = accepted.find((a) => normalised.includes(a));
    if (contained) return { correct: true, expected, matched: contained, normalised, basis: 'contains' };

    if (answerKey.requireTerms?.length) {
        const terms = answerKey.requireTerms.map(normaliseDiagnosis);
        const missing = terms.filter((t) => !normalised.includes(t));
        return missing.length === 0
            ? { correct: true, expected, matched: terms.join(' + '), normalised, basis: 'required_terms' }
            : { correct: false, expected, matched: null, normalised, basis: `missing:${missing.join(',')}` };
    }

    // Nothing matched and the author gave no term rule. Refuse to guess.
    return { correct: null, expected, matched: null, normalised, basis: 'undecided' };
}

/**
 * Escalate an undecided grade to Rohy's own llmService.
 *
 * `llmService` is INJECTED — this package never imports it, so dropping the
 * folder cannot break Rohy's LLM wiring, and the grader is testable with a
 * stub. Pass Rohy's service; the shape used is `complete({system, prompt})`.
 *
 * A deterministic verdict is returned untouched: the model is only ever asked
 * about cases the author's key could not settle.
 *
 * @returns {Promise<object>} the grade, with basis 'model' when escalated.
 */
export async function gradeWithModel(submission, answerKey, llmService) {
    const deterministic = gradeDiagnosis(submission, answerKey);
    if (deterministic.correct !== null) return deterministic;
    if (!llmService || typeof llmService.complete !== 'function') {
        // No grader available: stay undecided rather than inventing a verdict.
        return deterministic;
    }

    const reply = await llmService.complete({
        system: 'You grade pathology diagnoses. Reply with exactly one word: EQUIVALENT or DIFFERENT.',
        prompt: `Expected diagnosis: ${answerKey.diagnosis}\nTrainee answer: ${submission}\n`
            + 'Are these the same diagnosis, allowing for synonyms and abbreviations?',
    });

    const verdict = String(reply ?? '').trim().toUpperCase();
    if (verdict.startsWith('EQUIVALENT')) return { ...deterministic, correct: true, basis: 'model' };
    if (verdict.startsWith('DIFFERENT')) return { ...deterministic, correct: false, basis: 'model' };
    // An unparseable reply is not a verdict.
    return { ...deterministic, basis: 'model_unparseable' };
}
