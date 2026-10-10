// The case's course side for the learner, at the top of the Course view:
// how far the course gate is (minutes since they started the case, slides
// opened), the case's questionnaires, and the lessons still waiting.
//
// Everything here comes from GET /cases/:caseId/course-state, which already
// decided what this learner may see: questionnaires arrive without their
// answer key, the open attempt is the server's choice, and a locked lesson's
// content was never sent. This component only shows it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen, Clock, Check, Circle, ClipboardList, CheckCircle2, XCircle } from 'lucide-react';
import { apiGet, apiPost } from '../../services/apiClient';
import EventLogger, { VERBS, OBJECT_TYPES } from '../../services/eventLogger';
import { checkAnswers } from '../../../server/shared/caseCourse.js';

const POLL_MS = 30_000;

function formatRemaining(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function GateCard({ gate, now, lockedLessons }) {
    const { t } = useTranslation('course');
    if (!gate?.configured) return null;
    const remaining = gate.unlockAt ? Math.max(0, (Date.parse(gate.unlockAt) - now) / 1000) : null;
    const opened = gate.slides.filter((s) => s.opened).length;
    return (
        <section
            data-testid="course-gate"
            className={`rounded-2xl border px-5 py-4 ${gate.unlocked ? 'border-border bg-card' : 'border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20'}`}
        >
            <div className="flex items-start gap-3">
                {gate.unlocked
                    ? <LockOpen className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
                    : <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-foreground">
                        {gate.unlocked ? t('gate_open_title') : t('gate_locked_title')}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        {gate.unlocked ? t('gate_open_body') : t('gate_locked_body')}
                    </p>
                    {!gate.unlocked && (
                        <ul className="mt-3 space-y-1.5 text-sm">
                            {gate.afterMinutes > 0 && (
                                <li className="flex items-center gap-2" data-testid="course-gate-time">
                                    {remaining === 0
                                        ? <Check className="h-4 w-4 text-teal-700" aria-hidden="true" />
                                        : <Clock className="h-4 w-4 text-amber-700" aria-hidden="true" />}
                                    <span className="text-foreground">
                                        {remaining === null
                                            ? t('gate_time_not_started', { minutes: gate.afterMinutes })
                                            : remaining === 0
                                                ? t('gate_time_met', { minutes: gate.afterMinutes })
                                                : t('gate_time_remaining', { time: formatRemaining(remaining) })}
                                    </span>
                                </li>
                            )}
                            {gate.allSlidesOpened && gate.slides.length > 0 && (
                                <li data-testid="course-gate-slides">
                                    <span className="flex items-center gap-2 text-foreground">
                                        {opened === gate.slides.length
                                            ? <Check className="h-4 w-4 text-teal-700" aria-hidden="true" />
                                            : <Circle className="h-4 w-4 text-amber-700" aria-hidden="true" />}
                                        {t('gate_slides_opened', { opened, total: gate.slides.length })}
                                    </span>
                                    <ul className="ml-6 mt-1 flex flex-wrap gap-1.5">
                                        {gate.slides.map((slide) => (
                                            <li
                                                key={slide.id}
                                                className={`rounded-md px-2 py-0.5 text-xs ${slide.opened ? 'bg-teal-100 text-teal-900' : 'bg-muted text-muted-foreground'}`}
                                            >
                                                {slide.opened ? '✓ ' : ''}{slide.label}
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            )}
                        </ul>
                    )}
                    {/* A count, not a list: locked lessons arrive without their
                        titles, which can name the case's answer. */}
                    {!gate.unlocked && lockedLessons.length > 0 && (
                        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" data-testid="gate-waiting-count">
                            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {t('gate_waiting_count', { count: lockedLessons.length })}
                        </p>
                    )}
                </div>
            </div>
        </section>
    );
}

function attemptLabel(t, attempt) {
    if (attempt === 'pre') return t('attempt_pre');
    if (attempt === 'post') return t('attempt_post');
    return t('attempt_single');
}

function timingNote(t, questionnaire) {
    if (questionnaire.timing === 'pre_post') return t('timing_pre_post');
    if (questionnaire.timing === 'after') return t('timing_after');
    return t('timing_during');
}

function QuestionInput({ question, value, onChange, disabled }) {
    const { t } = useTranslation('course');
    if (question.type === 'text') {
        return (
            <textarea
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                rows={3}
                aria-label={question.text}
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder={t('answer_placeholder')}
            />
        );
    }
    const multiple = question.type === 'multiple';
    const chosen = multiple ? (Array.isArray(value) ? value : []) : value;
    return (
        <div className="mt-2 space-y-1.5" role={multiple ? 'group' : 'radiogroup'} aria-label={question.text}>
            {question.options.map((option, index) => {
                const checked = multiple ? chosen.includes(index) : chosen === index;
                return (
                    <label key={index} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 text-sm text-foreground hover:bg-muted">
                        <input
                            type={multiple ? 'checkbox' : 'radio'}
                            name={question.id}
                            checked={checked}
                            disabled={disabled}
                            onChange={() => {
                                if (!multiple) return onChange(index);
                                return onChange(checked ? chosen.filter((n) => n !== index) : [...chosen, index]);
                            }}
                            className="mt-0.5"
                        />
                        <span>{option}</span>
                    </label>
                );
            })}
        </div>
    );
}

function answerText(question, value) {
    if (value === undefined || value === null) return '—';
    if (question.type === 'text') return value;
    const picked = Array.isArray(value) ? value : [value];
    return picked.map((n) => question.options[n]).join(', ');
}

function AttemptResult({ questionnaire, attempt, pre }) {
    const { t, i18n } = useTranslation('course');
    // In the interface language, not the browser's.
    const submitted = attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString(i18n.language) : '';
    return (
        <div className="mt-3 rounded-xl border border-border bg-muted/40 px-4 py-3" data-testid={`attempt-${questionnaire.id}-${attempt.attempt}`}>
            <p className="text-sm font-medium text-foreground">
                {t('attempt_submitted', { attempt: attemptLabel(t, attempt.attempt), time: submitted })}
            </p>
            {attempt.score !== undefined && (
                <p className="mt-1 text-sm text-foreground">
                    {attempt.attempt === 'post' && pre?.score !== undefined
                        ? t('score_gain', { pre: pre.score, post: attempt.score, max: attempt.maxScore })
                        : t('score', { score: attempt.score, max: attempt.maxScore })}
                </p>
            )}
            {attempt.attempt === 'pre' && attempt.score === undefined && questionnaire.graded && (
                <p className="mt-1 text-xs text-muted-foreground">{t('pre_result_later')}</p>
            )}
            {attempt.key && (
                <ol className="mt-2 space-y-2">
                    {questionnaire.questions.map((question) => {
                        const result = attempt.results?.[question.id];
                        const key = attempt.key[question.id];
                        return (
                            <li key={question.id} className="text-sm">
                                <p className="flex items-start gap-1.5 text-foreground">
                                    {result === true && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-label={t('result_correct')} />}
                                    {result === false && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-label={t('result_wrong')} />}
                                    <span>{question.text}</span>
                                </p>
                                <p className="ml-5 text-muted-foreground">{t('your_answer', { answer: answerText(question, attempt.answers[question.id]) })}</p>
                                {key?.correct && result === false && (
                                    <p className="ml-5 text-muted-foreground">{t('correct_answer', { answer: answerText(question, key.correct) })}</p>
                                )}
                                {key?.feedback && <p className="ml-5 mt-0.5 italic text-foreground">{key.feedback}</p>}
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}

function QuestionnaireCard({ caseId, sessionId, questionnaire, onSubmitted }) {
    const { t } = useTranslation('course');
    const [answers, setAnswers] = useState({});
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState(null);
    const open = questionnaire.openAttempt;
    const pre = questionnaire.attempts.find((a) => a.attempt === 'pre');

    const submit = async (event) => {
        event.preventDefault();
        const checked = checkAnswers(questionnaire, answers);
        if (checked.problem) {
            setProblem(t('answer_all_required'));
            return;
        }
        setBusy(true);
        setProblem(null);
        try {
            await apiPost(`/cases/${caseId}/questionnaires/${encodeURIComponent(questionnaire.id)}/responses`, {
                attempt: open,
                answers: checked.answers,
                ...(sessionId ? { sessionId } : {}),
            });
            EventLogger.log(VERBS.SUBMITTED, OBJECT_TYPES.QUESTIONNAIRE, {
                objectId: questionnaire.id,
                objectName: questionnaire.title,
                result: open,
                component: 'CaseCoursePanel',
                context: { caseId, attempt: open, timing: questionnaire.timing },
            });
            await onSubmitted();
        } catch (err) {
            setProblem(err?.body?.error || t('submit_failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="rounded-2xl border border-border bg-card px-5 py-4" data-testid={`questionnaire-${questionnaire.id}`}>
            <div className="flex items-start gap-3">
                <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-foreground">{questionnaire.closed ? t('questionnaire_closed_title') : questionnaire.title}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{timingNote(t, questionnaire)}</p>
                    {questionnaire.instructions && <p className="mt-2 whitespace-pre-line text-sm text-foreground">{questionnaire.instructions}</p>}

                    {questionnaire.attempts.map((attempt) => (
                        <AttemptResult key={attempt.attempt} questionnaire={questionnaire} attempt={attempt} pre={pre} />
                    ))}

                    {open && (
                        <form onSubmit={submit} className="mt-3" data-testid={`questionnaire-form-${questionnaire.id}`}>
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{attemptLabel(t, open)}</p>
                            <ol className="mt-2 space-y-4">
                                {questionnaire.questions.map((question, index) => (
                                    <li key={question.id}>
                                        <p className="text-sm font-medium text-foreground">
                                            {index + 1}. {question.text}
                                            {question.required === false && <span className="ml-1 font-normal text-muted-foreground">{t('optional')}</span>}
                                        </p>
                                        {question.type === 'multiple' && <p className="text-xs text-muted-foreground">{t('pick_all_that_apply')}</p>}
                                        <QuestionInput
                                            question={question}
                                            value={answers[question.id]}
                                            disabled={busy}
                                            onChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                                        />
                                    </li>
                                ))}
                            </ol>
                            {problem && <p role="alert" className="mt-3 text-sm text-red-700">{problem}</p>}
                            <button
                                type="submit"
                                disabled={busy}
                                className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                            >
                                {busy ? t('submitting') : t('submit')}
                            </button>
                        </form>
                    )}

                    {!open && questionnaire.attempts.length === 0 && (
                        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {t('opens_with_materials')}
                        </p>
                    )}
                </div>
            </div>
        </section>
    );
}

/**
 * @param {{caseId: number, sessionId?: number|null, lockedLessons?: {id: number}[],
 *          onGateChange?: (unlocked: boolean) => void}} props
 */
export default function CaseCoursePanel({ caseId, sessionId = null, lockedLessons = [], onGateChange = () => {} }) {
    const { t } = useTranslation('course');
    const [state, setState] = useState(null);
    const [failed, setFailed] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    const load = useCallback(async () => {
        try {
            const next = await apiGet(`/cases/${caseId}/course-state`);
            setState(next);
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, [caseId]);

    useEffect(() => { if (caseId != null) load(); }, [caseId, load]);

    const unlocked = state?.gate?.unlocked ?? true;
    useEffect(() => { if (state) onGateChange(unlocked); }, [state, unlocked, onGateChange]);

    // While locked: tick the countdown every second, and ask the server again
    // when the clock reaches the unlock time and every 30 s (a slide opened in
    // another tab counts too).
    const unlockAt = state?.gate?.unlockAt ? Date.parse(state.gate.unlockAt) : null;
    useEffect(() => {
        if (unlocked || !state?.gate?.configured) return undefined;
        const tick = setInterval(() => setNow(Date.now()), 1000);
        const poll = setInterval(load, POLL_MS);
        return () => { clearInterval(tick); clearInterval(poll); };
    }, [unlocked, state?.gate?.configured, load]);
    const timeReached = unlockAt !== null && now >= unlockAt;
    useEffect(() => { if (timeReached && !unlocked) load(); }, [timeReached, unlocked, load]);

    const questionnaires = useMemo(() => state?.questionnaires ?? [], [state]);
    if (caseId == null) return null;
    if (failed) return <p className="text-sm text-muted-foreground">{t('load_failed')}</p>;
    if (!state || (!state.gate.configured && questionnaires.length === 0)) return null;

    return (
        <div className="space-y-4" data-testid="case-course-panel">
            <GateCard gate={state.gate} now={now} lockedLessons={lockedLessons} />
            {questionnaires.map((questionnaire) => (
                <QuestionnaireCard
                    // Keyed by the open attempt: the post-test after the
                    // pre-test mounts a fresh, empty form.
                    key={`${questionnaire.id}:${questionnaire.openAttempt}`}
                    caseId={caseId}
                    sessionId={sessionId}
                    questionnaire={questionnaire}
                    onSubmitted={load}
                />
            ))}
        </div>
    );
}
