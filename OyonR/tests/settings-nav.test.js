import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * The Settings page is driven by lib/settingsNav.ts: that module declares the
 * sections, their order and their grouping, and routes/settings.tsx supplies
 * each section's body keyed by the same id.
 *
 * That split is only safe if the two key sets stay identical. They are plain
 * string keys, so TypeScript is happy either way — a section present in the
 * nav but missing a body renders nothing (an empty group heading), and a body
 * whose id is not in the nav is never rendered at all. Both are silent. This
 * test is the thing that makes them loud.
 *
 * The same defect species has bitten this repo before: AU keys vs
 * ACTION_UNIT_MAP, snapshotSettings vs DEFAULT_SETTINGS, the barrel vs the
 * module list. Hand-maintained mirrors need an assertion, not discipline.
 */

const nav = readFileSync('standalone/app/src/lib/settingsNav.ts', 'utf8');
const page = readFileSync('standalone/app/src/routes/settings.tsx', 'utf8');
const store = readFileSync('standalone/app/src/lib/settingsStore.ts', 'utf8');
const menu = readFileSync('standalone/app/src/components/shell/SubNav.tsx', 'utf8');
const topMenu = readFileSync('standalone/app/src/components/shell/TopMenu.tsx', 'utf8');

/** All `id: 'settings-*'` declared in the nav module. */
const navIds = [...nav.matchAll(/\bid:\s*'(settings-[a-z-]+)'/g)].map((m) => m[1]);
/** All `'settings-*':` body keys in the page's record. */
const bodyIds = [...page.matchAll(/^\s{4}'(settings-[a-z-]+)':\s*\{/gm)].map((m) => m[1]);

assert.ok(navIds.length >= 12, `expected the full section set, found ${navIds.length}`);
assert.equal(
  new Set(navIds).size,
  navIds.length,
  'settingsNav.ts declares a duplicate section id',
);

assert.deepEqual(
  [...navIds].sort(),
  [...bodyIds].sort(),
  'every nav section needs a body in settings.tsx and vice versa — ' +
    `nav only: [${navIds.filter((i) => !bodyIds.includes(i))}], ` +
    `body only: [${bodyIds.filter((i) => !navIds.includes(i))}]`,
);

// Section ids are anchor targets for deep links. Freeze the ones that existed
// before the page was restructured so a future rename has to be deliberate.
for (const frozen of [
  'settings-capture',
  'settings-inference',
  'settings-smoothing',
  'settings-gaze',
  'settings-engagement',
  'settings-facial',
  'settings-posture',
  'settings-heart-rate',
  'settings-respiration',
  'settings-illumination',
  'settings-calibration',
  'settings-profiles',
]) {
  assert.ok(navIds.includes(frozen), `deep-link anchor #${frozen} must not disappear`);
}

// Sections that render their own <Section> live in components/settings/. Their
// ids must match what the nav claims, or the rail links to nothing.
for (const [file, id] of [
  ['standalone/app/src/components/settings/CalibrationSection.tsx', 'settings-calibration'],
  ['standalone/app/src/components/settings/ProfilesSection.tsx', 'settings-profiles'],
]) {
  assert.match(
    readFileSync(file, 'utf8'),
    new RegExp(`id="${id}"`),
    `${file} must keep id="${id}" — the rail anchors to it`,
  );
}

// Every toggleKey must be a real settings key, or the rail's on/off dot and
// the "N/M pipelines on" count read `undefined` and silently show "off".
const toggleKeys = [...nav.matchAll(/toggleKey:\s*'([a-z_]+)'/g)].map((m) => m[1]);
assert.ok(toggleKeys.length >= 7, `expected every sensing pipeline, found ${toggleKeys.length}`);
for (const key of toggleKeys) {
  assert.match(
    store,
    new RegExp(`^\\s*${key}:`, 'm'),
    `toggleKey '${key}' is not a key of DEFAULT_SETTINGS`,
  );
}

// Every settings key that is a pipeline master switch should be represented.
// Catches the reverse drift: a new *_enabled flag added to the store but never
// given a rail dot, so the page shows a pipeline the rail says nothing about.
// Not every `*_enabled` key is a pipeline master switch. `voice_worker_enabled`
// configures HOW voice runs (off-thread vs. main-thread analysis), not WHETHER
// it runs — `voice_enabled` owns that rail dot. A flag that lives inside another
// pipeline's section must not be required to own a section of its own.
const NON_PIPELINE_ENABLED_KEYS = new Set(['voice_worker_enabled']);
const enabledKeys = [...store.matchAll(/^\s{2}([a-z_]+_enabled):/gm)]
  .map((m) => m[1])
  .filter((key) => !NON_PIPELINE_ENABLED_KEYS.has(key));
for (const key of enabledKeys) {
  assert.ok(
    toggleKeys.includes(key),
    `'${key}' is a pipeline switch with no section in settingsNav.ts`,
  );
}

// SubNav must derive both lists from their source modules rather than
// re-listing entries — a second hand-maintained copy is the defect this whole
// test exists to prevent.
assert.match(menu, /SETTINGS_GROUPS/, 'SubNav must render settings from SETTINGS_GROUPS');
assert.match(menu, /analyzeSubTabs/, 'SubNav must render analytics from analyzeSubTabs');
assert.doesNotMatch(
  menu,
  /'settings-(capture|gaze|heart-rate)'/,
  'SubNav must not hard-code section ids',
);

// Group's sub-pages come from lib/groupTabs.ts the same way, and every tab
// must be a real child route of /group (and every child route a tab), or the
// row links to nothing / a page is unreachable from the row.
const groupTabs = readFileSync('standalone/app/src/lib/groupTabs.ts', 'utf8');
const groupRoutes = readFileSync('standalone/app/src/routes/group.tsx', 'utf8');
assert.match(menu, /groupSubTabs/, 'SubNav must render the group pages from groupSubTabs');
assert.doesNotMatch(topMenu, /groupSubTabs/, 'the top bar must not also list the group pages — SubNav owns them');
assert.match(topMenu, /to: '\/group'/, 'the Group section must stay a top-bar link to /group');
const groupTabPaths = [...groupTabs.matchAll(/to: '\/group(\/[a-z-]+)'/g)].map((m) => m[1]);
const groupChildPaths = [...groupRoutes.matchAll(/getParentRoute: \(\) => groupRoute,\s*path: '(\/[a-z-]+)'/g)].map((m) => m[1]);
assert.ok(groupTabPaths.length >= 7, `expected every group page in groupTabs.ts, found ${groupTabPaths.length}`);
assert.deepEqual(
  [...groupTabPaths].sort(),
  [...groupChildPaths].sort(),
  'every group tab needs a child route of /group and vice versa',
);
assert.match(groupTabs, /GROUP_LANDING = '\/group\/overview'/, '/group must land on Overview');
assert.doesNotMatch(groupRoutes, /useState\(/, 'group state lives in lib/groupStore.ts, not in the layout');

// Sub-navigation must stay VISIBLE, not collapse into a dropdown. Burying the
// destinations reduced the level count but hid the map: you could no longer
// see what a section contained without opening something. SubNav is a plain
// row of links/buttons — no popover.
assert.doesNotMatch(menu, /MenuPopover/, 'sub-navigation must not be hidden behind a popover');

// Chrome budget: the top bar keeps ONE band, and everything that is reference
// material rather than navigation stays folded into it.
assert.match(topMenu, /FilterControls/, 'scope filters must fold into the top bar');
assert.match(topMenu, /SessionContextPanel/, 'session context must fold into the top bar');
assert.doesNotMatch(
  topMenu,
  /analyzeSubTabs/,
  'the top bar must not also list the analytics domains — SubNav owns them',
);

// The section is labelled "Analytics" but the ROUTE stays /analyze, so every
// existing deep link keeps working. A rename that moved the route would break
// them silently.
assert.match(topMenu, /label: 'Analytics'/, 'the section must be labelled Analytics');
assert.match(topMenu, /to: '\/analyze'/, 'the Analytics route id must stay /analyze');

// Starting the camera must land on Live: the dock is reachable everywhere, so
// starting from Settings otherwise produces signal with no visible readout.
const miniCamera = readFileSync('standalone/app/src/components/shell/MiniCamera.tsx', 'utf8');
assert.match(
  miniCamera,
  /navigate\(\{ to: '\/live' \}\)/,
  'starting the camera must navigate to Live',
);

const analyzeRoute = readFileSync('standalone/app/src/routes/analyze.tsx', 'utf8');
assert.doesNotMatch(
  analyzeRoute,
  /role="tablist"/,
  'Analyze must not render its own tab row — the top bar owns navigation',
);
assert.doesNotMatch(
  analyzeRoute,
  /<PageHeader/,
  'Analyze must not render a page header band',
);
assert.doesNotMatch(
  page,
  /role="tablist"/,
  'Settings must not render its own tab column — the top bar owns navigation',
);

// The active section comes from the URL, so there is no second source of
// truth: the menu navigates, the hash changes, the page re-renders. Holding
// it in local state as well is what makes deep links and Back drift apart.
assert.match(
  page,
  /useRouterState\(\{ select: \(s\) => s\.location\.hash \}\)/,
  'the active settings section must be derived from the router hash',
);
assert.doesNotMatch(
  page,
  /window\.addEventListener\('hashchange'/,
  'a manual hashchange listener means the hash is being mirrored into state',
);

// The old "Privacy" framing claimed the validator protects privacy, which
// contradicts the authoritative data policy (validator = transport shape, and
// the app is explicitly NOT a privacy gatekeeper).
assert.doesNotMatch(
  page,
  /Denied at transport|title="Privacy"/,
  'the transport section must not be framed as a privacy guarantee',
);
assert.match(
  page,
  /not<\/strong> a privacy gate/,
  'the transport section must state plainly that it is not a privacy gate',
);

console.log('settings-nav.test.js — all cases passed');
