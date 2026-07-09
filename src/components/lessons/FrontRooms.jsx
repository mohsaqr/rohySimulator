// The front page's two rooms — rohy's model on the landing surface. The dock
// always shows exactly two divisions: the AGENT (the chat — default room, you
// always land here) and LESSONS (one lesson fills the room; several stack as
// pills). The chat column is passed in as children and stays MOUNTED but
// hidden while reading lessons, so the sensing runtime keeps its single
// lifecycle and windows keep flowing.
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, MessageCircle } from 'lucide-react';
import { toast } from './toastShim';
import RoomNavigator from './rohy/RoomNavigator';
import { LessonsRoom } from './LessonsRoom';
import { coursesApi } from './api/courses';
import { surveysApi } from './api/surveys';

// rohy accents: rose = the conversation room, emerald = the lesson room.
const AGENT_ACCENT = {
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

/** Candidate classes for the lessons room: the active agent's classes first,
 *  then every other class the user is enrolled in or owns; first one that
 *  actually has lessons wins. */
async function candidateClasses(agentId) {
  const withAgent = [];
  const rest = [];
  const seen = new Set();
  for (const url of ['/api/classrooms/mine', '/api/classrooms']) {
    try {
      const d = await fetch(url).then((r) => r.json());
      for (const c of (d.classrooms ?? [])) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        // /api/classrooms 403s for learners, so success means "I teach this".
        c.owned = url === '/api/classrooms';
        (agentId && c.agents?.some((a) => a.id === agentId) ? withAgent : rest).push(c);
      }
    } catch {
      // endpoint not available for this role — keep going
    }
  }
  return [...withAgent, ...rest];
}

export function FrontRooms({
  agentId,
  agentName,
  children,
}) {
  // Always land in the agent room.
  const [room, setRoom] = useState('chat');
  const [lessons, setLessons] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [classMeta, setClassMeta] = useState(null);
  const [completedIds, setCompletedIds] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    setLessons([]);
    setSurveys([]);
    setClassMeta(null);
    void (async () => {
      for (const cls of await candidateClasses(agentId)) {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/courses/modules/${cls.id}/lectures`);
          if (!res.ok) continue;
          const d = await res.json();
          const rows = d.data ?? [];
          // Class surveys ride along (published only — LAILA filters the same
          // way on its module page); a class with only a survey still wins.
          let published = [];
          try {
            published = (await surveysApi.getModuleSurveys(cls.id)).filter((s) => s.survey.isPublished);
          } catch {
            // surveys unavailable — lessons alone decide
          }
          if (rows.length > 0 || published.length > 0) {
            if (!cancelled) {
              setLessons(rows);
              setSurveys(published);
              setClassMeta(cls);
            }
            return;
          }
        } catch {
          // try the next candidate
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // Surveys are items INSIDE the lessons room, so the dock stays two divisions.
  const itemCount = lessons.length + surveys.length;
  const rooms = useMemo(
    () => [
      { key: 'chat', label: agentName ?? 'Tutor', sub: 'chat', ...AGENT_ACCENT },
      {
        key: 'lessons',
        label: 'Lessons',
        sub: surveys.length > 0 ? `${itemCount} items` : lessons.length === 1 ? 'lesson' : `${lessons.length} lessons`,
        ...LESSONS_ACCENT,
      },
    ],
    [agentName, lessons.length, surveys.length, itemCount]
  );

  const markComplete = (lectureId) => {
    void coursesApi
      .markLectureComplete(lectureId)
      .then(() => {
        setCompletedIds((prev) => new Set(prev).add(lectureId));
        toast.success('Lesson completed');
      })
      .catch((e) => toast.error(e.message));
  };

  return (
    <>
      {/* Agent room — the chat, mounted always, hidden while in lessons. */}
      <div className={room === 'chat' ? 'contents' : 'hidden'}>{children}</div>

      {room === 'lessons' && (
        <div className="w-full">
          <LessonsRoom
            lessons={lessons}
            surveys={surveys}
            classroomId={classMeta?.id ?? null}
            classMeta={classMeta}
            onOpenTutor={() => setRoom('chat')}
            completedIds={completedIds}
            onMarkComplete={markComplete}
            canEdit={Boolean(classMeta?.owned)}
          />
        </div>
      )}

      {/* In-flow spacer — reserves the bottom 72px so content clears the dock. */}
      <div className="h-[72px]" aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-40">
        <RoomNavigator
          rooms={rooms}
          currentRoom={room}
          onSelectRoom={(key) => setRoom(key)}
        />
      </div>
    </>
  );
}
