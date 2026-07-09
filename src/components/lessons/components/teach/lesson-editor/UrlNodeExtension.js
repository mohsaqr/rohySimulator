import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { UrlNodeView } from './UrlNodeView';

/**
 * Block-level external-link node. Serializes to a `<lecture-url>` tag with
 * data-* attributes so the student renderer (LessonViewer) round-trips it,
 * rendering a FileCard-style "Open" card that points at an external URL.
 */
export const UrlNode = Node.create({
  name: 'lectureUrl',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      newTab: { default: true, parseHTML: el => el.getAttribute('data-newtab') !== 'false' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'lecture-url',
        getAttrs: el => {
          const node = el;
          return {
            url: node.getAttribute('data-url') ?? '',
            title: node.getAttribute('data-title') ?? '',
            newTab: node.getAttribute('data-newtab') !== 'false',
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      'lecture-url',
      mergeAttributes(
        {},
        {
          'data-url': node.attrs.url,
          'data-title': node.attrs.title ?? '',
          'data-newtab': node.attrs.newTab === false ? 'false' : 'true',
        },
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(UrlNodeView);
  },

  addCommands() {
    return {
      insertLectureUrl:
        attrs =>
        ({ chain, editor }) =>
          chain()
            .focus()
            .insertContentAt(editor.state.selection.$to.pos, [
              { type: this.name, attrs: { url: attrs.url, title: attrs.title ?? '', newTab: attrs.newTab ?? true } },
              { type: 'paragraph' },
            ])
            .run(),
    };
  },
});
