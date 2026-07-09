// The LESSONS room — the class as a course page. Styling is deliberately quiet:
// it rides the app's own design tokens (card / muted / border / primary — a
// restrained teal), so it's theme-aware and enterprise-plain rather than a
// rainbow of gradients. Lesson and survey CARDS share one contents list; a
// survey is just another item. Card and list views; teachers edit in place.
import { useEffect, useState } from 'react';
import {
  BookOpen, ArrowLeft, Clock, Layers, Check, ListChecks,
  LayoutGrid, List, Pencil, Plus, ChevronRight, Settings2, GraduationCap,
} from 'lucide-react';
import { LessonRoomView } from './LessonRoomView';
import { SurveyEmbed } from './components/survey';
import { resolveFileUrl } from './api/client';

function Hero({
  classMeta, lessonCount, surveyCount, done,
}) {
  const img = classMeta?.thumbnail ? resolveFileUrl(classMeta.thumbnail) : null;
  const meta = [
    classMeta?.teacherName ? classMeta.teacherName : null,
    `${lessonCount} lesson${lessonCount === 1 ? '' : 's'}`,
    surveyCount > 0 ? `${surveyCount} survey${surveyCount === 1 ? '' : 's'}` : null,
    done > 0 ? `${done} completed` : null,
  ].filter(Boolean).join('  ·  ');

  if (img) {
    return (
      <div className="relative overflow-hidden border-b border-border">
        <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/15" />
        <div className="relative mx-auto max-w-5xl px-6 pb-10 pt-16 lg:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/70">Course</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{classMeta?.name ?? 'Lessons'}</h1>
          <p className="mt-2 text-sm text-white/80">{meta}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="border-b border-border bg-gradient-to-b from-muted/50 to-background">
      <div className="mx-auto max-w-5xl px-6 pb-10 pt-14 lg:px-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Course</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{classMeta?.name ?? 'Lessons'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{meta}</p>
      </div>
    </div>
  );
}

// A neutral, square-ish icon tile — the same chrome for lessons and surveys.
function Tile({ children }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
      {children}
    </span>
  );
}

function EditLink({ href, label }) {
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className="rounded-lg p-1.5 text-muted-foreground/70 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Pencil className="h-3.5 w-3.5" />
    </a>
  );
}

export function LessonsRoom({
  lessons, surveys = [], classroomId = null, classMeta,
  onOpenTutor, completedIds, onMarkComplete, canEdit = false,
}) {
  const [open, setOpen] = useState(null);
  const [view, setView] = useState('cards');

  const itemCount = lessons.length + surveys.length;

  // A single lesson (and nothing else) IS the room; otherwise start at the cards.
  useEffect(() => {
    if (lessons.length === 1 && surveys.length === 0) setOpen({ kind: 'lesson', id: lessons[0].id });
  }, [lessons, surveys]);

  const backToContents = itemCount > 1 && (
    <button
      type="button"
      onClick={() => setOpen(null)}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> All contents
    </button>
  );

  if (open?.kind === 'lesson') {
    const lecture = lessons.find((l) => l.id === open.id);
    if (lecture) {
      return (
        <div className="min-h-full bg-background">
          {backToContents && (
            <div className="mx-auto max-w-4xl px-4 pt-4 sm:px-6 lg:px-8">{backToContents}</div>
          )}
          <LessonRoomView
            lecture={lecture}
            onOpenTutor={onOpenTutor}
            completed={completedIds.has(lecture.id)}
            onMarkComplete={() => onMarkComplete(lecture.id)}
          />
        </div>
      );
    }
  }

  if (open?.kind === 'survey' && classroomId) {
    return (
      <div className="min-h-full bg-background">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          {backToContents && <div className="mb-4">{backToContents}</div>}
          <SurveyEmbed surveyId={open.id} context="module" moduleId={classroomId} courseId={classroomId} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <Hero classMeta={classMeta} lessonCount={lessons.length} surveyCount={surveys.length} done={completedIds.size} />

      <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 lg:px-8">
        {/* Toolbar — iOS-style segmented view switch; teachers author from here. */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-muted p-0.5">
            {(['cards', 'list']).map((v) => {
              const Icon = v === 'cards' ? LayoutGrid : List;
              const active = view === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {v}
                </button>
              );
            })}
          </div>
          {canEdit && classroomId && (
            <div className="flex items-center gap-2">
              <a
                href={`/classes/${classroomId}/lessons/new`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" /> New lesson
              </a>
              <a
                href={`/classes/${classroomId}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Settings2 className="h-3.5 w-3.5" /> Manage class
              </a>
            </div>
          )}
        </div>

        {itemCount === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <GraduationCap className="h-7 w-7" />
            </span>
            <p className="mt-4 text-base font-semibold text-foreground">No course content here</p>
            <p className="mt-1 text-sm text-muted-foreground">This course doesn&apos;t have any lessons or surveys yet.</p>
          </div>
        ) : view === 'cards' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {lessons.map((l) => {
              const sections = l.sections?.length ?? 0;
              const done = completedIds.has(l.id);
              return (
                <div
                  key={`lesson-${l.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen({ kind: 'lesson', id: l.id })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen({ kind: 'lesson', id: l.id }); }}
                  className="group cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-foreground/15 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start gap-4">
                    <Tile>
                      <BookOpen className="h-5 w-5" />
                    </Tile>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-foreground">{l.title}</h3>
                        {done && <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Completed" />}
                      </div>
                      {l.description && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{l.description}</p>
                      )}
                      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Layers className="h-3.5 w-3.5" /> {sections} section{sections === 1 ? '' : 's'}
                        </span>
                        {l.duration ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" /> {l.duration} min
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {canEdit && classroomId && (
                      <EditLink href={`/classes/${classroomId}/lessons/${l.id}/edit`} label="Edit lesson" />
                    )}
                  </div>
                </div>
              );
            })}

            {surveys.map((cs) => {
              const q = cs.survey._count?.questions ?? 0;
              return (
                <div
                  key={`survey-${cs.survey.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen({ kind: 'survey', id: cs.survey.id })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen({ kind: 'survey', id: cs.survey.id }); }}
                  className="group cursor-pointer rounded-xl border border-border bg-card p-5 transition-all hover:border-foreground/15 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start gap-4">
                    <Tile>
                      <ListChecks className="h-5 w-5" />
                    </Tile>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate font-semibold text-foreground">{cs.survey.title}</h3>
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Survey
                        </span>
                      </div>
                      {cs.survey.description && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{cs.survey.description}</p>
                      )}
                      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <ListChecks className="h-3.5 w-3.5" /> {q} question{q === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                    {canEdit && classroomId && (
                      <EditLink href={`/surveys/manage?classroomId=${classroomId}`} label="Edit survey" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {lessons.map((l) => {
              const sections = l.sections?.length ?? 0;
              const done = completedIds.has(l.id);
              return (
                <li key={`lesson-${l.id}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpen({ kind: 'lesson', id: l.id })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen({ kind: 'lesson', id: l.id }); }}
                    className="group flex cursor-pointer items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:bg-muted/50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <BookOpen className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{l.title}</span>
                        {done && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Completed" />}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {sections} section{sections === 1 ? '' : 's'}{l.duration ? ` · ${l.duration} min` : ''}
                      </span>
                    </span>
                    {canEdit && classroomId && (
                      <EditLink href={`/classes/${classroomId}/lessons/${l.id}/edit`} label="Edit lesson" />
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  </div>
                </li>
              );
            })}
            {surveys.map((cs) => {
              const q = cs.survey._count?.questions ?? 0;
              return (
                <li key={`survey-${cs.survey.id}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpen({ kind: 'survey', id: cs.survey.id })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen({ kind: 'survey', id: cs.survey.id }); }}
                    className="group flex cursor-pointer items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:bg-muted/50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <ListChecks className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{cs.survey.title}</span>
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Survey
                        </span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {q} question{q === 1 ? '' : 's'}
                      </span>
                    </span>
                    {canEdit && classroomId && (
                      <EditLink href={`/surveys/manage?classroomId=${classroomId}`} label="Edit survey" />
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
