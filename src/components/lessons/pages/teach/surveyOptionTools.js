// Option-list helpers for the survey question editor (SurveyManager). An
// educator building a 10-item perception survey had to type every Likert
// option by hand for every question; these back the three shortcuts: preset
// answer scales, a multi-line paste that becomes one option per line, and
// reusing the options of the previous choice question.

/**
 * Preset answer scales. The VALUES are stored as option text, so they go
 * through t() too: the educator builds the survey in their own language.
 * Every key is static so the i18n parser can see it.
 */
export const optionPresets = (t) => {
  const stronglyDisagree = t('scale_strongly_disagree', { defaultValue: 'Strongly disagree' });
  const disagree = t('scale_disagree', { defaultValue: 'Disagree' });
  const neutral = t('scale_neutral', { defaultValue: 'Neutral' });
  const agree = t('scale_agree', { defaultValue: 'Agree' });
  const stronglyAgree = t('scale_strongly_agree', { defaultValue: 'Strongly agree' });
  return [
    {
      id: 'agreement5',
      label: t('preset_agreement_5', { defaultValue: 'Agreement (5)' }),
      options: [stronglyDisagree, disagree, neutral, agree, stronglyAgree],
    },
    {
      id: 'agreement7',
      label: t('preset_agreement_7', { defaultValue: 'Agreement (7)' }),
      options: [
        stronglyDisagree,
        disagree,
        t('scale_somewhat_disagree', { defaultValue: 'Somewhat disagree' }),
        neutral,
        t('scale_somewhat_agree', { defaultValue: 'Somewhat agree' }),
        agree,
        stronglyAgree,
      ],
    },
    {
      id: 'frequency5',
      label: t('preset_frequency_5', { defaultValue: 'Frequency (5)' }),
      options: [
        t('scale_never', { defaultValue: 'Never' }),
        t('scale_rarely', { defaultValue: 'Rarely' }),
        t('scale_sometimes', { defaultValue: 'Sometimes' }),
        t('scale_often', { defaultValue: 'Often' }),
        t('scale_always', { defaultValue: 'Always' }),
      ],
    },
    {
      id: 'quality5',
      label: t('preset_quality_5', { defaultValue: 'Quality (5)' }),
      options: [
        t('scale_very_poor', { defaultValue: 'Very poor' }),
        t('scale_poor', { defaultValue: 'Poor' }),
        t('scale_fair', { defaultValue: 'Fair' }),
        t('scale_good', { defaultValue: 'Good' }),
        t('scale_very_good', { defaultValue: 'Very good' }),
      ],
    },
    {
      id: 'yesno',
      label: t('preset_yes_no', { defaultValue: 'Yes / No' }),
      options: [
        t('scale_yes', { defaultValue: 'Yes' }),
        t('scale_no', { defaultValue: 'No' }),
      ],
    },
  ];
};

/** Pasted text → one option per line, trimmed, blank lines dropped. */
export const splitPastedLines = (text) =>
  String(text ?? '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Put pasted lines at `index`. An empty field is replaced by the lines; a
 * field that already holds text keeps it and the lines follow it.
 */
export const insertPastedOptions = (options, index, lines) => {
  const current = options[index] ?? '';
  return [
    ...options.slice(0, index),
    ...(current.trim() ? [current] : []),
    ...lines,
    ...options.slice(index + 1),
  ];
};

/** True when the educator has typed at least one option. */
export const hasTypedOptions = (options) => (options || []).some((o) => String(o).trim() !== '');

/** Same options, ignoring blank fields and surrounding whitespace. */
export const sameOptions = (a, b) => {
  const clean = (list) => (list || []).map((o) => String(o).trim()).filter(Boolean);
  const left = clean(a);
  const right = clean(b);
  return left.length === right.length && left.every((o, i) => o === right[i]);
};

/**
 * The options of the nearest choice question before `editingId` (or of the
 * last choice question when adding a new one), or null when there is none.
 */
export const previousChoiceOptions = (questions, editingId) => {
  const list = questions || [];
  const stop = editingId != null ? list.findIndex((q) => q.id === editingId) : -1;
  const before = stop >= 0 ? list.slice(0, stop) : list;
  const found = [...before].reverse().find(
    (q) => q.questionType !== 'free_text' && Array.isArray(q.options) && q.options.length > 0
  );
  return found ? [...found.options] : null;
};
