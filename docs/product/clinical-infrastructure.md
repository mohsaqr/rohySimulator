# Clinical simulation infrastructure

Rohy's clinical infrastructure is the runtime environment that turns an authored case into an encounter. It is the part of the platform the learner experiences directly: the patient room, the examination surface, the investigation worklists, the monitor, treatments, records, alarms and debrief. The infrastructure is designed to make clinical reasoning observable. It gives learners tools, delays, signals and consequences, then records how they move through them.

Rohy presents an AI virtual patient the learner can talk to by text or by voice. An animated three-dimensional avatar lip-syncs the patient's spoken replies, blinks and holds eye contact, and the patient answers from the case's own history and personality, speaking in lay language, rating pain on a zero-to-ten scale and staying within what a real patient would know. Around the patient sits a small care team the learner can also address: a bedside nurse who is present, a senior consultant who is on-call and can be paged, and a family member who holds collateral history.

Examination happens on a body map. The learner opens an anterior or posterior view, chooses a region and then chooses how to examine it — inspection, palpation, percussion, auscultation or a named special test — and the platform reveals the finding the case author prepared for that combination, playing real heart and lung sounds for auscultation. Examined and abnormal regions are marked on the figure, findings can be exported, and free-text notes travel with the session.

Laboratory and Radiology work as searchable catalogues. The learner searches or browses, places an order and waits out the test's configured turnaround; a ready badge appears when the report arrives, opening it marks it viewed, and it stays available for the rest of the session. Treatments are ordered and then administered in two steps: the learner sets a medication's dose, route and frequency, or a fluid rate, or an oxygen or nursing measure, gives it, and its effect moves the vitals over the following minutes along an onset, peak and decline curve. Contraindicated and high-alert orders raise warnings, and an active treatment can be discontinued.

The patient monitor carries the case's physiology in real time: heart rate, oxygen saturation, blood pressure, respiratory rate, temperature and end-tidal carbon dioxide, with live ECG, pleth and respiration waveforms and a rhythm that can be normal sinus, atrial fibrillation, ventricular tachycardia, ventricular fibrillation or asystole. A scenario timeline can move the patient toward deterioration or recovery, treatment effects layer on top, and the case configuration is frozen at session start so later authoring edits never disturb a running encounter. When a vital crosses its threshold an alarm fires and latches; acknowledging or snoozing it silences the notification while the physiology carries on until it is treated or the scenario changes, and every firing and acknowledgement is timestamped.

The session is organised into five peer rooms — Patient, Examination, Laboratory, Radiology and Consultant — that the learner can move among freely. The Consultant room is available for reflection and help while the case is live. The deliberate End and Debrief action stops the timeline, locks orders, exams and chat, and opens the reflective debrief with a separate discussant tutor alongside the transcript, notes and a case summary. Throughout, every action the learner takes is recorded and stamped with the room it happened in, feeding a Transition Network Analysis dashboard that reconstructs the path through the case.

## The five-room workspace

Rohy organises the session into five peer rooms: Patient, Examination, Laboratory, Radiology and Consultant. They are not nested steps in a fixed pathway. A learner can move among them as a clinician might move among information sources and tasks. The Patient room holds the interview, monitor, treatment controls and the deliberate End and Debrief action. The Examination room exposes the body map and structured findings. Laboratory and Radiology provide catalogues, orders, worklists and reports. The Consultant room becomes the reflective debrief space once the case ends.

This room model matters because clinical reasoning is not a straight line. A learner may gather history, examine, return to the patient, order labs, review imaging, treat, monitor and consult in different orders. Rohy preserves those movements so the session can be interpreted later. Ready-result badges allow the learner to keep working while waiting for investigations, and room-stamped events allow analytics to distinguish where actions occurred.

## Monitor physiology and time

The patient monitor gives the case a temporal and physiological spine. It displays live vital signs such as heart rate, blood pressure, oxygen saturation, respiratory rate, temperature and end-tidal carbon dioxide where the case uses them. The ECG waveform and rhythm express the authored state of the patient, and the scenario timeline can move the patient toward deterioration or recovery.

The monitor is not just decoration. It creates pressure. A case can deteriorate while the learner hesitates. A treatment can improve or fail to improve a vital sign over time. An instructor-pinned state can remain stable despite other engine ticks. Because vital state is connected to session activity, educators can discuss not only what the learner did but when they did it relative to physiological change.

This is also why session snapshots matter. When a session starts, the relevant case configuration is frozen for that run. Later authoring edits do not mutate the live encounter. The learner's monitor, orders and findings remain tied to the case as it existed at start time, which preserves educational fairness and research interpretability.

## Alarm infrastructure

Alarms are part of the clinical signal and part of the evidence trail. When a vital crosses a threshold, Rohy can surface an alert visually and, where enabled, audibly. The alarm latches while the abnormal condition remains relevant. The learner can acknowledge or snooze the alert, but that action only affects the notification. The patient's physiology remains abnormal until the learner addresses the underlying problem or the scenario changes.

This separation is pedagogically important. In real clinical work, silencing a monitor is not treatment. Rohy records alarm firing, acknowledgement and response timing so debrief can address recognition, prioritisation and action. Per-case acknowledgement state prevents an alarm silenced in one patient from remaining silent in another, which is essential for simulation integrity.

## Physical examination

The Examination room makes physical examination explicit. The learner chooses where to examine and how to examine it. A chest inspection, abdominal palpation, posterior auscultation or neurological special test is an action that reveals only the finding configured for that region and technique. The platform therefore treats examination as inquiry, not passive disclosure.

This design rewards clinical focus. A learner who never examines the relevant region should not receive its finding. A learner who performs a broad but unfocused examination leaves a different trace from one who conducts a targeted exam after a specific history cue. Notes taken in the room travel with the session and become available in debrief, supporting qualitative interpretation alongside event data.

Technically, the exam surface combines React room components, body-map region metadata, case-configured findings and session-scoped persistence. Idempotent recording prevents retries from creating duplicate findings, while abnormal and examined markings help the learner keep track of what has been done.

## Laboratory and Radiology

Laboratory and Radiology are first-class rooms rather than instant answer dialogs. The learner searches or browses a catalogue, places orders, waits for configured turnaround, opens ready reports and marks them viewed by reading them. Reports can remain available through the session so the learner can revisit evidence while reasoning evolves.

The delay is educational. It forces learners to continue caring for the patient while information is pending. It also makes order timing meaningful. A troponin ordered before the history, after a focused exam or after an alarm represents different reasoning. A CT report viewed before treatment changes what the learner can reasonably know. Rohy's worklists and viewed states make those differences explicit.

Laboratory and Radiology also connect authoring to runtime. Educators define what each case can reveal. Some results may be normal, some abnormal, some critical and some unavailable unless ordered. The platform records orders and report views so analytics can reconstruct not only what information existed in the case but what information the learner actually accessed.

## Treatments and consequences

The Treatments panel models intervention as an explicit clinical action. A learner may order a medication, fluid, oxygen mode or manoeuvre, but the patient should not respond until the treatment is administered. Once administered, the effect can alter vital signs over time according to authored or catalogue-defined behaviour. Treatments can also carry contraindication and high-alert warnings, which become part of the educational scenario rather than hidden validation rules.

The treatment model is important because it links decision and consequence. A learner can choose an intervention, administer it, observe the monitor, discontinue it and later explain the reasoning. Debrief can ask whether the intervention was appropriate, timely, monitored and reconsidered. Analytics can place the treatment in sequence with history, examination, investigations and alarms.

## Records, memory and distributed information

Rohy cases can include records and memory surfaces so not all knowledge has to be spoken by the patient. Existing clinical context, medication history, allergies, social history, family history, session memory and learner notes can be surfaced through the appropriate controls. This supports realistic information distribution. The patient may not know every result. A family member may know collateral history. A consultant may have a different context boundary. A record may contain information the learner must decide to inspect.

This matters for both realism and research. If every fact is volunteered immediately, reasoning collapses into passive reception. If records, agents and findings are distributed, the learner's strategy becomes visible: what they looked for, what they missed, what they used and what they ignored.

## Debrief as a terminal clinical state

The Consultant room has two meanings. During an active case, visiting it is navigation. The case continues. End and Debrief is different. It deliberately stops the live case, locks further clinical actions and opens the reflective phase. This gives completion a stable meaning and protects the integrity of the session trace.

Debrief brings together transcript, notes, summary and a discussant persona. The discussant is separate from the patient because reflection is a different educational role. The aim is not to judge mechanically but to help the learner explain reasoning, reconsider decisions and connect their actions to the case trajectory. From a data perspective, debrief closes the loop between quantitative trace and qualitative explanation.

## Why the distinctions matter

The clinical infrastructure is built around distinctions that seem small but are educationally decisive. Ordering is not viewing. Viewing is not understanding. Acknowledging is not treating. Navigating is not ending. Asking is not examining. A treatment order is not an administered intervention. These boundaries make the learner's path interpretable. They also make the system scientifically useful, because the platform can connect behaviour, timing, room context, physiological state and debrief evidence without flattening them into a single undifferentiated activity log.

Related guides include [The five rooms](/trainee/rooms), [Physical examination](/trainee/examination), [Ordering labs and imaging](/trainee/investigations), [Treatments and medications](/trainee/treatments), [Vitals and alarms](/trainee/vitals), [Debrief](/trainee/debrief), and [Analytics, evidence and research traces](/product/analytics).
