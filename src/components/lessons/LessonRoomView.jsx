// Lesson room content — the section renderer copied from LAILA-v3
// client/src/pages/LectureView.tsx (renderSection + renderMarkdown + its
// colors table, light values — chatoyon is light-only). The page chrome is
// NOT copied: in chatoyon the student meets a lesson as a ROOM (rohy model),
// so the room shell replaces LAILA's breadcrumb/sidebar page. Adaptations:
//   • assignment sections dropped (no assignment subsystem).
//   • a chatbot section renders an "Open tutor" card that jumps to the Tutor
//     ROOM with that section's class-assigned agent — NOT an inline chat.
//     One ChatShell per screen keeps the sensing runtime's single lifecycle
//     (camera/gaze cannot double-init) and the Conversation === session spine.
//   • TrackedContent (LAILA's analytics wrapper) is not copied; lesson-open/
//     complete/room-hop events are recorded server-side instead.
import { Upload, Bot, ChevronRight, CheckCircle2 } from 'lucide-react';
import { marked } from 'marked';
import { resolveFileUrl } from './api/client';
import { sanitizeHtml, isHtmlContent } from './utils/sanitize';
import { FileCard } from './components/course/FileCard';
import { LessonViewer } from './components/teach/lesson-editor';

// Parse markdown to HTML, then sanitize for XSS safety (LAILA verbatim).
const renderMarkdown = (content) => {
  const html = marked.parse(content, { async: false });
  return sanitizeHtml(html);
};

export function LessonRoomView({ lecture, onOpenTutor, completed, onMarkComplete }) {
  const renderSection = (section) => {
    switch (section.type) {
      case 'text':
      case 'ai-generated': {
        const isHtml = isHtmlContent(section.content ?? '');
        // Detect lesson nodes independently of isHtmlContent — content that
        // *starts* with a node (e.g. a video-first lesson) isn't matched by
        // the narrow isHtmlContent regex, but still must use LessonViewer so
        // the node renders instead of being stripped by sanitize/markdown.
        const containsLessonNodes =
          section.content?.includes('<lecture-file') ||
          section.content?.includes('<lecture-folder') ||
          section.content?.includes('<lecture-chatbot') ||
          section.content?.includes('<lecture-video') ||
          section.content?.includes('<lecture-mcq') ||
          section.content?.includes('<lecture-url') ||
          section.content?.includes('<lecture-embed');
        return (
          <div key={section.id} className="mb-8">
            {section.title && (
              <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {section.title}
              </h2>
            )}
            {section.content &&
              (containsLessonNodes ? (
                /* Use the read-only lesson editor so <lecture-video> and
                   <lecture-mcq> nodes render with their proper UI. */
                <div className="text-foreground">
                  <LessonViewer
                    html={section.content}
                    courseId={lecture.classroomId}
                    lectureId={lecture.id}
                    sectionId={section.id}
                  />
                </div>
              ) : (
                <div
                  className="prose max-w-none text-foreground dark:prose-invert prose-headings:tracking-tight"
                  dangerouslySetInnerHTML={{
                    __html: isHtml ? sanitizeHtml(section.content) : renderMarkdown(section.content),
                  }}
                />
              ))}
          </div>
        );
      }

      case 'file': {
        if (!section.fileUrl) {
          return (
            <div key={section.id} className="mb-8 rounded-xl border border-border bg-muted/40 p-6 text-center">
              <Upload className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No file uploaded</p>
            </div>
          );
        }
        return (
          <div key={section.id} className="mb-8">
            {section.title && (
              <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {section.title}
              </h2>
            )}
            <FileCard
              fileName={section.fileName || 'file'}
              fileType={section.fileType}
              url={resolveFileUrl(section.fileUrl)}
              fileSize={section.fileSize}
              description={section.content || undefined}
            />
          </div>
        );
      }

      case 'chatbot':
        return (
          <div key={section.id} className="mb-8">
            {section.title && (
              <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {section.title}
              </h2>
            )}
            <button
              type="button"
              onClick={() => onOpenTutor(section.agentConfigId)}
              className="group flex w-full items-center gap-3.5 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-foreground/15 hover:shadow-sm"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Bot className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {section.chatbotTitle || 'AI Tutor'}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {section.chatbotIntro || 'Open the tutor room to chat.'}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 md:py-10 lg:px-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {lecture.title}
          </h1>
          {lecture.description && (
            <p className="mt-1.5 text-sm text-muted-foreground">{lecture.description}</p>
          )}
        </div>
        {onMarkComplete && (
          <button
            type="button"
            disabled={completed}
            onClick={onMarkComplete}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
              completed
                ? 'cursor-default bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            {completed ? 'Completed' : 'Mark complete'}
          </button>
        )}
      </div>
      {[...(lecture.sections ?? [])].sort((a, b) => a.order - b.order).map(renderSection)}
    </div>
  );
}
