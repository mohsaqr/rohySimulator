// Capture-pill localisation + accessibility (v3.3.3).
//
// Two halves, matching the repo's app-test conventions:
//   1. behaviour of the pure string module (standalone/app/src/lib/pillStrings.js
//      runs directly under node — same precedent as filterWindows.js);
//   2. source contracts on the TSX/CSS the app has no unit runner for. The
//      real-browser half (lang switch mid-capture, keyboard focus ring,
//      accessible names in the shadow DOM) is tests/e2e/embed-pill.spec.ts.
// Plus the WebGazer element-bundle fix that ships in the same release.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PILL_LANGS,
  PILL_STRING_KEYS,
  PILL_STRING_TABLE,
  formatPillString,
  parsePillLabels,
  parsePillLang,
  pillEmotionLabel,
  pillStrings,
} from '../standalone/app/src/lib/pillStrings.js';
import { resolveWebGazerModule } from '../src/inference/WebGazerAdapter.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// ─── the table: every language, every key, same placeholders ──────────────
{
  // Rohy's UI languages (rohy server/shared/languages.js) — all must be served.
  assert.deepEqual([...PILL_LANGS].sort(), ['de', 'en', 'es', 'fi', 'fr', 'it', 'kk', 'sv']);
  assert.deepEqual(Object.keys(PILL_STRING_TABLE).sort(), [...PILL_LANGS].sort());
  for (const lang of PILL_LANGS) {
    const table = PILL_STRING_TABLE[lang];
    assert.deepEqual(Object.keys(table).sort(), [...PILL_STRING_KEYS].sort(),
      `${lang}: the table must carry exactly the pill keys`);
    for (const key of PILL_STRING_KEYS) {
      assert.equal(typeof table[key], 'string', `${lang}.${key} must be a string`);
      assert.ok(table[key].trim().length > 0, `${lang}.${key} must not be blank`);
      assert.deepEqual(placeholders(table[key]), placeholders(PILL_STRING_TABLE.en[key]),
        `${lang}.${key} must keep exactly the English placeholders`);
    }
    if (lang !== 'en') {
      // Guard against an untranslated copy of English slipping in: a real
      // translation differs on (almost) every key — a few cognates such as
      // es "Error" or sv "Neutral" may legitimately match.
      const differing = PILL_STRING_KEYS.filter((k) => table[k] !== PILL_STRING_TABLE.en[k]);
      assert.ok(differing.length >= PILL_STRING_KEYS.length - 4,
        `${lang}: only ${differing.length}/${PILL_STRING_KEYS.length} keys differ from English`);
    }
  }
  // Plural-free: counts are rendered "label: N", never "N <noun>".
  for (const lang of PILL_LANGS) {
    assert.match(PILL_STRING_TABLE[lang].gazeActive, /:\s*\{count\}$/,
      `${lang}.gazeActive must end with ": {count}" so no plural rule is needed`);
  }
  assert.ok(Object.isFrozen(PILL_STRING_TABLE) && Object.isFrozen(PILL_STRING_TABLE.de),
    'the built-in table is immutable');
}

// ─── lang normalisation ───────────────────────────────────────────────────
{
  const cases = [
    ['de', 'de', true],
    ['de-DE', 'de', true],
    ['DE_at', 'de', true],
    ['  fr  ', 'fr', true],
    ['kk-Cyrl-KZ', 'kk', true],
    ['sv-FI', 'sv', true],
    ['', 'en', true],
    [null, 'en', true],
    [undefined, 'en', true],
    ['xx', 'en', false],
    ['zh-Hant', 'en', false],
    ['-', 'en', true],
  ];
  for (const [input, lang, recognized] of cases) {
    assert.deepEqual(parsePillLang(input), { lang, recognized }, `parsePillLang(${JSON.stringify(input)})`);
  }
}

// ─── labels parsing: validates, never throws ──────────────────────────────
{
  assert.deepEqual(parsePillLabels(null), { labels: null, problems: [] });
  assert.deepEqual(parsePillLabels('   '), { labels: null, problems: [] });

  const ok = parsePillLabels(JSON.stringify({ ready: 'Klar', stopCapture: 'Halt' }));
  assert.deepEqual(ok.labels, { ready: 'Klar', stopCapture: 'Halt' });
  assert.deepEqual(ok.problems, []);

  // Raw JSON, not JSON.stringify of a literal: an object literal's
  // `__proto__` sets the prototype instead of creating the key under test.
  const mixed = parsePillLabels(
    '{"ready":"Klar","bogus":"x","error":42,"paused":"   ","__proto__":{"ready":"polluted"}}',
  );
  assert.deepEqual(mixed.labels, { ready: 'Klar' }, 'only known keys with non-blank strings survive');
  assert.equal(Object.getPrototypeOf(mixed.labels), Object.prototype);
  assert.equal(mixed.problems.length, 4,
    'unknown key, non-string, blank value and __proto__ are each reported');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).ready, undefined, 'no prototype pollution');

  for (const bad of ['{', 'not json', '"a string"', '[1,2]', 'null', '42']) {
    let result;
    assert.doesNotThrow(() => { result = parsePillLabels(bad); }, `parsePillLabels(${bad}) must not throw`);
    assert.equal(result.labels, null, `parsePillLabels(${bad}) falls back to no overrides`);
    assert.equal(result.problems.length, 1, `parsePillLabels(${bad}) reports why`);
  }
  assert.deepEqual(parsePillLabels('{"bogus":"x"}').labels, null,
    'an object with no usable key means no overrides');
}

// ─── resolution: language, English backing, overrides ─────────────────────
{
  const de = pillStrings('de');
  assert.equal(de.ready, 'Bereit');
  assert.equal(de.startCapture, 'Erfassung starten');
  assert.equal(pillStrings('en').ready, 'Ready');
  assert.equal(pillStrings('kk').ready, 'Дайын');

  const overridden = pillStrings('de', { ready: 'Los geht’s' });
  assert.equal(overridden.ready, 'Los geht’s', 'a host label wins over the table');
  assert.equal(overridden.error, 'Fehler', 'keys without an override stay in the chosen language');

  assert.equal(pillStrings(/** @type {any} */ ('xx')).ready, 'Ready',
    'an unknown language still resolves every key (English backing)');
  assert.ok(Object.isFrozen(de));
}

// ─── formatting + emotion labels ──────────────────────────────────────────
{
  assert.equal(formatPillString('Gaze active, samples: {count}', { count: 12 }),
    'Gaze active, samples: 12');
  assert.equal(formatPillString('Gaze status: {status}', {}), 'Gaze status: {status}',
    'a missing value leaves the placeholder visible rather than printing "undefined"');
  assert.equal(formatPillString('{error}', { error: '$& $1' }), '$& $1',
    'replacement patterns in values are inserted literally');

  const de = pillStrings('de');
  assert.equal(pillEmotionLabel(de, 'happy'), 'Freude');
  assert.equal(pillEmotionLabel(de, 'Angry'), 'Wut', "'angry' is an alias of 'anger'");
  assert.equal(pillEmotionLabel(de, 'bored'), 'bored', 'an unknown label passes through');
  assert.equal(pillEmotionLabel(pillStrings('en'), 'surprise'), 'surprise',
    'English keeps the classifier wording the pill always showed');
  // Every classifier label has a localisation.
  const classifierLabels = ['anger', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];
  for (const lang of PILL_LANGS) {
    for (const label of classifierLabels) {
      assert.equal(pillEmotionLabel(pillStrings(lang), label), PILL_STRING_TABLE[lang][`emotion_${label}`],
        `${lang} must localise ${label} from its table`);
    }
  }
}

// ─── CapturePill source contracts ─────────────────────────────────────────
{
  const pill = read('standalone/app/src/components/capture/CapturePill.tsx');

  // No hardcoded English left in the rendered strings.
  for (const literal of [
    "'Ready'", "'Error'", "'camera…'", '"Start capture"', "'Resume'", "'Pause'", '"Stop"',
    'Open Oyon analytics for this session', 'Start capture before opening session analytics',
    'Calibrate gaze tracking', 'Gaze error:', 'Gaze active:',
  ]) {
    assert.ok(!pill.includes(literal), `CapturePill must not hardcode ${literal}`);
  }
  assert.ok(pill.includes("from '@/lib/pillStrings'"), 'strings come from the pillStrings module');
  assert.ok(pill.includes('useBridge((s) => s.lang)') && pill.includes('useBridge((s) => s.labels)'),
    'lang and labels are read from the per-instance bridge');

  // IconBtn: accessible name, tooltip, aria-disabled, focus class.
  const iconBtn = pill.slice(pill.indexOf('function IconBtn('), pill.indexOf('export function CapturePill'));
  assert.match(iconBtn, /label: string;/, 'IconBtn requires a label');
  assert.ok(iconBtn.includes('aria-label={label}'), 'IconBtn exposes the label as its accessible name');
  assert.ok(iconBtn.includes('title={title ?? label}'), 'IconBtn keeps a tooltip');
  assert.ok(iconBtn.includes('aria-disabled={disabled ? true : undefined}'),
    'disabled state is exposed as aria-disabled');
  assert.ok(iconBtn.includes('onClick={disabled ? undefined : onClick}'),
    'an aria-disabled button must not act on click');
  assert.ok(!/\sdisabled=\{disabled\}/.test(iconBtn),
    'native disabled would drop the control from the tab order');
  assert.ok(iconBtn.includes('oyon-pill-focus'), 'IconBtn draws the pill focus ring');

  // Every IconBtn use passes a label; every icon is hidden from AT.
  // The opening tag ends at the first '>' that is not part of an arrow '=>'.
  const uses = pill.split('<IconBtn').slice(1).map((chunk) => chunk.slice(0, chunk.search(/[^=]>/) + 1));
  assert.ok(uses.length >= 5, `expected the pill's icon buttons (found ${uses.length})`);
  for (const use of uses) assert.ok(/\blabel=\{/.test(use), `IconBtn without a label: <IconBtn${use}>`);
  const icons = pill.match(/<(Camera|Loader2|Play|Pause|Square|Crosshair|ExternalLink)\b[^>]*>/g) ?? [];
  assert.ok(icons.length >= 8, `expected every pill icon (found ${icons.length})`);
  for (const icon of icons) assert.ok(icon.includes('aria-hidden="true"'), `icon not aria-hidden: ${icon}`);

  // Headline is a polite live region whose emotion word cannot chatter.
  assert.ok(pill.includes('role="status"') && pill.includes('aria-live="polite"'),
    'headline must be role=status + aria-live=polite');
  assert.ok(pill.includes('aria-hidden={active ? true : undefined}'),
    'the live emotion word is hidden from AT while capturing');
  assert.ok(pill.includes('<span className="sr-only">{liveStatusText}</span>'),
    'a stable capturing/paused status is announced instead');
  // The group is labelled and declares its language.
  assert.ok(pill.includes('role="group"') && pill.includes('aria-label={t.pillLabel}'));
  assert.ok(pill.includes('lang={lang}'), 'the pill root carries the resolved language');
  // The analytics link in combined mode is named too.
  assert.ok(pill.includes('aria-label={t.openAnalytics}'));

  const css = read('standalone/app/src/styles/globals.css');
  const ring = css.slice(css.indexOf('.oyon-pill-focus:focus-visible'));
  assert.ok(ring.includes('outline: 2px solid #a5f3fc'), 'pill focus ring is a light cyan outline');
  assert.ok(ring.includes('outline-offset: 2px'));
  assert.ok(/box-shadow: 0 0 0 6px rgba\(2, 6, 23/.test(ring), 'with a dark halo so it reads on any host background');
}

// ─── element: lang/labels are observed and presentation-only ─────────────
{
  const element = read('standalone/app/src/element.tsx');
  const observed = element.slice(element.indexOf('const OBSERVED'), element.indexOf('] as const;'));
  assert.ok(observed.includes("'lang'") && observed.includes("'labels'"), 'lang and labels are observed');
  assert.ok(element.includes("lang: pillLangAttribute(this.getAttribute('lang'))"),
    'lang is read at connect (Rohy sets attributes before appendChild)');
  assert.ok(element.includes("labels: pillLabelsAttribute(this.getAttribute('labels'))"));

  const changed = element.slice(element.indexOf('attributeChangedCallback('), element.indexOf('async start()'));
  const langCase = changed.slice(changed.indexOf("case 'lang':"), changed.indexOf("case 'sample-events':"));
  assert.ok(langCase.includes('setBridge({ lang: pillLangAttribute(value) })'));
  assert.ok(langCase.includes('setBridge({ labels: pillLabelsAttribute(value) })'));
  for (const forbidden of ['controls', 'stop(', 'start(', 'reactRoot', 'unmount', 'render(']) {
    assert.ok(!langCase.includes(forbidden),
      `a lang/labels change must not touch ${forbidden} (no capture restart, no remount)`);
  }

  // The runtime never reads the presentation fields, so a change can't
  // recreate or reconfigure it.
  const runtime = read('standalone/app/src/lib/runtime.ts');
  const provider = read('standalone/app/src/lib/RuntimeProvider.tsx');
  for (const src of [runtime, provider]) {
    // Bridge reads in these files go through getState() / `bridge` / `b` /
    // a `(s) =>` selector. (`profile.config.labels` — the classifier's label
    // list — is unrelated and allowed.)
    assert.ok(!/\b(getState\(\)|bridge|b|s)\.(lang|labels)\b/.test(src),
      'runtime/RuntimeProvider must not read bridge lang/labels');
  }
  const bridge = read('standalone/app/src/lib/hostBridge.ts');
  assert.ok(bridge.includes("lang: 'en',") && bridge.includes('labels: null,'),
    'standalone default is English with no overrides');

  const docs = read('docs/EMBEDDING.md');
  assert.ok(docs.includes('| attr | `lang` |') && docs.includes('| attr | `labels` |'),
    'the host API table documents lang and labels');
}

// ─── WebGazer: the element bundle never inlines it nor throws for it ─────
{
  const stub = { setGazeListener() {} };
  assert.equal(resolveWebGazerModule({ default: stub }), stub);
  assert.equal(resolveWebGazerModule({ webgazer: stub }), stub);
  assert.equal(resolveWebGazerModule(stub), stub);
  assert.equal(resolveWebGazerModule({ default: null }), null,
    'the element build\'s empty stub module counts as "not bundled"');
  assert.equal(resolveWebGazerModule({ default: {} }), null);
  assert.equal(resolveWebGazerModule(null), null);
  assert.equal(resolveWebGazerModule(undefined), null);

  const adapter = read('src/inference/WebGazerAdapter.js');
  const init = adapter.slice(adapter.indexOf('async init()'), adapter.indexOf('async start()'));
  assert.ok(init.includes("resolveWebGazerModule(await import('webgazer'))"));
  assert.ok(/if \(!webgazer\) \{\s*await this\._loadScriptFallback\(\);/.test(init),
    'an import with no usable WebGazer falls back to the script tag, like a failed import');

  const config = read('standalone/app/vite.element.config.ts');
  assert.ok(config.includes("source === 'webgazer' ? WEBGAZER_STUB_ID : null"),
    'the element build resolves webgazer to the stub');
  assert.ok(config.includes("enforce: 'pre'"), 'before Vite\'s own resolver (and its throwing peer stub)');
  assert.ok(config.includes('plugins: [webgazerNotBundled(), react()]'));

  const appPkg = JSON.parse(read('standalone/app/package.json'));
  assert.ok(appPkg.scripts['build:element'].endsWith('node scripts/verify-element-bundle.mjs dist-element'),
    'build:element verifies the bundle');
}

console.log('app-pill-a11y.test.js passed');
