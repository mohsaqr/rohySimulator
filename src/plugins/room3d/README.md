# room3d — the 3D patient room as a Rohy plugin

A sixth RoomNavigator room ("3D Room") rendering the `rohy-3d-patient-room`
package bound to live case data: the case's patient record and avatar, the
monitor's real vitals (via `EventLogger.currentVitals`) and real ECG
generator, rhythm labels, and click-through to Rohy's own OrdersDrawer
(chart → records tab, IV/oxygen → treatments tab).

## Toggle

`src/plugins/config.js` → `ROOM3D_ENABLED`. Off = the registry is empty and
the app is stock.

## What lives here (everything plugin-owned)

- `index.js` — the plugin definition (room key `exam3d`, navigator entry with
  locale fallbacks, lazy `Screen`).
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

1. `src/plugins/registry.js` + `src/plugins/config.js` — the registry App and
   RoomNavigator consume (generic; carries no plugin specifics).
2. `src/App.jsx` — imports `PLUGIN_ROOMS`; spreads plugin keys into
   `ROOM_KEYS`; renders each plugin's `Screen` when `currentRoom` matches;
   sets `inert` on the two chat columns while a `coversChat` plugin room is
   active (the chat layout stays mounted underneath as the live-physiology
   bridge); passes `onOpenDrawer` into plugin screens.
3. `src/components/common/RoomNavigator.jsx` — appends
   `PLUGIN_ROOMS[].navigatorDef` to the room list; `t(labelKey,
   {defaultValue})` so plugins need no locale edits.
4. `src/components/orders/OrdersDrawer.jsx` — additive `openRequest`
   ({tab, at}) prop to open the drawer on a given tab programmatically, and
   `fabAlign` ('seam' default | 'left') so the floating pills dock at the
   very left over a full-surface plugin room instead of over its content.
5. `src/hooks/usePhysicalExam.js` + `src/services/ecgWaveform.js` — two
   EXTRACTIONS, not additions: the exam-perform flow lifted out of
   ManikinPanel and the waveform generator lifted out of PatientMonitor, so
   the 2D rooms and this room share one implementation each instead of the
   plugin carrying copies. Both are behaviour-preserving and covered
   (`usePhysicalExam.test.jsx`; PatientMonitor's 17 tests).
6. `src/components/examination/AuscultationPanel.jsx` — additive `figure`
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
bar does the same thing as tapping it. A turn is: recogniser → the session's
own thread + the chat room's persona → streamed reply, spoken sentence by
sentence as it is written, captioned as it is spoken.

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
- **The room never invents a persona.** If the cached prompt is missing or
  belongs to another case, the room says it is not ready instead of asking
  the model to improvise a patient.

Still open: audio arbitration between speech, stethoscope clips and alarms
(V3 in `tmp/voice-plan.html`) — a clip started by hand can still overlap a
spoken line.

## Dev environment (this worktree)

Client `:5273`, API `:3100`, own SQLite (seeded on first boot) — fully
isolated from the main checkout's 5173/3000 instance.
