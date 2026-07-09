import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline as UnderlineIcon, Heading2, List, ListOrdered, Code,
  AlignLeft, AlignCenter, AlignRight, Link as LinkIcon, Loader2, Check,
} from 'lucide-react';
import { toast } from '../../../toastShim';
import { useTheme } from '../../../hooks/useTheme';
import { coursesApi } from '../../../api/courses';
import { FileNode } from './FileNodeExtension';
import { VideoNode } from './VideoNodeExtension';
import { McqNode } from './McqNodeExtension';

/**
 * Rich-text editor for ONE text section. Pure formatting (bold/italic/headings/
 * lists/align/link) — media (image/video/file/agent/MCQ) are added as their own
 * sections, not inline. The custom node extensions are still registered so a
 * section seeded with a single media node (image/video/MCQ) renders/authors
 * correctly. Autosaves to `updateSection(sectionId, { content })`.
 */
export const SectionBodyEditor = ({ sectionId, initialContent, courseId, registerFlush }) => {
  const { t } = useTranslation('teaching');
  const { isDark } = useTheme();
  const lastSavedRef = useRef(initialContent);
  const debounceRef = useRef(null);
  const [saveState, setSaveState] = useState('idle');
  const savedTimeoutRef = useRef(null);

  const colors = {
    bgInput: isDark ? '#334155' : '#ffffff',
    border: isDark ? '#475569' : '#e2e8f0',
    textPrimary: isDark ? '#f1f5f9' : '#0f172a',
    toolbarBg: isDark ? '#2d3748' : '#f8fafc',
  };

  const flashSaved = () => {
    setSaveState('saved');
    if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setSaveState('idle'), 1400);
  };

  const updateSectionMutation = useMutation({
    mutationFn: (content) => coursesApi.updateSection(sectionId, { content }),
    onSuccess: () => flashSaved(),
    onError: () => { setSaveState('idle'); toast.error(t('failed_to_save_lesson', { defaultValue: 'Failed to save.' })); },
  });

  const persist = (html) => {
    if (html === lastSavedRef.current) return;
    setSaveState('saving');
    lastSavedRef.current = html;
    updateSectionMutation.mutate(html);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-cyan-600 underline' } }),
      Placeholder.configure({ placeholder: t('lesson_empty_placeholder', { defaultValue: 'Write here…' }) }),
      FileNode,
      VideoNode,
      McqNode,
    ],
    content: initialContent,
    editorProps: { attributes: { class: 'focus:outline-none' } },
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? '' : ed.getHTML();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => persist(html), 400);
    },
  });

  const flush = async () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    if (!editor) return;
    const html = editor.isEmpty ? '' : editor.getHTML();
    if (html === lastSavedRef.current) return;
    setSaveState('saving');
    lastSavedRef.current = html;
    await updateSectionMutation.mutateAsync(html);
  };

  useEffect(() => {
    registerFlush?.(flush);
    return () => registerFlush?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, sectionId]);

  useEffect(() => {
    if (!editor) return;
    if (initialContent === lastSavedRef.current) return;
    if (editor.isFocused) return;
    if (editor.getHTML() === initialContent) { lastSavedRef.current = initialContent; return; }
    editor.commands.setContent(initialContent || '', { emitUpdate: false });
    lastSavedRef.current = initialContent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent, editor]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  if (!editor) return null;

  const addLink = () => { const url = window.prompt('URL'); if (url) editor.chain().focus().setLink({ href: url }).run(); };

  const Btn = ({ onClick, isActive, title, children }) => (
    <span className="relative group/tbtn">
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        aria-pressed={isActive}
        className={`p-1.5 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${isActive ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
      >
        {children}
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/tbtn:opacity-100 dark:bg-slate-700">{title}</span>
    </span>
  );

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: colors.border, backgroundColor: colors.bgInput }}>
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b flex-wrap" style={{ borderColor: colors.border, backgroundColor: colors.toolbarBg }}>
        <Btn onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} title="Bold"><Bold size={16} /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} title="Italic"><Italic size={16} /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title="Underline"><UnderlineIcon size={16} /></Btn>
        <div className="shrink-0 w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1" />
        <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} isActive={editor.isActive('heading', { level: 2 })} title="Heading"><Heading2 size={16} /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')} title="Bullet List"><List size={16} /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')} title="Numbered List"><ListOrdered size={16} /></Btn>
        <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()} isActive={editor.isActive('codeBlock')} title="Code Block"><Code size={16} /></Btn>
        <div className="shrink-0 w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1" />
        <Btn onClick={() => editor.chain().focus().setTextAlign('left').run()} isActive={editor.isActive({ textAlign: 'left' })} title="Align Left"><AlignLeft size={16} /></Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('center').run()} isActive={editor.isActive({ textAlign: 'center' })} title="Align Center"><AlignCenter size={16} /></Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('right').run()} isActive={editor.isActive({ textAlign: 'right' })} title="Align Right"><AlignRight size={16} /></Btn>
        <div className="shrink-0 w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1" />
        <Btn onClick={addLink} isActive={editor.isActive('link')} title="Add Link"><LinkIcon size={16} /></Btn>
        <div className="ml-auto flex items-center pr-2 text-xs" style={{ color: isDark ? '#94a3b8' : '#64748b' }}>
          {saveState === 'saving' && (<span className="inline-flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('saving', { defaultValue: 'Saving…' })}</span>)}
          {saveState === 'saved' && (<span className="inline-flex items-center gap-1" style={{ color: isDark ? '#5eead4' : '#0f766e' }}><Check className="w-3.5 h-3.5" />{t('saved', { defaultValue: 'Saved' })}</span>)}
        </div>
      </div>
      <EditorContent
        editor={editor}
        className="px-3 py-3 min-h-[140px] max-h-[600px] overflow-y-auto prose prose-sm dark:prose-invert max-w-none focus-within:outline-none"
        style={{ color: colors.textPrimary }}
      />
    </div>
  );
};
