# Supporting-agent behaviour model

**Status:** part built. Sections 1–3 describe what rohy does today.
**§4 shipped in v3.0.0-beta.91** and is marked up accordingly. Sections 5
onward remain unbuilt and are specified here so they can be argued with
before they are written.

A rohy case has one main virtual agent — the patient — and may have any
number of *supporting* agents: a bedside nurse, an on-call consultant, a
family member, a debrief tutor. This document is about the supporting
ones: what makes them pedagogically different from each other, which of
those differences rohy can currently express, and what has to be built
for the rest.

---

## 1. Four axes, not three patterns

The scenarios people propose ("an unaware nurse who arrives late", "a
helpful nurse who is already there", "an anxious relative who gets in
the way") read like three kinds of agent. They are not. They are points
in a space with four independent axes, and treating them as named
presets is what makes the space feel small.

| Axis | The question it answers | Today |
|---|---|---|
| **Availability** | *When* can the learner reach them? | ✅ built |
| **Knowledge** | *What* do they know? | ✅ built (§4) |
| **Stance** | What do they *do* with what they know? | ❌ absent |
| **Initiative** | Do they speak *unprompted*? | ❌ absent |

The axes are worth naming because they compose. A delayed agent who
arrives holding a *wrong* preconception is availability + stance, and it
is arguably a sharper instrument than any of the three named scenarios:
the learner must both hand off well *and* hold their ground against a
confident colleague who is wrong. Nobody proposes that scenario when
thinking in presets. It falls out of the grid for free.

---

## 2. What is already built

### Availability — complete

`case_agents` carries the whole vocabulary, and
`AgentService.isAgentAvailable()` / `getAgentDisplayStatus()` enforce it:

| Column | Meaning |
|---|---|
| `availability_type` | `present` (in the room) · `on-call` (must be paged) · `absent` (not in this case) |
| `available_from_minute` | Not reachable until N minutes into the session |
| `depart_at_minute` | Leaves at minute N |
| `response_time_min`/`max` | Minutes between paging and arrival (0 = instant) |

Paging goes through `POST /sessions/:id/agents/:type/page`, which stamps
a server-anchored `arrives_at` so a refresh or a room switch cannot
strand the countdown.

**Arrival is instant by default** as of migration 0042. Every seeded
persona ships `response_time 0/0`, and a delay is something a case
author opts into. See §7 for the history — the previous default made
"instant" literally unreachable, and it is worth reading before anyone
proposes reintroducing a floor.

### Knowledge — built, see §4

Superseded by `config.knowledge`. What this section used to describe:
`agent_templates.context_filter` (`full` · `history` · `vitals` ·
`minimal`) plus `memory_access`, a verb filter on the patient-record
narrative.

Both were chosen by the **author** and both read from the **case
record** — the distinction that motivated §4. Two footnotes worth
keeping, because both were discovered only when §4 was built:
`context_filter`'s per-case override was stored and never read, and
`memory_access` reached no runtime object at all (its one consumer
called a method defined nowhere). Neither control did what this section
claimed. `context_filter` survives as a legacy fallback that
`normalizeKnowledge` maps; `memory_access` is gone.

### Stance and initiative — absent

No agent has a disposition beyond whatever its `system_prompt` says in
prose, and no agent ever speaks without being spoken to. Every turn is
reactive.

---

## 3. Scenario 2 (helpful nurse) is already authorable

Set the nurse to `availability_type: 'present'`, `context_filter:
'full'`, `response_time 0/0`. That is the seeded Sarah Mitchell, today,
with no code change. If the goal is an entry-level case where an
experienced nurse orients the learner, that is an authoring exercise —
write the persona, attach it, publish.

Worth stating plainly so nobody budgets engineering for it.

---

## 4. The missing primitive: `briefed` knowledge — BUILT (beta.91)

Everything interesting about a *delayed, unaware* agent depended on one
thing that did not exist. It does now; the problem is recorded here
because it is the reason the axis has the shape it has.

An agent's situational knowledge came from `buildDebriefingContext()`,
which assembled the case record filtered by the author's
`context_filter` tier. So a nurse configured as "arrives at minute 5,
knows nothing" still arrived knowing whatever the author let her know.
The handoff the learner performed was theatre: they could say "she's
crashing, help" and receive a fully briefed, competent colleague.
Nothing read what they said. Nothing could be wrong because of what they
left out.

### What shipped

One ordered axis rather than a source beside a tier — the two collapsed
once it was clear `context_filter` was the same question asked twice.
`config.knowledge` in `server/shared/agentKnowledge.js`:

```
scope:  'none'      -- the proposal's `briefed`: knows ONLY what the
                       learner says in this conversation
      | 'handover'  -- the proposal's `hybrid`: a shift handover —
                       identity, reason for presentation, live vitals
      | 'summary'   -- the case in outline, with the initial vitals
      | 'history'   -- the patient's story and the clinical records
      | 'chart'     -- everything the chart holds
answerKey: boolean  -- the expected diagnosis, plan and objectives
record:    boolean  -- the server-rendered encounter record
```

Three deviations from the proposal above, each for a reason:

- **A config key, not an `agent_templates` column.** The proposal
  predates the specialist `disclosure` gate, which proved the pattern.
  A config key gets the per-case override for free; a column would have
  been template-global, so an educator could not vary it per case —
  which is most of the point.
- **`answerKey` is separate.** Not in the proposal, and the defect that
  made this urgent: `context_filter: 'full'` was the only rung carrying
  the configured results and it emitted the expected diagnosis with
  them. There was no way to give an agent the chart without the answer.
- **`record` is separate.** An agent at `none` was still handed the
  learner's full action log by the `RECORD_AGENT_TYPES` allowlist. "You
  know nothing about this patient" plus a complete list of everything
  ordered is a lie the learner cannot detect.

`context_filter` is not read as a tier any more. It survives only as the
fallback `normalizeKnowledge` maps when an agent carries no
`config.knowledge`, so an install nobody has backfilled keeps exactly
the behaviour it had — `full` included, answer key and all.

### Why this is the load-bearing item

It is where the pedagogy lives. An agent acting on an incomplete handoff
and **visibly getting it wrong** — asking for the allergy the learner
never mentioned, drawing the wrong conclusion from a vital they were not
given — teaches more than any post-hoc rubric, and it does so in the
moment, from the learner's own omission. It is also the natural input to
a handoff-quality measure in the debrief, which is the assessment payload
the "unaware agent" scenario is really after.

### How it was actually done

- **No migration for the config.** `seedDefaultAgents` already runs a
  key-absent `json_patch` backfill on every boot, which is idempotent
  and never clobbers an educator's value. Migration 0063 carries only
  the two prompt-PROSE corrections, which cannot be patched that way.
- **The server assembles `none` and `handover`, not the client.** The
  route drops whatever situation the browser sent, exactly as the
  specialist path does. This was not in the proposal and is the most
  important part: an agent that knows only what the learner tells it
  must not have its ignorance enforced by the learner's own browser.
- **The ignorance block** is `BRIEF_UNBRIEFED` in
  `services/situationBrief.js`, in the same prompt slot as a
  specialist's CASE BRIEF — after the persona and its dos/donts, so an
  educator cannot author a "do" that argues with it and have the model
  read it last.
- **The handoff transcript needed no marking.** `agentConversations` is
  already keyed per agent type, so the conversation IS the handoff.
  The work was subtraction, not plumbing.
- **Live vitals come from `session_vitals`**, which the monitor persists
  on a deadband crossing — so a handover carries real current
  observations without trusting the browser's text.

**Effort, as predicted:** the branch was small and the prompt
engineering was the real work. The back-filling estimate holds: the
wording that stops a model inventing a presentation is repetitive and
closes each escape route by name. **Still outstanding: evaluation
against the small model voice mode uses.**

---

## 5. Stance

Once knowledge is separable from behaviour, stance is a small addition:

```
stance:  'supportive'   -- helps, defers, answers straight
       | 'neutral'      -- answers what is asked, volunteers nothing
       | 'obstructive'  -- emotionally demanding, derails, needs managing
       | 'misleading'   -- confidently offers a WRONG reading
```

`misleading` earns its own value rather than being left to prose,
because it needs a structured input — *which* wrong interpretation, so
the case author controls the error rather than the model improvising
one. Something like `config.misleading_claim`, seeded per case.

Two guardrails, both non-optional:

1. A misleading agent must be **visibly labelled to the educator** in
   the case editor and in analytics. A learner who is graded down for
   following bad advice they had no way to identify as bad is being
   punished for the simulation's design.
2. The debrief must know. `misleading` agents belong in the debrief
   context unconditionally, so the tutor can name what happened.

**Estimated effort:** small, *after* §4. On its own it is prose in a
system prompt and not worth a schema change.

---

## 6. Initiative — and why the distractor does not work without it

Every agent is strictly turn-based. There is no path by which an agent
emits a message the learner did not solicit. A family member who only
speaks when spoken to cannot distract anybody; ignoring them is free,
which is the opposite of the intended lesson.

Related: `case_agents.auto_arrive_minute` is stored, is editable through
the API, and **is read by no runtime code**. It is the natural hook for
this and is currently dead.

Making it real needs three things rohy does not have:

- A scheduler that can decide an agent should speak now (timer-based to
  start: "interject every N minutes while present").
- A delivery path for unsolicited agent messages into a room the learner
  may not be looking at — this is a notification-router question, not a
  chat question, and the existing six-surface notification centre is the
  right owner.
- Cross-agent state effects, for "each intervention raises the patient's
  anxiety". Nothing today lets one agent's turn alter another agent's
  state.

**Estimated effort:** large, and the largest genuine unknown is not the
scheduler but the interruption UX. An agent that talks over a learner
mid-consultation is a very easy thing to make infuriating rather than
instructive. Prototype the interruption before building the scheduler.

---

## 7. The learner-role gap

One proposed scenario — *nurse student pages a doctor, and cannot order
labs or perform exams themselves* — needs something that does not exist
anywhere in rohy: **the learner's in-simulation role**.

`users.role` is a platform permission (`guest` 0, `student` 1,
`reviewer` 2, `educator` 3, `admin` 4). It governs who may edit a case,
not who the learner is playing. Nothing gates the lab, radiology, or
examination rooms on a clinical role, because until now every learner
has been the physician.

This is the largest item in the whole set, and it is the one that
changes what rohy *is* — from a physician simulator to a
multi-professional one. Sketch:

- `cases.learner_role TEXT DEFAULT 'physician'` (`physician` · `nurse` ·
  `paramedic` · `student_observer`).
- A capability map per role — who may order, examine, prescribe,
  discharge — enforced **server-side** on the order/exam/radiology
  routes, not merely hidden in the UI.
- The affected rooms render a scoped state, not a 403. "You need a
  doctor's order for this" is the teaching moment; a permission error is
  a bug report.
- `roleAnchor()` already tells the agent who *it* is; it must also learn
  who the *learner* is, or a nurse-student case has consultants
  addressing them as "doctor".

**Estimated effort:** large. Budget it as its own project. It should not
ride along as a rider on a nurse persona, and it is worth doing on its
own merits regardless of which agent scenarios ship.

---

## 8. Scenarios mapped onto the axes

| Scenario | Availability | Knowledge | Stance | Initiative | Blocked on |
|---|---|---|---|---|---|
| 1A · unaware nurse called in | `on-call`, delay N | **`none`** | supportive | — | **nothing — authorable** |
| 1B · unaware doctor, nurse learner | `on-call`, delay N | **`none`** | supportive | — | §7 |
| 2 · helpful bedside nurse | `present`, instant | `chart` | supportive | — | **nothing — authorable** |
| 2b · nurse who just took shift | `present`, instant | **`handover`** | supportive | — | **nothing — authorable** |
| 3 · anxious family member | `present`, instant | `history` | **obstructive** | **proactive** | §5 + §6 |
| — · wrong-headed colleague | any | any | **misleading** | — | §5 |

§4 shipped in v3.0.0-beta.91 and unblocked 1A outright; 1B still waits
on §7. **§5 (stance) is the cheap next step** now that knowledge is
separable from behaviour, which was its precondition. §7 is a project.
§6 is a project with a UX risk that should be prototyped before it is
scheduled.

---

## 9. Appendix: the arrival-delay incident

Recorded because it is the reason §2 says "instant by default", and
because the failure mode is a general one worth recognising again.

Before v2.9.19 the page handler computed:

```js
minSec = Math.max(60, Math.min(180, configuredMinSec || 60));
maxSec = Math.max(minSec, Math.min(180, configuredMaxSec || 180));
```

Both lines are wrong in the same way. `configuredMinSec || 60` treats a
configured **0 as absent**, because 0 is falsy — so an author asking for
"instant" was silently given one minute; and `Math.max(60, …)` floors it
there again even if the first defect were repaired. The ceiling line
turns a configured max of 0 into 180 by the same mechanism.

The net effect is worth stating precisely, because it is funnier and
worse than a plain "the delay was too long": **`0/0` — the setting that
asks for no wait at all — produced a uniform random 60–180 second wait,
the widest band the system could generate.** Configuring instant was
strictly worse than configuring 1–2 minutes. The seeded consultant's
`2/5` produced 120–180s, so every default case spent up to three minutes
of a training session on a progress bar.

Compounding it, on the client `currentAgent` was read from the `agents`
array — fetched once per session, never written again — while the paging
flow updated a separate `agentStates` map. So `agentStatus`, which gates
the countdown, the Call button *and* the composer's `disabled`, never
moved. Pressing "Call Dr. Chen" changed nothing on screen; pressing it
again re-stamped the ETA and pushed the arrival further away; and when
the agent did arrive the tab dot went green next to a chat box that
still refused input. The only escape was leaving the room and returning,
which remounted the component and refetched the list.

Three things generalise:

- **`||` is not a default operator for numeric settings.** It is a
  falsy-check, and `0` is the value most likely to be meaningful and
  most likely to be swallowed. Use `??`, or an explicit `=== undefined`.
- **A clamp that cannot be configured away is not a clamp, it is a
  policy** — and it should be justified where it is written. The comment
  above this code claimed a nurse configured for "instant" would be
  honoured. It never was. Nobody checked the comment against the code.
- **Two copies of the same state will diverge.** The fix was not to keep
  `agents` fresh but to stop reading status from it at all: one live
  overlay, one source of truth. There had also been a second, unused
  client-side `calculateWaitTime()` returning *minutes* where the server
  returns *seconds*, with its own passing unit tests — green tests
  around dead code, while the live path was broken.

The endpoint now has coverage in `tests/server/agent-page-wait.test.js`
and the client contract in
`src/components/chat/ChatInterface.paging.test.jsx`. Both were confirmed
to fail against the pre-fix code before being committed.
