import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FileNodeView } from './FileNodeView';

/**
 * Custom block-level node for an embedded file. Renders as a thin
 * row inside the editor flow; serializes to a `<lecture-file>` tag
 * with data-* attributes so the student renderer can find them.
 */
export const FileNode = Node.create({
  name: 'lectureFile',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      fileUrl: { default: '' },
      fileName: { default: '' },
      fileType: { default: '' },
      fileSize: { default: 0, parseHTML: el => parseInt(el.getAttribute('data-size') ?? '0', 10) },
      description: { default: '', parseHTML: el => el.getAttribute('data-description') ?? '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'lecture-file',
        getAttrs: el => {
          const node = el;
          return {
            fileUrl: node.getAttribute('data-url') ?? '',
            fileName: node.getAttribute('data-name') ?? '',
            fileType: node.getAttribute('data-type') ?? '',
            fileSize: parseInt(node.getAttribute('data-size') ?? '0', 10),
            description: node.getAttribute('data-description') ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      'lecture-file',
      mergeAttributes(
        {},
        {
          'data-url': node.attrs.fileUrl,
          'data-name': node.attrs.fileName,
          'data-type': node.attrs.fileType,
          'data-size': String(node.attrs.fileSize ?? 0),
          'data-description': node.attrs.description ?? '',
        },
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileNodeView);
  },

  addCommands() {
    return {
      insertLectureFile:
        attrs =>
        ({ chain, editor }) =>
          chain()
            .focus()
            // Insert at the END of the current selection so the new node is
            // appended after any previously-selected atom (file/chatbot)
            // instead of replacing it.
            .insertContentAt(editor.state.selection.$to.pos, [
              { type: this.name, attrs },
              { type: 'paragraph' },
            ])
            .run(),
    };
  },
});
