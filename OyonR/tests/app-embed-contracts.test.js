// Source contracts for the <oyon-app> embeddable element + identity wiring.
// Style mirrors tests/app-runtime-contracts.test.js: assert on the source
// text of the app's TS files (the app has no test runner of its own; deep
// behavior is covered by app:typecheck + the element build + the embed
// example page).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ─── identity: per-instance, not the module useIdentity in the embed path ──
// FIX 1: the embed capture path resolves identity from THIS instance's bridge
// store (so a coexisting chrome="none" viewer can't clobber sessionIdOverride).
// runtime.ts reads identity via resolveIdentity(bridgeStore), NOT a direct
// useIdentity.getState() in the contextProvider / window-emit / start snapshot.
{
  const runtime = read('standalone/app/src/lib/runtime.ts');
  const contextBlock = runtime.slice(
    runtime.indexOf('const contextProvider'),
    runtime.indexOf('// Lazy-construct on first start'),
  );
  assert.ok(!contextBlock.includes("user_id: 'standalone-user'"),
    'contextProvider must read identity, not a hardcoded user');
  // The contextProvider resolves identity through the instance-aware helper,
  // NOT a raw module-store read.
  assert.ok(contextBlock.includes('resolveIdentity(bridgeStore)'),
    'contextProvider must resolve identity instance-aware via resolveIdentity(bridgeStore)');
  assert.ok(!contextBlock.includes('useIdentity.getState()'),
    'contextProvider must not read the module useIdentity store directly (embed clobber bug)');

  // resolveIdentity is the single instance-aware source: embedded → bridge,
  // standalone → module useIdentity.
  assert.ok(/function resolveIdentity\(/.test(runtime),
    'runtime must define resolveIdentity()');
  const helper = runtime.slice(
    runtime.indexOf('function resolveIdentity('),
    runtime.indexOf('interface BuildArgs'),
  );
  assert.ok(/b\.embedded/.test(helper) && helper.includes('useIdentity.getState()'),
    'resolveIdentity must branch on bridge.embedded and fall back to useIdentity standalone');

  // The three former direct module reads (contextProvider, oyon:window emit,
  // start snapshot) all go through resolveIdentity(bridgeStore) now.
  const resolveCount = (runtime.match(/resolveIdentity\(bridgeStore\)/g) || []).length;
  assert.ok(resolveCount >= 3,
    `the three identity reads must be instance-aware (found ${resolveCount} resolveIdentity calls)`);

  // The element writes identity into the per-instance bridge, not useIdentity.
  const element = read('standalone/app/src/element.tsx');
  const applyBlock = element.slice(
    element.indexOf('private applyIdentityAttributes'),
    element.indexOf('private applyIdentityAttributes') + 800,
  );
  assert.ok(/this\.bridge\?\.getState\(\)\.setBridge\(/.test(applyBlock),
    'applyIdentityAttributes must write identity into THIS element\'s bridge store');
  assert.ok(!applyBlock.includes('useIdentity.getState()'),
    'applyIdentityAttributes must not write the module useIdentity store (embed clobber bug)');
  assert.ok(applyBlock.includes('DEFAULT_USER_ID'),
    'the DEFAULT_USER_ID fallback must be preserved');
  // hostBridge carries the per-instance identity fields.
  const bridge = read('standalone/app/src/lib/hostBridge.ts');
  for (const f of ['userId', 'userLabel', 'sessionIdOverride']) {
    assert.ok(new RegExp(`\\b${f}\\b`).test(bridge),
      `hostBridge must carry the per-instance identity field "${f}"`);
  }

  // Host events fire from the shared handlers (no-op standalone).
  assert.ok(runtime.includes("emitHostEvent('oyon:window'"));
  assert.ok(runtime.includes("emitHostEvent('oyon:status'"));

  // The participant UI must read/write the SAME identity source the runtime
  // stamps from. In an embed that is the per-instance bridge, NOT the module
  // useIdentity store — otherwise the TopBar pill shows 'standalone-user' and
  // edits silently never reach the stamped windows. TopBar goes through
  // useResolvedIdentity (bridge when embedded, module store standalone).
  const identityStore = read('standalone/app/src/lib/identityStore.ts');
  assert.ok(/export function useResolvedIdentity\(/.test(identityStore),
    'identityStore must expose useResolvedIdentity (embed-aware participant identity)');
  const resolved = identityStore.slice(identityStore.indexOf('export function useResolvedIdentity('));
  assert.ok(/if\s*\(\s*embedded\s*\)/.test(resolved) && resolved.includes('bridgeStore.getState().setBridge'),
    'useResolvedIdentity must read/WRITE the bridge when embedded (edits must reach stamped windows)');
  const topbar = read('standalone/app/src/components/shell/TopBar.tsx');
  assert.ok(topbar.includes('useResolvedIdentity'),
    'TopBar ParticipantPill must use useResolvedIdentity, not the module store directly');
  assert.ok(!/=\s*useIdentity\(\)/.test(topbar),
    'TopBar must not bind the module useIdentity store directly (full-embed identity divergence)');
}

// ─── camera claim releases synchronously so a same-tick remount can claim it ─
// React `<oyon-app key={…}>` remount removes the old node + inserts the new one
// in ONE synchronous commit. If the realInstance claim were freed only in the
// deferred microtask, the incoming instance would refuse itself and nothing
// would mount. The claim must be released synchronously in disconnectedCallback
// (re-claimed in the microtask only on a same-node re-parent).
{
  const element = read('standalone/app/src/element.tsx');
  const disc = element.slice(
    element.indexOf('disconnectedCallback'),
    element.indexOf('attributeChangedCallback'),
  );
  // Synchronous release sits BEFORE the queueMicrotask, not inside it.
  const releaseAt = disc.indexOf('realInstance = null');
  const microtaskAt = disc.indexOf('queueMicrotask');
  assert.ok(releaseAt >= 0 && microtaskAt >= 0 && releaseAt < microtaskAt,
    'the camera claim must be released synchronously, before the deferred teardown microtask');
  // The microtask re-claims on a re-parent (node still connected).
  assert.ok(/heldCamera && realInstance === null\) realInstance = this/.test(disc),
    'a re-parent must re-claim the camera in the microtask when no incoming instance took it');
}

// ─── FIX 2: chrome is immutable after connect ─────────────────────────────
// A live chrome change would swap the runtime hook tree (stub vs real →
// rules-of-hooks violation) and bypass the realInstance camera guard claimed
// only at connect. attributeChangedCallback must IGNORE chrome changes with a
// warning, never mutate chromeMode post-mount.
{
  const element = read('standalone/app/src/element.tsx');
  const acc = element.slice(
    element.indexOf('attributeChangedCallback'),
    element.indexOf('async start()'),
  );
  const chromeCase = acc.slice(acc.indexOf("case 'chrome':"), acc.indexOf("default:"));
  assert.ok(chromeCase.length > 0, 'attributeChangedCallback must have a chrome case');
  assert.ok(!/setBridge\(\{\s*chromeMode/.test(chromeCase),
    'a live chrome change must NOT call setBridge({ chromeMode }) — chrome is fixed at mount');
  assert.ok(/console\.warn/.test(chromeCase),
    'a live chrome change must warn that chrome is fixed at mount and was ignored');
}

// ─── oyon:sample — live per-sample emotion: UNGATED, full-rate, full signal ──
// Oyon is research-grade (CLAUDE.md "Data policy"): the live affect stream is
// NOT gated, throttled, or scoped. oyon:sample fires unconditionally on every
// sample (outside the 100ms React-render throttle), carries the full signal,
// and bubbles+composed like every other host event.
{
  const runtime = read('standalone/app/src/lib/runtime.ts');
  assert.ok(runtime.includes("emitHostEvent('oyon:sample'"),
    'runtime must forward the live per-sample emotion as oyon:sample');
  const sampleAt = runtime.indexOf("emitHostEvent('oyon:sample'");
  const payload = runtime.slice(sampleAt, runtime.indexOf('});', sampleAt) + 3);
  // Full signal exposed — derived emotion AND the probability vector.
  for (const field of ['dominant', 'confidence', 'valence', 'arousal', 'probabilities', 'ts']) {
    assert.ok(new RegExp(`\\b${field}\\b`).test(payload),
      `oyon:sample payload must include "${field}"`);
  }

  // NO GATE: the emit must NOT be guarded by any liveSamples flag.
  const guardWindow = runtime.slice(Math.max(0, sampleAt - 300), sampleAt);
  assert.ok(!/liveSamples/.test(guardWindow),
    'oyon:sample must NOT be gated (no liveSamples guard) — research-grade, ungated');
  // Emitted at full rate: BEFORE/outside the 100ms React-render throttle, not
  // inside it (the throttle governs setLastPrediction only).
  const throttleAt = runtime.indexOf('lastFaceUpdateRef.current >= 100');
  assert.ok(throttleAt >= 0 && sampleAt < throttleAt,
    'oyon:sample must be emitted at full source rate (before the 100ms throttle)');

  // The liveSamples plumbing is fully removed from the bridge and the element.
  const bridge = read('standalone/app/src/lib/hostBridge.ts');
  assert.ok(!/liveSamples/.test(bridge),
    'hostBridge must not carry a liveSamples gate (removed — signal is ungated)');
  const element = read('standalone/app/src/element.tsx');
  assert.ok(!/live-samples|liveSamples/.test(element),
    'the element must not observe/parse a live-samples gate (removed)');
  // Every host event bubbles + composed (nothing scoped/suppressed).
  const emitBlock = element.slice(
    element.indexOf('emitHostEvent: (type, detail)'),
    element.indexOf('emitHostEvent: (type, detail)') + 600,
  );
  assert.ok(/bubbles:\s*true/.test(emitBlock) && /composed:\s*true/.test(emitBlock) && !/!scoped/.test(emitBlock),
    'host events must all bubble + cross the shadow boundary (no per-event scoping)');
}

// ─── chrome="none" viewer stub: NO capture machinery constructed ──────────
// A pure analytics viewer must construct zero capture machinery — crucially
// no gaze adapter, whose default engine (WebGazer) pops a browser alert on
// plain-HTTP at construction. Prove the chromeless branch never reaches
// createGazeAdapter / CameraController / buildRuntime.
{
  const runtime = read('standalone/app/src/lib/runtime.ts');

  // The public hook gates on `chromeless` (read from the PER-INSTANCE bridge
  // store) and delegates to the viewer stub.
  assert.ok(
    /if\s*\(\s*bridgeStore\.getState\(\)\.chromeless\s*\)\s*\{\s*return useViewerStubRuntime\(opts\);/.test(
      runtime,
    ),
    'useStandaloneRuntime must return the viewer stub when chromeless (per-instance store)',
  );

  // Isolate the stub function body and prove it constructs none of the
  // capture machinery. `createGazeAdapter` (→ WebGazer alert), the camera,
  // and the buildRuntime path must never appear inside it.
  const stubStart = runtime.indexOf('function useViewerStubRuntime');
  const stubEnd = runtime.indexOf('export function useStandaloneRuntime');
  assert.ok(stubStart >= 0 && stubEnd > stubStart, 'viewer stub must exist before the public hook');
  const stubBody = runtime.slice(stubStart, stubEnd);
  for (const banned of ['createGazeAdapter', 'CameraController', 'buildRuntime', 'getUserMedia', 'ensureRuntime']) {
    assert.ok(
      !stubBody.includes(banned),
      `viewer stub must not construct capture machinery (found ${banned})`,
    );
  }
  // The stub returns the inert viewer status/counters.
  assert.ok(/status:\s*'idle'/.test(stubBody), "stub status must be 'idle'");
  assert.ok(/windowCount:\s*0/.test(stubBody), 'stub windowCount must be 0');
  assert.ok(/gazeAdapter:\s*null/.test(stubBody), 'stub must expose no gaze adapter');

  // createGazeAdapter is reached ONLY through buildRuntime (the real path),
  // never at the public hook's top level.
  assert.ok(
    runtime.indexOf('const gazeAdapter = createGazeAdapter(') >
      runtime.indexOf('function buildRuntime'),
    'createGazeAdapter must live inside buildRuntime (the real capture path)',
  );
}

// ─── element: definition guards + composed events + memory history ────────
{
  const element = read('standalone/app/src/element.tsx');
  assert.ok(element.includes("customElements.get('oyon-app')"),
    'double-define guard required');
  // All host events cross the shadow boundary (composed) and bubble — nothing
  // is scoped or suppressed (research-grade: full signal exposed).
  assert.ok(element.includes('composed: true'),
    'host events must cross the shadow boundary (composed: true)');
  assert.ok(element.includes('createMemoryHistory'),
    'embedded router must not hijack the host URL');
  assert.ok(element.includes('attachShadow'));
  // Camera-safety guard: at most one REAL-runtime instance owns the camera at a
  // time (tracked by `realInstance`); chrome="none" viewers are unlimited and
  // may coexist. The old page-level `mountedInstance` singleton is gone.
  assert.ok(element.includes('realInstance'),
    'real-runtime camera guard required (one capture instance owns the camera)');
  assert.ok(!/\bmountedInstance\b/.test(element),
    'the page-level mountedInstance singleton must be replaced by the per-instance design');
}

// ─── per-instance bridge store: instances no longer share one store ───────
// Each <oyon-app> owns its OWN host-bridge store so a capture instance and N
// chrome="none" viewers coexist without clobbering each other. Prove the
// singleton store became a factory and the element wires its own store in.
{
  const bridge = read('standalone/app/src/lib/hostBridge.ts');
  assert.ok(/export function createHostBridgeStore\(\)/.test(bridge),
    'hostBridge must expose a per-instance store factory createHostBridgeStore()');
  // The default module store is now just one instance of the factory, kept for
  // the standalone / non-embedded path so it stays byte-for-byte unchanged.
  assert.ok(/export const useHostBridge[^=]*=\s*createHostBridgeStore\(\)/.test(bridge),
    'the default module store must be created via the factory (standalone path unchanged)');
  assert.ok(bridge.includes('export function HostBridgeProvider'),
    'hostBridge must expose a HostBridgeProvider to scope a store to a subtree');
  assert.ok(bridge.includes('export function useBridge') &&
    bridge.includes('export function useBridgeStore'),
    'hostBridge must expose useBridge(selector) and useBridgeStore() context hooks');

  const element = read('standalone/app/src/element.tsx');
  assert.ok(element.includes('this.bridge = createHostBridgeStore()'),
    'each element instance must create its OWN bridge store');
  assert.ok(/<HostBridgeProvider store={this\.bridge}>/.test(element),
    'the element must wrap its React root in HostBridgeProvider with its own store');
  // The guard now keys on a real-runtime instance and lets chrome="none"
  // viewers coexist with the one real instance.
  assert.ok(element.includes('isRealRuntimeMode'),
    'the guard must distinguish real-runtime modes from chrome="none" viewers');
  assert.ok(element.includes('owns the camera'),
    'the refusal message must explain the one-real-runtime camera rule');

  // Consumers read the per-instance store via the context hooks, not the
  // module-level store directly.
  const shell = read('standalone/app/src/components/shell/AppShell.tsx');
  assert.ok(/useBridge\(\(s\)\s*=>\s*s\.chromeMode\)/.test(shell),
    'AppShell must read chromeMode from the per-instance store via useBridge');
  const stored = read('standalone/app/src/lib/storedWindows.ts');
  assert.ok(/useBridge\(\(s\)\s*=>\s*s\.hostWindows\)/.test(stored),
    'storedWindows must read hostWindows from the per-instance store via useBridge');

  // runtime.ts reads the per-instance store imperatively via useBridgeStore()
  // so a viewer instance gets the stub and the capture instance gets the real
  // runtime, independently.
  const runtime = read('standalone/app/src/lib/runtime.ts');
  assert.ok(runtime.includes('const bridgeStore = useBridgeStore()'),
    'runtime hooks must grab the per-instance bridge store via useBridgeStore()');
  assert.ok(/if \(bridgeStore\.getState\(\)\.chromeless\)/.test(runtime),
    'the chromeless gate must read the per-instance store (not the module store)');
  assert.ok(!/useHostBridge\.getState\(\)/.test(runtime),
    'runtime must no longer reach the module store directly');
}

// ─── chrome="capture-analytics": pill + dashboards, real runtime ──────────
// The combined embed must (a) be a recognized chrome value, (b) render BOTH
// the CapturePill and the analytics Outlet in one branch, (c) stay on the real
// runtime (NOT chromeless — only 'none' is), and (d) default its initial route
// to /analyze so the dashboards show out of the box.
{
  const element = read('standalone/app/src/element.tsx');
  assert.ok(element.includes("if (v === 'capture-analytics') return 'capture-analytics';"),
    'parseChromeMode must recognize chrome="capture-analytics"');
  assert.ok(/capture-analytics'\s*\?\s*'\/analyze'\s*:\s*'\/'/.test(element),
    'capture-analytics must default its initial route to /analyze');

  const bridge = read('standalone/app/src/lib/hostBridge.ts');
  assert.ok(/ChromeMode\s*=\s*'full'\s*\|\s*'none'\s*\|\s*'capture'\s*\|\s*'capture-analytics'/.test(bridge),
    "ChromeMode union must include 'capture-analytics'");
  // chromeless stays strictly the viewer mode — combined runs the real engine.
  assert.ok(bridge.includes("chromeless: next.chromeMode === 'none'"),
    'chromeless must remain derived from === "none" (combined mode is NOT chromeless)');

  const shell = read('standalone/app/src/components/shell/AppShell.tsx');
  const branch = shell.slice(
    shell.indexOf("if (chromeMode === 'capture-analytics')"),
    shell.indexOf("// chrome=\"none\" (viewer-only embed)"),
  );
  assert.ok(branch.length > 0, 'AppShell must have a capture-analytics branch');
  assert.ok(branch.includes('<CapturePill />'), 'combined branch renders the capture pill');
  assert.ok(branch.includes('<Outlet />'), 'combined branch renders the analytics outlet');
  assert.ok(branch.includes('<EmbedHeader />'), 'combined branch renders the unified embed header (nav + tabs + filter)');
  assert.ok(branch.includes('<RuntimeProvider>'), 'combined branch keeps the real runtime provider');
}

// ─── router construction stays inside the entry points ────────────────────
{
  const main = read('standalone/app/src/main.tsx');
  assert.ok(main.includes('makeRouter()'),
    'main.tsx constructs the browser-history router itself');
  assert.ok(!main.includes('createMemoryHistory'));
  const router = read('standalone/app/src/router.ts');
  assert.ok(router.includes('export function makeRouter'));
  // A module-level makeRouter() in router.ts would execute inside the
  // element bundle's import graph and eagerly run createBrowserHistory()
  // on the HOST page (history.replaceState + pushState/replaceState
  // monkey-patching + popstate/beforeunload listeners) even when
  // <oyon-app> is never mounted. Routers are constructed only in entry
  // points: main.tsx (browser history) and element.tsx (memory history).
  assert.ok(!/^\s*(export\s+)?const\s+\w+\s*=\s*makeRouter\(/m.test(router),
    'router.ts must not construct a router at module level (host-history side effect)');
}

// ─── shadow DOM styling: tokens reach the shadow root ──────────────────────
{
  const tokens = read('standalone/app/src/styles/tokens.css');
  assert.ok(/:root,\s*\n?\s*:host/.test(tokens),
    'design tokens must include :host so they apply inside the shadow root');
  const elementCss = read('standalone/app/src/styles/element.css');
  assert.ok(elementCss.includes('.oyon-app-host'),
    'shadow wrapper must replicate the document-level body rules');
}

// ─── packaging: subpath export + artifact allowlist ────────────────────────
{
  const pkg = JSON.parse(read('package.json'));
  assert.equal(
    pkg.exports['./app-element'].import,
    './standalone/app/dist-element/oyon-app.element.js',
  );
  assert.ok(pkg.files.includes('standalone/app/dist-element'),
    'built element must ship in the npm tarball');
  assert.ok(pkg.scripts['app:build:element']);
}

console.log('app-embed-contracts.test.js — all cases passed');
