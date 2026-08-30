/**
 * Copy this file to Rohy `src/plugins/ecg/index.jsx` beside `manifest.js`.
 * This is the entire host adapter; the vendored package imports nothing from
 * Rohy and remains byte-identical to upstream.
 */
import { manifest } from './manifest.js';
import { EcgRoom } from './EcgRoom.jsx';
import { EcgCaseAuthor } from './EcgCaseAuthor.jsx';
import {
  case_document_is_servable,
  case_document_issues,
  case_document_summary,
  learner_case,
} from '../../components/ecg/caseDocument.js';

export default {
  manifest,
  component: EcgRoom,
  available: (ctx) => case_document_is_servable(ctx.data),
  validate: (document) => case_document_issues(document)
    .map(({ level, message }) => ({ level, message })),
  summarize: (document) => {
    const summary = case_document_summary(document);
    return { count: summary.count, labelKey: summary.label_key };
  },
  props: (ctx, persist) => ({
    ecg_case: learner_case(ctx.data),
    event_logger: ctx.eventLogger,
    exam_mode: ctx.session.examMode,
    initial_work: persist.state,
    on_work_change: (next) => persist.save(next),
  }),
  authorComponent: EcgCaseAuthor,
  authorProps: (_ctx, draft) => ({
    initial_document: draft.value ?? undefined,
    on_change: draft.save,
  }),
};
