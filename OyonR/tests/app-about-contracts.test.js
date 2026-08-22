import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const about = readFileSync('standalone/app/src/routes/about.tsx', 'utf8');
const router = readFileSync('standalone/app/src/router.ts', 'utf8');
const menu = readFileSync(
  'standalone/app/src/components/shell/TopMenu.tsx',
  'utf8',
);
const license = readFileSync('LICENSE', 'utf8').trim();

assert.match(router, /aboutRoute/, 'the About page must be registered');
assert.ok(
  menu.includes("{ to: '/about', label: 'About', icon: Info }"),
  'the main navigation must expose About',
);

assert.match(
  about,
  /OYON_VERSION/,
  'the About page version must come from the release-verified runtime constant',
);
assert.doesNotMatch(
  about,
  /const (?:OYON_)?VERSION\s*=/,
  'the About page must not maintain a second hard-coded version',
);
assert.match(about, /LACARM ecosystem/, 'LACARM stewardship must be explicit');
assert.match(
  about,
  /Oyon is a multimodal software platform for real-time/,
  'the user-authored About description must be present',
);
assert.match(
  about,
  /built on the Carm/,
  'the About description must identify the Carm software framework',
);
const normalizedAbout = about.toLowerCase();
for (const capability of [
  'physiological analytics',
  'respiration',
  'facial action signals',
  'body posture',
  'sensing diagnostics',
  'gaze calibration',
  'area-of-interest dwell',
  'transition networks',
  'sequence plots',
  'spell statistics',
  'pattern analysis',
  'cohort comparison',
  'reproducibility-bundle export',
  'standalone research application',
  'embeddable oyon web component',
]) {
  assert.ok(
    normalizedAbout.includes(capability),
    `the About description must include the implemented capability: ${capability}`,
  );
}
assert.match(
  about,
  /Carm Research License v1\.4/,
  'the Carm Research License version must be named',
);
assert.doesNotMatch(
  about,
  /Oyon is (?:released|licensed) under the MIT/,
  'the About page must not claim Oyon itself is MIT',
);
assert.ok(
  about.includes("import CARM_LICENSE from '../../../../LICENSE?raw';"),
  'the About page must render the repository license file verbatim',
);
assert.match(license, /^# Carm Research License v1\.4/m);

/*
 * Third-party licences must be IMPORTED as raw text, never fetched. The Carm
 * Licence requires redistributed copies to carry the text itself rather than a
 * link, and this app embeds into host pages whose CSP would block a runtime
 * request anyway — so a fetch would render an empty licence section in exactly
 * the deployment where the obligation matters most.
 */
for (const raw of [
  'licenses/GPL-3.0-or-later.txt?raw',
  'licenses/webgazer.LICENSE.txt?raw',
  'licenses/onnxruntime-web.LICENSE.txt?raw',
  'licenses/mediapipe.LICENSE.txt?raw',
  'licenses/silero-vad.LICENSE.txt?raw',
  'licenses/webeyetrack.LICENSE.txt?raw',
]) {
  assert.ok(
    about.includes(raw),
    `the About page must embed ${raw} so the text ships in the bundle`,
  );
}
assert.doesNotMatch(
  about,
  /fetch\(\s*['"`]https:\/\/raw\.githubusercontent/,
  'licence text must be bundled at build time, never fetched at runtime',
);

/*
 * Every panel must ALSO carry a live upstream link. The bundled text says what
 * this build is licensed under; the link says where that licence lives now.
 * Shipping only the text would leave a reader unable to tell they are behind.
 */
assert.match(
  about,
  /Latest upstream licence/,
  'each third-party panel must link its live upstream licence alongside the embedded text',
);
assert.match(
  about,
  /Latest version/,
  'the Carm licence card must link the always-current version beside the pinned text',
);
assert.match(
  about,
  /carm-license\/main\/LICENSE\.txt/,
  'the always-current Carm URL must track main, not the pinned tag',
);
// The copyleft engine must be visibly flagged, not listed like the MIT ones.
assert.match(about, /copyleft/, 'the GPL gaze engine must be flagged as copyleft on the page');

/*
 * Vendored first-party code must still be NAMED even though the Carm License
 * already covers it. Otherwise "we ship dynajs" and "we ship nothing extra"
 * look identical to a reader — which is exactly how dynajs went unmentioned in
 * the notices for as long as it did.
 */
assert.match(
  about,
  /Vendored Carm ecosystem code/,
  'the About page must name vendored first-party code even when it needs no separate license',
);
assert.match(about, /standalone\/vendor\/ladyna/, 'the About page must name where ladyna is vendored');
assert.doesNotMatch(
  about,
  /ladyna[^)]{0,80}MIT/,
  'ladyna is Carm-licensed like the rest of the ecosystem — it must not be shown as MIT',
);

console.log('app-about-contracts.test.js passed');
