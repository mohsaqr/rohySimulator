import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Type, ImagePlus, Video, FileUp, ListChecks, Loader2, Link2, UploadCloud } from 'lucide-react';
import { toast } from '../../../toastShim';
import { marked } from 'marked';
import { coursesApi } from '../../../api/courses';
import { toEmbedUrl } from '../../../utils/embed';
import { safeEmbedSrc } from './EmbedNodeView';
import { uploadWithProgress } from '../../../utils/upload';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { Modal } from '../../common/Modal';
import { Button } from '../../common/Button';
import { Input } from '../../common/Input';
import { isHtmlContent } from '../../../utils/sanitize';
import { SectionCard } from './SectionCard';

/** Legacy content may be HTML or markdown; normalize to HTML for the editor. */
const legacyToHtml = (c) => (isHtmlContent(c) ? c : marked.parse(c, { async: false }));

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);


/**
 * Stacked, multi-section lesson builder. Each section is its own typed card
 * (text / image / video / file / MCQ). Sections are added via the
 * icon row at the bottom — every icon creates a NEW section of that type
 * (nothing is inserted inline). Reorder via drag + arrows.
 */
export const SectionListEditor = forwardRef((
  { lectureId, initialSections, courseId, legacyContent },
  ref,
) => {
  const { t } = useTranslation(['teaching', 'common']);
  const queryClient = useQueryClient();

  const [sections, setSections] = useState(() => [...initialSections].sort(byOrder));
  const [dragIndex, setDragIndex] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const flushRegistry = useRef(new Map());
  const makeRegister = (id) => (fn) => {
    if (fn) flushRegistry.current.set(id, fn);
    else flushRegistry.current.delete(id);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lecture', lectureId] });
    queryClient.invalidateQueries({ queryKey: ['courseDetails'] });
  };

  const idsSig = [...initialSections].map(s => s.id).sort((a, b) => a - b).join(',');
  useEffect(() => {
    setSections(prev => {
      const byId = new Map(initialSections.map(s => [s.id, s]));
      const kept = prev.filter(s => byId.has(s.id)).map(s => byId.get(s.id));
      const fresh = initialSections.filter(s => !prev.some(p => p.id === s.id)).sort(byOrder);
      return [...kept, ...fresh];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsSig]);

  // One-time lazy migration of the legacy `lecture.content` field into a section.
  const importedRef = useRef(false);
  useEffect(() => {
    if (importedRef.current) return;
    const legacy = (legacyContent ?? '').trim();
    if (!legacy) return;
    importedRef.current = true;
    const existingIds = sections.map(s => s.id);
    (async () => {
      // Once the section exists, NEVER re-run the import — re-running would
      // duplicate the legacy content. Only a failure of createSection itself
      // (no section made) is safe to retry.
      let sectionCreated = false;
      try {
        const created = await coursesApi.createSection(lectureId, { type: 'text', title: '', content: legacyToHtml(legacy) });
        sectionCreated = true;
        setSections(prev => [created, ...prev.filter(s => s.id !== created.id)]);
        if (existingIds.length > 0) await coursesApi.reorderSections(lectureId, [created.id, ...existingIds]);
        await coursesApi.updateLecture(lectureId, { content: '' });
        invalidate();
      } catch {
        if (!sectionCreated) importedRef.current = false; // safe to retry only if nothing was created
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyContent, lectureId]);

  // ─── Section ops (create / delete / reorder / title) ──────────────────────
  const createAndAppend = async (data) => {
    const created = await coursesApi.createSection(lectureId, data);
    setSections(prev => [...prev, created]);
    invalidate();
    return created;
  };

  const deleteMutation = useMutation({
    mutationFn: (id) => coursesApi.deleteSection(id),
    onSuccess: (_d, id) => {
      flushRegistry.current.delete(id);
      setSections(prev => prev.filter(s => s.id !== id));
      invalidate();
    },
    onError: () => toast.error(t('common:error', { defaultValue: 'Something went wrong' })),
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds) => coursesApi.reorderSections(lectureId, orderedIds),
    onSuccess: invalidate,
    onError: () => { toast.error(t('common:error', { defaultValue: 'Something went wrong' })); invalidate(); },
  });

  const titleMutation = useMutation({
    mutationFn: ({ id, title }) => coursesApi.updateSection(id, { title }),
    onError: () => toast.error(t('common:error', { defaultValue: 'Something went wrong' })),
  });

  // Persist a file section's description (stored in the section `content` field).
  const fileDescMutation = useMutation({
    mutationFn: ({ id, content }) => coursesApi.updateSection(id, { content }),
    onError: () => toast.error(t('common:error', { defaultValue: 'Something went wrong' })),
  });

  const commitOrder = (next) => { setSections(next); reorderMutation.mutate(next.map(s => s.id)); };
  const move = (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[index], next[j]] = [next[j], next[index]];
    commitOrder(next);
  };
  const dropItem = (to) => {
    if (dragIndex === null || dragIndex === to) { setDragIndex(null); return; }
    const next = [...sections];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(to, 0, moved);
    setDragIndex(null);
    commitOrder(next);
  };
  const commitTitle = (id, title) => {
    setSections(prev => prev.map(s => (s.id === id ? { ...s, title } : s)));
    titleMutation.mutate({ id, title });
  };
  const commitFileDesc = (id, content) => {
    setSections(prev => prev.map(s => (s.id === id ? { ...s, content } : s)));
    fileDescMutation.mutate({ id, content });
  };

  useImperativeHandle(ref, () => ({
    flush: async () => {
      await Promise.all([...flushRegistry.current.values()].map(fn => fn().catch(() => null)));
      invalidate();
    },
  }));

  const upload = (endpoint, file) => uploadWithProgress(endpoint, file, setProgress);

  // ─── Add-section handlers (each creates a NEW section) ─────────────────────
  const addText = () => { createAndAppend({ type: 'text', title: '', content: '' }).catch(() => toast.error(t('common:error', { defaultValue: 'Something went wrong' }))); };
  const addMcq = () => { createAndAppend({ type: 'text', title: '', content: '<lecture-mcq></lecture-mcq>' }).catch(() => toast.error(t('common:error', { defaultValue: 'Something went wrong' }))); };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true); setProgress(0);
    try {
      const url = await upload('/api/uploads/image', file);
      await createAndAppend({ type: 'text', title: '', content: `<img src="${url}" alt="${file.name}">` });
    } catch { toast.error(t('common:error', { defaultValue: 'Something went wrong' })); }
    finally { setBusy(false); setProgress(null); }
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — must match the server multer limit
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t('file_too_large', { name: file.name, limit: '50 MB' }));
      return;
    }
    setBusy(true); setProgress(0);
    try {
      const url = await upload('/api/uploads/file', file);
      await createAndAppend({ type: 'file', title: '', content: '', fileName: file.name, fileUrl: url, fileType: file.type || file.name.split('.').pop() || '', fileSize: file.size });
    } catch { toast.error(t('common:error', { defaultValue: 'Something went wrong' })); }
    finally { setBusy(false); setProgress(null); }
  };

  // Video modal (upload or embed link)
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const videoInputRef = useRef(null);
  const onPickVideo = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setBusy(true); setProgress(0);
    try {
      const url = await upload('/api/uploads/video', file);
      await createAndAppend({ type: 'text', title: '', content: `<lecture-video data-src="${url}" data-mode="file"></lecture-video>` });
      setVideoOpen(false);
    } catch { toast.error(t('common:error', { defaultValue: 'Something went wrong' })); }
    finally { setBusy(false); setProgress(null); }
  };
  const submitVideoEmbed = async () => {
    const raw = videoUrl.trim();
    if (!raw) return;
    // Only persist http(s) embeds (safeEmbedSrc rejects javascript:/data:),
    // matching MoodleCourseEditor's authoring guard.
    const safe = safeEmbedSrc(toEmbedUrl(raw));
    if (!safe) { toast.error(t('common:error', { defaultValue: 'Something went wrong' })); return; }
    setBusy(true);
    try {
      await createAndAppend({ type: 'text', title: '', content: `<lecture-video data-src="${safe}" data-mode="embed"></lecture-video>` });
      setVideoOpen(false); setVideoUrl('');
    } catch { toast.error(t('common:error', { defaultValue: 'Something went wrong' })); }
    finally { setBusy(false); }
  };

  // ─── UI ────────────────────────────────────────────────────────────────────
  const ADD_BUTTONS = [
    { key: 'text', icon: <Type size={16} />, label: t('section_text', { defaultValue: 'Text' }), onClick: addText },
    { key: 'image', icon: <ImagePlus size={16} />, label: t('section_image', { defaultValue: 'Image' }), onClick: () => imageInputRef.current?.click() },
    { key: 'video', icon: <Video size={16} />, label: t('section_video', { defaultValue: 'Video' }), onClick: () => { setVideoUrl(''); setVideoOpen(true); } },
    { key: 'file', icon: <FileUp size={16} />, label: t('section_file', { defaultValue: 'File' }), onClick: () => fileInputRef.current?.click() },
    { key: 'mcq', icon: <ListChecks size={16} />, label: t('section_mcq', { defaultValue: 'MCQ' }), onClick: addMcq },
  ];

  return (
    <div className="space-y-4">
      {sections.map((section, index) => (
        <SectionCard
          key={section.id}
          section={section}
          index={index}
          courseId={courseId}
          isFirst={index === 0}
          isLast={index === sections.length - 1}
          onMoveUp={() => move(index, -1)}
          onMoveDown={() => move(index, 1)}
          isDragging={dragIndex === index}
          onDragStart={() => setDragIndex(index)}
          onDragOverRow={(e) => e.preventDefault()}
          onDropRow={() => dropItem(index)}
          onDragEnd={() => setDragIndex(null)}
          onTitleCommit={(title) => commitTitle(section.id, title)}
          onFileDescCommit={(desc) => commitFileDesc(section.id, desc)}
          onRequestDelete={() => setDeleteTarget(section)}
          registerFlush={makeRegister(section.id)}
        />
      ))}

      {/* Single "add a section" bar — each button creates a new section. */}
      <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium mr-1 text-slate-500 dark:text-slate-400">
            {busy ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />{progress != null ? `${progress}%` : t('common:loading', { defaultValue: 'Working…' })}</span>
            ) : t('add_a_section', { defaultValue: 'Add a section:' })}
          </span>
          {ADD_BUTTONS.map(b => (
            <button
              key={b.key}
              type="button"
              disabled={busy}
              onClick={b.onClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/30 border border-teal-100 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            >
              <span className="shrink-0">{b.icon}</span>{b.label}
            </button>
          ))}
        </div>
      </div>

      <input ref={imageInputRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />
      <input ref={fileInputRef} type="file" onChange={onPickFile} className="hidden" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.gif,.zip" />
      <input ref={videoInputRef} type="file" accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm" onChange={onPickVideo} className="hidden" />

      {/* Video: upload or embed link */}
      <Modal isOpen={videoOpen} onClose={() => { if (!busy) { setVideoOpen(false); setVideoUrl(''); } }} title={t('add_video_title', { defaultValue: 'Add a video' })}>
        <div className="p-5 space-y-4">
          {busy ? (
            <div className="py-6 text-center"><Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-teal-500" /><p className="text-sm text-slate-500 dark:text-slate-400">{progress != null ? `${t('uploading', { defaultValue: 'Uploading…' })} ${progress}%` : t('common:loading', { defaultValue: 'Loading…' })}</p></div>
          ) : (
            <>
              <label className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 cursor-pointer hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400 dark:hover:border-teal-500 text-slate-500 dark:text-slate-400 transition-colors">
                <UploadCloud className="w-7 h-7" />
                <span className="text-sm font-medium">{t('upload_a_video', { defaultValue: 'Upload a video file' })}</span>
                <button type="button" onClick={() => videoInputRef.current?.click()} className="hidden" />
                <span onClick={() => videoInputRef.current?.click()} className="text-xs underline">{t('choose_file', { defaultValue: 'Choose file' })}</span>
              </label>
              <div className="text-center text-xs font-medium text-slate-400">{t('or', { defaultValue: 'or' })}</div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input type="url" label={t('embed_video_link', { defaultValue: 'Paste a YouTube / Vimeo link' })} value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitVideoEmbed(); } }} />
                </div>
                <Button onClick={submitVideoEmbed} disabled={!videoUrl.trim()} icon={<Link2 className="w-4 h-4" />}>{t('embed', { defaultValue: 'Embed' })}</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); }}
        title={t('delete_section', { defaultValue: 'Delete section' })}
        message={t('delete_section_confirm', { defaultValue: 'Delete this section and its content? This cannot be undone.' })}
        confirmText={t('common:delete', { defaultValue: 'Delete' })}
      />
    </div>
  );
});

SectionListEditor.displayName = 'SectionListEditor';
