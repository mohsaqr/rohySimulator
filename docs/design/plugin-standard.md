# RPS-1 — the Rohy Plugin Standard

**Status:** implemented, rohy v2.9.59 · **Spec version:** 1.1 · **Last reviewed:** 2026-08-26

A plugin is a folder that **imports nothing from rohy**, declares itself in a
manifest, receives a host context, gets a room, and emits events into
`learning_events` — where the existing analytics pick them up for free.

The standard was extracted, not invented. Two things already worked and were
generalised: the vendored `rohy-pathology` package, whose services arrive as
props so the folder stays droppable; and that package's own workstation
registry, which proved the peaceful-exclusion rule empirically.

---

## 1. Scope and non-goals

RPS-1 defines **how a first-party, build-time module attaches to rohy** — its
room, its analytics vocabulary, its state, and the services it may use.

**It is not a security boundary.** Plugins are ordinary same-origin bundled
JavaScript with full access to `window`, `fetch`, `localStorage` and any host
module they choose to import. Capabilities are an **API-shape contract** that
keeps cooperative code honest and makes intent reviewable; they do not contain
hostile code. Loading untrusted third-party plugins is out of scope and would
require a sandbox this standard does not describe.

---

## 2. The six slots

Everything rohy used to hardcode about a room is now one of six slots.

| Slot | Replaces | Declared in |
|---|---|---|
| **room** | a hand-written `ROOM_DEFS` entry + `ROOM_KEYS` literal | manifest |
| **vocabulary** | a `...PLUGIN_VERBS` spread in `eventLogger.js` | manifest |
| **states** | a `...PLUGIN_VERB_FALLBACKS` spread in `clinicalStates.js` | manifest |
| **capabilities** | props hand-picked at the mount site in `App.jsx` | manifest + host grant |
| **data** | `caseSnapshot?.config?.<name>` | `caseConfig[manifest.id]` |
| **authoring** *(1.1, optional)* | nothing — there was no way to ship an editor | manifest + descriptor |

**One id.** The manifest `id` is the room key, the verb namespace, the
case-config key, the storage namespace and the API mount path. Four identities
that must agree eventually stop agreeing.

---

## 3. Anatomy

```
src/plugins/<id>/
  manifest.js     pure JS, no React. Node imports it, so it can be frozen for the server.
  index.jsx       the descriptor: component + gate + prop adapter.
```

Both files MUST exist. The generator and the runtime use the same predicate; a
folder with only one of them is not a plugin.

### 3.1 Manifest

```js
export const manifest = {
    id: 'ecg',                        // lower_snake_case, === room.key, not a core room
    version: '0.1.0',
    room: {
        key: 'ecg',
        labelKey: 'room_ecg',         // i18n key
        subKey: 'room_ecg_sub',
        icon: 'Scan',                 // from the host allowlist
        accent: 'teal',               // from the host allowlist
        order: 45,                    // position among rooms
    },
    vocabulary: {
        verbs: { OPENED_STRIP: { severity: 'INFO', category: 'CLINICAL' } },
        objectTypes: { STRIP: 'ecg_strip' },
        components: { VIEWER: 'EcgViewer' },
    },
    states: {
        verbFallbacks:   { OPENED_STRIP: 'assessing' },   // REQUIRED for every verb
        objectOverrides: { ecg_strip: 'assessing' },      // own object types only
        interpretations: { 'OPENED_STRIP:ecg_strip': 'assessing' },  // own vocabulary only
    },
    capabilities: ['persist'],
    minRole: 'student',
    authoring: {                      // optional; see §11
        labelKey: 'room_ecg_author',
        minRole: 'educator',          // REQUIRED when authoring is declared
    },
};
```

### 3.2 Descriptor

```jsx
export default {
    manifest,
    component: EcgRoom,                        // rendered when currentRoom === id
    available: (ctx) => ctx.data != null,      // the gate
    props: (ctx, persist) => ({ strips: ctx.data }),   // adapter

    authorComponent: EcgAuthor,                          // optional; see §11
    authorProps: (ctx, draft) => ({ value: draft.value, onChange: draft.save }),
};
```

`props()` is what lets a **vendored package keep its own prop vocabulary**.
Pathology wants `pathologyCase` / `initialAnnotations`; the host only knows
`ctx.data` and a store. The adapter bridges them and lives *outside* the
plugin's source — so `src/components/pathology/` stays byte-identical to
upstream. *If plugging something in requires editing it, it is not
plug-and-play.*

---

## 4. Normative rules

A manifest violating any of these is rejected at `plugins:gen` time, before any
code runs. Each rule exists because the failure it prevents surfaces somewhere
far from its cause.

| # | Rule | What it prevents |
|---|---|---|
| R1 | `id` is `lower_snake_case` | it becomes a room key and a URL segment |
| R2 | `room.key === id` | four identities drifting apart |
| R3 | `id` is not a core room key (`chat`, `examination`, `lab`, `radiology`, `consultant`) | a duplicate navigator tab and a plugin that can never mount — core rooms match earlier in the render chain |
| R4 | every verb declares `severity` and `category` | an emit-time throw |
| R5 | `severity ∈ {DEBUG, INFO, ACTION, IMPORTANT, CRITICAL}` and `category ∈ {SESSION, NAVIGATION, CLINICAL, COMMUNICATION, MONITORING, CONFIGURATION, ASSESSMENT, ERROR}` | these are CHECK constraints on `learning_events`. Anything else is valid JS and is then **silently dropped by sqlite at INSERT** |
| R6 | every verb has a `verbFallback` | an unmapped verb falls through to a literal `${verb}_${objectType}` bucket and silently pollutes every TNA model |
| R7 | `verbFallback` values are real clinical states | same |
| R8 | `objectOverrides` keys are object types the plugin declares | claiming a core type |
| R9 | `interpretations` keys involve the plugin's own verb or own object type | **the subtle one, see §5** |
| R10 | `capabilities` are known names | a silently ungranted capability |
| R11 | no key collides with rohy's or another plugin's | a silent overwrite that changes what existing rows mean |
| R12 | `minRole` / `authoring.minRole` are real rohy roles | a typo that silently reads as `guest` and opens the surface to everyone |
| R13 | if `authoring` is declared it MUST carry `labelKey` and `minRole` | an unlabelled entry, and an editor inheriting a learner-level gate |
| R14 | `authoring.minRole` is at least as strong as `minRole` | editing a case being easier to reach than reading it |
| R15 | `authoring` and `authorComponent` appear together or not at all | a manifest entry routing to nothing, or a component nothing can reach and no `minRole` gates |

Roles: `guest student reviewer educator admin` (mirrors `ROLE_RANKS` in
`server/middleware/auth.js`; a contract test asserts the copies agree).

Clinical states: `assessing examining investigating treating communicating
documenting monitoring regulating reflecting navigating`.
Capabilities: `llm uploads notify persist`.
Icons: `Microscope FlaskConical Scan Stethoscope BookOpen GraduationCap`.
Accents: `fuchsia teal indigo`.

Icon and accent are **strings resolved against host allowlists** — a manifest is
server-importable data, so it cannot carry a React component, and Tailwind only
emits a class it can see written out as a literal.

---

## 5. Collision detection is not ownership

`mergeNamespace()` throws on any duplicate key — plugin-vs-rohy and
plugin-vs-plugin alike. That catches a plugin **overwriting** something.

It is structurally blind to a plugin **claiming an unclaimed key that
semantically belongs to core.** `DEFAULT_INTERPRETATIONS` has no
`ORDERED_LAB:lab_test` row, so a plugin adding one collides with nothing — and
silently reclassifies a core clinical event across every TNA model, because
explicit interpretations outrank both object and verb defaults.

Hence R8/R9: **a plugin may only make claims about its own vocabulary.**

---

## 6. Host context

```js
ctx = {
    pluginId,
    session: { id, caseId, userId, role, language, examMode },
    data,            // caseConfig[manifest.id] — the plugin's case material
    eventLogger,     // see the caveat below
    capabilities,    // only what the host actually granted
    store,           // present iff 'persist' was requested
    t, navigate,
}
```

**Capabilities are narrowed adapters the host builds, never host singletons.**
The worked example: rohy's `LLMService` exposes `sendMessage`/`streamMessage`,
both bound to the patient conversation — handing it to a plugin for grading
would write grading prompts into the case transcript. The plugin wants
`{ complete({system, prompt}) }`. So `llm` is granted in that shape or not at
all, and a plugin that requested it MUST degrade rather than crash.

A capability the manifest requests but the host does not grant is **absent**,
not a broken stub. Check before calling.

> **Known weakness.** `ctx.eventLogger` is currently the whole `EventLogger`
> singleton, which exposes `setContext()` and unrestricted `log()`. A plugin can
> therefore change the global session/room context or emit another plugin's
> verbs. The narrowed `log()` adapter that would fix this — fixing
> `{pluginId, sessionId, room, allowedVerbs}` — is **not built**. Until it is,
> plugins are expected to wrap the logger themselves, as the pathology package
> does with `createPathologyLogger()`.

---

## 7. Events

Plugin rows land in `learning_events` with `room = '<id>'`, interleaved with
every other event by timestamp. That is the entire point: a slide read and a lab
order sit in one sequence, so TNA can show the transition between them. No new
table, no ETL.

The manifest's `states` block feeds `clinicalStates.js`, so plugin verbs resolve
to clinical states instead of a literal bucket.

The server validates every verb against one registry
(`server/shared/learningVerbs.js`), on **both** `POST /learning-events` and
`POST /learning-events/batch`.

---

## 8. Persistence

A plugin persists nothing. It hands the host its whole document on every
mutation and the host decides where that lives — which is why a change callback
should pass the full document rather than a patch: no change log to replay.

`ctx.store` is async, localStorage-backed, namespaced
`rohy_plugin:<pluginId>:<sessionId>:<name>`, registered in
`src/storage/registry.js` with a `session` lifetime. It is the only module
touching the backing store and every method is already async, so swapping the
bodies for `apiFetch('/api/plugins/...')` needs no change at any call site.

> **Ordering trap.** A plugin that seeds internal state from an `initial*` prop
> typically seeds it **once** and ignores later changes (otherwise a parent
> re-render discards work in progress). `PluginRoom` therefore renders nothing
> until the store load settles — mounting first would seed the plugin empty and
> silently drop everything saved last session.

> **Do not persist what you cannot restore.** If a plugin has no `initial*` prop
> for a piece of state, saving it is worse than not saving it: the value becomes
> unreadable *and* the next mutation after a remount overwrites it with an empty
> one. Pathology's report drafts are currently in exactly this position and are
> deliberately not persisted.

---

## 9. Availability and lifecycle

A plugin gates itself. `available(ctx)` returning false leaves it out of
navigation with a reason in `registry.diagnostics()`; a gate that **throws** is
treated as unavailable rather than taking rohy down.

A declined plugin does not mount at all — otherwise it would render its own
empty state, which is the thing `available()` exists to prevent. Every
`RoomNavigator` mount receives the resolved list, and a learner sitting in a
room that becomes unavailable (case switch, restored view blob) is returned to
`chat`.

---

## 10. Discovery and the drift gate

Two consumers must agree on one manifest:

- **runtime** — `import.meta.glob('./*/index.jsx')`, resolved by Vite at build
  time against whatever directories exist. This is what preserves the
  peaceful-exclusion rule under a bundler: delete `src/plugins/<id>/` and rohy
  still builds and boots, minus that room. A static import list would turn the
  same deletion into a build failure.
- **server** — `server/shared/plugins/manifests.generated.js`, frozen by
  `npm run plugins:gen`.

```bash
npm run plugins:gen      # regenerate after any manifest change
npm run plugins:check    # drift gate — runs in prebuild
```

Runtime registration additionally cross-checks the frozen snapshot and throws if
a descriptor's id or vocabulary has drifted, so a plugin cannot mount
client-side while the server rejects everything it emits.

> **Note.** An earlier version of this document justified generation with "the
> Docker runtime stage copies `server/` but not `src/`". That is false for the
> actual image: `deploy/docker/Dockerfile:156` copies `src/` into the runtime
> stage, and `analytics-routes.js:3` already imports from `src/`. (The same
> stale claim appears in `CLAUDE.md`.) Generation is kept because it gives a
> drift gate and keeps the ingest path off the `src/` layout — a deliberate
> trade, not a deployment constraint.

---

---

## 11. Authoring *(added in 1.1)*

A room is where a learner **uses** a plugin's material. An authoring surface is
where someone **makes** it. Before 1.1 there was no slot for the second, so a
plugin shipping an editor — pathology's `CaseAuthor` — had nowhere to mount.

### Why it is a slot and not a mode of the room

**The two gates are opposite.** `available(ctx)` declines a case with no
material, which is exactly the case an editor exists to create. Folding
authoring into the room would make the editor unreachable precisely when it is
needed.

They also differ in audience, in lifetime, and in what they write:

| | room | authoring |
|---|---|---|
| gate | `available(ctx)` — has this case material? | role only; a blank case is the normal starting point |
| audience | `minRole`, typically `student` | `authoring.minRole`, typically `educator` |
| writes | a learner's own work, per session | the case material every learner is then assessed against |
| store | `ctx.store`, namespaced by session | **not `ctx.store`** — see below |

### `authoring.minRole` is required, never inherited

Authored material is what every learner is subsequently assessed against.
Inheriting the room's `student` would be the most consequential default in the
standard to get wrong, so R13 makes the manifest say it out loud, and R14 stops
it being weaker than the room it edits.

> **1.1 also made `minRole` real.** It shipped in 1.0 and was enforced nowhere —
> a field that read like a guarantee and was not one. `registry.resolve()` now
> checks it, and reports a role refusal as its own reason rather than as
> "declined for this case": *"you may not open this"* and *"this case has no
> material"* are very different absences.

### Persistence is the host's, and it is not `ctx.store`

`ctx.store` is namespaced `rohy_plugin:<id>:<sessionId>:` — right for a
learner's in-progress work, wrong for authored material, which belongs to the
**case** and outlives every session.

So `PluginAuthor` takes the draft and its save callback as props: whoever
renders it decides where authored material lives. This is §8's rule applied one
level up — the plugin hands back its whole document, and the host owns storage.

> **Rohy has no case-config write path yet.** Until it does, a host may render
> `PluginAuthor` with no `onSave` and the plugin's own export is the way out —
> pathology writes the case JSON to a file. That is a real limitation, not a
> design: the seam is in place and needs a store behind it.

### The mount

```jsx
import { PluginAuthor } from './plugins/index.js';

<PluginAuthor
    pluginId="pathology"
    session={session}
    caseConfig={caseConfig}
    eventLogger={eventLogger}
    value={draft}            // optional; falls back to ctx.data
    onSave={persistTheCase}  // optional today
/>
```

`registry.authors(role)` lists the plugins offering an editor this role may
open — deliberately **not** filtered by `available()`, for the reason above.
`PluginAuthor` re-checks the role itself rather than trusting the navigation
that led to it: a surface reachable by URL must not depend on a check somewhere
else having happened.

---

## 12. Adding a plugin

1. `src/plugins/<id>/manifest.js`
2. `src/plugins/<id>/index.jsx`
3. `npm run plugins:gen`, commit the generated file
4. Add `room_<id>` / `room_<id>_sub` to `src/locales/en/common.json`, then
   `npm run i18n:extract` → `i18n:pseudo` → `i18n:translate`
5. Put material on a case under `case.config.<id>`

No edit to `App.jsx`, `RoomNavigator.jsx`, `eventLogger.js`,
`clinicalStates.js` or `analytics-routes.js`. **That list is the standard's
acceptance test** — each of those files used to require one.

---

## 13. Conformance checklist

- [ ] Both `manifest.js` and `index.jsx` present
- [ ] Manifest passes `npm run plugins:gen` (rules R1–R15)
- [ ] `available()` declines a case the plugin cannot serve, and never throws
- [ ] Every declared capability is checked for presence before use
- [ ] Nothing is persisted that the plugin cannot restore
- [ ] The plugin imports nothing from rohy
- [ ] i18n keys exist for `room.labelKey` and `room.subKey`
- [ ] If it ships an editor: `authoring` block AND `authorComponent` both present,
      `authoring.minRole` stated and at least as strong as `minRole`, and its
      `labelKey` has an i18n entry (§11)

---

## 14. Not built yet

Ordered by how much they matter to a plugin author.

1. **No narrowed `log()` adapter** — `ctx.eventLogger` is the mutable global
   singleton (§6).
2. **No server-side plugin routes.** `/api/plugins/<id>` is designed but
   unmounted, so `ctx.store` is per-browser: fine for drafts, not for anything
   that must survive a device change.
3. **No plugin/version attribution on rows.** Events store neither `plugin_id`
   nor manifest version, and clinical state is resolved with the currently
   installed maps — so upgrading or removing a plugin retroactively reinterprets
   historical analytics.
4. **No store behind the authoring seam.** `PluginAuthor` takes `value`/`onSave`
   as props (§11) but rohy has no case-config write path, so authored material
   currently leaves via the plugin's own export. This is the gap that keeps the
   authoring slot from being end-to-end.
5. **No per-tenant enable/disable** (the `oyon_settings` table is the pattern to
   copy). `minRole` and `authoring.minRole` ARE enforced as of 1.1, in
   `registry.resolve()` and `PluginAuthor` respectively.
6. **No LLM grant exists**, so `capabilities.llm` is always absent.
7. **No cleanup path for `rohy_plugin:*`** — a `session` lifetime is declared
   but nothing clears the keys, so state persists on shared browsers.
8. **Runtime/third-party loading is out of scope** (§1).

### Pre-existing rohy issues surfaced during review

Not caused by RPS-1, but they affect every plugin's data:

- `resolveSessionTrinity()` checks tenant membership but **not session
  ownership** or `deleted_at`, so any authenticated same-tenant user can insert
  events attributed to another learner's session.
- Both canonical ingest endpoints **drop `severity` and `category`**, so all
  rows land with NULL despite the columns and the manifest requirement.
- The batch endpoint has **no size cap and no rate limit**.

---

## 15. Reference implementation

`src/plugins/pathology/` — adapts the vendored `rohy-pathology` package
(`src/components/pathology/`, byte-identical to upstream) into a room with 23
verbs, 9 object types, whole-slide viewing, annotation with QuPath GeoJSON
interchange, and read-process assessment.
