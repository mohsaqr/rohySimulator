# Dynamics analytics, evidence and logs

Rohy analytics are designed to reconstruct the dynamics of a clinical simulation: what changed, when it changed, what the learner did in response, and how patterns unfolded across time. The analytics layer covers event sequences, n-grams and repeated motifs, temporal timelines, room movement, activity frequencies, transition and network structures, course-level progress, learner and session drill-downs, Oyon emotion and gaze summaries, heatmaps, chat records, audit logs, usage logs, exports and operational evidence. Transition Network Analysis is one method in this ecosystem, not the name of the ecosystem.

The methodological purpose is to study clinical reasoning as process. In Rohy, a learner gathers information, changes rooms, orders tests, waits, reviews reports, treats, monitors, consults, reacts to alarms and reflects in debrief. The meaning of an action depends on its timing and context. Ordering a test before examination, after examination or after physiological deterioration are analytically different events even when the order name is identical. Rohy analytics preserve those differences by linking events to the session, learner, case, course, room, patient state and time.

## Event traces and clinical context

Rohy records navigation, conversation, physical examination, order placement, report viewing, treatment, monitoring, alarm response, agent interaction and debrief activity as timestamped clinical events. Each event is linked to the actor, session, case, room, course frame and, where available, patient state, so the record preserves both the action and the clinical context in which it occurred.

This structure matters because a count alone is weak evidence. A laboratory order can be counted, but counting does not explain whether the order was targeted, premature, delayed, redundant or clinically necessary. Its meaning depends on what the learner knew, what they had examined, whether the monitor was deteriorating, whether previous results were ready, whether the report was viewed and what action followed. Rohy analytics are therefore relational: the action is interpreted through its links to time, room, case, course, physiology and subsequent behaviour.

Room context is central to this design. Movement among Patient, Examination, Laboratory, Radiology and Consultant rooms is part of the reasoning process. Consulting before any examination, consulting after reviewing imaging, and consulting during debrief are different behaviours. A learner who remains in the Patient room while results become ready behaves differently from one who cycles repeatedly between monitor and investigations. Room-aware traces make those differences visible.

## Sequence analytics

Sequence analytics represents the learner's session as an ordered path. A sequence may show history-taking, movement to Laboratory, broad test ordering, return to Patient, alarm acknowledgement and oxygen administration. Another sequence may show history, focused examination, targeted radiology, report viewing, consultation and treatment. These paths express different clinical strategies.

Sequences are useful at several levels. At session level, they support debrief because the teacher and learner can reconstruct the encounter in order. At student level, they reveal recurring habits across cases. At class level, they show whether learners converge on a shared workflow or diverge into many strategies. At research level, they provide the raw material for sequence mining, process mining, transition modelling and temporal comparison.

Sequence analysis is also suitable for non-emergency cases. In cold cases, timing pressure may be reduced, but diagnostic order still matters. A teacher may want to know whether students gather history before broad testing, whether they overuse imaging, whether they inspect records before asking the patient, or whether they return to reassess after new information appears.

## N-grams and motifs

N-grams describe short repeated subsequences inside longer clinical activity. Two-event patterns can show immediate tendencies such as alarm-to-treatment, history-to-lab, report-to-consultation or treatment-to-monitoring. Three- and four-event patterns can reveal more meaningful reasoning fragments, such as history-to-exam-to-targeted-test, monitor-to-oxygen-to-reassessment, or radiology-to-consultant-to-treatment.

These motifs are useful because they capture local routines that broad metrics miss. A learner may have a reasonable total number of actions but repeatedly follow an inefficient micro-pattern. A class may show a strong motif of broad laboratory ordering before examination. Another class may show repeated reassessment after treatment. N-gram analysis helps teachers and researchers identify these habits without flattening the full session into a single score.

Motifs can also be compared across cases. In emergency cases, useful motifs may involve rapid recognition, intervention and reassessment. In diagnostic cold cases, useful motifs may involve hypothesis-driven information gathering, selective investigation and reflective synthesis. The same analytical machinery supports both because the educator controls the scenario pressure.

## Timelines and temporal analysis

Timelines show when actions occurred relative to the start of the case, scenario phases, alarm onsets, result readiness, treatment administration and debrief. They make pace visible. A learner may perform the right actions too slowly for an emergency case. Another may act quickly but before enough information is available. Timelines make delay, acceleration, repetition and omission available for review.

Temporal analysis is especially important in time-critical scenarios. The interval between desaturation and oxygen, between alarm and acknowledgement, between report readiness and report viewing, or between deterioration and consultation can become educationally meaningful. Rohy can support these analyses because the clinical environment and event stream share a temporal frame.

Timelines also support cold-case teaching. Without deterioration, the temporal question may shift from emergency response to reasoning organisation. How long did the learner spend in history? Did they sequence examination before investigations? Did they revisit earlier information after results appeared? Did debrief occur after a complete review or after an early closure? These are still temporal questions.

## Transition, network and state dynamics

Transition and network analytics compress many ordered actions into structural views. Nodes represent activity states, and edges represent movement between states. This can reveal dominant pathways, rare branches, repeated loops, self-transitions and bottlenecks. Transition Network Analysis is therefore one powerful view of Rohy's dynamics analytics.

The network should remain clinically anchored. A dense network may indicate exploration, confusion or case complexity. A sparse network may indicate efficiency, premature closure or a short session. A highly central state may be a productive hub or an inefficient bottleneck. Edge weights and centrality measures are useful when interpreted with the authored scenario, clinical goal, learner level and debrief record.

Network views become stronger when paired with sequences and timelines. A transition network may show that many learners move from monitoring to laboratory ordering. The timeline can show whether this happens before or after deterioration. The n-gram view can show whether it is part of a repeated motif. The session trace can show the concrete clinical context. Rohy supports this movement among representations.

## Course, learner and session analytics

Course analytics gives the trace a teaching population. Roster, completion grid, live feed, export and course-scoped analytics answer practical questions: who is enrolled, who attempted the case, who reached debrief, who has no activity, when students worked and which sessions require review. These are operational views, but they also define the sampling frame for research.

The scope ladder matters. Whole-class analytics reveal common patterns across the group. Student analytics reveal individual tendencies across attempts. Session analytics reveal the concrete sequence that can be discussed in debrief. A teacher can move from class overview to a student, then from the student to one session, then from the session to its sequence, timeline, reports, treatments, conversation and multimodal traces.

Course analytics also supports longitudinal teaching. Across several cases, a teacher can examine whether students become faster at recognizing deterioration, more selective in ordering, more consistent in reassessment, more reflective in debrief or more appropriate in consultation. These patterns describe development over time rather than isolated performance.

Completion is interpreted narrowly. In the current model, completion means the learner reached debrief. It marks participation and workflow closure, not competence. This keeps course analytics honest and prevents operational status from silently becoming assessment.

## Multimodal analytics and Oyon

Oyon adds optional multimodal dynamics. It runs browser-side inference using MediaPipe and ONNX Runtime Web, aggregates signals into windows and sends aggregate data to Rohy when enabled and consented. Stored windows can include dominant expression estimates, class probabilities, valence, arousal, confidence, entropy, missing-face ratio, quality metadata and gaze area of interest.

These signals can be visualised as timelines, distributions, transitions and heatmaps. Emotion heatmaps can show where affective signals concentrate across time, session phases, rooms or cases. Gaze summaries can be related to monitor use, report viewing or avatar interaction. Valence and arousal timelines can be compared with alarms, deterioration, treatment or debrief moments. These views support hypotheses for reflection and research; they are not direct readings of a learner's inner state.

Quality indicators are essential. Confidence, missing-face ratio, valid-frame count and entropy help distinguish usable signal from weak capture. A responsible analysis defines quality thresholds before drawing conclusions. Low-confidence windows may still reveal something about capture conditions, but they should not be treated as affective evidence.

Oyon also contributes to simulation fidelity. When enabled, the patient or discussant can maintain eye contact, follow face position and glance at the monitor during alarms. This connects multimodal sensing to interaction while preserving the browser-side processing boundary.

## Heatmaps and visual analytics

Heatmaps in Rohy should be understood broadly as density views. They can show emotion intensity across time, activity concentration across hours, room use across sessions, gaze distribution across areas of interest, or class activity across cases. The value of a heatmap is that it helps locate patterns that deserve closer inspection.

A heatmap may suggest that arousal increases around alarms, that learners spend long periods in Laboratory, that a class clusters activity late in the session, or that gaze shifts toward the monitor during deterioration. The next step is always interpretive: inspect the underlying events, session context, case design and debrief. Heatmaps guide attention; they do not explain the simulation on their own.

Rohy therefore treats dashboards as navigation surfaces for evidence. A completion grid shows where to inspect. A timeline shows when to inspect. An n-gram view shows which motifs to inspect. A transition network shows pathway structure. An emotion heatmap shows phases that may warrant closer review. Logs show provenance and accountability. The analytical work happens by moving among these layers.

## Logs as analytical and governance evidence

Logs are part of Rohy's analytics architecture. They provide provenance, accountability and operational context for the learning traces. Rohy records several kinds of logs, each with a different purpose: learning-event logs, chat logs, audit logs, export records, LLM and TTS usage logs, system logs and request logs.

Learning-event logs describe learner activity inside the simulation. They are the basis for sequence, timeline, n-gram, transition, frequency and room-path analysis. Chat logs preserve patient and agent conversations, supporting review of history-taking, family interaction, consultation, patient distress and debrief. Conversation logs should be interpreted with role boundaries in mind: a patient, nurse, consultant, family member and discussant all represent different knowledge positions.

Audit logs answer who changed the system. They record security- and governance-relevant actions such as user creation, role edits, account deletion or purge, tenant operations, platform setting changes, force logout, exports and other sensitive mutations. The audit chain gives these records integrity value by supporting tamper detection. This matters when analytics are used for assessment, research or institutional reporting.

Export logs are essential because data often leaves Rohy. A CSV or JSON export may enter an LMS, a statistical package, a grading workflow or a research archive. Rohy records who exported the data, which resource was exported, which filters were applied, what format was used, how many records were included and when the export occurred. This creates provenance for datasets used outside the live platform.

Usage logs support operational analytics. LLM and TTS calls have cost, latency and provider implications. Tracking provider use helps administrators understand whether a course is consuming expected resources, whether a local voice engine is working, whether cloud usage is rising, or whether model behaviour changed after a settings update. These records help separate learner behaviour from infrastructure effects.

System and request logs support reliability. Structured NDJSON logs, request IDs and slow-query warnings allow operators to connect a user-reported problem to server behaviour. A slow analytics page can be traced through request IDs and database warnings. A malformed Oyon batch can be identified through validator rejection counts. These operational traces protect the reliability of the analytics pipeline.

The redaction layer is part of log interpretation. Logs and support bundles must not become channels for secrets or unnecessary personal data. Rohy centralises redaction so that API keys, token material, password hashes, PII and sensitive JSON fields are handled consistently. This is especially important when analytics, audit or operational records are exported or reviewed outside the runtime.

## Exports and external analysis

Rohy supports export because serious educational research often continues outside the platform. Researchers may use R, Python, SPSS, process-mining tools, network-analysis packages or qualitative-analysis workflows. Teachers may need CSV completion data for LMS import or local grading. Administrators may need audit records for compliance review.

Exported data should be treated as scoped evidence. A course export is filtered by class membership, case activity and authorization. A session export carries authored case context, learner actions, timing and available records. A chat export carries conversation text that may require careful handling. The export log records the provenance of that movement so later analysis can account for how the dataset was produced.

For methodological work, exported traces can support sequence mining, n-gram analysis, transition networks, temporal plots, process models, frequency analysis, multimodal alignment and qualitative coding. Rohy does not force one analytical method. It preserves structure so researchers can select methods appropriate to their question.

## Scientific value

Rohy's analytics layer supports research on the dynamics of clinical reasoning. It can describe information-seeking, diagnostic sequencing, investigation timing, treatment response, alarm behaviour, consultation, debrief, multimodal engagement and course-level variation. It supports emergency scenarios where deterioration and response time matter, and cold cases where diagnostic strategy and completeness may be the focus.

The strength of the analytics model is that different representations can be combined. A session can be inspected as a timeline, a sequence, a transition network, an n-gram profile, a room path, an emotion heatmap, a report-viewing history, a treatment record, a chat transcript, a usage record and a debrief conversation. Each representation gives a partial view. Together they support richer interpretation of how the learner worked through the simulated clinical problem.

The logs make this scientific value defensible. They provide provenance: which case was assigned, who ran the session, what was exported, which settings changed, what provider calls occurred and whether operational errors affected the run. Research on simulation data needs this context. Without logs, an analyst may see a behavioural pattern but miss the administrative or technical condition that produced it.

## Responsible use

The responsible analytics model is human-centred. Begin with the authored case and teaching objective. Inspect the timeline and sequence. Consider the clinical state and available information. Use network, n-gram, frequency and heatmap views as complementary lenses. Treat Oyon as aggregate contextual signal. Review logs for provenance and operational context. Bring the evidence into debrief and research interpretation with explicit attention to uncertainty, data quality and educational purpose.

Related guides include [Reporting and analytics](/educator/reporting), [TNA analytics](/educator/tna), [Oyon emotion analytics](/educator/oyon-analytics), [System logs](/admin/system-logs), [RBAC and auth model](/security/rbac), and [Redaction and PII](/security/redaction).
