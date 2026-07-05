# Case building and scenario authoring

Rohy case authoring is the process of turning a clinical learning objective into a reproducible simulation. A case is not merely a prompt for an AI patient. It is a structured clinical world: a patient with a story, a body with findings, a monitor with physiology, a timeline with deterioration or recovery, investigations with results, treatments with consequences, agents with knowledge boundaries and a debrief with reflective purpose.

This structure matters because simulation quality depends on alignment. The patient narrative, opening vitals, examination findings, laboratory results, radiology reports, treatment effects and debrief questions should all describe the same educational problem. If they contradict each other accidentally, the learner's trace becomes hard to interpret. If they are aligned deliberately, the case becomes a controlled environment for practice and research.

## Authoring as design, not data entry

The Case Wizard breaks authoring into steps, but the intellectual work is not filling fields. The work is simulation design. The educator decides what the learner should notice, what they should ask, what they should examine, what information should be delayed, what treatments should matter, how the patient should deteriorate and what should be discussed afterward. The wizard provides structure so those decisions are captured consistently.

Demographics and avatar establish who the learner meets. The story and patient prompt define what the patient can say and how they say it. The scenario timeline defines the pressure of time. Labs, radiology and examination findings define discoverable evidence. Records define background knowledge. Treatments define action and consequence. Agents define social context and information asymmetry. Debrief defines reflection.

A good case is therefore a coherent argument about clinical reasoning. It says: in this situation, with this patient, these signals and this time pressure, what should the learner discover, decide and explain?

## Patient model and clinical story

The patient model combines structured clinical data with natural-language persona design. Structured fields such as age, sex or gender context, body metrics, chief complaint, history, medications, allergies and risk factors give the runtime stable facts. The story and system prompt give the patient a voice: how symptoms are described, what is volunteered, what is withheld, what tone is used and how uncertainty appears.

This separation is important. Structured records support consistency across the runtime, while the prompt supports natural interaction. If the prompt alone carries all clinical truth, the case becomes fragile. If structured data alone carries everything, the patient becomes mechanical. Rohy authoring uses both so the patient can be conversational without losing reproducibility.

## Scenario timelines and vital-state design

A scenario timeline is the physiological plot of the case. It defines how the patient changes over time through keyframes: vital signs, rhythm, ECG conditions and clinical labels. The runtime interpolates between keyframes so deterioration or recovery feels continuous rather than abrupt.

The first keyframe is especially important because it defines the opening impression. If the story describes septic shock but the first frame shows stable vitals, the contradiction must be intentional. If a STEMI case is meant to deteriorate into cardiogenic shock, the timeline should make that pressure visible. Labels should not be treated as decorative names; they are the author's clinical explanation of what is happening at each phase.

Treatments are layered on top of the scenario. A learner's administered intervention can shift the live state while the underlying timeline continues. This means the author must think about both natural history and response to action. The best cases make time consequential without making the outcome feel arbitrary.

## Findings, investigations and records

Labs, radiology and examination findings define what the learner can discover. They should not simply repeat the patient's story. They should add evidence, narrow or widen the differential, reveal complications or confirm severity. A normal finding can be as educational as an abnormal one when it rules out a tempting hypothesis.

Laboratory authoring asks what should be available, what should be abnormal, how long results should take and whether panels support or undermine the learning goal. Radiology authoring asks which imaging choices are appropriate, what the reports reveal and whether imaging is necessary, confirmatory or distracting. Examination authoring asks which regions and techniques should produce meaningful findings, and which findings should remain hidden unless the learner examines deliberately.

Records give the case background depth. Past history, medications, allergies, social context and family history can be distributed through records instead of being forced into the opening conversation. This lets the learner decide when to inspect existing information and allows later analytics to interpret whether key context was accessed before decisions were made.

## Treatments and clinical consequence

Treatment authoring defines what the learner can do to the patient. It includes available interventions, dose expectations, routes, warnings, contraindications and physiological effects. Because Rohy distinguishes ordering from administering, authors can design cases where intention, action and monitoring are separate. A learner may choose correctly but delay administration, administer but fail to monitor, or ignore a warning that should shape debrief.

Treatment effects should be clinically coherent with the scenario. Oxygen should influence oxygenation where appropriate. Fluids should affect haemodynamics when the case supports it. A contraindicated or high-alert medication should create a teachable decision rather than a hidden trap. The aim is not to script one perfect pathway but to make consequences interpretable.

## Agents and distributed knowledge

Rohy cases can include multiple agents: patient, nurse, consultant, family member, pharmacist, technician, discussant or custom roles. Each agent has identity, prompt, voice, avatar, communication style, LLM settings and memory access. This lets authors model the social structure of clinical work.

Agent knowledge boundaries are essential. A family member may know what happened at home but not laboratory values. A nurse may know recent vitals and medication administration. A consultant may know the differential but not the learner's private notes. The discussant should operate after the case ends, not as the patient in another costume. These boundaries make conversation realistic and prevent agents from revealing information the learner has not earned.

Voice, avatar and model routing are part of authoring because presentation affects the encounter. A patient voice should not leak into the discussant. A consultant should not necessarily use the same model configuration as the patient. Multimodal settings are not cosmetic; they shape how learners experience the case and how consistently the simulation behaves.

## Catalogues, templates and reuse

Rohy includes reusable catalogues for labs, medications and other clinical content. Catalogue scope matters. A user-scoped item can support local experimentation. A tenant-scoped item can support a course. A platform-scoped item should be reserved for reviewed content that is broadly reusable. This prevents local case-building from polluting the shared clinical library while still allowing institutions to adapt the system.

Templates accelerate authoring but do not replace design. A seeded deterioration pattern, acute case or default persona can provide a clinically plausible starting point. The educator still needs to adapt it to learner level, time available, assessment purpose and debrief goals. Reuse is valuable when it preserves coherence; it is dangerous when it encourages unreviewed copying.

## Versioning, snapshots and reproducibility

Case versioning and session snapshots make Rohy authoring usable for teaching and research. Versioning preserves edit history and allows restoration. Snapshots freeze the case at session start. If a teacher edits the case while a student is running it, that live session remains tied to the state it began with.

This is not only a technical convenience. It protects fairness and interpretability. A debrief should refer to the case the learner actually experienced. A research trace should be linked to the authored conditions under which it was produced. A course report should not become ambiguous because a case changed mid-session. Reproducibility begins with stable authoring state.

## Quality of a Rohy case

A strong Rohy case is clinically coherent, temporally plausible and educationally intentional. The story, vitals, scenario, findings, reports and treatments point toward the same learning problem. Key information must be discoverable but not automatically revealed. The timeline creates appropriate pressure. Agents know what their role permits. Treatments create consequences that can be discussed. Debrief has something meaningful to reflect on.

The scientific value of structured authoring is that it controls the environment being studied. If two learners run the same case snapshot, differences in their traces can be interpreted against a stable scenario. If a case is revised, versioning makes that change visible. If analytics reveal a confusing pattern, the educator can return to the authored design and improve the case.

Related guides include [Authoring a case](/educator/case-wizard), [Scenario timelines](/educator/scenarios), [Agent personas](/educator/agents), [Lab and medication editors](/admin/catalogue-editors), [Clinical simulation infrastructure](/product/clinical-infrastructure), and [Analytics, evidence and research traces](/product/analytics).
