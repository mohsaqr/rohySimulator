import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { EmbedNodeView } from './EmbedNodeView';

/**
 * Generic external embed node (H5P, Padlet, Genially, Google Slides/Docs…).
 * Generalizes the video `mode:'embed'` iframe seam into a sanitized,
 * responsive iframe of configurable height. Serializes to a `<lecture-embed>`
 * tag with data-* attributes so the student renderer (LessonViewer) round-trips
 * it.
 */
export const EmbedNode = Node.create({
  name: 'lectureEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      height: { default: 480, parseHTML: el => parseInt(el.getAttribute('data-height') ?? '480', 10) || 480 },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'lecture-embed',
        getAttrs: el => {
          const node = el;
          return {
            src: node.getAttribute('data-src') ?? '',
            height: parseInt(node.getAttribute('data-height') ?? '480', 10) || 480,
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      'lecture-embed',
      mergeAttributes(
        {},
        {
          'data-src': node.attrs.src,
          'data-height': String(node.attrs.height ?? 480),
        },
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedNodeView);
  },

  addCommands() {
    return {
      insertLectureEmbed:
        attrs =>
        ({ chain, editor }) =>
          chain()
            .focus()
            .insertContentAt(editor.state.selection.$to.pos, [
              { type: this.name, attrs: { src: attrs.src, height: attrs.height ?? 480 } },
              { type: 'paragraph' },
            ])
            .run(),
    };
  },
});
