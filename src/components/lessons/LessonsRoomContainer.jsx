// LessonsRoomContainer — the student-facing lessons room for ONE course, the
// one tied to the active case (one case ⇄ one course; no course picker). Opened
// from the black "Course" card in the room nav; returns to the simulation.
// Fetches the course's published lessons + attached surveys + the caller's
// completion state and hands them to the vendored LessonsRoom.
//
// A failed request is never shown as an empty course (FI-0010 F18): loading,
// failure (with Retry) and "this course has nothing yet" are three different
// screens. A refresh that fails keeps the content already on screen.
import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, GraduationCap, AlertTriangle, RotateCw } from 'lucide-react';
import { LessonsQueryProvider } from './LessonsQueryProvider';
import { LessonsRoom } from './LessonsRoom';
import { coursesApi } from './api/courses';
import { surveysApi } from './api/surveys';
import { apiFetch } from '../../services/apiClient';
import EventLogger, { VERBS, OBJECT_TYPES } from '../../services/eventLogger';
import AoiRegion from '../oyon/AoiRegion';
import CaseCoursePanel from '../course/CaseCoursePanel';

// The chatbot block is deferred, so no lesson jumps to a tutor; a no-op keeps
// the vendored LessonRoomView happy if a legacy chatbot section ever appears.
const noop = () => {};

// What went wrong, in words a learner can act on. Permission and "offline" are
// told apart only when the request itself says so.
function loadErrorMessage(t, err) {
  const status = err?.status;
  if (status === 0) {
    return t('course_load_offline', { defaultValue: 'The course could not be loaded because the server could not be reached. Check your connection and try again.' });
  }
  if (status === 401 || status === 403 || status === 404) {
    return t('course_load_forbidden', { defaultValue: 'This course’s content is not available to you. If you think it should be, ask your teacher.' });
  }
  return t('course_load_failed', { defaultValue: 'The course could not be loaded. Try again.' });
}

function LoadFailed({ message, onRetry, compact = false }) {
  const { t } = useTranslation('authoring_lessons');
  return (
    <div
      role="alert"
      className={compact
        ? 'mx-auto mt-4 flex max-w-5xl items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'
        : 'mx-auto max-w-xl rounded-2xl px-6 py-16 text-center'}
      data-testid="course-load-error"
    >
      {!compact && (
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-200">
          <AlertTriangle className="h-7 w-7" />
        </span>
      )}
      <p className={compact ? 'flex-1' : 'mt-4 text-base font-semibold text-slate-900'}>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 ${compact ? '' : 'mt-4'}`}
      >
        <RotateCw className="h-4 w-4" /> {t('course_load_retry', { defaultValue: 'Try again' })}
      </button>
    </div>
  );
}

function RoomInner({ cohortId: cohortIdProp, cohortName: cohortNameProp, caseId, sessionId, onBackToSimulation }) {
  const { t } = useTranslation('authoring_lessons');
  const [lessons, setLessons] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [completedIds, setCompletedIds] = useState(new Set());

  // The case → course lookup. The host passes a course when it has one; when
  // it does not (none, or its own lookup failed), ask the server here — for
  // the course itself, or for why there is none, so a student who is simply
  // not enrolled is told that, instead of "not linked to a course yet".
  // Starts as 'loading' when a lookup is due, so "no course" never flashes
  // before the server has answered.
  const [lookup, setLookup] = useState(() => ({
    status: cohortIdProp == null && caseId != null ? 'loading' : 'idle',
    cohortId: null, cohortName: null, reason: null, error: null,
  }));
  const lookupSeq = useRef(0);
  const resolveCourse = useCallback(() => {
    if (cohortIdProp != null || caseId == null) {
      setLookup({ status: 'idle', cohortId: null, cohortName: null, reason: null, error: null });
      return;
    }
    const seq = ++lookupSeq.current;
    setLookup((prev) => ({ ...prev, status: 'loading', error: null }));
    apiFetch(`/courses/for-case/${caseId}`)
      .then((r) => {
        if (seq !== lookupSeq.current) return;
        setLookup({
          status: 'ready',
          cohortId: r?.data?.cohortId ?? null,
          cohortName: r?.data?.cohortName ?? null,
          reason: r?.data?.reason ?? null,
          error: null,
        });
      })
      .catch((err) => {
        if (seq !== lookupSeq.current) return;
        console.error('[LessonsRoomContainer] course lookup failed', err);
        setLookup({ status: 'error', cohortId: null, cohortName: null, reason: null, error: err });
      });
  }, [cohortIdProp, caseId]);
  useEffect(() => { resolveCourse(); }, [resolveCourse]);

  const cohortId = cohortIdProp ?? lookup.cohortId;
  const cohortName = cohortNameProp ?? lookup.cohortName;
  const notEnrolled = lookup.reason === 'not_enrolled';

  // The course content. `loaded` says whether what is on screen came from the
  // server, so a failed refresh keeps it and a failed first load says so.
  const [content, setContent] = useState({ status: 'idle', error: null, loaded: false });
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (cohortId == null) return;
    const seq = ++loadSeq.current;
    setContent((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const [ls, svs, prog] = await Promise.all([
        coursesApi.getLectures(cohortId, { includeSections: true }),
        surveysApi.getModuleSurveys(cohortId),
        apiFetch(`/courses/modules/${cohortId}/progress`).then((r) => r?.data || []),
      ]);
      // ?include=sections batches the lesson bodies server-side (one query).
      // Fallback: if a lesson still arrives without sections (older server),
      // hydrate it individually so the room never opens an empty lesson.
      // A locked lesson has no sections by design — asking for it is refused.
      const full = await Promise.all(
        ls.map((l) => (l.locked || Array.isArray(l.sections)
          ? l
          : coursesApi.getLectureById(l.id)))
      );
      if (seq !== loadSeq.current) return;
      setLessons(full);
      setSurveys(svs);
      setCompletedIds(new Set(prog));
      setContent({ status: 'ready', error: null, loaded: true });
    } catch (err) {
      if (seq !== loadSeq.current) return;
      console.error('[LessonsRoomContainer] course content failed to load', err);
      setContent((prev) => ({ ...prev, status: 'error', error: err }));
    }
  }, [cohortId]);

  useEffect(() => { load(); }, [load]);

  // A lesson locked behind the case's course gate arrives without its title
  // (server/routes/lessons-routes.js); the case panel counts it, the vendored
  // room gets the open ones. When the gate opens, fetch the lessons again so
  // their content arrives.
  const openLessons = lessons.filter((l) => !l.locked);
  const lockedLessons = lessons.filter((l) => l.locked);
  const lastGate = useRef(null);
  const onGateChange = useCallback((unlocked) => {
    if (lastGate.current === false && unlocked) load();
    lastGate.current = unlocked;
  }, [load]);

  // One OPENED/CLOSED pair per course visit, matching how other rooms bracket
  // their surfaces in learning_events (the 'lessons' room tag is stamped by
  // App.jsx via EventLogger.roomChanged).
  useEffect(() => {
    if (cohortId == null) return undefined;
    EventLogger.panelOpened(OBJECT_TYPES.COURSE, String(cohortId), cohortName || `course-${cohortId}`, 'lessons');
    return () => EventLogger.panelClosed(OBJECT_TYPES.COURSE, String(cohortId), cohortName || `course-${cohortId}`, 'lessons');
  }, [cohortId, cohortName]);

  const onMarkComplete = async (lessonId) => {
    try {
      await coursesApi.markLectureComplete(lessonId);
      setCompletedIds((prev) => new Set(prev).add(lessonId));
      const lesson = lessons.find((l) => l.id === lessonId);
      // Marking a lecture complete is a submission on the lecture, not a
      // scenario completing (the verb it used to borrow).
      EventLogger.log(VERBS.SUBMITTED, OBJECT_TYPES.LECTURE, {
        objectId: String(lessonId),
        objectName: lesson?.title || `lesson-${lessonId}`,
        result: 'completed',
        component: 'lessons',
        context: { surface: 'lesson', cohortId },
      });
    } catch { /* toast handled by shim */ }
  };

  const backLabel = t('back_to_simulation', { defaultValue: 'Back to simulation' });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onBackToSimulation}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4" /> {backLabel}
        </button>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <GraduationCap className="h-4 w-4 text-teal-700" />
          <span className="font-medium text-slate-900">
            {cohortName || t('course', { defaultValue: 'Course' })}
          </span>
        </div>
      </div>
      {/* Gaze AOI: the whole lesson/survey content area — registered like
          chat_panel/patient_face so eye-tracking windows captured in the
          lessons room map fixations onto course content. */}
      <AoiRegion id="lesson_content" className="min-h-0 flex-1 overflow-auto">
        {caseId != null && (
          <div className="mx-auto max-w-5xl px-6 pt-6 lg:px-8">
            <CaseCoursePanel
              caseId={caseId}
              sessionId={sessionId}
              lockedLessons={lockedLessons}
              onGateChange={onGateChange}
            />
          </div>
        )}
        {cohortId == null && lookup.status === 'error' ? (
          <LoadFailed message={loadErrorMessage(t, lookup.error)} onRetry={resolveCourse} />
        ) : cohortId == null && lookup.status === 'loading' ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500" role="status">
            {t('course_loading', { defaultValue: 'Loading the course…' })}
          </div>
        ) : cohortId == null ? (
          <div className="rounded-2xl px-6 py-16 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200">
              <GraduationCap className="h-7 w-7" />
            </span>
            <p className="mt-4 text-base font-semibold text-slate-900">
              {notEnrolled
                ? t('not_enrolled_for_case', { defaultValue: "You are not enrolled in this case's course" })
                : t('no_course_for_case', { defaultValue: 'No course content here' })}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {notEnrolled
                ? t('not_enrolled_for_case_sub', { defaultValue: 'Its lessons and surveys appear here once your teacher adds you to the course.' })
                : t('no_course_for_case_sub', { defaultValue: 'This case is not linked to a course yet.' })}
            </p>
          </div>
        ) : !content.loaded && content.status === 'error' ? (
          <LoadFailed message={loadErrorMessage(t, content.error)} onRetry={load} />
        ) : !content.loaded ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500" role="status">
            {t('course_loading', { defaultValue: 'Loading the course…' })}
          </div>
        ) : (
          <>
            {content.status === 'error' && (
              <div className="px-6 lg:px-8">
                <LoadFailed compact message={loadErrorMessage(t, content.error)} onRetry={load} />
              </div>
            )}
            <LessonsRoom
              lessons={openLessons}
              surveys={surveys}
              classroomId={cohortId}
              classMeta={{ name: cohortName }}
              onOpenTutor={noop}
              completedIds={completedIds}
              onMarkComplete={onMarkComplete}
              canEdit={false}
            />
          </>
        )}
      </AoiRegion>
    </div>
  );
}

export default function LessonsRoomContainer({
  cohortId = null, cohortName = null, caseId = null, sessionId = null, onBackToSimulation = () => {},
}) {
  return (
    <LessonsQueryProvider>
      <RoomInner
        cohortId={cohortId}
        cohortName={cohortName}
        caseId={caseId}
        sessionId={sessionId}
        onBackToSimulation={onBackToSimulation}
      />
    </LessonsQueryProvider>
  );
}
