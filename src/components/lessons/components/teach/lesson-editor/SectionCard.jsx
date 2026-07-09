import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, ArrowUp, ArrowDown, Trash2, Bot, ClipboardList } from 'lucide-react';
import { useTheme } from '../../../hooks/useTheme';
import { resolveFileUrl } from '../../../api/client';
import { SectionBodyEditor } from './SectionBodyEditor';
import { BlockCard } from './BlockCard';
import { FileCard } from '../../course/FileCard';

/**
 * One section of a lesson: a card with reorder handle/arrows, an inline
 * heading title, a delete control, and a type-switched body. Text sections
 * get the rich-text editor; chatbot/file/assignment sections render a compact
 * read-only summary (they're authored elsewhere and must not be clobbered).
 */
export const SectionCard = ({
  section, index, courseId, isFirst, isLast, onMoveUp, onMoveDown,
  isDragging, onDragStart, onDragOverRow, onDropRow, onDragEnd,
  onTitleCommit, onFileDescCommit, onRequestDelete, registerFlush,
}) => {
  const { t } = useTranslation(['teaching', 'common']);
  const { isDark } = useTheme();
  const [title, setTitle] = useState(section.title ?? '');
  const [fileDesc, setFileDesc] = useState(section.content ?? '');
  const [armed, setArmed] = useState(false);

  // Keep local fields in sync if the section changes externally.
  useEffect(() => { setTitle(section.title ?? ''); }, [section.title]);
  useEffect(() => { setFileDesc(section.content ?? ''); }, [section.content]);

  const colors = {
    cardBg: isDark ? '#0f172a' : '#ffffff',
    border: isDark ? '#334155' : '#e2e8f0',
    titleColor: isDark ? '#f1f5f9' : '#0f172a',
    muted: isDark ? '#94a3b8' : '#64748b',
    chipBg: isDark ? '#1e293b' : '#f1f5f9',
  };

  const isText = section.type === 'text' || section.type === 'ai-generated';

  // Non-text sections register a no-op flush so the parent's Promise.all is
  // uniform across all section cards.
  useEffect(() => {
    if (isText) return;
    registerFlush(async () => {});
    return () => registerFlush(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isText, section.id]);

  const summary = () => {
    if (section.type === 'chatbot') {
      return (
        <BlockCard
          icon={Bot}
          accent="violet"
          title={section.chatbotTitle || t('ai_agent', { defaultValue: 'AI agent' })}
          badge={t('agent_badge', { defaultValue: 'Agent' })}
        >
          <p className="text-sm" style={{ color: colors.muted }}>
            {section.chatbotIntro || t('agent_summary_hint', { defaultValue: 'Students chat with this AI agent in this section.' })}
          </p>
        </BlockCard>
      );
    }
    if (section.type === 'file') {
      return (
        <div className="space-y-2">
          <FileCard
            fileName={section.fileName || 'file'}
            fileType={section.fileType}
            url={section.fileUrl ? resolveFileUrl(section.fileUrl) : '#'}
            fileSize={section.fileSize}
            description={fileDesc || undefined}
          />
          <textarea
            value={fileDesc}
            onChange={e => setFileDesc(e.target.value)}
            onBlur={() => onFileDescCommit(fileDesc.trim())}
            rows={2}
            placeholder={t('file_description_placeholder', { defaultValue: 'Add a short description for this file (optional)…' })}
            className="w-full px-3 py-2 text-sm rounded-lg border outline-none focus:ring-2 focus:ring-teal-400 resize-none"
            style={{ backgroundColor: isDark ? '#1e293b' : '#ffffff', borderColor: colors.border, color: colors.titleColor }}
          />
        </div>
      );
    }
    // assignment / other
    return (
      <BlockCard icon={ClipboardList} accent="amber" title={t('assignment', { defaultValue: 'Assignment' })} badge={t('assignment_badge', { defaultValue: 'Task' })}>
        <p className="text-sm" style={{ color: colors.muted }}>
          {t('assignment_summary_hint', { defaultValue: 'An assignment embedded in this lesson.' })}
        </p>
      </BlockCard>
    );
  };

  return (
    <div
      draggable={armed}
      onDragStart={onDragStart}
      onDragOver={onDragOverRow}
      onDrop={() => { onDropRow(); setArmed(false); }}
      onDragEnd={() => { onDragEnd(); setArmed(false); }}
      className={`rounded-2xl border shadow-sm transition ${isDragging ? 'opacity-50 ring-2 ring-teal-300' : ''}`}
      style={{ backgroundColor: colors.cardBg, borderColor: colors.border }}
    >
      {/* Section header: grip + step number + title + reorder + delete */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: colors.border }}>
        <button
          type="button"
          aria-label={t('drag_to_reorder', { defaultValue: 'Drag to reorder' })}
          title={t('drag_to_reorder', { defaultValue: 'Drag to reorder' })}
          onMouseDown={() => setArmed(true)}
          onMouseUp={() => setArmed(false)}
          className="shrink-0 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded"
        >
          <GripVertical className="w-5 h-5" />
        </button>
        <span
          className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold"
          style={{ backgroundColor: colors.chipBg, color: colors.muted }}
        >
          {index + 1}
        </span>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => onTitleCommit(title.trim())}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
          placeholder={t('section_title_placeholder', { defaultValue: 'Section title…' })}
          aria-label={t('section_title_placeholder', { defaultValue: 'Section title…' })}
          className="flex-1 min-w-0 bg-transparent text-base font-bold outline-none border-b-2 border-transparent focus:border-teal-400 px-1 py-0.5"
          style={{ color: colors.titleColor }}
        />
        <div className="shrink-0 flex items-center gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label={t('move_up', { defaultValue: 'Move up' })}
            title={t('move_up', { defaultValue: 'Move up' })}
            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label={t('move_down', { defaultValue: 'Move down' })}
            title={t('move_down', { defaultValue: 'Move down' })}
            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRequestDelete}
            aria-label={t('common:delete', { defaultValue: 'Delete' })}
            title={t('delete_section', { defaultValue: 'Delete section' })}
            className="p-1.5 rounded-md text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Section body */}
      <div className="p-3">
        {isText ? (
          <SectionBodyEditor
            sectionId={section.id}
            initialContent={section.content ?? ''}
            courseId={courseId}
            registerFlush={registerFlush}
          />
        ) : (
          summary()
        )}
      </div>
    </div>
  );
};
