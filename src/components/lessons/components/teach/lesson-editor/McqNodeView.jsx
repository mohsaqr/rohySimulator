import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeViewWrapper } from '@tiptap/react';
import { ListChecks, Plus, Trash2, Check, X, CheckCircle2, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';
import { BlockCard } from './BlockCard';
import { normalizeQuestion, blankQuestion } from './mcqShared';
import { activityLogger } from '../../../services/activityLogger';

/**
 * Multiple-choice self-check block. Author view = a list of question editors;
 * student view = a stepper that gives instant feedback per question and a
 * final summary. No scores are persisted. Wrapped in the shared BlockCard.
 */
export const McqNodeView = ({ node, updateAttributes, deleteNode, editor }) => {
  const { t } = useTranslation(['teaching', 'common']);
  const { isDark } = useTheme();
  const editable = editor?.isEditable ?? true;

  const raw = node.attrs.questions ?? [];
  const questions = raw.length ? raw.map(normalizeQuestion) : [blankQuestion()];
  const n = questions.length;

  const cardBg = isDark ? '#1e293b' : '#ffffff';
  const cardBorder = isDark ? '#334155' : '#e2e8f0';
  const subtle = isDark ? '#e2e8f0' : '#334155';
  const muted = isDark ? '#94a3b8' : '#64748b';
  const accent = isDark ? '#2dd4bf' : '#0f766e';

  // ─── Author view ───────────────────────────────────────────────────────────
  if (editable) {
    const setQuestions = (next) => updateAttributes({ questions: next });
    const patchQ = (qi, patch) =>
      setQuestions(questions.map((q, i) => (i === qi ? { ...q, ...patch } : q)));
    const addQuestion = () => setQuestions([...questions, blankQuestion()]);
    const removeQuestion = (qi) => setQuestions(questions.filter((_, i) => i !== qi));
    const setOption = (qi, oi, value) =>
      patchQ(qi, { options: questions[qi].options.map((o, i) => (i === oi ? value : o)) });
    const addOption = (qi) => patchQ(qi, { options: [...questions[qi].options, ''] });
    const removeOption = (qi, oi) => {
      const q = questions[qi];
      const options = q.options.filter((_, i) => i !== oi);
      const correctIndex = q.correctIndex === oi ? 0 : q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex;
      patchQ(qi, { options, correctIndex });
    };

    return (
      <NodeViewWrapper as="div" className="my-3" data-drag-handle>
        <BlockCard
          icon={ListChecks}
          accent="cyan"
          title={t('mcq_self_check', { defaultValue: 'Self-check' })}
          badge={t('mcq_n_questions', { defaultValue: '{{n}} Q', n })}
          actions={
            <button
              type="button"
              onClick={() => deleteNode()}
              className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              style={{ color: '#ef4444' }}
              aria-label={t('common:delete', { defaultValue: 'Delete' })}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          }
        >
          <div className="space-y-3" contentEditable={false}>
            {questions.map((q, qi) => (
              <div key={qi} className="rounded-lg border p-3" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: muted }}>
                    {t('mcq_question_n', { defaultValue: 'Question {{n}}', n: qi + 1 })}
                  </span>
                  {n > 1 && (
                    <button
                      type="button"
                      onClick={() => removeQuestion(qi)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                      style={{ color: muted }}
                      aria-label={t('mcq_remove_question', { defaultValue: 'Remove question' })}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={q.question}
                  onChange={e => patchQ(qi, { question: e.target.value })}
                  placeholder={t('mcq_question_placeholder', { defaultValue: 'Type the question…' })}
                  className="w-full mb-2.5 px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  style={{ backgroundColor: cardBg, borderColor: cardBorder, color: subtle }}
                />

                <div className="space-y-1.5">
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => patchQ(qi, { correctIndex: oi })}
                        title={t('mcq_mark_correct', { defaultValue: 'Mark as correct answer' })}
                        className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        style={{
                          borderColor: q.correctIndex === oi ? '#10b981' : cardBorder,
                          backgroundColor: q.correctIndex === oi ? '#10b981' : 'transparent',
                          color: '#ffffff',
                        }}
                        aria-label={t('mcq_mark_correct', { defaultValue: 'Mark as correct answer' })}
                      >
                        {q.correctIndex === oi && <Check className="w-3.5 h-3.5" />}
                      </button>
                      <input
                        type="text"
                        value={opt}
                        onChange={e => setOption(qi, oi, e.target.value)}
                        placeholder={t('mcq_option_placeholder', { defaultValue: 'Option {{n}}', n: oi + 1 })}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-cyan-400"
                        style={{ backgroundColor: cardBg, borderColor: cardBorder, color: subtle }}
                      />
                      {q.options.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeOption(qi, oi)}
                          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                          style={{ color: muted }}
                          aria-label={t('common:delete', { defaultValue: 'Delete' })}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => addOption(qi)}
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 hover:underline"
                  style={{ color: accent }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('mcq_add_option', { defaultValue: 'Add option' })}
                </button>

                <input
                  type="text"
                  value={q.explanation}
                  onChange={e => patchQ(qi, { explanation: e.target.value })}
                  placeholder={t('mcq_explanation_placeholder', { defaultValue: 'Explanation shown after answering (optional)' })}
                  className="w-full mt-2.5 px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  style={{ backgroundColor: cardBg, borderColor: cardBorder, color: subtle }}
                />
              </div>
            ))}

            <button
              type="button"
              onClick={addQuestion}
              className="inline-flex items-center gap-1.5 text-sm font-semibold rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 hover:underline"
              style={{ color: accent }}
            >
              <Plus className="w-4 h-4" />
              {t('mcq_add_question', { defaultValue: 'Add question' })}
            </button>
          </div>
        </BlockCard>
      </NodeViewWrapper>
    );
  }

  // ─── Student view (stepper) ──────────────────────────────────────────────
  return <McqStudent questions={questions} isDark={isDark} />;
};

/** Interactive multi-question self-check for learners. */
const McqStudent = ({ questions, isDark }) => {
  const { t } = useTranslation(['teaching', 'common']);
  const n = questions.length;
  const [cur, setCur] = useState(0);
  const [answers, setAnswers] = useState(() => questions.map(() => null));
  const [revealed, setRevealed] = useState(() => questions.map(() => false));
  const [done, setDone] = useState(false);

  const cardBg = isDark ? '#1e293b' : '#ffffff';
  const cardBorder = isDark ? '#334155' : '#e2e8f0';
  const subtle = isDark ? '#e2e8f0' : '#334155';
  const muted = isDark ? '#94a3b8' : '#64748b';
  const accent = isDark ? '#2dd4bf' : '#0f766e';

  const q = questions[cur];
  const picked = answers[cur];
  const isRevealed = revealed[cur];
  const correctCount = answers.filter((a, i) => a === questions[i].correctIndex).length;

  const pick = (oi) => {
    if (isRevealed) return;
    setAnswers(prev => prev.map((a, i) => (i === cur ? oi : a)));
  };
  const check = () => {
    setRevealed(prev => prev.map((r, i) => (i === cur ? true : r)));
    // Self-check grading is client-side by design (no persistence), but the
    // attempt itself is a learning event — log it like other rooms do.
    activityLogger.log({
      verb: picked === q.correctIndex ? 'CORRECT_ANSWER' : 'INCORRECT_ANSWER',
      objectType: 'question',
      objectId: `mcq-${cur + 1}`,
      objectTitle: q.question,
      questionIndex: cur,
      questionCount: n,
      pickedIndex: picked,
      correctIndex: q.correctIndex,
    });
  };
  const restart = () => { setAnswers(questions.map(() => null)); setRevealed(questions.map(() => false)); setCur(0); setDone(false); };

  const optStyle = (oi) => {
    const base = { backgroundColor: cardBg, borderColor: cardBorder, color: subtle };
    if (!isRevealed) {
      return oi === picked
        ? { ...base, borderColor: accent, backgroundColor: isDark ? 'rgba(45,212,191,0.10)' : '#f0fdfa' }
        : base;
    }
    if (oi === q.correctIndex) return { ...base, borderColor: '#10b981', backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : '#ecfdf5' };
    if (oi === picked) return { ...base, borderColor: '#ef4444', backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : '#fef2f2' };
    return base;
  };

  const badge = n > 1
    ? t('mcq_q_of_n', { defaultValue: 'Q{{i}} of {{n}}', i: cur + 1, n })
    : t('mcq_self_check', { defaultValue: 'Self-check' });

  return (
    <NodeViewWrapper as="div" className="my-3">
      <BlockCard icon={ListChecks} accent="cyan" title={t('mcq_self_check', { defaultValue: 'Self-check' })} badge={badge}>
        <div contentEditable={false}>
          {done ? (
            <div className="text-center py-4">
              <div className="text-2xl font-bold mb-1" style={{ color: subtle }}>
                {t('mcq_score', { defaultValue: '{{c}} / {{n}}', c: correctCount, n })}
              </div>
              <p className="text-sm mb-3" style={{ color: muted }}>
                {t('mcq_complete', { defaultValue: 'Self-check complete.' })}
              </p>
              <button
                type="button"
                onClick={restart}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-cyan-400"
                style={{ backgroundColor: accent }}
              >
                <RotateCcw className="w-4 h-4" />
                {t('mcq_try_again', { defaultValue: 'Try again' })}
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium mb-3" style={{ color: subtle }}>
                {q.question || t('mcq_question_n', { defaultValue: 'Question {{n}}', n: cur + 1 })}
              </p>

              <div className="space-y-2">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    type="button"
                    disabled={isRevealed}
                    onClick={() => pick(oi)}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg border transition-colors disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    style={optStyle(oi)}
                  >
                    <span
                      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full border-2 text-[11px] font-semibold"
                      style={{ borderColor: oi === picked && !isRevealed ? accent : cardBorder, color: muted }}
                    >
                      {String.fromCharCode(65 + oi)}
                    </span>
                    <span className="flex-1 min-w-0 break-words">{opt}</span>
                    {isRevealed && oi === q.correctIndex && <CheckCircle2 className="w-4 h-4" style={{ color: '#10b981' }} />}
                    {isRevealed && oi === picked && oi !== q.correctIndex && <X className="w-4 h-4" style={{ color: '#ef4444' }} />}
                  </button>
                ))}
              </div>

              {isRevealed && (
                <div className="mt-3 space-y-1">
                  <div className="text-sm font-medium" style={{ color: picked === q.correctIndex ? '#10b981' : '#ef4444' }}>
                    {picked === q.correctIndex ? t('mcq_correct', { defaultValue: 'Correct!' }) : t('mcq_incorrect', { defaultValue: 'Not quite.' })}
                  </div>
                  {q.explanation && <p className="text-sm" style={{ color: muted }}>{q.explanation}</p>}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  disabled={cur === 0}
                  onClick={() => setCur(c => Math.max(0, c - 1))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium rounded-lg disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  style={{ color: muted }}
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t('common:back', { defaultValue: 'Back' })}
                </button>

                {!isRevealed ? (
                  <button
                    type="button"
                    disabled={picked === null}
                    onClick={check}
                    className="px-4 py-1.5 text-sm font-semibold rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-cyan-400"
                    style={{ backgroundColor: accent }}
                  >
                    {t('mcq_check', { defaultValue: 'Check answer' })}
                  </button>
                ) : cur < n - 1 ? (
                  <button
                    type="button"
                    onClick={() => setCur(c => Math.min(n - 1, c + 1))}
                    className="inline-flex items-center gap-1 px-4 py-1.5 text-sm font-semibold rounded-lg text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-cyan-400"
                    style={{ backgroundColor: accent }}
                  >
                    {t('mcq_next_question', { defaultValue: 'Next' })}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDone(true)}
                    className="px-4 py-1.5 text-sm font-semibold rounded-lg text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-emerald-400"
                    style={{ backgroundColor: '#10b981' }}
                  >
                    {t('mcq_finish', { defaultValue: 'Finish' })}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </BlockCard>
    </NodeViewWrapper>
  );
};
