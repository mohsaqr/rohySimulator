// LessonAuthoring — rohy mount glue for the ported lesson + survey editors.
// Rendered inside ConfigPanel's "Lessons" tab (educators). Picks one of the
// teacher's cohorts (courses), then lets them build lessons (LectureEditor) and
// surveys (SurveyManager) scoped to it. Wraps everything in the react-query
// island the vendored editors need.
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ClipboardList, Plus, ChevronLeft, Pencil } from 'lucide-react';
import { LessonsQueryProvider } from './LessonsQueryProvider';
import { LectureEditor } from './pages/teach/LectureEditor';
import { SurveyManager } from './pages/teach/SurveyManager';
import { SurveyResponses } from './pages/teach/SurveyResponses';
import { coursesApi } from './api/courses';
import { listCohorts, listCaseAssignments, assignCaseCourse } from '../../services/cohortsService';

// LectureEditor delegates navigation to onDone(url). After a create it pushes
// `/classes/:c/lessons/:id/edit`; on delete/save-existing it pushes `/classes`.
// Parse the lesson id out to keep editing, else drop back to the list.
const LESSON_ID_RE = /\/lessons\/(\d+)\/edit/;

function AuthoringInner() {
  const { t } = useTranslation('authoring_lessons');
  const [cohorts, setCohorts] = useState([]);
  const [cohortId, setCohortId] = useState(null);
  const [tab, setTab] = useState('lessons');           // 'lessons' | 'surveys'
  const [lessons, setLessons] = useState([]);
  const [editing, setEditing] = useState(false);        // false = list; { id } or { id: null } = editor
  const [responsesFor, setResponsesFor] = useState(null);
  const [error, setError] = useState(null);
  // Case↔course assignments: [{caseId, caseName, cohortId, cohortName}].
  // cohortId null = unassigned case. Loaded once, refreshed after each PUT.
  const [assignments, setAssignments] = useState([]);
  const [assignBusy, setAssignBusy] = useState(false);

  const loadAssignments = useCallback(() => {
    listCaseAssignments()
      .then((res) => setAssignments(Array.isArray(res) ? res : res?.data || []))
      .catch(() => setAssignments([]));
  }, []);

  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  // The case currently assigned to the selected course (first match).
  const assignedCase = assignments.find((a) => a.cohortId === cohortId) || null;

  const onAssignedCaseChange = async (value) => {
    const newCaseId = value === '' ? null : Number(value);
    if (assignBusy || (assignedCase?.caseId ?? null) === newCaseId) return;
    setAssignBusy(true);
    try {
      // Detach the previously assigned case first so the course keeps a
      // single case, then attach the newly picked one (server moves it if
      // it belonged to another course).
      if (assignedCase && assignedCase.caseId !== newCaseId) {
        await assignCaseCourse(assignedCase.caseId, null);
      }
      if (newCaseId != null) await assignCaseCourse(newCaseId, cohortId);
    } catch (e) {
      setError(e.message || 'Failed to assign case');
    } finally {
      setAssignBusy(false);
      loadAssignments();
    }
  };

  useEffect(() => {
    let alive = true;
    listCohorts()
      .then((res) => {
        if (!alive) return;
        const list = Array.isArray(res) ? res : res?.cohorts || [];
        setCohorts(list);
        if (list.length && cohortId == null) setCohortId(list[0].id);
      })
      .catch((e) => alive && setError(e.message || 'Failed to load courses'));
    return () => { alive = false; };
  }, [cohortId]);

  const loadLessons = useCallback(() => {
    if (cohortId == null) return;
    coursesApi.getLectures(cohortId).then(setLessons).catch(() => setLessons([]));
  }, [cohortId]);

  useEffect(() => { loadLessons(); }, [loadLessons]);

  const onDone = (to) => {
    const m = LESSON_ID_RE.exec(String(to || ''));
    if (m) setEditing({ id: Number(m[1]) });
    else { setEditing(false); loadLessons(); }
  };
  const backToList = () => { setEditing(false); loadLessons(); };

  if (cohorts.length === 0) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        {error || t('no_courses', { defaultValue: 'Create a course first — lessons attach to a course.' })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Course selector + section tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">{t('course_label', { defaultValue: 'Course' })}</span>
          <select
            value={cohortId ?? ''}
            onChange={(e) => { setCohortId(Number(e.target.value)); setEditing(false); setResponsesFor(null); }}
            className="rohy-input rounded-lg border border-neutral-300 px-2 py-1 text-sm"
          >
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">{t('assigned_case_label', { defaultValue: 'Assigned case' })}</span>
          <select
            value={assignedCase?.caseId ?? ''}
            onChange={(e) => onAssignedCaseChange(e.target.value)}
            disabled={assignBusy}
            className="rohy-input rounded-lg border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50"
          >
            <option value="">{t('assigned_case_none', { defaultValue: '— none —' })}</option>
            {assignments.map((a) => (
              <option key={a.caseId} value={a.caseId}>
                {a.caseName}
                {a.cohortId != null && a.cohortId !== cohortId
                  ? ` (${t('assigned_case_was', { defaultValue: 'was: {{course}}', course: a.cohortName })})`
                  : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="inline-flex rounded-xl bg-neutral-100 p-0.5">
          {[['lessons', BookOpen, t('tab_lessons', { defaultValue: 'Lessons' })],
            ['surveys', ClipboardList, t('tab_surveys', { defaultValue: 'Surveys' })]].map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setTab(key); setEditing(false); setResponsesFor(null); }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === key ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Lessons */}
      {tab === 'lessons' && (
        editing ? (
          <div>
            <button type="button" onClick={backToList}
              className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900">
              <ChevronLeft className="h-4 w-4" /> {t('all_lessons', { defaultValue: 'All lessons' })}
            </button>
            <LectureEditor
              classroomId={cohortId}
              lectureId={editing.id ?? undefined}
              onDone={onDone}
              onBack={backToList}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <button type="button" onClick={() => setEditing({ id: null })}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--rohy-accent,#0f766e)] px-3.5 py-2 text-xs font-medium text-white hover:opacity-90">
                <Plus className="h-3.5 w-3.5" /> {t('new_lesson', { defaultValue: 'New lesson' })}
              </button>
            </div>
            {lessons.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500">
                {t('no_lessons', { defaultValue: 'No lessons yet. Create the first one.' })}
              </div>
            ) : (
              <ul className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200">
                {lessons.map((l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => setEditing({ id: l.id })}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50">
                      <BookOpen className="h-4 w-4 text-neutral-400" />
                      <span className="flex-1 truncate text-sm font-medium text-neutral-800">{l.title}</span>
                      {!l.isPublished && (
                        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                          {t('draft', { defaultValue: 'Draft' })}
                        </span>
                      )}
                      <Pencil className="h-3.5 w-3.5 text-neutral-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}

      {/* Surveys */}
      {tab === 'surveys' && (
        responsesFor ? (
          <SurveyResponses surveyId={responsesFor} classroomId={cohortId} onBack={() => setResponsesFor(null)} />
        ) : (
          <SurveyManager classroomId={cohortId} onViewResponses={setResponsesFor} />
        )
      )}
    </div>
  );
}

export default function LessonAuthoring() {
  return (
    <LessonsQueryProvider>
      <AuthoringInner />
    </LessonsQueryProvider>
  );
}
