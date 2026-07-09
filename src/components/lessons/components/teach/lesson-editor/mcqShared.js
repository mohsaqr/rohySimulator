export const blankQuestion = () => ({
  question: '',
  options: ['', ''],
  correctIndex: 0,
  explanation: '',
});

/** Coerce arbitrary parsed JSON into a safe McqQuestion (defends against
 *  hand-edited or corrupted content round-tripping through the DB). */
export const normalizeQuestion = (raw) => {
  const q = raw ?? {};
  const options = Array.isArray(q.options) ? q.options.map(o => String(o ?? '')) : ['', ''];
  const safeOptions = options.length >= 2 ? options : [...options, '', ''].slice(0, 2);
  let correctIndex = Number.isInteger(q.correctIndex) ? q.correctIndex : 0;
  if (correctIndex < 0 || correctIndex >= safeOptions.length) correctIndex = 0;
  return {
    question: typeof q.question === 'string' ? q.question : '',
    options: safeOptions,
    correctIndex,
    explanation: typeof q.explanation === 'string' ? q.explanation : '',
  };
};
