# RPS-1 — the Rohy Plugin Standard

**Status:** 1.0–1.2 implemented (rohy v2.9.59–v2.9.61) · **1.3 DRAFT — specified, not yet implemented** · **Spec version:** 1.3-draft · **Last reviewed:** 2026-08-28

> **Reading this document.** Sections marked *(1.3, proposed)* describe behaviour
> rohy does not have yet. They are written before the code on purpose — the
> same discipline as 1.1 and 1.2 — and the marker is removed in the commit that
> lands the code. Until then, §14 item 4 remains true.

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
| **document** *(1.3, proposed)* | hand-pasting a plugin's export into `config` | descriptor (`validate`, `summarize`) + host case store |

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

    // 1.3, proposed — the document contract (§11a). REQUIRED when `authoring`
    // is declared; `summarize` is optional.
    validate: (doc) => [/* { level: 'error'|'warning', message } */],
    summarize: (doc) => ({ count: doc?.strips?.length ?? 0, labelKey: 'ecg_strips_count' }),
};
```

`props()` is what lets a **package keep its own prop vocabulary**.
Pathology wants `pathologyCase` / `initialAnnotations`; the host only knows
`ctx.data` and a store. The adapter bridges them and lives *outside* the
package's source. *If plugging something in requires editing it, it is not
plug-and-play.*

> **1.3 note — the boundary is a test, and the location is upstream.**
> `src/components/pathology/` is a byte-identical copy of
> `~/Documents/Github/Pathoyon/rohy-pathology/src` (re-vendored at v2.9.69).
> Edit the package upstream and re-vendor; never in rohy. Rohy's ESLint ignores
> the folder (as it does `OyonR/`), and rohy's own gate on it is
> `portability.test.js`: every import is a file inside the folder or a declared
> peer dependency, and rohy's services arrive as props (`eventLogger`, `t`, the
> persistence callback).

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
| R16 | `remote` and the `remote` capability appear together or not at all | a manifest describing a proxy it never requested, or a proxy mounted onto nothing |
| R17 | `remote.origin` is **forbidden** | a manifest choosing which host rohy's server will talk to. See §7a |
| R18 | `remote.paths` are literal `/lower-kebab` prefixes and `remote.contentTypes` is a non-empty list of bare `type/subtype` | an unbounded proxy — an open relay onto the configured origin — and an image proxy that will happily relay `text/html` from it |
| R19 *(1.3, proposed)* | if `authoring` is declared the descriptor MUST export `validate(doc)` | an editor whose output the host cannot judge — material every learner is assessed against, shipped unreviewable. See §11a |
| R20 *(1.3, proposed)* | `available(ctx)` judges the **document**, never the key's presence | a saved-but-empty document lighting a room onto nothing — the exact failure `available()` exists to prevent |

Roles: `guest student reviewer educator admin` (mirrors `ROLE_RANKS` in
`server/middleware/auth.js`; a contract test asserts the copies agree).

Clinical states: `assessing examining investigating treating communicating
documenting monitoring regulating reflecting navigating`.
Capabilities: `llm uploads notify persist remote`.
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

## 7a. Remote content *(added in 1.2)*

A plugin whose material is too large to ship inside rohy declares the `remote`
capability. A whole-slide pyramid is gigabytes; putting it in the Docker image,
the backups and the air-gap bundle is not a packaging inconvenience, it is a
different product.

```js
capabilities: ['persist', 'remote'],
remote: {
    paths: ['/tiles', '/gross'],
    contentTypes: ['application/xml', 'text/xml', 'image/jpeg', 'image/png', 'image/webp'],
},
```

A case then addresses the content with a `remote:` reference:

```json
{ "slides": [{ "id": "s1", "dzi": "remote:tiles/case42/slide1.dzi" }] }
```

and the browser receives `/api/plugins/pathology/tiles/case42/slide1.dzi` — same
origin, so the CSP never has to hear about the slide host.

### A case author picks a path; an operator picks a host

The origin is absent from the manifest **and** from the case, by rule (R17). It
comes from one place only:

```
ROHY_PLUGIN_ORIGINS="pathology=https://slides.example.edu"
```

This is the load-bearing decision of the whole feature and it is not
hypothetical caution: `proxy-routes.js` accepts a client-supplied `endpoint` and
then deliberately ignores it, because honouring it was an SSRF and API-key
exfiltration hole. A plugin proxy is the same risk with a friendlier name.
Anyone who can edit a case can choose a *path*; only someone who can edit the
server's environment can choose a *host*.

It also makes cases portable. A case that named `https://slides.example.edu`
would pin one deployment's infrastructure into content meant to move between
them; a `remote:` reference runs unchanged against a university's slide server
and a laptop's.

### Why proxy instead of widening the CSP

Naming the slide host in `img-src` is one line in `server/security-headers.js`
and it is the wrong line. It puts a third-party origin inside the page's trust
boundary for every case and every tenant, permanently, and it moves the decision
about what rohy may load from the server to the browser. Proxying keeps the CSP
at `'self'`, keeps upstream reachability a server-side fact, and makes *who may
read which slide* a question rohy can answer.

### What the proxy refuses

`GET /api/plugins/:pluginId/*` is authenticated, `minRole`-gated (the first
place `minRole` is actually enforced), and read-only. It refuses:

| Refusal | Why |
|---|---|
| any origin not in `ROHY_PLUGIN_ORIGINS` | 503 rather than a guess |
| **redirects** — `redirect: 'manual'`, 3xx → 502 | fetch's default is `follow`; with it, the slide host could hand rohy the cloud metadata endpoint and rohy would fetch it with the server's own network position |
| a path outside the declared prefixes | 403, **before the upstream is contacted** — a check applied to the response would already have fetched the secret |
| traversal, in both spellings | `%2e%2e/` is normalised away by the router and caught by the prefix check; `..%2f` survives as one segment containing a separator and is caught by the segment check. Dropping either leaves one spelling live |
| a content type the manifest did not declare | relaying `text/html` would serve attacker-controlled markup from rohy's own origin |
| a body over 32 MB, or 15 s of silence | what a compromised or simply broken upstream can push through rohy before anyone notices |
| any method but GET | a proxy that can POST is a confused deputy holding rohy's network position |

Client cookies, `Authorization` and query strings are not forwarded upstream;
upstream `Set-Cookie` is not returned. The two sides share a path and nothing
else. Responses are `Cache-Control: private, max-age=86400` — private because
they passed a per-user check, long because tile immutability is what keeps a
deep-zoom pan off the network at all.

The route is exempt from `generalLimiter` and carries its own limiter at
2000/min keyed by **(tenant, user)**. `generalLimiter` is 600/min keyed by IP,
and a teaching lab is a room of students behind one NAT address: one learner
reading a slide would otherwise spend the whole building's budget.

### What it is not

It is not a general fetch capability, an upload path, or a way to reach a
service that needs credentials — there is no upstream-authentication design yet.
It is a read-only relay of declared paths from one operator-configured host.

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

> **Rohy has no case-config write path yet** (true until 1.3 lands). Until it
> does, a host may render `PluginAuthor` with no `onSave` and the plugin's own
> export is the way out — pathology writes the case JSON to a file. §11a
> specifies the store behind the seam.

## 11a. The document *(1.3, proposed)*

A plugin is **part editor, part room**, and the thing that travels between the
two halves is its *document*: the plugin's slice of the case config,
`config[manifest.id]`. 1.1 named both halves and gated them; 1.3 says what the
document is, who judges it, and what the host owes it. Nothing here *needs* to touch a
plugin's source — pathology's `caseAuthoring.js` already exports `validateCase`
and `isShippable`; the descriptor adapts them, exactly as `props()` adapts the
room. (The package is edited upstream and re-vendored — see §3.2 — so the
hooks are adapters by design; a package that ships its own validator needs no
change to gain them.)

### 11a.1 Shape

- `config[<id>]` is **one JSON document**, owned by the plugin, opaque to rohy.
  The host never reads inside it; it stores, snapshots, exports and versions it
  as a unit. This is §8 applied to authoring: the plugin hands back the *whole*
  document, never a patch.
- `null` / absent means **no material**. The host does not invent the key.
- It is text — paths, `remote:` refs (§7a), coordinates, prose. Bulk bytes live
  behind the remote proxy, never inline. The server caps a document at
  **64 KB serialised** (well under the 256 KB request limit, and enough for
  hundreds of annotations); a plugin that needs more raises it *per plugin* in
  the manifest, never globally.

### 11a.2 The plugin judges its own document

Two descriptor hooks, both pure functions of the document, both usable on the
server side one day because they take no context:

| hook | required | returns | the host uses it to |
|---|---|---|---|
| `validate(doc)` | **yes** when `authoring` is declared (R19) | `[{ level: 'error' \| 'warning', message }]` | show issues on the wizard card; refuse to mark a case *available to students* while an `error` remains — never refuse to **save** (a half-finished draft must be storable) |
| `summarize(doc)` | no | `{ count, labelKey }` | print "3 slides" on the card; falls back to *"material present"* |

`available(ctx)` keeps its role — *can this plugin serve this case?* — but R20
makes explicit what 1.1 left implicit: it decides on the **document**, not on
whether the key exists. Pathology's `ctx.data != null` is the anti-pattern;
`ctx.data?.slides?.some(s => s.dzi)` is the rule.

### 11a.3 What the host owes the editor half

The mirror of §6–§9 for rooms. A host is conformant when all five hold:

1. **Discoverable.** Every plugin in `registry.authors(role)` has an entry point
   the case author can find without knowing the plugin exists — a *Plugins*
   step in the case wizard, one card per plugin: label (`authoring.labelKey`),
   `summarize()` line, `validate()` issues, **Open editor**, **Remove**
   (confirm; sets `config[<id>] = undefined`). The step is hidden when no
   registered plugin ships an editor.
2. **A surface, not a panel.** The editor mounts full-page via `PluginAuthor`
   (like the persona editor), with `value = config[<id>]` and `onSave` writing
   the whole document back into the wizard's draft. A plugin editor is a
   workstation — two headers and a wizard footer around it is the wrong frame.
   The host guards **Discard** on a dirty draft.
3. **Persistence through the case.** The document is saved by the ordinary case
   save (`POST/PUT /cases`) and nothing else. That is what buys, with zero
   plugin code, everything the case already has: the session snapshot
   (`sessions.case_snapshot.config`, so a learner's room is pinned to the
   document they started on), export/import, and case versions.
4. **A server-side guard driven by the manifest snapshot.** For every plugin in
   `PLUGIN_MANIFESTS` that declares `authoring`, `normaliseCaseForStorage`
   requires `config[<id>]` to be a plain object within the size cap, and any
   `remote:` ref inside it to start with one of `manifest.remote.paths`;
   otherwise `400 { code: 'invalid_plugin_config' }`, never 500. Keys the
   manifests do not claim are left alone — they are not ours to police.
5. **Seed-once respected.** Editors seed internal state from `initial*` once
   (§8 ordering trap). The host mounts the surface only when the document is in
   hand and keys the mount by `(pluginId, caseId)`.

### 11a.4 Lifecycle of a document

```
author opens wizard → Plugins step → Open editor
   → PluginAuthor(value = config[id]) → onSave(whole doc) → wizard draft
   → PUT /cases (guard: object, ≤64 KB, remote paths)      ← the ONLY write
   → cases.config[id]
   → POST /sessions copies it into case_snapshot.config    ← pinned per learner
   → PluginRoom: available(ctx) judges ctx.data            ← R20
   → learner works; ctx.store holds THEIR work, per session (§8)
```

Two documents, two stores, never confused: the **case** document is the
author's and lives in `config[<id>]`; the **learner's** work is theirs and
lives in `ctx.store`. 1.1 said this in prose; 1.3 makes each half of the plugin
write to exactly one of them.

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
- [ ] *(1.3)* If it ships an editor: the descriptor exports `validate(doc)` (R19),
      `available()` judges the document not the key (R20), and its document
      round-trips `PUT /cases` → `case_snapshot` → room with no plugin code (§11a)
- [ ] *(1.3)* A blank document saved from the editor does NOT light the room

---

## 14. Not built yet

Ordered by how much they matter to a plugin author.

1. **No narrowed `log()` adapter** — `ctx.eventLogger` is the mutable global
   singleton (§6).
2. **`/api/plugins/<id>` serves reads, not writes.** The `remote` proxy (§7a)
   is mounted as of 1.2, so bulk content can live off-box — but there is still
   no write path, so `ctx.store` remains per-browser: fine for drafts, not for
   anything that must survive a device change.
   Nor is there an upstream-authentication design: the proxy can only reach a
   host that will serve it unauthenticated from rohy's network position.
3. **No plugin/version attribution on rows.** Events store neither `plugin_id`
   nor manifest version, and clinical state is resolved with the currently
   installed maps — so upgrading or removing a plugin retroactively reinterprets
   historical analytics.
4. **No store behind the authoring seam.** `PluginAuthor` takes `value`/`onSave`
   as props (§11) but rohy has no case-config write path, so authored material
   currently leaves via the plugin's own export. This is the gap that keeps the
   authoring slot from being end-to-end. **Specified by 1.3 (§11a, R19, R20);
   remove this item in the commit that implements it.** Implementation plan:
   `todo/pathology-authoring-plan.md` (WP1 server guard + WP2 availability, then
   WP3 wizard step + WP4 surface).
5. **No per-tenant enable/disable** (the `oyon_settings` table is the pattern to
   copy). `minRole` and `authoring.minRole` ARE enforced — as of 1.1 in
   `registry.resolve()` and `PluginAuthor`, and as of 1.2 server-side in the
   remote proxy, which is the first surface rohy's *server* renders on a
   plugin's behalf.
6. **No LLM grant exists**, so `capabilities.llm` is always absent.
7. **No cleanup path for `rohy_plugin:*`** — a `session` lifetime is declared
   but nothing clears the keys, so state persists on shared browsers.
8. **Runtime/third-party loading is out of scope** (§1).

### Pre-existing rohy issues surfaced during review — now fixed

Not caused by RPS-1, but they affected every plugin's data. All three were
closed in v2.9.60; kept here because they define guarantees a plugin author can
now rely on.

- **Session ownership.** `resolveSessionTrinity()` checked tenant membership but
  not ownership, and deriving `(user_id, case_id)` from the sessions row made
  that worse rather than better: a forged event arrived correctly attributed to
  the victim. It now takes an optional `principal` and returns
  `reason: 'not_owner'` for a session the caller does not own — passed by both
  ingest endpoints, and not widened by rank. It also excludes soft-deleted
  sessions. **A plugin's events are attributable**: a row naming a learner means
  that learner's browser produced it.
- **`severity` / `category` are persisted.** Both were dropped at ingestion, so
  every row landed NULL. The verb→metadata map moved from
  `src/services/eventLogger.js` to `server/shared/learningVerbs.js`, so the
  server now *derives* both from the verb — which is what makes a manifest's
  mandatory `verbMetadata` (R7) mean something. A caller may override within the
  enum; an out-of-enum value is rejected as `invalid_event_metadata` rather than
  coerced or left to fail the CHECK constraint.
- **Batch cap and per-user rate limit.** `MAX_BATCH_EVENTS = 500` matches
  BackendSurface's own queue cap. The endpoint was not strictly unlimited before
  — `routes.js` mounts a 600/min global limiter — but that one is keyed by IP,
  and a teaching lab shares one NAT address, so telemetry from one noisy client
  spent the whole room's budget. The route-level limiter is keyed by
  (tenant, user) at 240/min against a legitimate ~12/min.

---

## 15. Reference implementation

`src/plugins/pathology/` — adapts the `rohy-pathology` package
(`src/components/pathology/`, a byte-identical copy of
`~/Documents/Github/Pathoyon/rohy-pathology/src`, re-vendored v2.9.69; rohy's
`portability.test.js` guards the boundary) into a room with 23
verbs, 9 object types, whole-slide viewing, annotation with QuPath GeoJSON
interchange, and read-process assessment.
