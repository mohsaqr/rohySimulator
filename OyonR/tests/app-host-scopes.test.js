import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHostCheckReport } from '../bin/host-check.js';
import { OYON_HOST_CONTRACT_VERSION } from '../src/version.js';

/*
 * <oyon-app> host-scope contracts (AGENT-NOTE-HOST-SCOPES items 2-4, 8).
 *
 * Source-level contracts in the idiom of tests/app-embed-contracts.test.js:
 * the app is TypeScript/React and is exercised in a browser by
 * tests/e2e/host-scopes.spec.ts; these assertions pin the wiring that makes
 * the privacy rule hold — "Oyon renders only what the host fed; it never
 * widens a scope from its own local store" — so a refactor has to break a
 * named promise to undo it.
 */

const read = (path) => readFileSync(path, 'utf8');
const element = read('standalone/app/src/element.tsx');
const bridge = read('standalone/app/src/lib/hostBridge.ts');
const recordScope = read('standalone/app/src/lib/recordScope.ts');
const signalSource = read('standalone/app/src/lib/signalSource.ts');
const storedWindows = read('standalone/app/src/lib/storedWindows.ts');
const filtered = read('standalone/app/src/lib/useFilteredWindows.ts');
const enriched = read('standalone/app/src/lib/useEnrichedWindows.ts');
const filterBar = read('standalone/app/src/components/shell/FilterBar.tsx');
const shell = read('standalone/app/src/components/shell/AppShell.tsx');
const gate = read('standalone/app/src/components/shell/ScopeGate.tsx');
const header = read('standalone/app/src/components/shell/EmbedHeader.tsx');

// ── the host contract moved ───────────────────────────────────────────────
assert.equal(OYON_HOST_CONTRACT_VERSION, '3.2', 'setRecords / scope / group-id / context-id are host contract 3.2');

// ── setRecords: one feed, validated, in memory ────────────────────────────
{
  assert.match(element, /setRecords\(records: HostRecordsInput \| null\): void/,
    'the element must expose setRecords(records | null)');
  assert.match(element, /validateHostRecords\(records\)/,
    'every fed record must be shape-checked on the way in');
  assert.ok(element.includes("emitHostEvent?.('oyon:records'"),
    'refused records must be reported through the oyon:records event');
  assert.ok(element.includes('refused: checked.counts.refused') && element.includes('reasons: checked.refused'),
    'the event must carry the refused counts and the reason for each');
  assert.match(element, /bridge\.setHostRecords\(null\)/, 'setRecords(null) must clear the feed');

  // The feed lives in the per-instance bridge store and nowhere else.
  const setRecordsBody = element.slice(element.indexOf('setRecords(records:'), element.indexOf('setGazeAois(aois:'));
  for (const sink of ['localStorage', 'indexedDB', 'IndexedDbOyonStore', 'bulkAdd', 'sessionStorage']) {
    assert.ok(!setRecordsBody.includes(sink), `setRecords must not write to ${sink}`);
  }
  assert.ok(bridge.includes('hostRecords: HostRecords | null') && bridge.includes('setHostRecords'),
    'the bridge store must hold the feed');
  assert.ok(element.includes('bridge?.getState().setHostRecords(null)'),
    'removing the element must drop the feed');

  // setWindows keeps its 3.5 meaning.
  assert.match(element, /setWindows\(windows: EmotionWindow\[\] \| null\): void/);
}

// ── while a feed is set, the local store is not even read ─────────────────
{
  assert.match(signalSource, /const readsLocalStore = hostRecords == null && !scope\.needsFeed/,
    'episode windows / events: the local read is gated on "no feed and not a feed-only scope"');
  assert.match(signalSource, /enabled: readsLocalStore/,
    'the local-store query must be disabled while a feed is set');
  assert.match(signalSource, /return scope\.inView\(ordered\)/,
    'fed records must pass through the scope filter');
  assert.match(storedWindows, /enabled: readsLocalOrLegacy/,
    'interval windows: the local-store query must be disabled while a feed is set');
  // Fed windows bypass the query cache; raw-only envelopes (modality 'raw')
  // and split parts are joined/split off first, as for the local store.
  assert.match(storedWindows, /splitRawOnly\(fedWindows\)\.windows/,
    'fed windows have their raw-only envelopes split off');
  assert.match(storedWindows, /if \(hostRecords != null\) return \{ data: fedEmotionWindows, isLoading: false \}/,
    'fed windows are returned directly, outside the query cache');
  assert.match(storedWindows, /if \(needsFeed\) return \{ data: NO_WINDOWS, isLoading: false \}/,
    'a person/group scope with no feed reads nothing');

  for (const [name, src] of [
    ['storedTypingWindows.ts', read('standalone/app/src/lib/storedTypingWindows.ts')],
    ['storedEvents.ts', read('standalone/app/src/lib/storedEvents.ts')],
    ['routes/analyze/voice.tsx', read('standalone/app/src/routes/analyze/voice.tsx')],
  ]) {
    assert.match(src, /useSignalRecords</, `${name} must read through the shared signal source`);
    assert.ok(!/\buseQuery\(/.test(src), `${name} must not keep a private local-store query beside it`);
  }
}

// ── scope: one definition for every record kind ───────────────────────────
{
  assert.match(element, /function parseScope\(value: string \| null\): EmbedScope/);
  assert.match(element, /if \(v === 'person' \|\| v === 'group' \|\| v === 'class'\) return v;[\s\S]*?return 'session';/,
    'an unrecognized scope must fall back to session — the narrowest — never widen');
  for (const attr of ["'scope'", "'class-id'", "'group-id'", "'context-id'", "'closable'"]) {
    assert.ok(element.includes(attr), `${attr} must be an observed attribute`);
  }

  assert.match(recordScope, /const needsFeed = embedded && scope !== 'session' && !fed/,
    'person and group scopes need a host feed');
  assert.match(recordScope, /needsFeed \? \[\] : \(scopeRecords\(records, base\)/,
    'with no feed a person/group scope yields nothing — no fallback to browser storage');
  assert.match(recordScope, /import \{ scopeRecords \} from 'oyon'/,
    'the app must use the library scope filter (tested in tests/host-records.test.js)');

  assert.match(filtered, /const scopedByRecords = embedded && \(recordScope\.fed \|\| recordScope\.scope !== 'session'\)/,
    'a feed or a person/group scope must be filtered by the shared record scope');
  assert.ok(gate.includes('needsFeed') && gate.includes('setRecords()'),
    'the empty state must say that the view needs host-fed records');
  assert.equal((shell.match(/<ScopeGate>/g) || []).length, 2,
    'both embedded analytics shells must mount the scope gate');

  // Dynamics never cross from one person's session into another's.
  assert.match(enriched, /const key = `\$\{userIdOf\(window\)\}\|\$\{sessionIdOf\(window\)\}`/,
    'fed windows must be enriched per person and session');
}

// ── the header states the scope and its counts ────────────────────────────
{
  assert.ok(filterBar.includes('SCOPE_WORDS[scope]') && filterBar.includes("class: 'Class'") && filterBar.includes("person: 'Person'"),
    'the header must state the level in plain words: Session, Person, Group, Class');
  assert.ok(filterBar.includes('<LevelMenus'), 'the top bar must carry the aggregation-level drop-downs');
  for (const noun of ["'session'", "'person', 'people'", "'record'"]) {
    assert.ok(filterBar.includes(`plural(overview.counts.`) && filterBar.includes(noun),
      `the header must state the count of ${noun}`);
  }
  assert.ok(filterBar.includes('No records from the host'),
    'a feed-only scope with no feed must say so in the header');
  assert.ok(filterBar.includes('aria-pressed={option.active}'),
    'the Current / All switch must not signal its state by colour alone');
}

// ── identity fields reach captured records ────────────────────────────────
{
  const runtime = read('standalone/app/src/lib/runtime.ts');
  assert.ok(runtime.includes('...hostIdentityFields(bridgeStore)'),
    'captured windows must be stamped with the host identity fields');
  for (const field of ['fields.user_label = b.userLabel', 'fields.group_id = b.groupId', 'fields.context_id = b.contextId']) {
    assert.ok(runtime.includes(field), `runtime must stamp ${field}`);
  }
  assert.ok(element.includes("this.trimmedAttribute('group-id')") && element.includes("this.trimmedAttribute('context-id')"),
    'the element must read group-id and context-id into its bridge store');
}

// ── host-facing items: close control and theme ────────────────────────────
{
  assert.ok(header.includes("emitHostEvent?.('oyon:close', {})"), 'the close control must emit oyon:close');
  assert.ok(header.includes('closable ?'), 'the close control is shown only when the host asks for it');

  const tokens = read('standalone/app/src/styles/tokens.css');
  const elementCss = read('standalone/app/src/styles/element.css');
  for (const [property, fallback] of [
    ['--oyon-surface', '#ffffff'],
    ['--oyon-text', '#171717'],
    ['--oyon-border', 'rgba(0, 0, 0, 0.10)'],
    ['--oyon-accent', '#1d4ed8'],
  ]) {
    assert.ok(tokens.includes(`var(${property}, ${fallback})`),
      `${property} must fall back to the current look (${fallback})`);
  }
  assert.ok(elementCss.includes('--oyon-font'), 'the font family must be themeable');
}

// ── types and host-check know the new API ─────────────────────────────────
{
  const types = read('types/app-element.d.ts');
  assert.ok(types.includes('setRecords(records: HostRecordsInput | null): void'));
  assert.ok(types.includes("'oyon:records': CustomEvent<OyonRecordsEventDetail>"));
  assert.ok(types.includes("'oyon:close': CustomEvent<OyonCloseEventDetail>"));

  const hostCheck = read('bin/host-check.js');
  assert.ok(hostCheck.includes("'setRecords'"), 'host-check must verify the bundle exposes setRecords');
  assert.equal(typeof buildHostCheckReport, 'function');
}

// ── the Overview: the dashboard's front page ──────────────────────────────
{
  const overview = read('standalone/app/src/components/overview/RecordsOverview.tsx');
  const overviewRecords = read('standalone/app/src/lib/overviewRecords.ts');
  const sessionsPage = read('standalone/app/src/routes/sessions.tsx');
  const router = read('standalone/app/src/router.ts');

  const levelSelection = read('standalone/app/src/lib/levelSelection.ts');
  assert.match(levelSelection, /listRecordLevels\(sets\)/,
    'the levels offered must be the ones present in the records');
  assert.match(levelSelection, /summarizeRecordsBy\(withinOthers\(level\.key\), \{ by: level\.id \}\)/,
    'each level lists its units from every record kind, inside the narrowing at the other levels');
  assert.match(levelSelection, /return scope === 'person' && key === 'session_id';/,
    'inside one person only sessions can be narrowed; inside one session, nothing');
  const levelMenus = read('standalone/app/src/components/overview/LevelMenus.tsx');
  assert.ok(levelMenus.includes('<MenuPopover') && levelMenus.includes('aria-selected={checked}') && levelMenus.includes('<Check'),
    'each level is a styled drop-down whose chosen units carry a check mark, not colour alone');
  assert.ok(!/<select\b/.test(overview + filterBar + levelMenus),
    'levels use the dashboard\'s own drop-downs, not native selects');
  const popover = read('standalone/app/src/components/shell/MenuPopover.tsx');
  assert.ok(popover.includes('e.composedPath().includes(root)'),
    'a drop-down inside the shadow root must not close on a click inside its own panel');
  assert.ok(!/MAX_SESSIONS_SHOWN|slice\(0, 20\)/.test(overview + sessionsPage),
    'the session list must not be capped at the latest 20');
  assert.ok(overview.includes('aria-sort=') && overview.includes('aria-selected='),
    'sort direction and selection must not be signalled by colour alone');
  assert.match(overviewRecords, /const session = \{ scope: 'session' as const, sessionId: currentSessionId \}/,
    'a session embed with no feed must list only its own session, for every record kind');
  assert.match(overviewRecords, /enabled: readsLocalStore/,
    'the overview must not read the local store while a feed is set');

  assert.ok(sessionsPage.includes('<RecordsOverview'), 'the standalone Sessions page is the same overview');
  assert.ok(router.includes('overviewRoute'), 'router.ts must register the overview route');
  assert.ok(header.includes("{ to: '/overview', label: 'Overview' }"), 'the embedded header must lead with Overview');
  assert.match(element, /if \(scope !== 'session' && chromeMode !== 'capture'\) return '\/overview';/,
    'a person or group embed must open on the Overview');
}

console.log('app-host-scopes contracts OK');
