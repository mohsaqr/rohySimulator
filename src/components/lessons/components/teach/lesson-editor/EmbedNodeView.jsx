import { NodeViewWrapper } from '@tiptap/react';
import { Trash2, MonitorPlay } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BlockCard } from './BlockCard';

/** Only http/https iframes are allowed — never javascript:, data:, etc. */
export const safeEmbedSrc = (raw) => {
  const u = (raw || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^www\./i.test(u)) return `https://${u}`;
  return '';
};

/**
 * Generic external embed node — an iframe for H5P, Padlet, Genially, Google
 * Slides/Docs, etc. Generalizes the video `mode:'embed'` seam: any sanitized
 * http/https URL becomes a responsive iframe. Height is configurable (default
 * 480px). Used by both the editor and the read-only LessonViewer.
 */
export const EmbedNodeView = ({ node, deleteNode, editor }) => {
  const { t } = useTranslation(['teaching', 'common']);
  const editable = editor?.isEditable ?? true;
  const rawSrc = node.attrs.src;
  const src = safeEmbedSrc(rawSrc);
  const height = Math.max(160, Math.min(1200, Number(node.attrs.height) || 480));

  const frame = src ? (
    <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ height }}>
      <iframe
        src={src}
        title={t('block_embed', { defaultValue: 'Embedded content' })}
        className="absolute inset-0 w-full h-full"
        style={{ border: 0 }}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
      />
    </div>
  ) : (
    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 py-8 text-center text-sm text-slate-400">
      {t('embed_invalid_url', { defaultValue: 'Invalid or unsupported embed URL' })}
    </div>
  );

  // Student view: a clean iframe, no card chrome.
  if (!editable) {
    return (
      <NodeViewWrapper as="div" className="my-3">
        <div contentEditable={false}>{frame}</div>
      </NodeViewWrapper>
    );
  }

  // Editor: wrap in the shared block card with a labeled header + delete.
  return (
    <NodeViewWrapper as="div" className="my-3" data-drag-handle>
      <BlockCard
        icon={MonitorPlay}
        accent="violet"
        title={t('block_embed', { defaultValue: 'Embedded content' })}
        actions={
          <button
            type="button"
            onClick={() => deleteNode()}
            className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            style={{ color: '#ef4444' }}
            aria-label={t('common:delete', { defaultValue: 'Delete' })}
            title={t('common:delete', { defaultValue: 'Delete' })}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        }
      >
        <div contentEditable={false}>{frame}</div>
      </BlockCard>
    </NodeViewWrapper>
  );
};
