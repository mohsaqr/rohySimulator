// activityLogger — the lessons module's seam into rohy's real telemetry
// pipeline (src/services/eventLogger.js → /api/learning-events →
// learning_events). Vendored LAILA components and videoXapi call this with
// LAILA's xAPI-flavoured payload shape; each method maps that onto
// EventLogger.log(verb, objectType, options) so lesson/survey/video activity
// lands in the same unified event stream as every other room (the room tag
// is stamped automatically by EventLogger's context — 'lessons' while the
// course room is open, see App.jsx).
import EventLogger, { VERBS, OBJECT_TYPES } from '../../../services/eventLogger';

const LESSONS_COMPONENT = 'lessons';

// The xAPI Video Profile verbs videoXapi emits, mapped to the registry.
// videoXapi itself is untouched: its lowercase names and IRIs are provenance,
// kept in context.extensions; this seam is where they become rohy verbs.
// Until this map existed every one of these rows was rejected at ingest as
// `unknown_verb` — two months of video telemetry, gone.
const VIDEO_VERB_MAP = Object.freeze({
  initialized: [VERBS.OPENED_VIDEO],
  played: [VERBS.PLAYED_VIDEO],
  paused: [VERBS.PAUSED_VIDEO],
  seeked: [VERBS.SEEKED_VIDEO],
  'playback-rate-changed': [VERBS.CHANGED_VIDEO_SPEED],
  progressed: [VERBS.PROGRESSED_VIDEO],
  completed: [VERBS.COMPLETED_VIDEO],
  terminated: [VERBS.CLOSED_VIDEO, 'completed'],
  abandoned: [VERBS.CLOSED_VIDEO, 'abandoned'],
});

// videoXapi (and any future block) calls log() with a single object:
// { verb, objectType, objectId, objectTitle, courseId, lectureId, sectionId,
//   duration, progress, actionSubtype, extensions }. Everything that isn't a
// first-class learning_events column rides along in context.
const log = (event = {}) => {
  const {
    verb,
    objectType = 'component',
    objectId,
    objectTitle,
    duration,
    ...rest
  } = event;
  if (!verb) return;
  const mapped = VIDEO_VERB_MAP[verb];
  const canonical = mapped ? mapped[0] : verb;
  if (!VERBS[canonical]) {
    throw new Error(`activityLogger: '${verb}' is not a registered verb (add it to VIDEO_VERB_MAP or the registry)`);
  }
  EventLogger.log(canonical, mapped ? OBJECT_TYPES.VIDEO : objectType, {
    objectId: objectId != null ? String(objectId) : undefined,
    objectName: objectTitle,
    component: LESSONS_COMPONENT,
    durationMs: duration != null ? Math.round(duration * 1000) : undefined,
    result: mapped?.[1] ?? rest.result,
    context: mapped ? { ...rest, xapiVerb: verb } : rest,
  });
};

const logView = (name, id, context) => {
  EventLogger.log(VERBS.VIEWED, OBJECT_TYPES.COMPONENT, {
    objectId: id != null ? String(id) : name,
    objectName: name,
    component: LESSONS_COMPONENT,
    context,
  });
};

export const activityLogger = {
  log,
  logLectureEditorViewed: async (lectureId, lectureTitle, courseId) =>
    logView(lectureTitle || 'lecture-editor', lectureId, { surface: 'lecture-editor', courseId }),
  logSurveySubmitted: async (surveyId, surveyTitle, courseId, extra = {}) => {
    EventLogger.log(VERBS.SUBMITTED, OBJECT_TYPES.SURVEY, {
      objectId: String(surveyId),
      objectName: surveyTitle,
      component: LESSONS_COMPONENT,
      context: { surface: 'survey', courseId, ...extra },
    });
  },
  logSurveyViewed: async (surveyId, surveyTitle, courseId) =>
    logView(surveyTitle || 'survey', surveyId, { surface: 'survey', courseId }),
  // Authoring a survey is SAVED_CONTENT on a survey (result created|updated).
  // These used to emit CREATED / UPDATED, verbs the registry never had, so
  // both rows were rejected at ingest.
  logSurveyCreated: async (surveyId, surveyTitle, courseId) => {
    EventLogger.contentSaved(OBJECT_TYPES.SURVEY, surveyId, surveyTitle, LESSONS_COMPONENT, 'created');
    void courseId;
  },
  logSurveyUpdated: async (surveyId, surveyTitle, courseId) => {
    EventLogger.contentSaved(OBJECT_TYPES.SURVEY, surveyId, surveyTitle, LESSONS_COMPONENT, 'updated');
    void courseId;
  },
  logSurveyManagerViewed: async (courseId) =>
    logView('survey-manager', courseId, { surface: 'survey-manager', courseId }),
  logSurveyResponsesViewed: async (surveyId, courseId) =>
    logView('survey-responses', surveyId, { surface: 'survey-responses', courseId }),
};

export default activityLogger;
