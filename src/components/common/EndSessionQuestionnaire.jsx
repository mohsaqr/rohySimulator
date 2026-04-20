import React, { useState } from 'react';
import { X, CheckCircle, ChevronRight } from 'lucide-react';

// ─── Page 1: Questions ───────────────────────────────────────────────────────

const QUESTIONS = [
  {
    id: 'diagnosis',
    label: 'What is your diagnosis of the case',
    maxSelect: 1,
    required: true,
    options: [
      'Panic attack',
      'Ischemic heart disease',
      'Nonspecific chest pain',
      'Gastrointestinal disease',
      'Acute myocardial infarction',
      'Musculoskeletal pain',
      'Arrhythmias',
      'No idea',
      'Others',
    ],
  },
  {
    id: 'diagnosisConfidence',
    label: 'What is your confidence level in your diagnosis',
    sublabel: '(0 = not confident, 5 = very confident)',
    type: 'rating',
    required: true,
    min: 0,
    max: 5,
  },
  {
    id: 'decisionProcess',
    label: 'How did you mainly make your decision',
    maxSelect: 2,
    required: true,
    options: [
      'I have seen similar cases or patients before',
      'I worked through the information provided by the virtual patient step by step',
      'I tried to rule out serious conditions',
      'I was not sure',
      'Others',
    ],
  },
  {
    id: 'keyFactors',
    label: 'What are the key factors influencing your decision',
    maxSelect: 3,
    required: true,
    options: [
      'Symptoms (e.g., vital signs and patient expressions)',
      'History',
      'Lab results',
      'Radiology results',
      'Physical examinations',
      'Others',
    ],
  },
  {
    id: 'treatment',
    label: 'What is your possible treatment for the next step',
    maxSelect: 3,
    required: true,
    options: [
      'Administer aspirin',
      'Arrange urgent reperfusion therapy (PCI/thrombolysis)',
      'Initiate anti-anginal therapy',
      'Provide reassurance and symptomatic treatment',
      'Prescribe proton pump inhibitors or antacids',
      'Provide anxiolytics and reassurance',
      'Arrange oxygen therapy',
      'Prescribe NSAIDs and recommend rest/physical therapy',
      'Initiate antiarrhythmic therapy or rate/rhythm control',
      'Others',
    ],
  },
  {
    id: 'treatmentConfidence',
    label: 'What is your confidence level in your further treatments',
    sublabel: '(0 = not confident, 5 = very confident)',
    type: 'rating',
    required: true,
    min: 0,
    max: 5,
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function RatingInput({ value, onChange, min, max }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`w-9 h-9 rounded text-sm font-semibold border transition-colors ${
            value === n
              ? 'bg-blue-600 border-blue-500 text-white'
              : 'bg-neutral-800 border-neutral-600 text-neutral-300 hover:border-blue-500 hover:text-blue-300'
          }`}
        >
          {n}
        </button>
      ))}
      {value !== null && value !== undefined && (
        <span className="self-center text-xs text-neutral-400 ml-1">
          {value === 0 ? 'Not confident' : value === max ? 'Very confident' : `Level ${value}`}
        </span>
      )}
    </div>
  );
}

function MultiSelectInput({ options, selected, maxSelect, onChange }) {
  const toggle = (option) => {
    if (selected.includes(option)) {
      onChange(selected.filter((o) => o !== option));
    } else if (selected.length < maxSelect) {
      onChange([...selected, option]);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((option) => {
        const isSelected = selected.includes(option);
        const isDisabled = !isSelected && selected.length >= maxSelect;
        return (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            disabled={isDisabled}
            className={`text-left px-3 py-2 rounded border text-sm transition-colors ${
              isSelected
                ? 'bg-blue-900/60 border-blue-500 text-blue-100'
                : isDisabled
                ? 'bg-neutral-900/40 border-neutral-700 text-neutral-600 cursor-not-allowed'
                : 'bg-neutral-800/60 border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100'
            }`}
          >
            <span className={`inline-block w-4 h-4 mr-2 rounded-sm border align-middle ${
              isSelected ? 'bg-blue-500 border-blue-400' : 'border-neutral-500'
            }`} />
            {option}
          </button>
        );
      })}
    </div>
  );
}

// Step indicator shown in header
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

// ─── Page 2: Case Results ─────────────────────────────────────────────────────

function ResultsPage() {
  return (
    <div className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
      <div className="flex items-start gap-3 p-5 bg-green-900/30 border border-green-600/50 rounded-lg w-full">
        <CheckCircle className="w-6 h-6 text-green-400 shrink-0 mt-0.5" />
        <div className="text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-400 mb-1">Correct Diagnosis</p>
          <p className="text-lg font-bold text-white">Acute Inferior Myocardial Infarction</p>
        </div>
      </div>
    </div>
  );
}

// ─── Page 3: Reflection questions ────────────────────────────────────────────

const REFLECTION_QUESTIONS = [
  {
    id: 'improvements',
    label: 'Based on this simulation, where do you think you need to improve in the future',
    maxSelect: 3,
    required: true,
    options: [
      'Interpreting radiology results',
      'Interpreting lab results',
      'Clinical examination skills',
      'Treatment planning',
      'Managing uncertainty',
      'Communication skills',
      'I don\'t think I need improvement in this case',
      'Others',
    ],
  },
  {
    id: 'doDifferently',
    label: 'If you could do this case again, what would you do differently',
    maxSelect: 3,
    required: true,
    options: [
      'Make a different diagnosis',
      'Pay more attention to collecting history-related information',
      'Pay more attention to communicating with the patient',
      'Order different tests',
      'Arrange different treatments',
      'Pay more attention to analysing lab test results',
      'Pay more attention to analysing radiology results',
      'I would not change anything',
      'Others',
    ],
  },
];

// ─── Main component ───────────────────────────────────────────────────────────

const PAGE_TITLES = [
  'Self-Assessment',
  'Case Results',
  'Reflection',
];

export default function EndSessionQuestionnaire({
  onSubmit,
  onCancel,
  hideCancel = false,
}) {
  const [page, setPage] = useState(1);
  const TOTAL_PAGES = 3;

  const [answers, setAnswers] = useState({
    diagnosis: [],
    diagnosisConfidence: null,
    decisionProcess: [],
    keyFactors: [],
    treatment: [],
    treatmentConfidence: null,
  });
  const [reflectionAnswers, setReflectionAnswers] = useState({
    improvements: [],
    doDifferently: [],
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const setAnswer = (id, value) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => ({ ...prev, [id]: undefined }));
  };

  const setReflectionAnswer = (id, value) => {
    setReflectionAnswers((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => ({ ...prev, [id]: undefined }));
  };

  const validatePage1 = () => {
    const newErrors = {};
    QUESTIONS.forEach((q) => {
      if (!q.required) return;
      const val = answers[q.id];
      if (q.type === 'rating') {
        if (val === null || val === undefined) newErrors[q.id] = 'Please select a rating.';
      } else {
        if (!val || val.length === 0) newErrors[q.id] = 'Please select at least one option.';
      }
    });
    return newErrors;
  };

  const validatePage3 = () => {
    const newErrors = {};
    REFLECTION_QUESTIONS.forEach((q) => {
      if (!q.required) return;
      const val = reflectionAnswers[q.id];
      if (!val || val.length === 0) newErrors[q.id] = 'Please select at least one option.';
    });
    return newErrors;
  };

  const handleNext = () => {
    if (page === 1) {
      const newErrors = validatePage1();
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        const firstErrId = Object.keys(newErrors)[0];
        document.getElementById(`q-${firstErrId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    setErrors({});
    setPage((p) => p + 1);
  };

  const handleSubmit = async () => {
    const newErrors = validatePage3();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstErrId = Object.keys(newErrors)[0];
      document.getElementById(`rq-${firstErrId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitting(true);
    await onSubmit({ ...answers, ...reflectionAnswers });
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700 shrink-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <StepIndicator current={page} total={TOTAL_PAGES} />
            </div>
            <h2 className="text-base font-semibold text-white">
              {PAGE_TITLES[page - 1]}
            </h2>
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
            <div className="space-y-6">
              {QUESTIONS.map((q, idx) => (
                <div key={q.id} id={`q-${q.id}`} className="space-y-2">
                  <p className="text-sm font-medium text-neutral-100">
                    <span className="text-neutral-400 mr-1">{idx + 1}.</span>
                    {q.label}
                    {q.maxSelect && (
                      <span className="text-neutral-400 ml-1 font-normal">
                        (select a maximum of {q.maxSelect})
                      </span>
                    )}
                    {q.sublabel && (
                      <span className="text-neutral-400 ml-1 font-normal">{q.sublabel}</span>
                    )}
                    <span className="text-red-400 ml-1">*</span>
                  </p>
                  {q.type === 'rating' ? (
                    <RatingInput
                      value={answers[q.id]}
                      onChange={(v) => setAnswer(q.id, v)}
                      min={q.min}
                      max={q.max}
                    />
                  ) : (
                    <MultiSelectInput
                      options={q.options}
                      selected={answers[q.id]}
                      maxSelect={q.maxSelect}
                      onChange={(v) => setAnswer(q.id, v)}
                    />
                  )}
                  {errors[q.id] && (
                    <p className="text-xs text-red-400">{errors[q.id]}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {page === 2 && <ResultsPage />}

          {page === 3 && (
            <div className="space-y-6">
              {REFLECTION_QUESTIONS.map((q, idx) => (
                <div key={q.id} id={`rq-${q.id}`} className="space-y-2">
                  <p className="text-sm font-medium text-neutral-100">
                    <span className="text-neutral-400 mr-1">{idx + 1}.</span>
                    {q.label}
                    {q.maxSelect && (
                      <span className="text-neutral-400 ml-1 font-normal">
                        (select a maximum of {q.maxSelect})
                      </span>
                    )}
                    <span className="text-red-400 ml-1">*</span>
                  </p>
                  <MultiSelectInput
                    options={q.options}
                    selected={reflectionAnswers[q.id]}
                    maxSelect={q.maxSelect}
                    onChange={(v) => setReflectionAnswer(q.id, v)}
                  />
                  {errors[q.id] && (
                    <p className="text-xs text-red-400">{errors[q.id]}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-neutral-700 shrink-0">
          <div className="text-xs text-neutral-500">
            Page {page} of {TOTAL_PAGES}
          </div>
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
