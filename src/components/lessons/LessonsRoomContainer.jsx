// LessonsRoomContainer — the student-facing lessons room for ONE course, the
// one tied to the active case (one case ⇄ one course; no course picker). Opened
// from the black "Course" card in the room nav; returns to the simulation.
// Fetches the course's published lessons + attached surveys + the caller's
// completion state and hands them to the vendored LessonsRoom.
import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, GraduationCap } from 'lucide-react';
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

function RoomInner({ cohortId, cohortName, caseId, sessionId, onBackToSimulation }) {
  const { t } = useTranslation('authoring_lessons');
  const [lessons, setLessons] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [completedIds, setCompletedIds] = useState(new Set());

  const load = useCallback(async () => {
    if (cohortId == null) return;
    const [ls, svs, prog] = await Promise.all([
      coursesApi.getLectures(cohortId, { includeSections: true }).catch(() => []),
      surveysApi.getModuleSurveys(cohortId).catch(() => []),
      apiFetch(`/courses/modules/${cohortId}/progress`).then((r) => r?.data || []).catch(() => []),
    ]);
    // ?include=sections batches the lesson bodies server-side (one query).
    // Fallback: if a lesson still arrives without sections (older server),
    // hydrate it individually so the room never opens an empty lesson.
    // A locked lesson has no sections by design — asking for it is refused.
    const full = await Promise.all(
      ls.map((l) => (l.locked || Array.isArray(l.sections)
        ? l
        : coursesApi.getLectureById(l.id).catch(() => l)))
    );
    setLessons(full);
    setSurveys(svs);
    setCompletedIds(new Set(prog));
  }, [cohortId]);

  useEffect(() => { load(); }, [load]);

  // A lesson locked behind the case's course gate arrives as a title only
  // (server/routes/lessons-routes.js); the case panel lists it, the vendored
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
        {cohortId == null ? (
          <div className="rounded-2xl px-6 py-16 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200">
              <GraduationCap className="h-7 w-7" />
            </span>
            <p className="mt-4 text-base font-semibold text-slate-900">
              {t('no_course_for_case', { defaultValue: 'No course content here' })}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {t('no_course_for_case_sub', { defaultValue: 'This case is not linked to a course yet.' })}
            </p>
          </div>
        ) : (
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
