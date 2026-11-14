import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * app-phone-layout.test.js — the shell must stay usable on a phone.
 *
 * The app was responsive at the CONTENT level (the dashboards already collapse
 * their grids at sm/md/lg) and desktop-only at the SHELL level, which is the
 * part no grid utility can fix. Measured at 390 px before this suite existed:
 *
 *   - the camera dock was a fixed `w-72` COLUMN with no mobile rule, so it took
 *     288 of 390 px and left <main> 102 px wide holding 435 px of content;
 *   - the primary nav's labels are `sr-only` until `xl` (1280 px), so a phone
 *     got eight visually identical unlabelled icons;
 *   - SubNav's 13 Settings entries wrapped to THREE stacked rows;
 *   - a `whitespace-nowrap` StatusPill and a `minmax(300px, 1fr)` grid track
 *     each refused to shrink and dragged the whole page wider than the screen.
 *
 * These assertions pin the fixes that are invisible in a desktop browser, so a
 * later change cannot silently undo them. They are deliberately about
 * STRUCTURE (does a phone branch exist at all) rather than exact class
 * strings, except where a specific token is the whole fix.
 */

const read = (p) => readFileSync(p, 'utf8');

const shell = read('standalone/app/src/components/shell/AppShell.tsx');
const topMenu = read('standalone/app/src/components/shell/TopMenu.tsx');
const tabBar = read('standalone/app/src/components/shell/MobileTabBar.tsx');
const subNav = read('standalone/app/src/components/shell/SubNav.tsx');
const menuPopover = read('standalone/app/src/components/shell/MenuPopover.tsx');
const pageHeader = read('standalone/app/src/components/shell/PageHeader.tsx');
const mediaQuery = read('standalone/app/src/lib/useMediaQuery.ts');
const globals = read('standalone/app/src/styles/globals.css');
const indexHtml = read('standalone/app/index.html');
const card = read('standalone/app/src/components/ui/Card.tsx');
const statusPill = read('standalone/app/src/components/ui/StatusPill.tsx');
const metric = read('standalone/app/src/components/ui/Metric.tsx');
const patternsPanel = read('standalone/app/src/components/patterns/PatternsPanel.tsx');

// ---------------------------------------------------------------------------
// The camera dock: a column on a laptop, an overlay sheet on a phone.
// ---------------------------------------------------------------------------

// The single worst offender. `w-72` may still appear — it is the DESKTOP
// width — but it must sit on the non-phone side of a branch, never as the
// dock's only layout.
assert.match(shell, /useIsPhone/,
  'AppShell must know whether it is on a phone — the dock changes structure, not just size');
assert.match(
  shell,
  /isPhone[\s\S]{0,900}above-tab-bar fixed right-3 z-modal w-44/,
  'on a phone the camera dock must be a small floating thumbnail, not an inline column',
);
assert.match(
  shell,
  /isPhone[\s\S]{0,1200}w-72 shrink-0/,
  'the w-72 column must be the non-phone branch, not the unconditional layout',
);
assert.match(shell, /compact=\{isPhone\}/,
  'the phone preview must use the compact variant — no reference readout on a thumbnail');
assert.match(read('standalone/app/src/styles/globals.css'), /\.above-tab-bar/,
  'the floating preview needs an offset that clears the tab bar AND the home indicator');

// A preview you glance at must not blank the readouts you started the capture
// to watch. The first attempt was a 78svh sheet with a modal backdrop; checking
// your framing then meant dismissing the app.
assert.doesNotMatch(shell, /aria-label="Close camera preview"/,
  'the floating preview must not need a modal backdrop — the page stays usable under it');
assert.doesNotMatch(shell, /fixed inset-x-0 bottom-0/,
  'the camera preview must not be a full-width bottom sheet');

// A closed column merely reclaims space; a closed sheet is invisible. The
// phone default must therefore be CLOSED, decided at first paint — reading it
// from an effect renders one frame of a dock covering the whole screen.
assert.match(
  shell,
  /useState\(\s*\(\)\s*=>\s*!window\.matchMedia\(PHONE_QUERY\)\.matches,?\s*\)/,
  'the dock must start closed on a phone, from the initialiser (not an effect)',
);
assert.match(shell, /if \(isPhone\) setDockVisible\(false\)/,
  'rotating into phone width must close the dock rather than leave it over the content');

// The e2e capture journey drives Start/Stop through this landmark.
assert.match(shell, /aria-label="Camera dock"/,
  'the dock must keep its accessible name at every width');

// The compact variant keeps the video and transport controls and drops the
// reference readout — but Hide is how you dismiss a floating panel, so it must
// stay a real thumb target rather than a 14 px icon.
const mini = read('standalone/app/src/components/shell/MiniCamera.tsx');
assert.match(mini, /compact \? null : \(\s*<div className="flex-1 overflow-y-auto/,
  'the compact preview must drop the reference readout, not the video');
assert.match(mini, /compact \? 'touch-target/,
  'the compact close control must be a real touch target');
assert.match(mini, /compact \? null : <CalibrateButton \/>/,
  'a full-screen calibration flow does not belong on a 176 px thumbnail');

// `vh` is measured with mobile toolbars retracted, so any viewport-height
// unit here must be the dynamic/small variant.
assert.doesNotMatch(shell, /\[\d+vh\]/,
  'never size phone chrome in vh — it is wrong whenever browser chrome is visible');

// ---------------------------------------------------------------------------
// Navigation: the desktop bar cannot shrink into the phone role.
// ---------------------------------------------------------------------------

assert.match(topMenu, /className="hidden min-w-0 items-center gap-0\.5 overflow-x-auto md:flex/,
  'the desktop nav row must be hidden below md, where the tab bar owns navigation');
assert.match(tabBar, /md:hidden/, 'the phone tab bar must not appear on desktop');
assert.match(shell, /<MobileTabBar \/>/, 'the shell must render the phone tab bar');

// One source of truth for destinations. If the tab bar restated its own
// routes, the two bars would drift the first time a section was added.
assert.match(topMenu, /export const ITEMS/, 'the destination list must be exported for reuse');
assert.match(topMenu, /export const PHONE_PRIMARY/, 'the phone subset must be declared beside ITEMS');
assert.match(tabBar, /import \{ ITEMS, PHONE_PRIMARY, isNavActive \} from '\.\/TopMenu'/,
  'the tab bar must derive its lists from TopMenu, not restate routes');
assert.doesNotMatch(tabBar, /to: '\//,
  'the tab bar must not hard-code any route literal');

// Seven destinations do not fit a thumb-reachable bar; the overflow must be
// reachable rather than dropped.
assert.match(tabBar, /More/, 'destinations beyond the primary four need an overflow affordance');
assert.match(tabBar, /Consent/,
  'Consent is a nav entry with no route — it must survive the move to the phone bar');
assert.match(tabBar, /overflowActive/,
  'the More tab must read as current while you are inside one of its destinations');
assert.match(tabBar, /setMoreOpen\(false\)/,
  'the More sheet must close on navigation rather than sit over the destination');

// ---------------------------------------------------------------------------
// SubNav: wrapping is right on a laptop and wrong on a phone.
// ---------------------------------------------------------------------------

assert.match(subNav, /flex-nowrap[\s\S]{0,120}md:flex-wrap/,
  'the sub-nav must scroll on one line on a phone and wrap only from md');
assert.match(subNav, /scroll-strip/, 'the phone sub-nav must be a scroll strip');

// ---------------------------------------------------------------------------
// Things that could not shrink, and so widened the whole page.
// ---------------------------------------------------------------------------

// Grid and flex items floor at min-content unless told otherwise; a Card
// holding a wide table then drags its track past the viewport.
assert.match(card, /'min-w-0 rounded-lg/,
  'Card must be able to shrink below its content — it is a grid item on every dashboard');

// nowrap + max-w-full + shrink-0 are one mechanism; drop any and it breaks.
assert.match(statusPill, /max-w-full shrink-0/,
  'StatusPill must cap at its container (phone) without yielding to sibling labels (desktop)');
assert.match(statusPill, /truncate text-status-null\/80/,
  'only the supplementary reason may ellipsize');
assert.match(statusPill, /className="shrink-0">\{children\}<\/span>/,
  'the status word itself must never truncate — it is the point of the pill');
assert.match(statusPill, /title=\{reason\}/,
  'a truncated reason must stay recoverable on hover');

assert.match(metric, /flex flex-wrap items-start justify-between/,
  'a KPI tile header must let a long status pill drop below the label');

// A bare `300px` minimum in minmax() is a HARD floor: the track stays 300 px
// wide inside a 262 px container.
assert.match(patternsPanel, /minmax\(min\(300px, 100%\), 1fr\)/,
  'auto-fill tracks must collapse below their ideal width on a narrow screen');
assert.doesNotMatch(patternsPanel, /minmax\(300px, 1fr\)/,
  'the hard 300px track floor must not come back');

// Panels declare a comfortable intrinsic width that exceeds a phone.
assert.match(menuPopover, /max-w-\[calc\(100vw-1rem\)\]/,
  'popover panels must be clamped to the viewport — the Scope panel asks for 26rem');

// The action cluster was `shrink-0`, so it could neither shrink nor wrap.
assert.match(pageHeader, /flex flex-wrap items-baseline justify-between/,
  'the page header must wrap its action cluster on a phone');
assert.match(pageHeader, /md:shrink-0/,
  'the action cluster may only refuse to shrink from md upwards');

// ---------------------------------------------------------------------------
// Platform plumbing that is invisible until you hold an actual phone.
// ---------------------------------------------------------------------------

assert.match(indexHtml, /viewport-fit=cover/,
  'the app must reach the physical edges of a notched display');
assert.match(globals, /\.pt-safe|\.pb-safe/,
  'edge-pinned chrome must reserve the notch and home indicator itself');
assert.match(tabBar, /pb-safe/, 'the tab bar sits on the bottom edge and must clear the home indicator');
assert.match(globals, /safe-area-inset-bottom\) \+ 0\.5rem/,
  'the floating preview must clear the home indicator as well as the tab bar');
assert.match(topMenu, /pt-safe/, 'the top bar must clear the notch');

// iOS resolves the page scrolling box on the documentElement, so the same
// rule on <body> alone is silently ignored.
assert.match(globals, /html \{\s*overflow-x: hidden;/,
  'the page itself must never scroll sideways — regions opt in, the document does not');

// iOS zooms the viewport when a <16px control is focused and never zooms back.
assert.match(globals, /@media \(pointer: coarse\)[\s\S]{0,200}font-size: max\(16px/,
  'form controls must be >=16px on touch devices or iOS zooms in and strands the user');

// A rolling media query is an external mutable store; the useState+useEffect
// idiom paints one wrong frame first, which here is a dock flashing over the
// whole screen.
assert.match(mediaQuery, /useSyncExternalStore/,
  'the media query must not be read through an effect');
assert.match(mediaQuery, /const subscribers = new Map/,
  'the subscribe function must be cached, or every render resubscribes');

console.log('app-phone-layout.test.js — all cases passed');
