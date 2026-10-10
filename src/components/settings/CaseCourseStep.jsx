import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap, Lock, Plus, Trash2, ArrowUp, ArrowDown, Download, ClipboardList } from 'lucide-react';
import { apiGet, apiPut } from '../../services/apiClient';
import { responsesToCsv } from './questionnaireCsv.js';
import {
    normaliseCourseGate, normaliseQuestionnaires, QUESTION_TYPES, QUESTIONNAIRE_TIMINGS, COURSE_LIMITS,
} from '../../../server/shared/caseCourse.js';

const INPUT = 'w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100';
const SMALL_BUTTON = 'inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-neutral-700 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40';

const newId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const TIMING_KEYS = { during: 'course_timing_during', pre_post: 'course_timing_pre_post', after: 'course_timing_after' };
const TYPE_KEYS = { single: 'course_type_single', multiple: 'course_type_multiple', text: 'course_type_text' };
const ATTEMPT_KEYS = { single: 'course_attempt_single', pre: 'course_attempt_pre', post: 'course_attempt_post' };

/** How many pathology slides the case shows — what "all slides opened" counts. */
function caseSlideCount(config) {
    const slides = config?.pathology?.manifest?.slides;
    return Array.isArray(slides) ? slides.length : 0;
}

function move(list, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

function GateSection({ config, setConfigKey }) {
    const { t } = useTranslation('authoring_config');
    const gate = normaliseCourseGate(config.courseGate).gate ?? { afterMinutes: 0, allSlidesOpened: false };
    const slides = caseSlideCount(config);
    const update = (patch) => {
        const next = normaliseCourseGate({ ...gate, ...patch });
        setConfigKey('courseGate', next.problem ? { ...gate, ...patch } : next.gate);
    };
    return (
        <section className="space-y-3 rounded-lg border border-neutral-700 bg-neutral-800/60 p-4" data-testid="course-gate-editor">
            <h5 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
                <Lock className="h-4 w-4 text-teal-400" aria-hidden="true" /> {t('course_gate_title')}
            </h5>
            <p className="text-xs text-neutral-400">{t('course_gate_help')}</p>
            <label className="flex items-center gap-3 text-sm text-neutral-200">
                <span className="w-56">{t('course_gate_minutes')}</span>
                <input
                    type="number"
                    min={0}
                    max={COURSE_LIMITS.maxMinutes}
                    step={1}
                    value={gate.afterMinutes}
                    onChange={(e) => update({ afterMinutes: Math.max(0, Math.min(COURSE_LIMITS.maxMinutes, Math.round(Number(e.target.value) || 0))) })}
                    className={`${INPUT} w-28`}
                    aria-label={t('course_gate_minutes')}
                />
            </label>
            <label className="flex items-start gap-3 text-sm text-neutral-200">
                <input
                    type="checkbox"
                    checked={gate.allSlidesOpened}
                    onChange={(e) => update({ allSlidesOpened: e.target.checked })}
                    className="mt-1"
                />
                <span>
                    {t('course_gate_slides')}
                    <span className="block text-xs text-neutral-500">
                        {slides > 0 ? t('course_gate_slides_count', { count: slides }) : t('course_gate_no_slides')}
                    </span>
                </span>
            </label>
            <p className="text-xs text-neutral-500">{t('course_gate_trust_note')}</p>
        </section>
    );
}

function LessonLocksSection({ caseId }) {
    const { t } = useTranslation('authoring_config');
    const [course, setCourse] = useState(null);
    const [locked, setLocked] = useState(new Set());
    const [status, setStatus] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await apiGet(`/cases/${caseId}/course-lessons`);
            setCourse(res.data);
            setLocked(new Set(res.data.lessons.filter((l) => l.locked).map((l) => l.id)));
        } catch {
            setStatus('load_failed');
        }
    }, [caseId]);
    useEffect(() => { if (caseId) load(); }, [caseId, load]);

    if (!caseId) return <p className="text-xs text-neutral-500">{t('course_locks_save_case_first')}</p>;
    if (status === 'load_failed') return <p className="text-xs text-red-400">{t('course_locks_load_failed')}</p>;
    if (!course) return null;
    if (course.cohortId == null) return <p className="text-xs text-neutral-500">{t('course_locks_no_course')}</p>;

    const save = async () => {
        setStatus('saving');
        try {
            await apiPut(`/cases/${caseId}/course-locks`, { lessonIds: [...locked] });
            setStatus('saved');
            await load();
        } catch {
            setStatus('save_failed');
        }
    };

    return (
        <div className="space-y-2" data-testid="course-lesson-locks">
            <p className="text-xs text-neutral-400">{t('course_locks_help', { course: course.cohortName })}</p>
            {course.lessons.length === 0 && <p className="text-xs text-neutral-500">{t('course_locks_no_lessons')}</p>}
            <ul className="space-y-1">
                {course.lessons.map((lesson) => (
                    <li key={lesson.id}>
                        <label className="flex items-center gap-2 text-sm text-neutral-200">
                            <input
                                type="checkbox"
                                checked={locked.has(lesson.id)}
                                onChange={(e) => {
                                    setStatus(null);
                                    setLocked((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(lesson.id); else next.delete(lesson.id);
                                        return next;
                                    });
                                }}
                            />
                            <span>{lesson.title}</span>
                            {!lesson.isPublished && <span className="text-xs text-neutral-500">{t('course_locks_draft')}</span>}
                            {lesson.lockedByCaseId && !locked.has(lesson.id) && (
                                <span className="text-xs text-amber-400">{t('course_locks_other_case', { caseId: lesson.lockedByCaseId })}</span>
                            )}
                        </label>
                    </li>
                ))}
            </ul>
            {course.lessons.length > 0 && (
                <div className="flex items-center gap-3">
                    <button type="button" onClick={save} disabled={status === 'saving'} className="px-3 py-1.5 rounded bg-teal-700 text-white text-sm hover:bg-teal-600 disabled:opacity-50">
                        {t('course_locks_save')}
                    </button>
                    {status === 'saved' && <span className="text-xs text-teal-400">{t('course_locks_saved')}</span>}
                    {status === 'save_failed' && <span className="text-xs text-red-400">{t('course_locks_save_failed')}</span>}
                </div>
            )}
        </div>
    );
}

function QuestionEditor({ question, graded, index, count, onChange, onMove, onRemove }) {
    const { t } = useTranslation('authoring_config');
    const choice = question.type !== 'text';
    const correct = question.correct ?? [];
    const setType = (type) => {
        if (type === 'text') {
            const { options: _o, correct: _c, ...rest } = question;
            return onChange({ ...rest, type });
        }
        return onChange({
            ...question,
            type,
            options: question.options?.length >= 2 ? question.options : ['', ''],
            correct: type === 'single' ? correct.slice(0, 1) : correct,
        });
    };
    const toggleCorrect = (optionIndex) => {
        if (question.type === 'single') return onChange({ ...question, correct: [optionIndex] });
        const next = correct.includes(optionIndex) ? correct.filter((n) => n !== optionIndex) : [...correct, optionIndex];
        return onChange({ ...question, correct: next.sort((a, b) => a - b) });
    };
    const removeOption = (optionIndex) => onChange({
        ...question,
        options: question.options.filter((_, i) => i !== optionIndex),
        correct: correct.filter((n) => n !== optionIndex).map((n) => (n > optionIndex ? n - 1 : n)),
    });
    return (
        <li className="space-y-2 rounded border border-neutral-700 bg-neutral-900/60 p-3" data-testid={`question-editor-${index}`}>
            <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">{index + 1}.</span>
                <select value={question.type} onChange={(e) => setType(e.target.value)} className={`${INPUT} w-44`} aria-label={t('course_question_type')}>
                    {QUESTION_TYPES.map((type) => <option key={type} value={type}>{t(TYPE_KEYS[type])}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs text-neutral-300">
                    <input type="checkbox" checked={question.required !== false} onChange={(e) => onChange({ ...question, required: e.target.checked })} />
                    {t('course_question_required')}
                </label>
                <span className="flex-1" />
                <button type="button" className={SMALL_BUTTON} onClick={() => onMove(-1)} disabled={index === 0} aria-label={t('course_move_up')}><ArrowUp className="h-3 w-3" /></button>
                <button type="button" className={SMALL_BUTTON} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t('course_move_down')}><ArrowDown className="h-3 w-3" /></button>
                <button type="button" className={SMALL_BUTTON} onClick={onRemove} aria-label={t('course_question_remove')}><Trash2 className="h-3 w-3" /></button>
            </div>
            <textarea
                value={question.text}
                onChange={(e) => onChange({ ...question, text: e.target.value })}
                rows={2}
                className={INPUT}
                placeholder={t('course_question_text')}
                aria-label={t('course_question_text')}
            />
            {choice && (
                <div className="space-y-1">
                    {question.options.map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-2">
                            {graded && (
                                <input
                                    type={question.type === 'single' ? 'radio' : 'checkbox'}
                                    name={`correct-${question.id}`}
                                    checked={correct.includes(optionIndex)}
                                    onChange={() => toggleCorrect(optionIndex)}
                                    title={t('course_option_correct')}
                                    aria-label={t('course_option_correct')}
                                />
                            )}
                            <input
                                value={option}
                                onChange={(e) => onChange({ ...question, options: question.options.map((o, i) => (i === optionIndex ? e.target.value : o)) })}
                                className={INPUT}
                                placeholder={t('course_option_placeholder', { n: optionIndex + 1 })}
                                aria-label={t('course_option_placeholder', { n: optionIndex + 1 })}
                            />
                            <button type="button" className={SMALL_BUTTON} onClick={() => removeOption(optionIndex)} disabled={question.options.length <= 2} aria-label={t('course_option_remove')}>
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        className={SMALL_BUTTON}
                        onClick={() => onChange({ ...question, options: [...question.options, ''] })}
                        disabled={question.options.length >= COURSE_LIMITS.options}
                    >
                        <Plus className="h-3 w-3" /> {t('course_option_add')}
                    </button>
                    {graded && correct.length === 0 && <p className="text-xs text-amber-400">{t('course_question_no_correct')}</p>}
                </div>
            )}
            {graded && (
                <textarea
                    value={question.feedback ?? ''}
                    onChange={(e) => onChange({ ...question, feedback: e.target.value })}
                    rows={2}
                    className={INPUT}
                    placeholder={t('course_question_feedback')}
                    aria-label={t('course_question_feedback')}
                />
            )}
        </li>
    );
}

function QuestionnaireEditor({ questionnaire, index, count, onChange, onMove, onRemove }) {
    const { t } = useTranslation('authoring_config');
    const questions = questionnaire.questions ?? [];
    const setQuestions = (next) => onChange({ ...questionnaire, questions: next });
    const addQuestion = (type) => setQuestions([
        ...questions,
        type === 'text'
            ? { id: newId('k'), type, text: '', required: true }
            : { id: newId('k'), type, text: '', options: ['', ''], required: true },
    ]);
    return (
        <li className="space-y-3 rounded-lg border border-neutral-700 bg-neutral-800/60 p-4" data-testid={`questionnaire-editor-${index}`}>
            <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-teal-400" aria-hidden="true" />
                <input
                    value={questionnaire.title}
                    onChange={(e) => onChange({ ...questionnaire, title: e.target.value })}
                    className={INPUT}
                    placeholder={t('course_questionnaire_title')}
                    aria-label={t('course_questionnaire_title')}
                />
                <button type="button" className={SMALL_BUTTON} onClick={() => onMove(-1)} disabled={index === 0} aria-label={t('course_move_up')}><ArrowUp className="h-3 w-3" /></button>
                <button type="button" className={SMALL_BUTTON} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t('course_move_down')}><ArrowDown className="h-3 w-3" /></button>
                <button type="button" className={SMALL_BUTTON} onClick={onRemove} aria-label={t('course_questionnaire_remove')}><Trash2 className="h-3 w-3" /></button>
            </div>
            <textarea
                value={questionnaire.instructions ?? ''}
                onChange={(e) => onChange({ ...questionnaire, instructions: e.target.value })}
                rows={2}
                className={INPUT}
                placeholder={t('course_questionnaire_instructions')}
                aria-label={t('course_questionnaire_instructions')}
            />
            <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-neutral-200">
                    {t('course_questionnaire_timing')}
                    <select
                        value={questionnaire.timing}
                        onChange={(e) => onChange({ ...questionnaire, timing: e.target.value })}
                        className={`${INPUT} w-72`}
                    >
                        {QUESTIONNAIRE_TIMINGS.map((timing) => <option key={timing} value={timing}>{t(TIMING_KEYS[timing])}</option>)}
                    </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-neutral-200">
                    <input type="checkbox" checked={!!questionnaire.graded} onChange={(e) => onChange({ ...questionnaire, graded: e.target.checked })} />
                    {t('course_questionnaire_graded')}
                </label>
            </div>
            <ol className="space-y-2">
                {questions.map((question, i) => (
                    <QuestionEditor
                        key={question.id}
                        question={question}
                        graded={!!questionnaire.graded}
                        index={i}
                        count={questions.length}
                        onChange={(next) => setQuestions(questions.map((q, j) => (j === i ? next : q)))}
                        onMove={(delta) => setQuestions(move(questions, i, delta))}
                        onRemove={() => setQuestions(questions.filter((_, j) => j !== i))}
                    />
                ))}
            </ol>
            <div className="flex flex-wrap gap-2">
                {QUESTION_TYPES.map((type) => (
                    <button key={type} type="button" className={SMALL_BUTTON} onClick={() => addQuestion(type)} disabled={questions.length >= COURSE_LIMITS.questions}>
                        <Plus className="h-3 w-3" /> {t(TYPE_KEYS[type])}
                    </button>
                ))}
            </div>
        </li>
    );
}

function ResponsesSection({ caseId }) {
    const { t, i18n } = useTranslation('authoring_config');
    const [data, setData] = useState(null);
    const [failed, setFailed] = useState(false);
    if (!caseId) return null;
    const load = async () => {
        try {
            setData(await apiGet(`/cases/${caseId}/questionnaire-responses`));
            setFailed(false);
        } catch {
            setFailed(true);
        }
    };
    const download = () => {
        const blob = new Blob([responsesToCsv(data)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `case-${caseId}-questionnaire-answers.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };
    return (
        <section className="space-y-2 rounded-lg border border-neutral-700 bg-neutral-800/60 p-4" data-testid="questionnaire-responses">
            <div className="flex items-center gap-2">
                <h5 className="text-sm font-semibold text-neutral-100">{t('course_responses_title')}</h5>
                <span className="flex-1" />
                <button type="button" className={SMALL_BUTTON} onClick={load}>{t('course_responses_show')}</button>
                {data?.responses?.length > 0 && (
                    <button type="button" className={SMALL_BUTTON} onClick={download}><Download className="h-3 w-3" /> {t('course_responses_csv')}</button>
                )}
            </div>
            {failed && <p className="text-xs text-red-400">{t('course_responses_failed')}</p>}
            {data && data.responses.length === 0 && <p className="text-xs text-neutral-500">{t('course_responses_none')}</p>}
            {data && data.responses.length > 0 && (
                <table className="w-full text-left text-xs text-neutral-300">
                    <thead className="text-neutral-500">
                        <tr>
                            <th className="py-1">{t('course_responses_user')}</th>
                            <th>{t('course_responses_questionnaire')}</th>
                            <th>{t('course_responses_attempt')}</th>
                            <th>{t('course_responses_score')}</th>
                            <th>{t('course_responses_time')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.responses.map((r) => (
                            <tr key={r.id} className="border-t border-neutral-800">
                                <td className="py-1">{r.username}</td>
                                <td>{r.questionnaire?.title ?? r.questionnaireId}</td>
                                <td>{t(ATTEMPT_KEYS[r.attempt])}</td>
                                <td>{r.score === null ? '—' : `${r.score}/${r.maxScore}`}</td>
                                <td>{new Date(r.submittedAt).toLocaleString(i18n.language)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

/**
 * The wizard step for the case's course side (server/shared/caseCourse.js):
 * when the course materials open (config.courseGate), which lessons of the
 * case's course wait for it (saved at once, through its own endpoint, like
 * the treatment rubric), the case's questionnaires (config.questionnaires,
 * saved with the case) and their answers.
 */
export function CaseCourseStep({ caseData, setCaseData }) {
    const { t } = useTranslation('authoring_config');
    const config = useMemo(() => caseData?.config ?? {}, [caseData?.config]);
    const questionnaires = Array.isArray(config.questionnaires) ? config.questionnaires : [];

    const setConfigKey = (key, value) => setCaseData((prev) => {
        const { [key]: _old, ...rest } = prev.config ?? {};
        return { ...prev, config: value === null || value === undefined ? rest : { ...rest, [key]: value } };
    });
    const setQuestionnaires = (next) => setConfigKey('questionnaires', next.length ? next : null);
    const problem = normaliseQuestionnaires(questionnaires.length ? questionnaires : null).problem;

    return (
        <div className="space-y-6" data-testid="case-course-step">
            <div className="flex items-start gap-3">
                <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-teal-400" />
                <p className="text-sm text-neutral-400">{t('course_step_help')}</p>
            </div>

            <GateSection config={config} setConfigKey={setConfigKey} />

            <section className="space-y-2 rounded-lg border border-neutral-700 bg-neutral-800/60 p-4">
                <h5 className="text-sm font-semibold text-neutral-100">{t('course_locks_title')}</h5>
                <LessonLocksSection caseId={caseData?.id} />
            </section>

            <section className="space-y-3">
                <h5 className="text-sm font-semibold text-neutral-100">{t('course_questionnaires_title')}</h5>
                <p className="text-xs text-neutral-400">{t('course_questionnaires_help')}</p>
                <ol className="space-y-3">
                    {questionnaires.map((questionnaire, i) => (
                        <QuestionnaireEditor
                            key={questionnaire.id}
                            questionnaire={questionnaire}
                            index={i}
                            count={questionnaires.length}
                            onChange={(next) => setQuestionnaires(questionnaires.map((q, j) => (j === i ? next : q)))}
                            onMove={(delta) => setQuestionnaires(move(questionnaires, i, delta))}
                            onRemove={() => setQuestionnaires(questionnaires.filter((_, j) => j !== i))}
                        />
                    ))}
                </ol>
                {problem && (
                    <p role="alert" className="text-xs text-amber-400">{t('course_questionnaires_problem', { problem })}</p>
                )}
                <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={questionnaires.length >= COURSE_LIMITS.questionnaires}
                    onClick={() => setQuestionnaires([...questionnaires, { id: newId('kysely'), title: '', timing: 'during', graded: false, questions: [] }])}
                >
                    <Plus className="h-3 w-3" /> {t('course_questionnaire_add')}
                </button>
            </section>

            <ResponsesSection caseId={caseData?.id} />
        </div>
    );
}
