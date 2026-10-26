import { useContext, useEffect, useRef } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { resolveFileUrl } from '../../../api/client';
import {
  trackUploadedVideo,
  trackYouTubeEmbed,
  isYouTubeEmbed,
  withJsApi,
} from '../../../services/videoXapi';
import { LessonMediaContext } from './LessonMediaContext';
import { safeVideoEmbedSrc } from '../../../utils/safeUrl';

// Host edit (security audit 2026-10-26, L5-05): the video iframe is sandboxed.
// allow-same-origin is required by the YouTube player and IFrame API, and is
// safe only because safeVideoEmbedSrc admits nothing but the cross-origin
// providers in VIDEO_EMBED_HOSTS. allow-popups: "Watch on YouTube".
export const VIDEO_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups';

/** Filename (without uuid noise) for a friendlier log title. */
const titleFromSrc = (src) => {
  try {
    return decodeURIComponent(src.split('/').pop() || 'video');
  } catch {
    return 'video';
  }
};

/**
 * Inline video node. Renders either an uploaded HTML5 `<video>` (mode
 * 'file') or an embedded `<iframe>` for an external provider such as
 * YouTube/Vimeo (mode 'embed'). Used by both the editor and the
 * read-only LessonViewer.
 *
 * When viewed (not editable), watch activity is captured via the xAPI Video
 * Profile (`services/videoXapi.ts`, dependency-free):
 * initialized / played / paused / seeked / playback-rate-changed / completed
 * / abandoned / terminated, plus a coarse `progressed` heartbeat every 30s.
 * Uploaded videos use native media events; embedded YouTube videos are driven
 * directly over the YouTube IFrame API. Non-YouTube embeds (e.g. Vimeo) stay
 * plain iframes — the IFrame API can't reach them.
 */
export const VideoNodeView = ({ node, deleteNode, editor }) => {
  const { t } = useTranslation(['teaching', 'common']);
  const { courseId, lectureId, sectionId } = useContext(LessonMediaContext);
  const editable = editor?.isEditable ?? true;
  const mode = node.attrs.mode || 'file';
  const src = node.attrs.src;
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const isYouTube = mode === 'embed' && isYouTubeEmbed(src);
  // VideoNodeView is the shared render path for lecture-video nodes, so the
  // allow-list must live here (not only at the authoring call sites) to keep
  // a javascript:/data: src — or any page that is not a video provider — out
  // of a student's iframe. Empty means the stored URL was rejected -> render
  // a fallback instead. The iframe is sandboxed (VIDEO_IFRAME_SANDBOX).
  const safeSrc = mode === 'embed' ? safeVideoEmbedSrc(src) : src;
  // YouTube embeds need `enablejsapi=1` so the IFrame API can attach.
  const iframeSrc = isYouTube ? withJsApi(safeSrc) : safeSrc;

  // Watch tracking — only when read-only (a student watching, not an
  // instructor editing) and only when we know which lecture this is (so
  // instructor previews without context don't generate logs).
  useEffect(() => {
    if (editable || lectureId == null) return;

    const ctx = {
      courseId,
      lectureId,
      sectionId,
      title: titleFromSrc(src),
      src,
      mode: mode === 'embed' ? 'embed' : 'file',
    };

    if (mode === 'embed') {
      if (!isYouTube || !iframeRef.current) return;
      return trackYouTubeEmbed(iframeRef.current, ctx);
    }
    if (!videoRef.current) return;
    return trackUploadedVideo(videoRef.current, ctx);
  }, [editable, mode, src, courseId, lectureId, sectionId, isYouTube]);

  return (
    <NodeViewWrapper as="div" className="my-3 relative group/video max-w-xl mx-auto" data-drag-handle>
      <div contentEditable={false}>
        {/* Both uploaded videos and embeds use one full-width 16:9 frame so
            they take the whole content width at a consistent, reasonable size. */}
        <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ paddingBottom: '56.25%' }}>
          {mode === 'embed' ? (
            safeSrc ? (
              <iframe
                ref={iframeRef}
                src={iframeSrc}
                title={t('block_video', { defaultValue: 'Video' })}
                className="absolute inset-0 w-full h-full"
                style={{ border: 0 }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                sandbox={VIDEO_IFRAME_SANDBOX}
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-white/80">
                {t('invalid_embed_url', { defaultValue: 'This embed URL is not allowed.' })}
              </div>
            )
          ) : (
            <video
              ref={videoRef}
              controls
              preload="metadata"
              // The `#t=0.1` media fragment makes the browser seek to and
              // paint the first frame as a poster thumbnail before playback.
              src={resolveFileUrl(src) ? `${resolveFileUrl(src)}#t=0.1` : undefined}
              className="absolute inset-0 w-full h-full"
              style={{ objectFit: 'contain' }}
            />
          )}
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => deleteNode()}
            className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-md bg-black/50 text-white opacity-0 group-hover/video:opacity-100 transition-opacity hover:bg-red-500"
            aria-label={t('common:delete', { defaultValue: 'Delete' })}
            title={t('common:delete', { defaultValue: 'Delete' })}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
};
