import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FolderNodeView } from './FolderNodeView';

/** Parse the data-files JSON safely into a FolderFile[]. */
const parseFiles = (raw) => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(f => !!f && typeof f === 'object')
      .map(f => ({
        fileName: String(f.fileName ?? ''),
        fileUrl: String(f.fileUrl ?? ''),
        fileType: f.fileType != null ? String(f.fileType) : '',
        fileSize: typeof f.fileSize === 'number' ? f.fileSize : Number(f.fileSize) || 0,
      }))
      .filter(f => f.fileUrl);
  } catch {
    return [];
  }
};

/**
 * Folder node — groups MULTIPLE files under one collapsible card (Moodle's
 * Folder resource). Unlike the multi-file upload (which makes N separate File
 * items), a folder is ONE item carrying its whole file list in `data-files`
 * (a JSON array of {fileName,fileUrl,fileType,fileSize}). Serializes to a
 * `<lecture-folder>` tag so the read-only LessonViewer round-trips it.
 */
export const FolderNode = Node.create({
  name: 'lectureFolder',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      label: { default: '', parseHTML: el => el.getAttribute('data-label') ?? '' },
      files: {
        default: [],
        parseHTML: el => parseFiles(el.getAttribute('data-files')),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'lecture-folder',
        getAttrs: el => {
          const node = el;
          return {
            label: node.getAttribute('data-label') ?? '',
            files: parseFiles(node.getAttribute('data-files')),
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const files = Array.isArray(node.attrs.files) ? node.attrs.files : [];
    return [
      'lecture-folder',
      mergeAttributes(
        {},
        {
          'data-label': node.attrs.label ?? '',
          'data-files': JSON.stringify(files),
        },
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FolderNodeView);
  },

  addCommands() {
    return {
      insertLectureFolder:
        attrs =>
        ({ chain, editor }) =>
          chain()
            .focus()
            .insertContentAt(editor.state.selection.$to.pos, [
              { type: this.name, attrs: { label: attrs.label, files: attrs.files } },
              { type: 'paragraph' },
            ])
            .run(),
    };
  },
});
