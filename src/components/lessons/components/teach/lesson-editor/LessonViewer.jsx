import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { FileNode } from './FileNodeExtension';
import { FolderNode } from './FolderNodeExtension';
import { VideoNode } from './VideoNodeExtension';
import { McqNode } from './McqNodeExtension';
import { UrlNode } from './UrlNodeExtension';
import { EmbedNode } from './EmbedNodeExtension';
import { LessonMediaContext } from './LessonMediaContext';

/**
 * Read-only renderer for the lesson editor's HTML — used on the
 * student lecture page so embedded `<lecture-file>` and
 * `<lecture-chatbot>` tags render with the same node-view UI as in
 * the editor (sans edit affordances; the node views check
 * `editor.isEditable`).
 */
export const LessonViewer = ({ html, courseId, lectureId, sectionId }) => {
  const editor = useEditor({
    editable: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: true, allowBase64: true }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: { class: 'text-cyan-600 underline' },
      }),
      FileNode,
      FolderNode,
      VideoNode,
      McqNode,
      UrlNode,
      EmbedNode,
    ],
    content: html,
  });

  // useEditor's `content` prop is only consumed on first mount. Push
  // updates through setContent so navigating between lectures (or a
  // refetch) actually swaps the rendered document.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === html) return;
    editor.commands.setContent(html, { emitUpdate: false });
  }, [html, editor]);

  if (!editor) return null;

  return (
    <LessonMediaContext.Provider value={{ courseId, lectureId, sectionId }}>
      <EditorContent
        editor={editor}
        className="prose prose-sm dark:prose-invert max-w-none"
      />
    </LessonMediaContext.Provider>
  );
};
