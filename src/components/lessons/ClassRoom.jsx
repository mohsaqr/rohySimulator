// The class ROOM experience — rohy's in-session model applied to a chatoyon
// class, with exactly TWO divisions on the bottom dock:
//   • the TUTOR (the class agent's chat — the DEFAULT room, you always land
//     here), hosting the real ChatShell (sensing, voice, analytics — the
//     Conversation spine intact), kept mounted-but-hidden across hops so the
//     sensing runtime keeps its single lifecycle;
//   • the LESSONS — the class contents as a course page (lesson AND survey
//     cards in one list; card/list views; teachers edit in place) (LessonsRoom).
// One navigateToRoom() entry point records every hop (rohy: roomChanged →
// here POST /api/courses/rooms/event → audit trail → Activity log).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, MessageCircle, X, Loader2 } from 'lucide-react';
import { toast } from './toastShim';
// TODO(mount): these are chatoyon app-level integrations (Tutor chat room).
// rohy has no `@/components/chat/ChatShell` or `@/lib/agents/client` — the
// mounting layer must provide/point these before ClassRoom's Tutor room works.
import { ChatShell } from '@/components/chat/ChatShell';
import { useAgents } from '@/lib/agents/client';
import RoomNavigator from './rohy/RoomNavigator';
import { LessonsRoom } from './LessonsRoom';
import { coursesApi } from './api/courses';
import { surveysApi } from './api/surveys';

// rohy accents: rose = the conversation room, emerald = the lesson room.
const TUTOR_ACCENT = {
  icon: MessageCircle,
  iconText: 'text-rose-300',
  activeText: 'text-rose-200',
  activeBg: 'bg-rose-500/15',
  activeRing: 'ring-rose-500/30',
  activeBar: 'bg-rose-400',
};
const LESSONS_ACCENT = {
  icon: BookOpen,
  iconText: 'text-emerald-300',
  activeText: 'text-emerald-200',
  activeBg: 'bg-emerald-500/15',
  activeRing: 'ring-emerald-500/30',
  activeBar: 'bg-emerald-400',
};
// TODO(mount): onNavigate is injected by the mounting layer to perform real
// navigation (was next/navigation router.push).
export function ClassRoom({ classroomId, onNavigate = () => {} }) {
  const { agents, fetchAgents } = useAgents();

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const { data: lessons, isLoading } = useQuery({
    queryKey: ['class-lessons', classroomId],
    // Server-side visibility: learners get published lessons only.
    queryFn: () => coursesApi.getLectures(classroomId),
  });

  const { data: surveys } = useQuery({
    queryKey: ['class-surveys', classroomId],
    // Published only — LAILA filters the same way on its module page.
    queryFn: async () =>
      (await surveysApi.getModuleSurveys(classroomId)).filter(
        (s) => s.survey.isPublished
      ),
  });

  // Resolve the class's default tutor: enrolled learners via /classrooms/mine,
  // educators previewing their own class via the owned agents route. The same
  // fetch yields the course-page hero meta (name/teacher/thumbnail).
  const [tutorId, setTutorId] = useState(null);
  const [classMeta, setClassMeta] = useState(null);
  // Owned-class detail resolving means the viewer teaches this class.
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/classrooms/mine');
        const d = await r.json();
        const cls = (d.classrooms ?? []).find((c) => c.id === classroomId);
        if (cls && !cancelled) setClassMeta({ name: cls.name, teacherName: cls.teacherName, thumbnail: cls.thumbnail });
        const def = cls?.agents?.find((a) => a.isDefault) ?? cls?.agents?.[0];
        if (def && !cancelled) {
          setTutorId(def.id);
          return;
        }
      } catch {
        // fall through to the owned-class path
      }
      try {
        const r = await fetch(`/api/classrooms/${classroomId}/agents`);
        const d = await r.json();
        const def = (d.agents ?? []).find((a) => a.isDefault) ?? (d.agents ?? [])[0];
        if (def && !cancelled) setTutorId(def.id);
        // Owned-class preview: hero meta from the class detail.
        const det = await fetch(`/api/classrooms/${classroomId}`).then((res) => res.json());
        if (det?.classroom && !cancelled) {
          setClassMeta({ name: det.classroom.name, thumbnail: det.classroom.thumbnail ?? null });
          setCanEdit(true);
        }
      } catch {
        // no tutor resolvable — the Tutor room will show a hint
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classroomId]);

  const tutorAgent = agents.find((a) => a.id === tutorId) ?? null;

  // Surveys are items INSIDE the lessons room, so the dock stays two divisions.
  const lessonCount = lessons?.length ?? 0;
  const surveyCount = surveys?.length ?? 0;
  const rooms = useMemo(
    () => [
      { key: 'tutor', label: tutorAgent?.displayName ?? 'Tutor', sub: 'chat', ...TUTOR_ACCENT },
      {
        key: 'lessons',
        label: 'Lessons',
        sub: surveyCount > 0 ? `${lessonCount + surveyCount} items` : lessonCount === 1 ? 'lesson' : `${lessonCount} lessons`,
        ...LESSONS_ACCENT,
      },
    ],
    [tutorAgent, lessonCount, surveyCount]
  );

  // Always land in the agent room.
  const [currentRoom, setCurrentRoom] = useState('tutor');

  // Entering the class room is itself a recorded event.
  useEffect(() => {
    void fetch('/api/courses/rooms/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classroomId, room: 'tutor' }),
    }).catch(() => {});
  }, [classroomId]);

  // Single entry point for every room transition (rohy App.jsx navigateToRoom).
  const navigateToRoom = useCallback(
    (target) => {
      setCurrentRoom((prev) => {
        if (target === prev) return prev;
        void fetch('/api/courses/rooms/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classroomId, room: target }),
        }).catch(() => {});
        return target;
      });
    },
    [classroomId]
  );

  const [completedIds, setCompletedIds] = useState(new Set());
  const markComplete = useCallback((lectureId) => {
    void coursesApi
      .markLectureComplete(lectureId)
      .then(() => {
        setCompletedIds((prev) => new Set(prev).add(lectureId));
        toast.success('Lesson completed');
      })
      .catch((e) => toast.error(e.message));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Slim top bar — class exit only; the rooms own the rest of the screen. */}
      <div className="flex items-center justify-end border-b border-border px-3 py-1.5">
        <button
          type="button"
          onClick={() => onNavigate('/classes')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Exit
        </button>
      </div>

      {/* Room content — bottom 72px reserved for the always-visible navigator. */}
      <div className="flex-1 overflow-y-auto">
        {currentRoom === 'lessons' &&
          (isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <LessonsRoom
              lessons={lessons ?? []}
              surveys={surveys ?? []}
              classroomId={classroomId}
              classMeta={classMeta}
              onOpenTutor={() => navigateToRoom('tutor')}
              completedIds={completedIds}
              onMarkComplete={markComplete}
              canEdit={canEdit}
            />
          ))}

        {/* Tutor room — kept mounted (hidden) so the sensing runtime keeps its
            single lifecycle and windows keep flowing while lessons are read. */}
        <div className={currentRoom === 'tutor' ? 'mx-auto flex h-full w-full max-w-3xl flex-col px-4' : 'hidden'}>
          {tutorAgent ? (
            <ChatShell agentId={tutorAgent.id} agentVoice={tutorAgent.voice ?? null} agent={tutorAgent} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              This class has no tutor assigned yet.
            </div>
          )}
        </div>
      </div>

      <RoomNavigator rooms={rooms} currentRoom={currentRoom} onSelectRoom={navigateToRoom} />
    </div>
  );
}
