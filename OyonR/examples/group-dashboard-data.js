/*
 * SYNTHETIC demo records for examples/group-dashboard.html.
 *
 * Nothing here was captured from a person. A seeded generator drives the
 * real library (TypingAggregator through createTypingEditReporter, the
 * document-edit and code-run trackers) so the records have exactly the
 * shapes a host would have stored, and the page is the same on every load.
 */

import { TypingAggregator } from '/src/aggregation/TypingAggregator.js';
import { createTypingEditReporter } from '/src/capture/TypingEditReporter.js';
import { createDocumentEditTracker } from '/src/capture/DocumentEditTracker.js';
import { createCodeRunTracker } from '/src/capture/CodeRunTracker.js';
import { SignalEventLog } from '/src/logging/SignalEventLog.js';

/** mulberry32: a small seeded PRNG, so the demo is deterministic. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLASS = { id: 'writing-101', label: 'Writing 101' };
const GROUPS = {
  a: { id: 'seminar-a', label: 'Seminar A' },
  b: { id: 'seminar-b', label: 'Seminar B' },
};
const PEOPLE = [
  { id: 'p-amira', label: 'Amira H.', group: GROUPS.a, pace: 150, revise: 0.06, calm: 0.7, focus: 0.78 },
  { id: 'p-jonas', label: 'Jonas K.', group: GROUPS.a, pace: 230, revise: 0.16, calm: 0.45, focus: 0.61 },
  { id: 'p-leila', label: 'Leila S.', group: GROUPS.a, pace: 180, revise: 0.1, calm: 0.6, focus: 0.7 },
  { id: 'p-mateo', label: 'Mateo R.', group: GROUPS.b, pace: 320, revise: 0.22, calm: 0.35, focus: 0.52 },
  { id: 'p-yuki', label: 'Yuki T.', group: GROUPS.b, pace: 130, revise: 0.04, calm: 0.8, focus: 0.84 },
  { id: 'p-noor', label: 'Noor A.', group: GROUPS.b, pace: 200, revise: 0.12, calm: 0.55, focus: 0.66 },
];
const EMOTIONS = ['neutral', 'happy', 'surprise', 'sad', 'anger'];
const BOUNDARIES = ['mid_word', 'word_boundary', 'word_boundary', 'sentence_boundary', 'paragraph_boundary'];
const DAY_MS = 86_400_000;
const FIRST_DAY = Date.parse('2026-11-02T09:00:00.000Z');

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

/** One session's records for one person. */
function buildSession({ person, sessionIndex, random, out }) {
  const sessionId = `${person.id}-s${sessionIndex + 1}`;
  const identity = {
    session_id: sessionId,
    user_id: person.id,
    user_label: person.label,
    group_id: person.group.id,
    group_label: person.group.label,
    class_id: CLASS.id,
    class_label: CLASS.label,
    context_id: `essay-${(sessionIndex % 2) + 1}`,
  };
  const sessionStart = FIRST_DAY + sessionIndex * 2 * DAY_MS + Math.floor(random() * 6) * 3_600_000;
  let clock = 0;                                   // monotonic ms within the session
  const wall = () => sessionStart + clock;

  // One shared event log per session: one sequence across typing, document
  // edits and code runs, as createSignalCapture gives a host.
  let eventId = 0;
  const log = new SignalEventLog({
    now: wall,
    monotonicNow: () => clock,
    idFactory: () => `${sessionId}-e${++eventId}`,
  });
  log.start({ capture_id: `cap-${sessionId}`, ...identity });
  const record = (event) => out.signalEvents.push(log.record(event));
  const documentEdits = createDocumentEditTracker({ onEvent: record, now: () => clock, wallClockNow: wall });
  const codeRuns = createCodeRunTracker({ onEvent: record, now: () => clock, wallClockNow: wall });

  // Camera windows: 10 s each.
  const windowCount = 24 + Math.floor(random() * 18);
  for (let i = 0; i < windowCount; i += 1) {
    const emotion = random() < person.calm ? 'neutral' : pick(random, EMOTIONS);
    const end = sessionStart + (i + 1) * 10_000;
    const others = EMOTIONS.filter((name) => name !== emotion);
    const top = 0.55 + random() * 0.35;
    const probabilities = Object.fromEntries([
      [emotion, top],
      ...others.map((name) => [name, (1 - top) / others.length]),
    ]);
    out.windows.push({
      ...identity,
      window_id: `${sessionId}-w${i}`,
      window_start: new Date(end - 10_000).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: 10_000,
      dominant_emotion: emotion,
      probabilities,
      confidence: top,
      valence: emotion === 'happy' ? 0.5 : emotion === 'sad' || emotion === 'anger' ? -0.4 : 0.05,
      arousal: emotion === 'neutral' ? 0.1 : 0.45,
      valid_frames: 9,
      missing_face_ratio: 0.05,
      engagement: { focus_score: Math.max(0, Math.min(1, person.focus + (random() - 0.5) * 0.3)) },
      model_name: 'synthetic-demo',
    });
  }

  // Typing episodes on the essay.
  let graphemes = 0;
  const episodes = 2 + Math.floor(random() * 2);
  for (let e = 0; e < episodes; e += 1) {
    clock += 20_000 + Math.floor(random() * 40_000);
    const reporter = createTypingEditReporter({
      aggregator: new TypingAggregator({ now: wall, onEvent: record }),
      targetKind: 'document_editor',
      targetId: 'essay',
      now: () => clock,
      wallClockNow: wall,
      onWindow: (window) =>
        out.signalWindows.push({
          ...window,
          ...identity,
          window_id: `${sessionId}-t${e}`,
          capture_id: `cap-${sessionId}`,
        }),
    });
    reporter.start({ graphemes, words: Math.floor(graphemes / 6) });
    const edits = 60 + Math.floor(random() * 120);
    for (let i = 0; i < edits; i += 1) {
      const pause = random() < 0.07;
      clock += pause ? 2200 + Math.floor(random() * 4000) : person.pace * (0.6 + random() * 0.8);
      const deleting = graphemes > 4 && random() < person.revise;
      const before = graphemes;
      graphemes += deleting ? -1 : 1;
      reporter.reportEdit({
        inputType: deleting ? 'deleteContentBackward' : 'insertText',
        graphemesBefore: before,
        graphemesAfter: graphemes,
        wordsBefore: Math.floor(before / 6),
        wordsAfter: Math.floor(graphemes / 6),
        caretOffset: graphemes,
        boundaryContext: pause ? pick(random, BOUNDARIES) : 'mid_word',
      });
    }
    clock += 800;
    reporter.submit();

    // The document's own history, and a code run now and then.
    documentEdits.record({ state: 'insert', graphemes_added: edits, words_added: Math.floor(edits / 6) });
    if (random() < 0.5) {
      clock += 1500;
      documentEdits.record({ state: 'replace', source: 'ai', graphemes_added: 80, graphemes_removed: 60 });
    }
    if (random() < 0.6) {
      const runId = `${sessionId}-r${e}`;
      clock += 2000;
      codeRuns.started({ run_id: runId, language: 'r' });
      clock += 400 + Math.floor(random() * 3000);
      if (random() < 0.7) codeRuns.succeeded({ run_id: runId, language: 'r' });
      else codeRuns.failed({ run_id: runId, language: 'r', error_kind: 'runtime' });
    }
  }
}

/** Every record of the synthetic class: 2 groups, 6 people, 2–3 sessions each. */
export function buildSyntheticGroup() {
  const random = seeded(20261112);
  const out = { windows: [], signalWindows: [], signalEvents: [], logEvents: [] };
  for (const person of PEOPLE) {
    const sessions = 2 + Math.floor(random() * 2);
    for (let sessionIndex = 0; sessionIndex < sessions; sessionIndex += 1) {
      buildSession({ person, sessionIndex, random, out });
    }
  }
  return { records: out, className: CLASS.label };
}
