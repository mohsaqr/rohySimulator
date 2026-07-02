import type { EmotionWindow, OyonSettings } from 'oyon';
import type { SessionSummary } from './sessions';

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

export interface ExportBundle {
  schema_version: '1.0';
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

- \`windows.json\`  — every aggregate EmotionWindow recorded for this session
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
- Per-frame predictions. Only aggregate 10-second windows are retained.

## How to read

\`\`\`bash
jq '.session' bundle.json                  # one-line summary
jq '.windows | length' bundle.json         # number of aggregate windows
jq '.windows[0]' bundle.json               # shape of one window
jq '.settings' bundle.json                 # full parameter snapshot
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
}): ExportBundle {
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    generator: 'oyon-app',
    session: args.summary,
    windows: args.windows,
    settings: args.settings,
    model: args.model,
    readme: README_TEMPLATE,
  };
}

/*
 * Multi-session bundle — same provenance posture as the single-session
 * variant, but carries an array of sessions. Useful for comparison
 * studies where reviewers want every condition in one file.
 */
export interface MultiSessionBundle {
  schema_version: '1.0';
  variant: 'multi';
  generated_at: string;
  generator: 'oyon-app';
  sessions: Array<{
    summary: SessionSummary;
    windows: EmotionWindow[];
  }>;
  settings: OyonSettings;
  model: { name: string; version: string; label: string };
  readme: string;
}

export function buildMultiSessionBundle(args: {
  groups: Array<{ summary: SessionSummary; windows: EmotionWindow[] }>;
  settings: OyonSettings;
  model: { name: string; version: string; label: string };
}): MultiSessionBundle {
  return {
    schema_version: '1.0',
    variant: 'multi',
    generated_at: new Date().toISOString(),
    generator: 'oyon-app',
    sessions: args.groups,
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
