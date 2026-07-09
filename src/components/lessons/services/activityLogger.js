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
  EventLogger.log(verb, objectType, {
    objectId: objectId != null ? String(objectId) : undefined,
    objectName: objectTitle,
    component: LESSONS_COMPONENT,
    durationMs: duration != null ? Math.round(duration * 1000) : undefined,
    context: rest,
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
    EventLogger.log(VERBS.SUBMITTED, OBJECT_TYPES.COMPONENT, {
      objectId: String(surveyId),
      objectName: surveyTitle,
      component: LESSONS_COMPONENT,
      context: { surface: 'survey', courseId, ...extra },
    });
  },
  logSurveyViewed: async (surveyId, surveyTitle, courseId) =>
    logView(surveyTitle || 'survey', surveyId, { surface: 'survey', courseId }),
  logSurveyCreated: async (surveyId, surveyTitle, courseId) => {
    EventLogger.log(VERBS.CREATED || 'CREATED', OBJECT_TYPES.COMPONENT, {
      objectId: String(surveyId),
      objectName: surveyTitle,
      component: LESSONS_COMPONENT,
      context: { surface: 'survey-manager', action: 'created', courseId },
    });
  },
  logSurveyUpdated: async (surveyId, surveyTitle, courseId) => {
    EventLogger.log(VERBS.UPDATED || 'UPDATED', OBJECT_TYPES.COMPONENT, {
      objectId: String(surveyId),
      objectName: surveyTitle,
      component: LESSONS_COMPONENT,
      context: { surface: 'survey-manager', action: 'updated', courseId },
    });
  },
  logSurveyManagerViewed: async (courseId) =>
    logView('survey-manager', courseId, { surface: 'survey-manager', courseId }),
  logSurveyResponsesViewed: async (surveyId, courseId) =>
    logView('survey-responses', surveyId, { surface: 'survey-responses', courseId }),
};

export default activityLogger;
