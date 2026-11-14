import type { EmotionWindow, OyonLogEvent, OyonMetric, OyonSettings } from 'oyon';
import type { SessionSummary } from './sessions';
import { collectRecords } from './exportRecords';
import { readRuntimeLog } from './runtimeLogStore';
import { readStoredRawOnly } from './storedWindows';
import { splitRawOnly } from './rawOnly';

/*
 * Reproducibility export bundle — the artifact you hand a peer reviewer.
 *
 * A bundle for one session contains:
 *   1. windows.json    — every EmotionWindow for that session_id
 *   2. summary.json    — derived KPIs (so reviewers don't have to re-derive)
 *   3. settings.json   — current OyonSettings snapshot (versioned, hashed)
 *   4. model.json      — model name + version + (if available) model card
 *   5. README.md       — how the bundle was produced + how to interpret it
 *
 * For the Phase D first cut, the bundle is a single JSON object combining
 * the above (no zip). That makes the export one click + one file. Once
 * Phase D.1 adds the actual zip layer (jszip), this same shape becomes
 * the inner manifest.
 */

/** Every other record kind of the session, so the bundle is the whole log. */
export interface SessionRecords {
  /** Episode windows: typing episodes, voice turns, AI-assist cycles. */
  signal_windows: Array<Record<string, unknown>>;
  /** Per-event states: typing, interaction, ai_assist, voice, document_edit, code_run. */
  signal_events: Array<Record<string, unknown>>;
  /** `oyon-log-v1` runtime (or host) log events. */
  log_events: Array<OyonLogEvent | Record<string, unknown>>;
  /** `oyon-metric-v1` runtime metrics. */
  metrics: Array<OyonMetric | Record<string, unknown>>;
  /** Raw-only envelopes (`modality: 'raw'`): per-sample rows no camera window carried (sent at stop, at the recorder's row bound, or when a track ended). */
  raw_windows: Array<Record<string, unknown>>;
}

export interface ExportBundle extends SessionRecords {
  /** 1.1 adds signal_windows, signal_events, log_events, metrics and raw_windows. */
  schema_version: '1.1';
  generated_at: string;
  generator: 'oyon-app';
  session: SessionSummary;
  windows: EmotionWindow[];
  settings: OyonSettings;
  model: {
    name: string;
    version: string;
    label: string;
  };
  readme: string;
}

const README_TEMPLATE = `# Oyon Reproducibility Bundle

This bundle was exported from the Oyon Research Instrument shell.
The contents are intended to make any analytic finding from this session
re-runnable by a reviewer without access to the original device.

## Files

- \`windows\`        — every interval window (camera) of this session, each with
  its per-sample \`raw_streams\` (a session with no camera has none; its other
  records are below). A comparison bundle holds these five kinds under
  \`records\`, for every compared session or person.
- \`signal_windows\` — typing episodes, voice turns, AI-assist cycles
- \`signal_events\`  — every per-event state (typing, interaction, AI, voice,
  document edit, code run)
- \`log_events\`     — the runtime log (oyon-log-v1): start, stop, errors, sync
- \`metrics\`        — runtime metrics (oyon-metric-v1)
- \`raw_windows\`    — raw-only envelopes (modality \`raw\`): per-sample rows
  no camera window carried (sent at stop, at the recorder's row bound, or
  when a face track ended). Split windows are already joined back.
- \`summary.json\`  — derived per-session KPIs (counts, means, dominant emotion)
- \`settings.json\` — the OyonSettings profile under which this data was captured
- \`model.json\`    — emotion classifier identity (name + version)

## Provenance

- Camera + inference: device-local (no raw frames left the browser).
- Aggregate window length, smoothing parameters, and validator deny-list are
  visible in \`settings.json\`. The \`settings_hash\` field uniquely identifies
  the parameter set so the same hash → the same processing pipeline.
- Calibration provenance is preserved per-window in the \`gaze\` block under
  \`calibration_quality\` / \`calibration_confidence\` / \`calibration_age_ms\`.

## What's NOT in this bundle

- Raw video frames, images, or landmarks. By design — see
  \`src/validation/validateEmotionPayload.js\` for the validator deny-list.
- Text the person typed or said. Typing and voice records carry timing and
  counts, never content.

## How to read

\`\`\`bash
jq '.session' bundle.json                  # one-line summary
jq '.windows | length' bundle.json         # number of aggregate windows
jq '.windows[0]' bundle.json               # shape of one window
jq '.settings' bundle.json                 # full parameter snapshot
jq '.signal_events | group_by(.modality) | map({(.[0].modality): length}) | add' bundle.json
\`\`\`

## Ethical use

Aggregate facial-expression signals are not ground-truth emotions.
This bundle is suitable for descriptive analytics, calibration auditing,
and inter-rater agreement studies. It is NOT suitable for grading,
ranking, automated decision-making about individuals, or any context
prohibited by the EU AI Act (Article 5 / Recital 44).
`;

export function buildSessionBundle(args: {
  summary: SessionSummary;
  windows: EmotionWindow[];
  settings: OyonSettings;
  model: { name: string; version: string; label: string };
  /** The session's other record kinds; a kind left out is empty. */
  records?: Partial<SessionRecords>;
}): ExportBundle {
  return {
    schema_version: '1.1',
    generated_at: new Date().toISOString(),
    generator: 'oyon-app',
    session: args.summary,
    windows: args.windows,
    signal_windows: args.records?.signal_windows ?? [],
    signal_events: args.records?.signal_events ?? [],
    log_events: args.records?.log_events ?? [],
    metrics: args.records?.metrics ?? [],
    raw_windows: args.records?.raw_windows ?? [],
    settings: args.settings,
    model: args.model,
    readme: README_TEMPLATE,
  };
}

/** The record sets a surface may draw (useOverviewRecords().inScope). */
export interface BundleRecordSets {
  signalWindows: Array<Record<string, unknown>>;
  signalEvents: Array<Record<string, unknown>>;
  logEvents: Array<Record<string, unknown>>;
}

/**
 * Every non-window record `keep` accepts, for a bundle: episode windows and
 * events from the surface's sets; the log and metrics from the runtime's own
 * store, read whole at export time — or, under a host feed, the feed's log
 * events (a feed has no metrics).
 */
export async function bundleRecords(args: {
  sets: BundleRecordSets;
  fed: boolean;
  keep: (record: object) => boolean;
  /** Under a host feed: the fed windows, whose raw-only envelopes are exported. */
  fedWindows?: ReadonlyArray<object> | null;
}): Promise<SessionRecords> {
  const runtimeLog = args.fed ? null : await readRuntimeLog();
  const rawWindows = args.fed ? splitRawOnly(args.fedWindows ?? []).rawOnly : await readStoredRawOnly();
  return collectRecords({
    signalWindows: args.sets.signalWindows,
    signalEvents: args.sets.signalEvents,
    logEvents: runtimeLog?.logEvents ?? args.sets.logEvents,
    metrics: runtimeLog?.metrics ?? [],
    rawWindows,
  }, args.keep);
}

/*
 * Multi-session bundle — same provenance posture as the single-session
 * variant, but carries an array of sessions. Useful for comparison
 * studies where reviewers want every condition in one file.
 */
export interface MultiSessionBundle {
  /** 1.1 adds `records`: every other record kind of the compared sessions (or people). */
  schema_version: '1.1';
  variant: 'multi';
  generated_at: string;
  generator: 'oyon-app';
  sessions: Array<{
    summary: SessionSummary;
    windows: EmotionWindow[];
  }>;
  /** Episode windows, events, log and metrics of every compared session (or person). */
  records: SessionRecords;
  settings: OyonSettings;
  model: { name: string; version: string; label: string };
  readme: string;
}

export function buildMultiSessionBundle(args: {
  groups: Array<{ summary: SessionSummary; windows: EmotionWindow[] }>;
  /** The compared sessions' other record kinds; a kind left out is empty. */
  records?: Partial<SessionRecords>;
  settings: OyonSettings;
  model: { name: string; version: string; label: string };
}): MultiSessionBundle {
  return {
    schema_version: '1.1',
    variant: 'multi',
    generated_at: new Date().toISOString(),
    generator: 'oyon-app',
    sessions: args.groups,
    records: {
      signal_windows: args.records?.signal_windows ?? [],
      signal_events: args.records?.signal_events ?? [],
      log_events: args.records?.log_events ?? [],
      metrics: args.records?.metrics ?? [],
      raw_windows: args.records?.raw_windows ?? [],
    },
    settings: args.settings,
    model: args.model,
    readme: README_TEMPLATE,
  };
}

export function downloadMultiSessionBundle(
  bundle: MultiSessionBundle,
  filename?: string,
): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename ??
    `oyon-comparison-${bundle.sessions.length}sessions-${bundle.generated_at.slice(0, 19).replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Trigger a browser download of the bundle as a JSON file. */
export function downloadBundle(bundle: ExportBundle, filename?: string): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename ??
    `oyon-bundle-${bundle.session.sessionId}-${bundle.generated_at.slice(0, 19).replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
