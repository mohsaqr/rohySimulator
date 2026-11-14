export const OYON_VERSION: string;
export const OYON_HOST_CONTRACT_VERSION: string;

/** The batch schema Oyon emits. v4 added the `modality` discriminator. */
export const OYON_WINDOW_BATCH_SCHEMA_VERSION: 'oyon-window-batch-v4';

/** Schemas the validator accepts. v3 stays supported for hosts on the older contract. */
export const OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS: readonly string[];

/** Modality a window may declare. `emotion` is the camera pipeline's own window. */
export type OyonModality =
  | 'emotion'
  | 'engagement'
  | 'facial'
  | 'gaze'
  | 'heart_rate'
  | 'posture'
  | 'respiration'
  | 'illumination'
  | 'typing'
  | 'discourse'
  | 'interaction'
  | 'ai_assist'
  | 'voice'
  | 'document_edit'
  | 'code_run'
  | 'raw';

export const OYON_MODALITIES: readonly OyonModality[];

/** Fixed-interval camera window, or a host-bounded episode (typing, voice). */
export type OyonWindowKind = 'interval' | 'episode';

export const OYON_WINDOW_KINDS: readonly OyonWindowKind[];

/** Document edits a host reports for a document it owns (host contract 3.2). */
export const OYON_DOCUMENT_EDIT_STATES_VERSION: 'document-edit-states-v1';
export const OYON_DOCUMENT_EDIT_STATES: readonly string[];

/** Code runs a host reports: start and how it ended (host contract 3.2). */
export const OYON_CODE_RUN_STATES_VERSION: 'code-run-states-v1';
export const OYON_CODE_RUN_STATES: readonly string[];
