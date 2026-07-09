import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { McqNodeView } from './McqNodeView';
import { normalizeQuestion, blankQuestion } from './mcqShared';

/**
 * Inline multiple-choice self-check. A single block can hold MULTIPLE
 * questions, each with options + correct index + explanation. Self-contained:
 * the student view checks answers locally (no scores stored). Serializes to a
 * `<lecture-mcq>` tag carrying `data-questions` (JSON).
 *
 * Back-compatible: older single-question nodes (data-question/data-options/
 * data-correct/data-explanation) are read into a one-element questions array.
 */
export const McqNode = Node.create({
  name: 'lectureMcq',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      questions: {
        default: [],
        parseHTML: el => {
          const node = el;
          const raw = node.getAttribute('data-questions');
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed) && parsed.length) return parsed.map(normalizeQuestion);
            } catch {
              /* fall through to legacy */
            }
          }
          // Legacy single-question attributes → one question.
          const legacyQ = node.getAttribute('data-question');
          const legacyOpts = node.getAttribute('data-options');
          if (legacyQ !== null || legacyOpts !== null) {
            let options = ['', ''];
            try { const p = legacyOpts ? JSON.parse(legacyOpts) : []; if (Array.isArray(p)) options = p.map(String); } catch { /* ignore */ }
            return [normalizeQuestion({
              question: legacyQ ?? '',
              options,
              correctIndex: parseInt(node.getAttribute('data-correct') ?? '0', 10) || 0,
              explanation: node.getAttribute('data-explanation') ?? '',
            })];
          }
          return [blankQuestion()];
        },
        renderHTML: attrs => ({ 'data-questions': JSON.stringify(attrs.questions ?? []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'lecture-mcq' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['lecture-mcq', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(McqNodeView);
  },

  addCommands() {
    return {
      insertLectureMcq:
        (attrs = {}) =>
        ({ chain, editor }) =>
          chain()
            .focus()
            .insertContentAt(editor.state.selection.$to.pos, [
              {
                type: this.name,
                attrs: { questions: attrs.questions?.length ? attrs.questions.map(normalizeQuestion) : [blankQuestion()] },
              },
              { type: 'paragraph' },
            ])
            .run(),
    };
  },
});
