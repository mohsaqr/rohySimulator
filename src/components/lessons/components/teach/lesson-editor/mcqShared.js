export const blankQuestion = () => ({
  question: '',
  options: ['', ''],
  correctIndex: 0,
  explanation: '',
});

/** Coerce arbitrary parsed JSON into a safe McqQuestion (defends against
 *  hand-edited or corrupted content round-tripping through the DB).
 *
 *  `correctIndex` is null when the question carries NO answer key: the server
 *  removes `correctIndex` and `explanation` from a learner's copy of the
 *  lesson (lessons-routes stripMcqAnswerKeys) and the student view then grades
 *  through POST /courses/lectures/:id/mcq/check. A present-but-invalid index
 *  still falls back to 0, as before. */
export const normalizeQuestion = (raw) => {
  const q = raw ?? {};
  const options = Array.isArray(q.options) ? q.options.map(o => String(o ?? '')) : ['', ''];
  const safeOptions = options.length >= 2 ? options : [...options, '', ''].slice(0, 2);
  let correctIndex = q.correctIndex === undefined || q.correctIndex === null
    ? null
    : (Number.isInteger(q.correctIndex) ? q.correctIndex : 0);
  if (correctIndex !== null && (correctIndex < 0 || correctIndex >= safeOptions.length)) correctIndex = 0;
  return {
    question: typeof q.question === 'string' ? q.question : '',
    options: safeOptions,
    correctIndex,
    explanation: typeof q.explanation === 'string' ? q.explanation : '',
  };
};

/**
 * Which <lecture-mcq> of the document this node is, in document order — the
 * `blockIndex` the server's check route addresses a section's blocks by.
 */
export const mcqBlockIndexOf = (editor, getPos) => {
  const pos = typeof getPos === 'function' ? getPos() : null;
  if (!editor?.state || typeof pos !== 'number') return 0;
  const positions = [];
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'lectureMcq') positions.push(p); });
  const i = positions.indexOf(pos);
  return i < 0 ? 0 : i;
};
