import { NodeViewWrapper } from '@tiptap/react';
import {
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  FileSpreadsheet,
  Presentation,
  Download,
  Eye,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../hooks/useTheme';
import { resolveFileUrl } from '../../../api/client';
import { previewKind } from '../../../utils/filePreview';

/** Per-type icon + accent (light/dark). Keyed by lowercase extension. */
const TYPE_META = {
  pdf: { Icon: FileText, light: '#dc2626', dark: '#f87171' },
  doc: { Icon: FileText, light: '#2563eb', dark: '#60a5fa' },
  docx: { Icon: FileText, light: '#2563eb', dark: '#60a5fa' },
  txt: { Icon: FileText, light: '#475569', dark: '#94a3b8' },
  jpg: { Icon: ImageIcon, light: '#0f766e', dark: '#2dd4bf' },
  jpeg: { Icon: ImageIcon, light: '#0f766e', dark: '#2dd4bf' },
  png: { Icon: ImageIcon, light: '#0f766e', dark: '#2dd4bf' },
  gif: { Icon: ImageIcon, light: '#0f766e', dark: '#2dd4bf' },
  webp: { Icon: ImageIcon, light: '#0f766e', dark: '#2dd4bf' },
  svg: { Icon: ImageIcon, light: '#0f766e', dark: '#2dd4bf' },
  mp4: { Icon: Film, light: '#7c3aed', dark: '#a78bfa' },
  mov: { Icon: Film, light: '#7c3aed', dark: '#a78bfa' },
  webm: { Icon: Film, light: '#7c3aed', dark: '#a78bfa' },
  mp3: { Icon: Music, light: '#db2777', dark: '#f472b6' },
  wav: { Icon: Music, light: '#db2777', dark: '#f472b6' },
  ogg: { Icon: Music, light: '#db2777', dark: '#f472b6' },
  zip: { Icon: Archive, light: '#d97706', dark: '#fbbf24' },
  rar: { Icon: Archive, light: '#d97706', dark: '#fbbf24' },
  '7z': { Icon: Archive, light: '#d97706', dark: '#fbbf24' },
  xls: { Icon: FileSpreadsheet, light: '#059669', dark: '#34d399' },
  xlsx: { Icon: FileSpreadsheet, light: '#059669', dark: '#34d399' },
  csv: { Icon: FileSpreadsheet, light: '#059669', dark: '#34d399' },
  ppt: { Icon: Presentation, light: '#ea580c', dark: '#fb923c' },
  pptx: { Icon: Presentation, light: '#ea580c', dark: '#fb923c' },
};

const metaFor = (fileType) => {
  const ext = (fileType ?? '').toLowerCase().replace(/^\./, '');
  return TYPE_META[ext] ?? { Icon: FileIcon, light: '#475569', dark: '#94a3b8' };
};

/** Human-readable byte size, e.g. 781286 → "763 KB". */
const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

/**
 * Professional inline file card: a type-colored icon tile, the filename as a
 * styled title, a meta line (TYPE · size), an optional description, and a
 * Download action. In the editor the title and description are inline-editable
 * and a delete control is shown; for students it's a clean download card.
 */
export const FileNodeView = ({ node, updateAttributes, deleteNode, editor }) => {
  const { t } = useTranslation(['teaching', 'common']);
  const { isDark } = useTheme();
  const editable = editor?.isEditable ?? true;

  const fileUrl = node.attrs.fileUrl;
  const fileName = node.attrs.fileName || t('block_file', { defaultValue: 'File' });
  const fileType = node.attrs.fileType;
  const fileSize = node.attrs.fileSize;
  const description = node.attrs.description || '';
  const url = fileUrl ? resolveFileUrl(fileUrl) : null;

  const { Icon, light, dark } = metaFor(fileType);
  const accent = isDark ? dark : light;
  const ext = (fileType || '').replace(/^\./, '').toUpperCase();
  const size = formatBytes(fileSize);
  const metaParts = [ext, size].filter(Boolean).join('  ·  ');

  const colors = {
    cardBg: isDark ? '#1e293b' : '#ffffff',
    cardBorder: isDark ? '#334155' : '#e2e8f0',
    title: isDark ? '#f1f5f9' : '#0f172a',
    muted: isDark ? '#94a3b8' : '#64748b',
    inputBg: isDark ? '#0f172a' : '#f8fafc',
  };

  const canView = previewKind(fileName, fileType) !== null;

  return (
    <NodeViewWrapper as="div" className="my-3" data-drag-handle>
      <div
        className="group/file flex items-center gap-3.5 rounded-xl border p-3.5 transition-shadow hover:shadow-sm"
        style={{ backgroundColor: colors.cardBg, borderColor: colors.cardBorder }}
        contentEditable={false}
      >
        {/* Type-colored icon tile */}
        <span
          className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-xl"
          style={{ backgroundColor: `${accent}1f`, color: accent }}
        >
          <Icon className="w-6 h-6" />
        </span>

        {/* Title + meta + description */}
        <div className="flex-1 min-w-0">
          {editable ? (
            <input
              value={node.attrs.fileName}
              onChange={e => updateAttributes({ fileName: e.target.value })}
              placeholder={t('file_name_placeholder', { defaultValue: 'File name' })}
              className="w-full bg-transparent text-sm font-semibold outline-none border-b border-transparent focus:border-teal-400 truncate"
              style={{ color: colors.title }}
            />
          ) : (
            <div className="text-sm font-semibold truncate" style={{ color: colors.title }} title={fileName}>
              {fileName}
            </div>
          )}

          <div className="mt-0.5 text-xs font-medium tracking-wide" style={{ color: colors.muted }}>
            {metaParts || t('file_badge', { defaultValue: 'File' })}
          </div>

          {editable ? (
            <input
              value={description}
              onChange={e => updateAttributes({ description: e.target.value })}
              placeholder={t('file_description_placeholder', { defaultValue: 'Add a short description (optional)' })}
              className="mt-1.5 w-full bg-transparent text-sm outline-none border-b border-transparent focus:border-teal-400"
              style={{ color: colors.muted }}
            />
          ) : description ? (
            <p className="mt-1 text-sm" style={{ color: colors.muted }}>{description}</p>
          ) : null}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1.5">
          {url && (canView ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              title={t('common:view', { defaultValue: 'View' })}
              aria-label={t('common:view', { defaultValue: 'View' })}
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">{t('common:view', { defaultValue: 'View' })}</span>
            </a>
          ) : (
            <a
              href={url}
              download={fileName || undefined}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              title={t('download', { defaultValue: 'Download' })}
              aria-label={t('download', { defaultValue: 'Download' })}
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">{t('download', { defaultValue: 'Download' })}</span>
            </a>
          ))}
          {editable && (
            <button
              type="button"
              onClick={() => deleteNode()}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              aria-label={t('common:delete', { defaultValue: 'Delete' })}
              title={t('common:delete', { defaultValue: 'Delete' })}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
};
