import { useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { Folder, FolderOpen, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../hooks/useTheme';
import { resolveFileUrl } from '../../../api/client';
import { FileCard } from '../../course/FileCard';

/**
 * Folder node view — a collapsible card grouping multiple files under one
 * header (folder icon + label + file count). Expanding reveals each contained
 * file as a `FileCard` with the right View/Download action (per `previewKind`).
 * Used by both the editor and the read-only LessonViewer (it checks
 * `editor.isEditable` to show the delete control only while editing).
 */
export const FolderNodeView = ({ node, deleteNode, editor }) => {
  const { t } = useTranslation(['teaching', 'common', 'courses']);
  const { isDark } = useTheme();
  const editable = editor?.isEditable ?? true;

  const label = node.attrs.label || t('block_folder', { defaultValue: 'Folder' });
  const files = Array.isArray(node.attrs.files) ? node.attrs.files : [];
  const count = files.length;

  // Default collapsed; the header toggle is obvious (chevron + icon swap).
  const [open, setOpen] = useState(false);

  const colors = {
    cardBg: isDark ? '#1e293b' : '#ffffff',
    cardBorder: isDark ? '#334155' : '#e2e8f0',
    title: isDark ? '#f1f5f9' : '#0f172a',
    muted: isDark ? '#94a3b8' : '#64748b',
    accent: isDark ? '#fbbf24' : '#d97706',
  };

  return (
    <NodeViewWrapper as="div" className="my-3" data-drag-handle>
      <div
        className="rounded-xl border overflow-hidden transition-shadow hover:shadow-sm"
        style={{ backgroundColor: colors.cardBg, borderColor: colors.cardBorder }}
        contentEditable={false}
      >
        {/* Folder header — click to expand/collapse. */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="flex flex-1 items-center gap-3 px-3.5 py-3 text-left min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded-xl"
          >
            <span className="shrink-0 text-slate-400">
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
            <span
              className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-xl"
              style={{ backgroundColor: `${colors.accent}1f`, color: colors.accent }}
            >
              {open ? <FolderOpen className="w-6 h-6" /> : <Folder className="w-6 h-6" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold truncate" style={{ color: colors.title }} title={label}>
                {label}
              </span>
              <span className="mt-0.5 block text-xs font-medium tracking-wide" style={{ color: colors.muted }}>
                {t('folder_files_count', { defaultValue: '{{count}} file(s)', count })}
              </span>
            </span>
          </button>
          {editable && (
            <button
              type="button"
              onClick={() => deleteNode()}
              className="mr-3 inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              aria-label={t('common:delete', { defaultValue: 'Delete' })}
              title={t('common:delete', { defaultValue: 'Delete' })}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* File list — revealed when open. */}
        {open && (
          <div className="px-3.5 pb-3.5 pt-1 space-y-2 border-t" style={{ borderColor: colors.cardBorder }}>
            {count === 0 ? (
              <p className="py-3 text-center text-sm" style={{ color: colors.muted }}>
                {t('folder_empty', { defaultValue: 'This folder is empty.' })}
              </p>
            ) : (
              files.map((f, i) => (
                <FileCard
                  key={`${f.fileUrl}-${i}`}
                  fileName={f.fileName ?? ''}
                  fileType={f.fileType ?? ''}
                  fileSize={f.fileSize ?? 0}
                  url={resolveFileUrl(f.fileUrl)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};
