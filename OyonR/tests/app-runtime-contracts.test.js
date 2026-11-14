import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtime = readFileSync('standalone/app/src/lib/runtime.ts', 'utf8');
const provider = readFileSync('standalone/app/src/lib/RuntimeProvider.tsx', 'utf8');
const preview = readFileSync('standalone/app/src/components/capture/CameraPreview.tsx', 'utf8');

assert.match(runtime, /sessionIdRef/, 'runtime must keep one stable session id per capture run');
assert.doesNotMatch(
  provider,
  /standalone-\$\{runtime\.windowCount\}/,
  'TopBar session id must not be synthesized from windowCount',
);
assert.doesNotMatch(
  provider,
  /runtime\.start\(\)\.catch/,
  'RuntimeProvider must not auto-start camera without a user gesture',
);
assert.match(
  preview,
  /srcObject = runtime\.cameraStream/,
  'CameraPreview must rebind the existing MediaStream after route changes',
);

// A declined camera must actually prevent capture — every time, not once.
//
// The first version of this check lived inside ensureRuntime(), which opens
// with `if (runtimeRef.current) return runtimeRef.current`. Once a runtime had
// been built the builder short-circuits, so the guard stopped running and a
// participant who declined AFTER a first capture could still start sensing.
// The check therefore belongs in start(), ahead of ensureRuntime().
{
  const startBody = runtime.match(/const start = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[/);
  assert.ok(startBody, 'could not locate start()');
  assert.match(
    startBody[0],
    /cameraAllowed\(/,
    'start() must check camera consent on every call',
  );

  // Compare CODE positions, not text positions: the comment above the guard
  // names ensureRuntime() to explain why the check is not in there, and a
  // naive indexOf finds that mention first and fails on correct code.
  const code = startBody[0].replace(/\/\/.*$/gm, '');
  const guardAt = code.indexOf('cameraAllowed(');
  const buildAt = code.indexOf('ensureRuntime()');
  assert.ok(
    guardAt !== -1 && buildAt !== -1 && guardAt < buildAt,
    'the consent check must run BEFORE ensureRuntime() — no camera may be requested first',
  );

  const ensureBody = runtime.match(/const ensureRuntime = useCallback[\s\S]*?\n  \}, \[/);
  assert.ok(ensureBody, 'could not locate ensureRuntime()');
  assert.doesNotMatch(
    ensureBody[0],
    /cameraAllowed\(/,
    'ensureRuntime() is memoized, so a consent check there enforces only once',
  );

  // Withdrawal mid-capture must stop the current run, not merely the next one:
  // the agreement's own words are "sensing stops straight away".
  assert.match(
    runtime,
    /cameraConsented[\s\S]*?void stop\(\)/,
    'declining the camera during a capture must stop it',
  );

  // consent_version is the whole audit trail, and it was a hardcoded string.
  //
  // EmotionRuntime stamps `consentVersion` onto every window. While it read a
  // build-time literal, the "custom agreement text is hashed and the hash is
  // stamped on each window" contract in docs/CONSENT_PLAN.md was simply not
  // true: an operator could edit the wording afterwards and no record showed
  // which version anyone actually agreed to.
  assert.doesNotMatch(
    runtime,
    /consentVersion:\s*'standalone-app-v1'/,
    'consentVersion must not be a hardcoded literal — it is the audit trail',
  );
  assert.match(
    runtime,
    /consentVersion:\s*\n?\s*useConsent\.getState\(\)\.answeredVersion/,
    'consentVersion must be the version the participant actually agreed to',
  );

  // The runtime is memoized, so a changed answer must force a rebuild —
  // otherwise the cached instance keeps the old sensor mask AND stamps the
  // version the participant no longer agreed to.
  assert.match(
    code,
    /consentBuildSignature\([\s\S]*?runtimeRef\.current = null/,
    'a changed consent answer must discard the cached runtime',
  );
}

const settingsStore = readFileSync('standalone/app/src/lib/settingsStore.ts', 'utf8');
const live = readFileSync('standalone/app/src/routes/live.tsx', 'utf8');

// Pre-start, /live must preview the USER's settings, not library defaults —
// where every v3 sensing pipeline is off. Otherwise an enabled pipeline reads
// "off · enable in Settings" until capture starts.
assert.match(
  runtime,
  /settingsRef\.current\s*\n?\s*\?\?\s*\(createOyonSettings\(oyonSettingsInput\(useSettings\.getState\(\)\)\)/,
  'pre-start settings preview must build from the editable settings store',
);
assert.doesNotMatch(
  runtime,
  /settingsRef\.current \?\? createOyonSettings\(\{ model_profile: modelProfile \}\)/,
  'pre-start settings must not fall back to bare library defaults',
);

// snapshotSettings must enumerate DEFAULT_SETTINGS rather than hand-listing
// keys: a forgotten key silently drops that setting from saved profiles with
// no type error.
assert.match(
  settingsStore,
  /Object\.keys\(DEFAULT_SETTINGS\)/,
  'snapshotSettings must derive its key set from DEFAULT_SETTINGS',
);

// Every v3 sensing pipeline surfaces per-sample on /live.
for (const slice of ['lastFacial', 'lastPosture', 'lastHeartRate']) {
  assert.match(runtime, new RegExp(`${slice},`), `runtime must expose ${slice}`);
  assert.match(live, new RegExp(slice), `/live must consume ${slice}`);
}

// The Window-summary grid must be symmetric: a hardcoded column count goes
// ragged the moment a tile is added (8 tiles in a 6-col grid = 6 + 2 orphans).
assert.match(
  live,
  /symmetricColumns\(SUMMARY_TILES\)/,
  'the summary grid must derive its column count from the tile count',
);
assert.doesNotMatch(
  live,
  /grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6/,
  'the summary grid must not hardcode a column count',
);
{
  // Tile count and the declared constant must agree, or the grid is symmetric
  // in name only.
  const declared = Number(live.match(/const SUMMARY_TILES = (\d+)/)?.[1]);
  const summary = live.slice(live.indexOf('id="live-summary"'), live.indexOf('id="live-structure"'));
  const actual = (summary.match(/<Metric\b/g) || []).length;
  assert.equal(actual, declared, `SUMMARY_TILES says ${declared} but ${actual} <Metric> tiles are rendered`);
  const columns = [6, 5, 4, 3].find((count) => declared % count === 0) ?? 4;
  assert.equal(declared % columns, 0, 'tile count must divide evenly into full rows');
}

const position = readFileSync('standalone/app/src/routes/analyze/sensing.tsx', 'utf8');
const fixture = readFileSync('standalone/app/src/legacy/demoFixture.js', 'utf8');
const auMap = readFileSync('src/inference/FacialSignalExtractor.js', 'utf8');

// The Position tab must DISCOVER action-unit keys from the payload. It used to
// hardcode 7 names while the extractor emits 14 — dropping eye_squint,
// mouth_press and both brow_raise variants, so a session whose loudest
// expressions were exactly those rendered blank. A hardcoded allowlist also
// violates the data policy and silently re-breaks whenever the extractor gains
// a signal; reading keys off the payload cannot.
assert.doesNotMatch(
  position,
  /const AU_KEYS\s*=/,
  'the Position tab must not hardcode an action-unit list',
);
assert.match(position, /discoverKeys\(/, 'AU keys must be discovered from the data');
assert.match(position, /blendshapes_mean/, 'raw blendshapes must be exposed too');

// The demo fixture must mirror the real extractor, or demo data hides the very
// gap this fixes.
{
  const auKeys = [...auMap.matchAll(/^\s{2}([a-z_]+):\s*\[/gm)].map((m) => m[1]);
  assert.ok(auKeys.length >= 14, `expected >=14 AUs in ACTION_UNIT_MAP, found ${auKeys.length}`);
  const block = fixture.slice(fixture.indexOf('action_units_mean: {'), fixture.indexOf('blendshapes_mean: {'));
  for (const k of auKeys) {
    assert.ok(block.includes(`${k}:`), `demo fixture is missing action unit "${k}"`);
  }
}

// One makeFacial, one of each block — guards the duplicate-splice mistake that
// produced a syntactically valid file with a shadowed second definition.
for (const [needle, label] of [['function makeFacial(', 'makeFacial'], ['action_units_mean: {', 'action_units_mean'], ['blendshapes_mean: {', 'blendshapes_mean']]) {
  const n = fixture.split(needle).length - 1;
  assert.equal(n, 1, `demoFixture must define ${label} exactly once (found ${n})`);
}

// Rate readouts are coloured by TRUST, from one shared mapping — the same
// number must not be green on one surface and amber on another. The beating
// dot in particular was hardcoded red, which reads as "bad" permanently and
// wastes the channel the eye reads first.
{
  const tone = readFileSync('standalone/app/src/lib/vitalsTone.ts', 'utf8');
  const signals = readFileSync('standalone/app/src/components/live/LiveSignals.tsx', 'utf8');
  assert.match(tone, /outside \$\{min\}/, 'out-of-band must be reported as its own reason');
  assert.match(signals, /vitalTone\(/, 'the live tile must use the shared trust mapping');
  assert.doesNotMatch(
    signals,
    /background: 'var\(--status-bad\)',\n\s*animation: `oyon-beat/,
    'the pulse dot must not be hardcoded red',
  );
  assert.match(live, /vitalTone\(/, 'the summary metrics must use the same mapping');
}

// Every editable setting must actually REACH the library.
//
// oyonSettingsInput() hand-lists the keys it forwards, so a setting can exist
// in the store, render a control, persist to localStorage and count toward
// settings_hash while never being passed to createOyonSettings — the user
// moves a slider and nothing happens, with no type error anywhere.
//
// This is how heart_rate_target_fps went missing: the library had it, the app
// never carried it, so the ROI sampling rate was silently pinned to the
// library default and had no control at all.
{
  const block = settingsStore.match(
    /export const DEFAULT_SETTINGS: EditableSettings = \{([\s\S]*?)\n\};/,
  );
  assert.ok(block, 'could not locate DEFAULT_SETTINGS');
  const keys = [...block[1].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 25, `expected the full settings set, found ${keys.length}`);

  const input = runtime.match(
    /function oyonSettingsInput\(editable: EditableSettings\)[\s\S]*?\n\}/,
  );
  assert.ok(input, 'could not locate oyonSettingsInput');

  // App-only settings: host-side POLICY, not library parameters. The FER
  // module must not decide who may be captured (docs/ARCHITECTURE.md
  // anti-coupling), so the consent gate never reaches createOyonSettings — it
  // masks `editable` before buildRuntime instead (see runtime.ts).
  //
  // Listed explicitly, and asserted ABSENT below, so this exemption cannot
  // quietly grow into a hole that hides a genuinely unforwarded setting.
  const APP_ONLY = ['consent_required', 'consent_text'];

  const forwarded = (k) => new RegExp(`\\b${k}: editable\\.${k}\\b`).test(input[0]);

  const missing = keys.filter((k) => !APP_ONLY.includes(k) && !forwarded(k));
  assert.deepEqual(
    missing,
    [],
    `these settings are editable but never forwarded to the library: ${missing.join(', ')}`,
  );

  const leaked = APP_ONLY.filter(forwarded);
  assert.deepEqual(
    leaked,
    [],
    `app-only policy settings must not be forwarded to the library: ${leaked.join(', ')}`,
  );
}

// The page header was collapsed from a three-line block to one line, because
// it was the only non-interactive band in a four-deep stack of chrome and
// pushed real content a third of the way down the viewport.
//
// The title is now visually quiet — which is exactly when someone is tempted
// to "simplify" it into a <div>. It must stay an <h1>: it is the document
// heading screen readers jump to, and demoting it breaks heading-order
// navigation to save nothing.
{
  const header = readFileSync('standalone/app/src/components/shell/PageHeader.tsx', 'utf8');
  assert.match(header, /<h1\b/, 'the page title must remain an h1 for heading navigation');
  assert.doesNotMatch(
    header,
    /\beyebrow\?:/,
    'the eyebrow prop is gone — the nav already says which section you are in',
  );
  assert.doesNotMatch(
    header,
    /text-2xl/,
    'the page title must not go back to a 2xl block heading',
  );
}

// Raw-only envelopes (modality 'raw') reach the host event but are not
// counted as emotion windows in the live counter or the recent list.
assert.match(runtime, /const emotion = normalized\.filter\(\(w\) => !isRawOnly\(w\)\);/);
assert.match(runtime, /setWindowCount\(\(n\) => n \+ emotion\.length\)/);
assert.match(runtime, /emitHostEvent\('oyon:window', \{\s*windows: normalized,/);
console.log('app-runtime-contracts.test.js passed');
