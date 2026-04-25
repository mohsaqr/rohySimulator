import React, { useState } from 'react';
import { X, ChevronRight } from 'lucide-react';

// ─── Page 1: Clinical Reasoning Assessment (20 items, Likert 1–5) ─────────────

const CRA_QUESTIONS = [
  'I know the reference values for heart rate, blood pressure, respiratory rate, and body temperature.',
  'I can interpret an ECG of a patient with an emergency medical condition.',
  'I can assess a patient using the ABCDE scheme.',
  'I can conduct a focused history taking in clinical emergency.',
  'I can perform a focused physical examination in a clinical emergency.',
  'I can recognize a critically ill patient.',
  'I can request the most important laboratory parameters in a clinical emergency based on the clinical presentation of a patient.',
  'I can interpret the laboratory findings in a patient with an emergency medical condition.',
  'I can correctly assess the indications for performing an X-ray in a patient with an emergency medical condition.',
  'I can interpret X-rays of a patient with an emergency medical condition.',
  'I can prioritize tasks in emergency situations according to importance.',
  'I know the most important medications that must be administered in clinical emergencies.',
  'I can correctly determine the indication for further diagnostic and therapeutic interventions in clinical emergencies (e.g., endoscopy, cardiac catheterization).',
  'I have a good time management in treating patients with emergency medical conditions.',
  'I can perform and interpret a focused emergency ultrasound in a patient.',
  'I know the dosages of the most important medications that must be administered in clinical emergencies.',
  'I question how, what and why I do things in practice.',
  'I cope well with change.',
  'I can function with uncertainty.',
  'I make decisions about practice based on my experience.',
];

// ─── Page 2: User Experience (15 items, Likert 1–5) ──────────────────────────

const UX_QUESTIONS = [
  'Working through the virtual patient was a valuable learning experience.',
  'The virtual patient helped me to improve my clinical reasoning skills.',
  'The virtual patient helped me to make diagnostic decisions.',
  'The virtual patient helped me to plan patient management.',
  'The virtual patient case was realistic.',
  'The patient encounter felt authentic.',
  'The clinical situation resembled real practice.',
  'I was motivated to work through the virtual patient.',
  'The virtual patient kept my attention.',
  'I enjoyed learning with the virtual patient.',
  'The virtual patient system was easy to use.',
  'Navigation through the case was clear.',
  'I could use the system without difficulty.',
  'I would like to use virtual patients again in future learning.',
  'I would recommend this virtual patient to other students.',
];

// ─── Shared sub-components ────────────────────────────────────────────────────

const LIKERT_LEGEND = [
  ['1', 'SD', 'Strongly Disagree'],
  ['2', 'D',  'Disagree'],
  ['3', 'U',  'Undecided'],
  ['4', 'A',  'Agree'],
  ['5', 'SA', 'Strongly Agree'],
];

function LikertLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-300 bg-neutral-800/60 border border-neutral-700 rounded px-4 py-3">
      {LIKERT_LEGEND.map(([num, short, long]) => (
        <span key={num}>
          <span className="text-white font-semibold">{num} = {short}</span>
          <span className="text-neutral-400"> ({long})</span>
        </span>
      ))}
    </div>
  );
}

function LikertInput({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-400 shrink-0">1 = Strongly Disagree</span>
      {[1, 2, 3, 4, 5].map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`w-9 h-9 rounded text-sm font-semibold border transition-colors ${
            value === v
              ? 'bg-blue-600 border-blue-500 text-white'
              : 'bg-neutral-800 border-neutral-600 text-neutral-300 hover:border-blue-500 hover:text-blue-300'
          }`}
        >
          {v}
        </button>
      ))}
      <span className="text-xs text-neutral-400 shrink-0">5 = Strongly Agree</span>
    </div>
  );
}

function LikertPage({ questions, prefix, answers, setAnswer, errors }) {
  return (
    <div className="space-y-5">
      <LikertLegend />
      {questions.map((label, i) => {
        const key = `${prefix}_${i}`;
        return (
          <div key={key} id={`item-${key}`} className="space-y-2">
            <p className="text-sm font-medium text-neutral-100">
              <span className="text-neutral-400 mr-1">{i + 1}.</span>
              {label}
              <span className="text-red-400 ml-1">*</span>
            </p>
            <LikertInput value={answers[key]} onChange={(v) => setAnswer(key, v)} />
            {errors[key] && (
              <p className="text-xs text-red-400">{errors[key]}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepIndicator({ current, total }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <React.Fragment key={step}>
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${
              step < current
                ? 'bg-green-700 border-green-600 text-white'
                : step === current
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-neutral-800 border-neutral-600 text-neutral-500'
            }`}
          >
            {step < current ? '✓' : step}
          </div>
          {step < total && (
            <div className={`w-5 h-px ${step < current ? 'bg-green-700' : 'bg-neutral-700'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PAGE_TITLES = ['Clinical Reasoning Assessment', 'User Experience'];
const TOTAL_PAGES = 2;

const initAnswers = (questions, prefix) =>
  Object.fromEntries(questions.map((_, i) => [`${prefix}_${i}`, null]));

const validatePage = (questions, prefix, answers) => {
  const errors = {};
  questions.forEach((_, i) => {
    const key = `${prefix}_${i}`;
    if (answers[key] == null) errors[key] = 'Please select a rating.';
  });
  return errors;
};

export default function EndSessionQuestionnaire({ onSubmit, onCancel, hideCancel = false }) {
  const [page, setPage] = useState(1);
  const [craAnswers, setCraAnswers] = useState(() => initAnswers(CRA_QUESTIONS, 'cra'));
  const [uxAnswers, setUxAnswers]   = useState(() => initAnswers(UX_QUESTIONS,  'ux'));
  const [errors, setErrors]         = useState({});
  const [submitting, setSubmitting] = useState(false);

  const setAnswer = (setter) => (key, value) => {
    setter((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleNext = () => {
    const newErrors = validatePage(CRA_QUESTIONS, 'cra', craAnswers);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      document.getElementById(`item-${Object.keys(newErrors)[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setErrors({});
    setPage(2);
  };

  const handleSubmit = async () => {
    const newErrors = validatePage(UX_QUESTIONS, 'ux', uxAnswers);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      document.getElementById(`item-${Object.keys(newErrors)[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitting(true);
    await onSubmit({ ...craAnswers, ...uxAnswers });
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700 shrink-0">
          <div className="flex flex-col gap-1">
            <StepIndicator current={page} total={TOTAL_PAGES} />
            <h2 className="text-base font-semibold text-white">{PAGE_TITLES[page - 1]}</h2>
          </div>
          {!hideCancel && (
            <button
              onClick={onCancel}
              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {page === 1 && (
            <LikertPage
              questions={CRA_QUESTIONS}
              prefix="cra"
              answers={craAnswers}
              setAnswer={setAnswer(setCraAnswers)}
              errors={errors}
            />
          )}
          {page === 2 && (
            <LikertPage
              questions={UX_QUESTIONS}
              prefix="ux"
              answers={uxAnswers}
              setAnswer={setAnswer(setUxAnswers)}
              errors={errors}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-neutral-700 shrink-0">
          <div className="text-xs text-neutral-500">Page {page} of {TOTAL_PAGES}</div>
          <div className="flex items-center gap-3">
            {!hideCancel && page === 1 && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm rounded border border-neutral-600 text-neutral-300 hover:text-white hover:border-neutral-500 transition-colors"
              >
                Cancel
              </button>
            )}
            {page < TOTAL_PAGES ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-4 py-2 text-sm rounded bg-blue-700 hover:bg-blue-600 text-white font-semibold transition-colors flex items-center gap-1.5"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded bg-red-700 hover:bg-red-600 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting…' : 'Submit & End Session'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
