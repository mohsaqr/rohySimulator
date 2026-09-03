# room3d — Bedside as a Rohy plugin

The SECOND room in the navigator ("Bedside", `order: 15`, right after
Patient), rendering the `rohy-3d-patient-room` package bound to live case
data: the case's patient record and avatar, the monitor's real vitals (via
`EventLogger.currentVitals`) and real ECG generator, rhythm labels,
click-through to Rohy's own OrdersDrawer (chart → records tab, IV/oxygen →
treatments tab), and the session's ONE patient conversation.

It is an RPS-1 plugin: `manifest.js` (server-importable data) + `index.jsx`
(the adapter). Discovery is Rohy's own `src/plugins/index.js` glob;
`npm run plugins:gen` freezes the manifest for the server. Delete this
directory and Rohy still builds and boots, minus this room.

## Toggle

There is no switch of its own: like every RPS-1 plugin it is on when the
directory exists and the manifest is generated, gated by `minRole` and by
`available()` (a case must be loaded). Per-tenant enable/disable follows
whatever the host does for the other plugins.

## What lives here (everything plugin-owned)

- `manifest.js` — the RPS-1 manifest: id/room key `room3d`, `order: 15`,
  `icon: 'Bed'`, `accent: 'teal'`, `presentation: 'overlay'` (see Core
  touchpoints), the `Room3D` analytics component, and the three
  capabilities it asks the host for: `case`, `conversation`, `drawer`.
- `index.jsx` — the adapter: maps the host context onto the screen's props
  (`activeCase` ← `ctx.patientCase`, `sessionId` ← `ctx.session.id`,
  `onOpenDrawer` ← `ctx.capabilities.openDrawer`, `conversation` ←
  `ctx.capabilities.conversation`). `available()` is "a case is loaded".
- `Exam3DScreen.jsx` — the room surface (z-30; under the z-40 RoomNavigator
  and z-50 OrdersDrawer by contract).
- `caseBinding.js` — pure case→patient / vitals / rhythm / avatar mapping.
- `ecgMirror.js` — 250 Hz fixed-timestep canvas mirror of the monitor's ECG.
- `ecgWaveform.js` — the rhythm-aware **sampler** only. The waveform
  physiology is imported from `src/services/ecgWaveform.js`, the module the
  bedside monitor itself draws from, so the mirrored trace cannot drift
  from the monitor's. `ecgWaveform.test.js` pins both halves.
- `examRegions3d.js` — 18 supine collider boxes using Rohy's own
  `BODY_REGIONS` ids (patient's anatomical left = +x).
- `examWheelData.js` — adapts the real exam model (`BODY_REGIONS.examTypes`
  + `specialTests`) into the room's radial **exam wheel** contract; nothing
  is invented, techniques are only relabeled as verbs.
- (no exam-perform code of its own) — the wheel performs through core's
  `src/hooks/usePhysicalExam.js`, the shared hook extracted out of
  ManikinPanel so the 2D room and this room run one implementation. The
  screen adds its own `EventLogger` call with the `room3d` marker, exactly
  as App does for PhysicalExamScreen.
- `FindingPanel.jsx` — the finding surface, built as a clipboard: a board
  carrying the frame and a gold clip, and a page that scrolls. It only
  frames Rohy's REAL `FindingDisplay` (docked right, or fullscreen via the
  square icon), so auscultation keeps its full `AuscultationPanel`:
  clickable sites, per-point audio, play/pause, volume. It asks for the
  anatomical figure (`figure="manikin"`) and, while docked, for the stacked
  layout — side-by-side needs ~600px and would wrap the finding to three
  words per line in a 430px panel.
- `ManikinOverlay.jsx` — opens Rohy's REAL `ManikinPanel` (the 2D room's
  workspace: stylized figure, front/back and gender toggles, technique
  selector, findings, exam log) full size behind the "Body map" pill, and
  adds the same `EventLogger.physicalExamPerformed` call App makes for
  `PhysicalExamScreen`.
- `usePatientVoice.js` — the patient's voice. `resolveVoice` picks it (case
  override → persona → platform default, refusing to substitute), Rohy's
  `VoiceService` speaks it, and `speaking`/`visemes` are mirrored into
  VoiceContext. Voice settings are fetched here rather than assumed, because
  ChatInterface is their only other writer. Two ways to speak, one resolver
  and one audio path behind them: `speak(line)` for a line the room already
  knows, and `beginSession()` for a reply still being written by the model.
- `useRoomConversation.js` — the learner's spoken turn. Decides **nothing**
  about the patient: the persona is the chat room's own assembled system
  prompt, read from the `lastPatientPrompt` module cache that the (still
  mounted, hidden, inert) ChatInterface pre-warms, and guarded by case id —
  a room that cannot prove it holds this patient's persona refuses to ask
  rather than improvising one. The thread is the session's real
  `/interactions` thread, so a question asked here is in the transcript the
  educator reviews. Each finished sentence is enqueued as the model writes
  it, so the patient starts answering before the reply is complete.
- (no microphone of its own) — the mic is Rohy's `discussion/VoiceControl`,
  the same control the debrief screen uses, in the room's palette
  (`variant="room"`) and with barge-in enabled (`onInterrupt`). One
  microphone in the product, and the room inherits its seven translations.
- Tests for all of the above.

## Navigation

The room's wheel is a navigator, not a camera control: beside the five
camera views it carries destinations passed as `nav_actions` — **Examine**
(answered by the room itself: it opens the examination wheel), **Records**
(→ OrdersDrawer records tab) and **Body map** (→ ManikinPanel overlay).
Views steer the camera; destinations arrive back as `{type:'nav', id}`.
The hub steps through views only — a view is a state worth cycling, a
destination is a decision.

Panels move: the monitor drags by its header and stays where it is put,
clamped to the room.

Sides: the vitals monitor owns the right, so the examination chart docks
**left** and the two never fight for an edge. While a finding is up the
room is asked (`setNavSide('right')`) to move the navigation wheel across,
and it comes back when the chart closes. The chart stops above the room's
own left-hand controls rather than burying them.

## Examination flow

Clicking the patient's body opens the room package's radial exam wheel
(techniques for that region, special tests as a sub-ring); a wedge performs
the exam via core's shared `usePhysicalExam`, and **Rohy** presents it —
the room mounts with `findings: 'host'` precisely so it never replaces
FindingDisplay/AuscultationPanel with a flat card of its own. The room
still answers diegetically: region tint, wince, and a spoken line on an
abnormal finding. Posterior regions stay reachable through the Body map
pill, which opens Rohy's own ManikinPanel full size. Both exam surfaces
(wheel and manikin) log exactly what the 2D examination room logs.

Auscultation draws **Cardoyon's own patient figure** rather than a
schematic ellipse: the same ink-coverage mask its ECG lead selector uses,
painted through an SVG mask so the theme owns the colour. The chest or
abdomen is cropped from it, the sternal midline and intercostal spaces are
marked in its dashed-landmark language ("2nd", "4th", "5th"),
and the auscultation points sit on real anatomy (patient's right on the
viewer's left, apex below and lateral to the nipple). A rendered preview
of both figures lives at `tmp/exam-surfaces-preview.html`.

## Core touchpoints (the entire integration surface)

1. **Three RPS-1 capabilities**, declared in `server/shared/pluginRegistry.js`
   and granted in `src/plugins/context.js` — generic, any plugin may ask:
   `case` (the frozen case snapshot on `ctx.patientCase`), `conversation`
   (the session's one patient conversation, narrowed to send + read) and
   `drawer` (`openDrawer(tab)`). No `llm` grant: the room never talks to a
   model itself.
2. `src/contexts/PatientConversationContext.jsx` — the bus beside
   ChatInterface. ChatInterface stays the owner of the patient turn and
   publishes its transcript + registers its send handler; the host narrows
   that into the `conversation` grant. New, generic, tested on its own.
3. `src/App.jsx` — mounts the provider; builds the three grants; and
   honours `manifest.room.presentation: 'overlay'`: such a plugin room is
   rendered OVER the chat layout instead of replacing it, with both chat
   columns `inert`. The chat layout is where the session lives —
   PatientMonitor is the physiology engine, ChatInterface owns the
   conversation — so it keeps running underneath. Also `openRequest` /
   `fabAlign` into OrdersDrawer.
4. `src/components/common/RoomNavigator.jsx` — one additive entry (`Bed`)
   in the icon allowlist. Ordering and labels are the manifest's;
   `room_room3d` / `room_room3d_sub` are in all seven locales.
5. `src/components/chat/ChatInterface.jsx` — `handleSendToPatient(text,
   meta)`: `meta.source` ('typed' | 'voice' | a plugin room id) is stamped
   on the message and persisted with the interaction (`interactions.source`,
   migration 0053); `meta.spoken` voices the reply for a turn that was
   spoken even when the chat's voice mode is off.
6. `src/components/orders/OrdersDrawer.jsx` — additive `openRequest`
   ({tab, at}) prop to open the drawer on a given tab programmatically, and
   `fabAlign` ('seam' default | 'left') so the floating pills dock at the
   very left over a full-surface plugin room instead of over its content.
7. `src/hooks/usePhysicalExam.js` + `src/services/ecgWaveform.js` — two
   EXTRACTIONS, not additions: the exam-perform flow lifted out of
   ManikinPanel (including its `POST /sessions/:id/exam-findings` persist,
   so a bedside exam reaches the case summary like a 2D one) and the
   waveform generator lifted out of PatientMonitor, so the 2D rooms and this
   room share one implementation each instead of the plugin carrying
   copies. Both are behaviour-preserving and covered
   (`usePhysicalExam.test.jsx`; PatientMonitor's tests).
8. `src/components/examination/AuscultationPanel.jsx` — additive `figure`
   ('diagram' default | 'manikin'), `layout` ('row' default | 'stack'),
   `transport` ('default' | 'compact' — tiny play + real seek, rendered
   directly under the figure in stacked mode) and
   `normalLabel` (true default; false withholds the "normal" verdict badge)
   props. Its progress bar was also fixed to follow real playback instead
   of a hardcoded 60% — same markup, honest width, both modes. `manikin` swaps the schematic
   ellipse for Cardoyon's patient figure with anatomically placed sites;
   the default keeps the 2D room byte-identical. Coordinates and their
   calibration are documented in the file; `AuscultationPanel.test.jsx`
   pins both modes.
7. `src/components/examination/patientFigure.js` — VENDORED byte-for-byte
   from Cardoyon (Github/ECG/src/patientFigure.js), the ink-coverage
   patient mask its ECG lead selector paints. Newer Rohy checkouts vendor
   Cardoyon wholesale under src/components/ecg/; when that lands on this
   branch, delete this copy and import from there.
8. `src/components/examination/FindingDisplay.jsx` — forwards `figure`,
   `layout`, `transport` and `normalLabel` through to AuscultationPanel,
   and honours `normalLabel` for its own verdict badge. No behaviour
   change by default.
9. `src/components/voice/SubtitleBand.jsx` + `useSubtitleReveal.js` — the
   caption EXTRACTED from ChatInterface (it was also copied into
   DiscussionScreen). ChatInterface now renders the shared one; the 3D room
   uses it as its primary surface. The 30% audio head-start gate came with
   it, since no TTS provider exposes word boundaries.
10. `vite.config.js` — `resolve.dedupe: ['three']` (single three.js with the
   `file:../3D` dependency); `package.json` — `rohy-3d-patient-room`.

Every core touch above either adds a prop with a behaviour-preserving
default, or extracts code that was already there so it stops being copied.
No clinical logic is implemented twice.

## Language

Everything the room shows is translated. The plugin's own strings — the
navigation wheel, the spoken exam reactions, the voice control, the caption
speaker labels, conversation errors, case placeholders, finding/manikin
aria — live in the `room3d` namespace (`src/locales/<lang>/room3d.json`,
seven locales, `en-XA` generated by `npm run i18n:pseudo`). The PACKAGE
chrome (clock, monitor, rhythm, status chip, view/nudge wheels, trends card,
finding card, fallback notices) takes the same namespace's `chrome_*` keys
through `mountPatientRoom({ labels })` (`chromeLabels(t)` in
`Exam3DScreen.jsx`); the package refuses an unknown label key rather than
leaving one English. Rhythm names go through the monitor's own
`RHYTHM_LABEL_KEYS`, so the bedside monitor and the room's monitor can never
name a rhythm differently.

Extractor note: i18next-parser files every `t(` call under the LAST
`useTranslation('ns')` named in a file and ignores other function names, so
the room's translators are called `tRoom` / `tMonitor` and the extracted
namespace's hook comes last in each file.

## Voice

The patient speaks the lines the room already writes: an abnormal finding
makes it wince, tint the region, and say something — now audibly, in the
case's own voice, with the line on screen as a subtitle rather than in a
transcript. One control in the room mutes it (and stops mid-sentence).
Silent unless the platform's `voice_mode_enabled` is on and the case's voice
resolves; a configured-but-unplayable voice stays silent by design rather
than substituting a different patient's voice.

## Talking to the patient

The learner speaks back. The microphone sits centre-bottom, and the space
bar does the same thing as tapping it. A turn is: recogniser →
`conversation.send(text, { source: 'room3d', spoken: true })` → the chat
room's OWN send handler (persona, agent template, patient-record write,
`/interactions` row stamped `room3d`, voice) → the reply streams into the
shared transcript, which this room captions as it grows and the chat room
shows as it types. One conversation, two places to have it: a question
asked here is in the chat when the learner walks back; a question typed
there while this room is open is answered here, aloud if the chat's voice
mode is on.

One caption band carries both speakers — the learner's live transcript in
italics under **YOU**, the patient's answer under their name — because
subtitles are the screen here, not a transcript panel.

Three things are deliberate:

- **Barge-in.** Tapping the mic while the patient is talking cuts them off,
  the way it would in a real room. The debrief screen keeps the opposite
  behaviour (let the discussant finish); the difference is one prop.
- **The space bar is shielded, not just used.** ChatInterface is still
  mounted underneath (hidden and inert, so the vitals keep running) and
  carries its own window-level space-bar voice turn. The room's listener is
  on the **capture** phase and stops propagation, so one press opens one
  microphone — the room's — rather than two racing recognisers on a screen
  the learner cannot see. `Exam3DScreen.test.jsx` pins this with a stand-in
  chat listener.
- **The room never invents a persona.** It has no prompt, no history and no
  model call of its own; before the host has a conversation to grant (no
  session yet), the room says it is not ready instead of improvising.

One turn at a time: the chat room's handler refuses a second bus turn while
one is in flight (`patient_turn_in_flight`), so a fast second utterance
cannot interleave two threads; the mic is also disabled while `thinking`.
`voiced` from the host says whether the reply is actually being spoken —
`true` once a speech session exists, `false` when it never will, `null`
between turns — and the room reveals an unvoiced line immediately.

Still open: audio arbitration between speech, stethoscope clips and alarms
(V3 in `tmp/voice-plan.html`) — a clip started by hand can still overlap a
spoken line.

## Dev environment

Stock ports (`:5173` client, `:3000` API). The package is linked as
`rohy-3d-patient-room: file:../3D`; `vite.config.js` dedupes `three` so one
copy is bundled.
