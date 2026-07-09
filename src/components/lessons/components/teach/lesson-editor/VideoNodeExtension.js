import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { VideoNodeView } from './VideoNodeView';

/**
 * Block-level video node. `mode: 'file'` is an uploaded video served
 * from /uploads; `mode: 'embed'` is an external iframe (YouTube, Vimeo…).
 * Serializes to a `<lecture-video>` tag with data-* attributes so the
 * student renderer (LessonViewer) round-trips it. Also parses bare
 * `<video>` / `<iframe>` tags for robustness.
 */
export const VideoNode = Node.create({
  name: 'lectureVideo',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      mode: { default: 'file' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'lecture-video',
        getAttrs: el => ({
          src: el.getAttribute('data-src') ?? '',
          mode: el.getAttribute('data-mode') ?? 'file',
        }),
      },
      {
        tag: 'video',
        getAttrs: el => ({ src: el.getAttribute('src') ?? '', mode: 'file' }),
      },
      {
        tag: 'iframe',
        getAttrs: el => ({ src: el.getAttribute('src') ?? '', mode: 'embed' }),
      },
    ];
  },

  renderHTML({ node }) {
    return [
      'lecture-video',
      mergeAttributes(
        {},
        {
          'data-src': node.attrs.src,
          'data-mode': node.attrs.mode,
        },
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoNodeView);
  },

  addCommands() {
    return {
      insertLectureVideo:
        attrs =>
        ({ chain, editor }) =>
          chain()
            .focus()
            .insertContentAt(editor.state.selection.$to.pos, [
              { type: this.name, attrs: { src: attrs.src, mode: attrs.mode ?? 'file' } },
              { type: 'paragraph' },
            ])
            .run(),
    };
  },
});
