# Oyon capture: licence agreement instead of in-app consent pop-ups

Status: **planned** · Decided 2026-09-17, revised the same day (opt-in by the person) · Owner: product

## Decision

Rohy shows **no consent pop-ups of any kind** for Oyon.

- **Opt-in by the person.** Oyon measurement is **opt-in, and the person turns it on themselves**. Nobody switches it on for them. The institution decides which measurements are *available* in its deployment. Each learner then chooses whether to use them, and can stop at any time.
- **Consent outside the session.** Consent to the terms of use and to data processing comes from a **licence agreement built into the system**, accepted once per account and version (see Prior art). Research use additionally requires the researchers' own signed agreements with participants.
- **Enforcement.** The server keeps enforcing that nothing is stored for a person who has not turned measurement on. An earlier idea, letting the tenant switch authorize capture for everyone, was **rejected**: Oyon is turned on by the user.

## Why

- Pop-ups interrupt learners mid-case, and they failed anyway: an admin who never saw the student welcome page was never asked, so turning Voice on and talking captured nothing.
- The camera already works this way: it starts only when the learner presses start.

## What changes in rohy (to implement)

- **Remove the consent cards:** `OyonConsentUpdate` and any first-time variant.
- **Learner-facing on/off controls** for each available measurement (camera, typing, voice, interaction), in the capture pill and Settings → Oyon, named in plain language:
  - Turning one on records that choice, and the server stores only what the person has turned on.
  - Turning it off stops measurement immediately.
  - The camera's existing start button already follows this pattern.
- **Server gate:** replace "consent version covers the modality" with "the person has turned this modality on", recorded per person, with the time and the terms version in force.
- **Welcome page:** its checkbox becomes the first place a learner can turn measurement on, listing each measurement it turns on.
- **Licence agreement:** port chatoyon+'s terms gate. Draft text: `docs/design/rohy-terms-of-use-draft.md`.
- **Tests and Prova:**
  - Replace the consent-version gate tests with opt-in tests.
  - Retire Prova case `OYON.CONSENT.01` and add cases for the opt-in controls and the licence acceptance.
- **Docs:** update `docs/OYON_INTEGRATION_POLICY.md`.

## Prior art: chatoyon+ already has this

`~/Documents/Github/chatoyon-plus` (a sibling repo) ships a complete, versioned terms-of-use agreement. Port it rather than design a new one:

- **Gate, not a dialog** (`src/components/license/LicenseGate.tsx`, rendered by `AuthGate`): shown once per account, between sign-in and the app, **in place of the whole shell**, so nothing (including sensing) starts before acceptance.
  - Checkbox unlocks only after scrolling to the end.
  - "Decline and sign out" is the only alternative; there is no "later".
- **Versioned acceptance** (`src/app/api/license/route.ts`, `prisma` model `LicenseAcceptance`):
  - Unique on (user, version).
  - Snapshots the exact title and body shown, with IP and user agent.
  - Audited as `license.accept`.
  - A POST naming a stale version gets 409, so nobody signs text they did not see.
- **Admin control:**
  - Required on or off, title, body and version are editable, and edits are audited without the body.
  - An adoption count shows accepted vs eligible accounts.
- **Public text:** `/terms` is readable without an account, and the login screen links to it.
- Default terms text (`lib/license/defaultTerms.mjs`) covers the tutor, camera sensing, privacy ("numbers, not images") and analytics. Adapt it for rohy's rooms and for typing and voice.

**Reconcile before building.** The user asked for "no pop-ups whatsoever". chatoyon+'s gate is a full-page step shown once per account at sign-in, not a pop-up over a running app. Confirm that this one-time acceptance is the intended form.

## Licence of the software itself

Oyon, and the rest of the Carm ecosystem, is under the **Carm Research License** (v1.4 in the Oyon repo and in rohy's vendored `OyonR/LICENSE`; chatoyon+ still carries v1.3). Clauses that bear on rohy:

- **Free** for non-commercial research and teaching.
- **No sublicensing, resale, or offering as a service** without the copyright holder's written permission. rohy.lacarm.com hosts Oyon as part of a service.
- **Embedding or integrating** Oyon into other software needs explicit written approval, as does **extracting or reusing portions** (functions, algorithms, constants). rohy ports Oyon's `typingChartMath.js` and part of `voiceChartMath.js`.
- **Attribution** in publications and **third-party notices** must accompany copies. Oyon's `licenses/` covers Silero VAD, ONNX Runtime Web, MediaPipe, HSEmotion, EmotiEffLib, WebGazer and WebEyeTrack.

The copyright holder is Professor Mohammed Saqr. The written permissions for rohy's integration should be recorded (for example in `NOTICE.md` or this doc) so a later audit or a third-party deployment can see they exist.

## Open questions

- Is the licence accepted per tenant, per institution, or per deployment?
- How is an active measurement shown while it runs? The capture pill is the natural place.
- Retention period and deletion on request under the agreement.
