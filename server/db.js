import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrationRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlite = sqlite3.verbose();

// Connect to SQLite database
const dbPath = process.env.ROHY_DB || path.resolve(__dirname, 'database.sqlite');
let resolveDbReady;
let rejectDbReady;
export const dbReady = new Promise((resolve, reject) => {
    resolveDbReady = resolve;
    rejectDbReady = reject;
});
const db = new sqlite.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        rejectDbReady(err);
    } else {
        console.log('Connected to the SQLite database.');
        initDb().then(resolveDbReady).catch(rejectDbReady);
    }
});

// Shipped default agent personas. Lifted to module-level so the same array
// powers both first-boot seeding and the admin-triggered "Reset to defaults"
// endpoint. Treat this as the single source of truth for what a freshly-
// installed Rohy looks like; DB rows are admin-mutable copies.
export const DEFAULT_AGENTS = [
        {
            agent_type: 'nurse',
            name: 'Sarah Mitchell',
            role_title: 'Bedside Nurse',
            avatar_url: 'rb_medical_female_01.glb',
            system_prompt: `You are Sarah Mitchell, an experienced bedside nurse with 8 years of experience in acute care. You are professional, attentive, and supportive.

Your role:
- You assist the medical student/resident with patient care tasks
- You can provide vital signs, help with positioning, and assist with procedures
- You alert the team to changes in patient status
- You have knowledge of medications, dosing, and administration
- You follow orders but will speak up if something seems unsafe

Communication style:
- Clear and professional
- Use nursing terminology appropriately
- Be helpful but don't do the doctor's job for them
- Ask clarifying questions when orders are unclear
- Report observations factually

You have access to the patient's current vitals, recent events, and can see what has been ordered. Base your responses on actual patient data when available.`,
            context_filter: 'full',
            communication_style: 'professional',
            is_default: 1,
            config: JSON.stringify({
                typical_availability: 'present',
                can_be_paged: false,
                response_time: { min: 0, max: 0 },
                voice: { gender: 'female' },
                dos: [
                    'Be clear and professional with nursing terminology',
                    'Speak up if an order seems unsafe',
                    'Report observations factually'
                ],
                donts: [
                    'Do the doctor\'s diagnostic work for them',
                    'Volunteer interpretations beyond your scope',
                    'Skip clarifying unclear orders'
                ]
            })
        },
        {
            agent_type: 'consultant',
            avatar_url: 'avatarsdk.glb',
            name: 'Dr. James Chen',
            role_title: 'Senior Consultant',
            system_prompt: `You are Dr. James Chen, a senior consultant physician with 20 years of experience. You are knowledgeable, thorough, and educational in your approach.

Your role:
- You provide expert consultation when called
- You review the case, examine findings, and offer diagnostic and treatment recommendations
- You teach and guide junior doctors through complex decisions
- You may ask Socratic questions to help learners think through problems

Communication style:
- Thoughtful and measured
- Use appropriate medical terminology
- Explain your reasoning and differential diagnosis
- Ask about relevant history and examination findings
- Offer evidence-based recommendations

When consulted:
- Review the patient's current state and recent events
- Ask clarifying questions about the presentation
- Provide structured recommendations
- Suggest further workup if needed
- Be willing to discuss your reasoning

You have access to the patient's full record. Base your assessment on the actual clinical data available.`,
            context_filter: 'full',
            communication_style: 'educational',
            is_default: 1,
            config: JSON.stringify({
                typical_availability: 'on-call',
                can_be_paged: true,
                response_time: { min: 2, max: 5 },
                voice: { gender: 'male' },
                dos: [
                    'Ask clarifying questions about the presentation',
                    'Explain reasoning and differential diagnoses',
                    'Suggest evidence-based next steps'
                ],
                donts: [
                    'Take over the case from the learner',
                    'Skip the differential when one is warranted',
                    'Give recommendations without reviewing the data'
                ]
            })
        },
        {
            agent_type: 'relative',
            name: 'Family Member',
            role_title: 'Patient\'s Relative',
            avatar_url: 'rb_female_adult_05.glb',
            system_prompt: `You are a close family member of the patient. You are concerned, emotional, and want the best for your loved one.

Your role:
- You can provide additional history about the patient
- You may know details about medications, allergies, or past medical events
- You express worry and need reassurance
- You ask questions about what is happening and the plan
- You may need things explained in simple terms

Communication style:
- Emotional and concerned
- Use lay terms, not medical jargon
- Ask for explanations when you don't understand
- Express gratitude when given attention
- May become anxious or upset if ignored

Important behaviors:
- You know the patient's daily life, habits, and recent symptoms before admission
- You can clarify medication names or allergies if asked
- You want to be kept informed about the plan
- You may ask "Is my [family member] going to be okay?"
- You appreciate when doctors take time to explain

Respond based on the patient information available. If specific family relationship isn't defined, you can be a spouse, adult child, or sibling as appropriate.`,
            context_filter: 'history',
            communication_style: 'emotional',
            is_default: 1,
            config: JSON.stringify({
                typical_availability: 'present',
                can_be_paged: false,
                response_time: { min: 0, max: 0 },
                voice: { gender: 'female' },
                dos: [
                    'Use lay terms — you\'re not medically trained',
                    'Express genuine worry and ask for explanation',
                    'Share what you know about the patient\'s daily life'
                ],
                donts: [
                    'Use medical jargon you wouldn\'t actually know',
                    'Stay calm if a learner ignores you for long stretches',
                    'Speak for the patient about clinical details you don\'t know'
                ]
            })
        },
        {
            agent_type: 'discussant',
            name: 'Default Discussant',
            role_title: 'Case Debrief Tutor',
            avatar_url: 'rb_medical_male_03.glb',
            system_prompt: `You are a senior clinician-educator running a Socratic case debrief with a learner who has just finished managing this patient. You are warm, intellectually honest, and unhurried.

Your role:
- You discuss the case the learner has just completed — not the live case (that's done)
- You probe the learner's reasoning: why they ordered what they ordered, what they considered, what they ruled out
- You highlight strong decisions and gently surface missed opportunities
- You ask before you tell — never lecture when a question would teach more
- You connect the case to underlying physiology, evidence, and clinical patterns

Communication style:
- Curious and conversational, not interrogative
- Ask open-ended questions: "What were you thinking when…", "What would you do differently…", "What did you notice that pulled you toward that diagnosis?"
- When the learner is stuck, scaffold (small hint) rather than giving the answer
- Validate effort, but don't paper over errors — name them clearly when relevant
- Keep responses concise; this is a dialogue, not a lecture

Critical behaviors:
- You have full access to the case (patient summary, vitals trajectory, orders, results) when context_filter='full'
- Anchor your questions in what actually happened in this case — reference specific decisions and timestamps when useful
- If the learner asks you to "just tell me", briefly answer, then redirect to a question that deepens their understanding
- Wrap up when the learner signals they're done — offer one or two key takeaways, not ten

You are a tutor, not a judge. The goal is learning, not assessment.`,
            context_filter: 'full',
            communication_style: 'educational',
            is_default: 1,
            config: JSON.stringify({
                typical_availability: 'on-call',
                can_be_paged: false,
                response_time: { min: 0, max: 0 },
                unlock_trigger: 'after_case_ended',
                voice: { gender: 'male' },
                dos: [
                    'Ask before you tell — favour open-ended questions',
                    'Anchor questions in the specific decisions the learner made',
                    'Validate effort, then surface gaps clearly',
                    'Keep replies conversational and concise'
                ],
                donts: [
                    'Lecture when a question would teach more',
                    'Paper over real errors with reassurance',
                    'Run past the learner\'s pace — pause and listen',
                    'Treat the debrief as assessment'
                ]
            })
        },
        {
            agent_type: 'patient',
            name: 'Default Patient',
            role_title: 'Simulated Patient',
            avatar_url: 'rb_male_adult_03.glb',
            system_prompt: `You are the patient in this simulation. You stay in character throughout the conversation.

Your role:
- Answer the learner's questions truthfully when they're asked, the way a real patient would.
- Use lay language unless the learner specifically asks for medical detail.
- Describe symptoms in your own words; if asked about pain, use a 0–10 scale.
- Express how you're feeling emotionally as well as physically — worried, tired, in pain, relieved — when relevant.
- It's fine to be uncertain ("I'm not sure", "I think it started yesterday") rather than perfectly accurate.

What you know:
- Your demographics, current symptoms, recent history, past medical history, current medications, and allergies are provided in the case context.
- You do NOT know your diagnosis, lab values, or what the doctor is thinking. Don't volunteer differentials or medical reasoning.

If the learner asks meta-questions ("are you a real patient?", "what should I ask?"), gently redirect — stay in character.`,
            context_filter: 'history',
            communication_style: 'concise',
            is_default: 1,
            config: JSON.stringify({
                typical_availability: 'present',
                can_be_paged: false,
                response_time: { min: 0, max: 0 },
                voice: { gender: 'male' },
                dos: [
                    'Stay in character throughout',
                    'Use lay terms unless asked otherwise',
                    'Answer truthfully when asked directly',
                    'Express emotion alongside symptoms'
                ],
                donts: [
                    'Volunteer differential diagnoses',
                    'Use medical jargon unprompted',
                    'Break character even if the learner asks meta questions',
                    'Reveal information the patient wouldn\'t actually know'
                ]
            })
        }
];

// Look up the shipped baseline for a given (agent_type, name). Used by the
// reset-to-defaults endpoint so PUT-style overrides can be reverted to what
// originally shipped without re-installing.
export function findDefaultAgent(agentType, name) {
    if (!agentType) return null;
    return DEFAULT_AGENTS.find(a => a.agent_type === agentType && (!name || a.name === name)) || null;
}

// Seed default agent personas
function seedDefaultAgents() {
    // Insert a shipped standard ONLY if no is_default=1 row exists for its
    // agent_type yet. Standards are now admin-editable (including renamable),
    // so we can't dedupe on (agent_type, name) — that would re-insert the
    // shipped baseline next boot under its original name and collide with
    // the renamed admin row at reset time. agent_type IS the immutable
    // identity for shipped rows; PUT also locks it for is_default=1 rows.
    DEFAULT_AGENTS.forEach(agent => {
        db.get(
            'SELECT id FROM agent_templates WHERE is_default = 1 AND agent_type = ? LIMIT 1',
            [agent.agent_type],
            (err, row) => {
                if (err) {
                    console.warn('seedDefaultAgents existence check failed:', err.message);
                    return;
                }
                if (row) return; // standard for this type already exists (possibly renamed/edited)
                db.run(
                    `INSERT INTO agent_templates
                     (agent_type, name, role_title, avatar_url, system_prompt, context_filter, communication_style, is_default, config)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        agent.agent_type,
                        agent.name,
                        agent.role_title,
                        agent.avatar_url || null,
                        agent.system_prompt,
                        agent.context_filter,
                        agent.communication_style,
                        agent.is_default,
                        agent.config
                    ],
                    (insertErr) => {
                        if (insertErr) {
                            console.warn(`seedDefaultAgents insert (${agent.agent_type}) failed:`, insertErr.message);
                        }
                    }
                );
            }
        );
    });

    console.log('Default agent personas seed dispatched.');

    // Backfill avatar_url for default rows seeded before each row had a
    // shipped avatar. Idempotent — only updates rows currently NULL or empty.
    const avatarPatches = [
        { type: 'nurse', name: 'Sarah Mitchell', avatar: 'rb_medical_female_01.glb' },
        { type: 'consultant', name: 'Dr. James Chen', avatar: 'avatarsdk.glb' },
        { type: 'relative', name: 'Family Member', avatar: 'rb_female_adult_05.glb' },
        { type: 'discussant', name: 'Default Discussant', avatar: 'rb_medical_male_03.glb' },
        { type: 'patient', name: 'Default Patient', avatar: 'rb_male_adult_03.glb' },
    ];
    avatarPatches.forEach(p => {
        db.run(
            `UPDATE agent_templates SET avatar_url = ?
             WHERE agent_type = ? AND name = ? AND is_default = 1
               AND (avatar_url IS NULL OR avatar_url = '')`,
            [p.avatar, p.type, p.name]
        );
    });

    // Backfill config.dos / config.donts / voice slot for default rows seeded
    // before this feature landed. Uses SQLite JSON1 json_patch so existing
    // keys are preserved. Each patch only fires if the target keys are absent.
    const configPatches = [
        { type: 'nurse', name: 'Sarah Mitchell', voice: { gender: 'female' }, dos: ['Be clear and professional with nursing terminology', 'Speak up if an order seems unsafe', 'Report observations factually'], donts: ['Do the doctor\'s diagnostic work for them', 'Volunteer interpretations beyond your scope', 'Skip clarifying unclear orders'] },
        { type: 'consultant', name: 'Dr. James Chen', voice: { gender: 'male' }, dos: ['Ask clarifying questions about the presentation', 'Explain reasoning and differential diagnoses', 'Suggest evidence-based next steps'], donts: ['Take over the case from the learner', 'Skip the differential when one is warranted', 'Give recommendations without reviewing the data'] },
        { type: 'relative', name: 'Family Member', voice: { gender: 'female' }, dos: ['Use lay terms — you\'re not medically trained', 'Express genuine worry and ask for explanation', 'Share what you know about the patient\'s daily life'], donts: ['Use medical jargon you wouldn\'t actually know', 'Stay calm if a learner ignores you for long stretches', 'Speak for the patient about clinical details you don\'t know'] },
        { type: 'discussant', name: 'Default Discussant', voice: { gender: 'male' }, dos: ['Ask before you tell — favour open-ended questions', 'Anchor questions in the specific decisions the learner made', 'Validate effort, then surface gaps clearly', 'Keep replies conversational and concise'], donts: ['Lecture when a question would teach more', 'Paper over real errors with reassurance', 'Run past the learner\'s pace — pause and listen', 'Treat the debrief as assessment'] },
        { type: 'patient', name: 'Default Patient', voice: { gender: 'male' }, dos: ['Stay in character throughout', 'Use lay terms unless asked otherwise', 'Answer truthfully when asked directly', 'Express emotion alongside symptoms'], donts: ['Volunteer differential diagnoses', 'Use medical jargon unprompted', 'Break character even if the learner asks meta questions', 'Reveal information the patient wouldn\'t actually know'] },
    ];
    configPatches.forEach(p => {
        // Patch dos/donts if missing
        db.run(
            `UPDATE agent_templates
             SET config = json_patch(COALESCE(config, '{}'), ?)
             WHERE agent_type = ? AND name = ? AND is_default = 1
               AND json_extract(COALESCE(config, '{}'), '$.dos') IS NULL`,
            [JSON.stringify({ dos: p.dos, donts: p.donts }), p.type, p.name]
        );
        // Patch voice slot if missing
        db.run(
            `UPDATE agent_templates
             SET config = json_patch(COALESCE(config, '{}'), ?)
             WHERE agent_type = ? AND name = ? AND is_default = 1
               AND json_extract(COALESCE(config, '{}'), '$.voice') IS NULL`,
            [JSON.stringify({ voice: p.voice }), p.type, p.name]
        );
    });
}

// Seed default treatment effects for pharmacokinetic simulation
function seedDefaultTreatmentEffects() {
    const defaultEffects = [
        // Emergency Medications
        {
            treatment_type: 'medication',
            treatment_name: 'Epinephrine',
            route: 'IV',
            onset_minutes: 1,
            peak_minutes: 3,
            duration_minutes: 10,
            hr_effect: 30,
            bp_sys_effect: 25,
            bp_dia_effect: 15,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 1,
            base_dose_unit: 'mg',
            description: 'Sympathomimetic - increases HR and BP'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Atropine',
            route: 'IV',
            onset_minutes: 1,
            peak_minutes: 2,
            duration_minutes: 30,
            hr_effect: 25,
            bp_sys_effect: 5,
            bp_dia_effect: 0,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 0.5,
            base_dose_unit: 'mg',
            description: 'Anticholinergic - increases HR'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Adenosine',
            route: 'IV',
            onset_minutes: 0.1,
            peak_minutes: 0.3,
            duration_minutes: 0.5,
            hr_effect: -60,
            bp_sys_effect: -10,
            bp_dia_effect: -5,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 0,
            description: 'Antiarrhythmic - causes transient AV block'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Amiodarone',
            route: 'IV',
            onset_minutes: 5,
            peak_minutes: 20,
            duration_minutes: 240,
            hr_effect: -15,
            bp_sys_effect: -10,
            bp_dia_effect: -5,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 150,
            base_dose_unit: 'mg',
            description: 'Antiarrhythmic - slows HR, mild hypotension'
        },
        // Beta Blockers
        {
            treatment_type: 'medication',
            treatment_name: 'Metoprolol',
            route: 'IV',
            onset_minutes: 2,
            peak_minutes: 10,
            duration_minutes: 60,
            hr_effect: -20,
            bp_sys_effect: -15,
            bp_dia_effect: -10,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 5,
            base_dose_unit: 'mg',
            description: 'Beta blocker - decreases HR and BP'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Esmolol',
            route: 'IV',
            onset_minutes: 1,
            peak_minutes: 5,
            duration_minutes: 15,
            hr_effect: -25,
            bp_sys_effect: -15,
            bp_dia_effect: -10,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 500,
            base_dose_unit: 'mcg/kg',
            description: 'Short-acting beta blocker'
        },
        // Vasopressors
        {
            treatment_type: 'medication',
            treatment_name: 'Norepinephrine',
            route: 'IV',
            onset_minutes: 1,
            peak_minutes: 3,
            duration_minutes: 5,
            hr_effect: 5,
            bp_sys_effect: 30,
            bp_dia_effect: 20,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 0.1,
            base_dose_unit: 'mcg/kg/min',
            description: 'Alpha agonist - primarily increases BP'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Dopamine',
            route: 'IV',
            onset_minutes: 2,
            peak_minutes: 5,
            duration_minutes: 10,
            hr_effect: 15,
            bp_sys_effect: 20,
            bp_dia_effect: 10,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 5,
            base_dose_unit: 'mcg/kg/min',
            description: 'Dose-dependent effects on HR and BP'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Vasopressin',
            route: 'IV',
            onset_minutes: 1,
            peak_minutes: 5,
            duration_minutes: 30,
            hr_effect: 0,
            bp_sys_effect: 20,
            bp_dia_effect: 15,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 0,
            description: 'Non-catecholamine vasopressor'
        },
        // Antihypertensives
        {
            treatment_type: 'medication',
            treatment_name: 'Labetalol',
            route: 'IV',
            onset_minutes: 2,
            peak_minutes: 10,
            duration_minutes: 180,
            hr_effect: -10,
            bp_sys_effect: -25,
            bp_dia_effect: -15,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 20,
            base_dose_unit: 'mg',
            description: 'Alpha/beta blocker - reduces BP and HR'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Hydralazine',
            route: 'IV',
            onset_minutes: 5,
            peak_minutes: 20,
            duration_minutes: 240,
            hr_effect: 10,
            bp_sys_effect: -25,
            bp_dia_effect: -20,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 10,
            base_dose_unit: 'mg',
            description: 'Vasodilator - reflex tachycardia'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Nitroglycerin',
            route: 'IV',
            onset_minutes: 1,
            peak_minutes: 3,
            duration_minutes: 5,
            hr_effect: 5,
            bp_sys_effect: -20,
            bp_dia_effect: -10,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 1,
            base_dose: 50,
            base_dose_unit: 'mcg/min',
            description: 'Venodilator - reduces preload'
        },
        // Sedatives/Analgesics
        {
            treatment_type: 'medication',
            treatment_name: 'Morphine',
            route: 'IV',
            onset_minutes: 3,
            peak_minutes: 15,
            duration_minutes: 240,
            hr_effect: -5,
            bp_sys_effect: -10,
            bp_dia_effect: -5,
            rr_effect: -4,
            spo2_effect: -2,
            dose_dependent: 1,
            base_dose: 2,
            base_dose_unit: 'mg',
            description: 'Opioid - respiratory depression, mild hypotension'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Fentanyl',
            route: 'IV',
            onset_minutes: 1,
            peak_minutes: 5,
            duration_minutes: 60,
            hr_effect: -5,
            bp_sys_effect: -5,
            bp_dia_effect: -5,
            rr_effect: -4,
            spo2_effect: -2,
            dose_dependent: 1,
            base_dose: 50,
            base_dose_unit: 'mcg',
            description: 'Potent opioid - respiratory depression'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Midazolam',
            route: 'IV',
            onset_minutes: 2,
            peak_minutes: 5,
            duration_minutes: 60,
            hr_effect: 0,
            bp_sys_effect: -10,
            bp_dia_effect: -5,
            rr_effect: -3,
            spo2_effect: -2,
            dose_dependent: 1,
            base_dose: 2,
            base_dose_unit: 'mg',
            description: 'Benzodiazepine - sedation, respiratory depression'
        },
        {
            treatment_type: 'medication',
            treatment_name: 'Propofol',
            route: 'IV',
            onset_minutes: 0.5,
            peak_minutes: 1,
            duration_minutes: 10,
            hr_effect: 0,
            bp_sys_effect: -20,
            bp_dia_effect: -15,
            rr_effect: -5,
            spo2_effect: -3,
            dose_dependent: 1,
            base_dose: 1,
            base_dose_unit: 'mg/kg',
            description: 'Hypnotic - significant hypotension'
        },
        // Diuretics
        {
            treatment_type: 'medication',
            treatment_name: 'Furosemide',
            route: 'IV',
            onset_minutes: 5,
            peak_minutes: 30,
            duration_minutes: 120,
            hr_effect: 0,
            bp_sys_effect: -10,
            bp_dia_effect: -5,
            rr_effect: 0,
            spo2_effect: 2,
            dose_dependent: 1,
            base_dose: 40,
            base_dose_unit: 'mg',
            description: 'Loop diuretic - reduces preload'
        },
        // Bronchodilators
        {
            treatment_type: 'medication',
            treatment_name: 'Albuterol',
            route: 'inhaled',
            onset_minutes: 5,
            peak_minutes: 30,
            duration_minutes: 240,
            hr_effect: 10,
            bp_sys_effect: 0,
            bp_dia_effect: 0,
            rr_effect: -2,
            spo2_effect: 3,
            dose_dependent: 0,
            description: 'Beta-2 agonist - bronchodilation, mild tachycardia'
        },
        // IV Fluids
        {
            treatment_type: 'iv_fluid',
            treatment_name: 'Normal Saline 500ml Bolus',
            route: 'IV',
            onset_minutes: 5,
            peak_minutes: 20,
            duration_minutes: 60,
            hr_effect: -5,
            bp_sys_effect: 10,
            bp_dia_effect: 5,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 0,
            description: 'Crystalloid - volume expansion'
        },
        {
            treatment_type: 'iv_fluid',
            treatment_name: 'Normal Saline 1000ml Bolus',
            route: 'IV',
            onset_minutes: 10,
            peak_minutes: 30,
            duration_minutes: 90,
            hr_effect: -10,
            bp_sys_effect: 15,
            bp_dia_effect: 8,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 0,
            description: 'Crystalloid - significant volume expansion'
        },
        {
            treatment_type: 'iv_fluid',
            treatment_name: 'Lactated Ringers 500ml Bolus',
            route: 'IV',
            onset_minutes: 5,
            peak_minutes: 20,
            duration_minutes: 60,
            hr_effect: -5,
            bp_sys_effect: 10,
            bp_dia_effect: 5,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 0,
            description: 'Balanced crystalloid - volume expansion'
        },
        {
            treatment_type: 'iv_fluid',
            treatment_name: 'D5W 500ml',
            route: 'IV',
            onset_minutes: 10,
            peak_minutes: 30,
            duration_minutes: 60,
            hr_effect: 0,
            bp_sys_effect: 0,
            bp_dia_effect: 0,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 0,
            description: 'Dextrose water - free water replacement'
        },
        {
            treatment_type: 'iv_fluid',
            treatment_name: 'Albumin 5% 250ml',
            route: 'IV',
            onset_minutes: 5,
            peak_minutes: 15,
            duration_minutes: 120,
            hr_effect: -5,
            bp_sys_effect: 12,
            bp_dia_effect: 8,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 0,
            description: 'Colloid - oncotic pressure support'
        },
        // Oxygen Therapy
        {
            treatment_type: 'oxygen',
            treatment_name: 'Nasal Cannula 2L/min',
            route: 'inhaled',
            onset_minutes: 2,
            peak_minutes: 5,
            duration_minutes: -1,
            hr_effect: 0,
            bp_sys_effect: 0,
            bp_dia_effect: 0,
            rr_effect: 0,
            spo2_effect: 4,
            dose_dependent: 0,
            description: 'FiO2 ~28%'
        },
        {
            treatment_type: 'oxygen',
            treatment_name: 'Nasal Cannula 4L/min',
            route: 'inhaled',
            onset_minutes: 2,
            peak_minutes: 5,
            duration_minutes: -1,
            hr_effect: 0,
            bp_sys_effect: 0,
            bp_dia_effect: 0,
            rr_effect: 0,
            spo2_effect: 8,
            dose_dependent: 0,
            description: 'FiO2 ~36%'
        },
        {
            treatment_type: 'oxygen',
            treatment_name: 'Nasal Cannula 6L/min',
            route: 'inhaled',
            onset_minutes: 2,
            peak_minutes: 5,
            duration_minutes: -1,
            hr_effect: 0,
            bp_sys_effect: 0,
            bp_dia_effect: 0,
            rr_effect: 0,
            spo2_effect: 10,
            dose_dependent: 0,
            description: 'FiO2 ~44%'
        },
        {
            treatment_type: 'oxygen',
            treatment_name: 'Simple Face Mask 8L/min',
            route: 'inhaled',
            onset_minutes: 1,
            peak_minutes: 3,
            duration_minutes: -1,
            hr_effect: 0,
            bp_sys_effect: 0,
            bp_dia_effect: 0,
            rr_effect: 0,
            spo2_effect: 12,
            dose_dependent: 0,
            description: 'FiO2 ~50-60%'
        },
        {
            treatment_type: 'oxygen',
            treatment_name: 'Non-Rebreather Mask 15L/min',
            route: 'inhaled',
            onset_minutes: 1,
            peak_minutes: 3,
            duration_minutes: -1,
            hr_effect: 0,
            bp_sys_effect: 0,
            bp_dia_effect: 0,
            rr_effect: 0,
            spo2_effect: 15,
            dose_dependent: 0,
            description: 'FiO2 ~80-100%'
        },
        // Nursing Interventions
        {
            treatment_type: 'nursing',
            treatment_name: 'Trendelenburg Position',
            route: 'position',
            onset_minutes: 1,
            peak_minutes: 3,
            duration_minutes: -1,
            hr_effect: -5,
            bp_sys_effect: 10,
            bp_dia_effect: 5,
            rr_effect: 0,
            spo2_effect: -1,
            dose_dependent: 0,
            description: 'Improves venous return, may compromise breathing'
        },
        {
            treatment_type: 'nursing',
            treatment_name: 'Fowler Position (45°)',
            route: 'position',
            onset_minutes: 1,
            peak_minutes: 2,
            duration_minutes: -1,
            hr_effect: 5,
            bp_sys_effect: -5,
            bp_dia_effect: -3,
            rr_effect: -2,
            spo2_effect: 2,
            dose_dependent: 0,
            description: 'Improves breathing, reduces preload'
        },
        {
            treatment_type: 'nursing',
            treatment_name: 'High Fowler Position (90°)',
            route: 'position',
            onset_minutes: 1,
            peak_minutes: 2,
            duration_minutes: -1,
            hr_effect: 8,
            bp_sys_effect: -8,
            bp_dia_effect: -5,
            rr_effect: -3,
            spo2_effect: 3,
            dose_dependent: 0,
            description: 'Maximum breathing comfort, reduces preload'
        },
        {
            treatment_type: 'nursing',
            treatment_name: 'Supine Position',
            route: 'position',
            onset_minutes: 1,
            peak_minutes: 2,
            duration_minutes: -1,
            hr_effect: 0,
            bp_sys_effect: 0,
            bp_dia_effect: 0,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 0,
            description: 'Neutral position'
        },
        {
            treatment_type: 'nursing',
            treatment_name: 'Left Lateral Position',
            route: 'position',
            onset_minutes: 1,
            peak_minutes: 2,
            duration_minutes: -1,
            hr_effect: 0,
            bp_sys_effect: 5,
            bp_dia_effect: 3,
            rr_effect: 0,
            spo2_effect: 0,
            dose_dependent: 0,
            description: 'Improves cardiac output in pregnancy'
        }
    ];

    const stmt = db.prepare(`
        INSERT OR IGNORE INTO treatment_effects
        (treatment_type, treatment_name, route, onset_minutes, peak_minutes, duration_minutes,
         hr_effect, bp_sys_effect, bp_dia_effect, rr_effect, spo2_effect, temp_effect,
         dose_dependent, base_dose, base_dose_unit, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    defaultEffects.forEach(effect => {
        stmt.run(
            effect.treatment_type,
            effect.treatment_name,
            effect.route || null,
            effect.onset_minutes,
            effect.peak_minutes,
            effect.duration_minutes,
            effect.hr_effect || 0,
            effect.bp_sys_effect || 0,
            effect.bp_dia_effect || 0,
            effect.rr_effect || 0,
            effect.spo2_effect || 0,
            effect.temp_effect || 0,
            effect.dose_dependent || 0,
            effect.base_dose || null,
            effect.base_dose_unit || null,
            effect.description || null
        );
    });

    stmt.finalize(() => {
        console.log('Default treatment effects seeded.');
    });
}

function seedDefaultModelPricing() {
    const defaultPricing = [
        ['openai', 'gpt-3.5-turbo', 0.0005, 0.0015],
        ['openai', 'gpt-4', 0.03, 0.06],
        ['openai', 'gpt-4-turbo', 0.01, 0.03],
        ['openai', 'gpt-4o', 0.005, 0.015],
        ['openai', 'gpt-4o-mini', 0.00015, 0.0006],
        ['ollama', 'default', 0, 0],
        ['lmstudio', 'default', 0, 0]
    ];

    const pricingStmt = db.prepare(
        `INSERT OR IGNORE INTO llm_model_pricing
         (provider, model, input_cost_per_1k, output_cost_per_1k)
         VALUES (?, ?, ?, ?)`
    );
    defaultPricing.forEach(([provider, model, input, output]) => {
        pricingStmt.run(provider, model, input, output);
    });
    pricingStmt.finalize();
}

function seedAvatarDefaults() {
    const avatarSettings = [
        ['default_avatar_male', 'rb_male_adult_03.glb'],
        ['default_avatar_female', 'rb_female_adult_07.glb']
    ];
    const psStmt = db.prepare(
        `INSERT OR IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?, ?)`
    );
    avatarSettings.forEach(([key, value]) => psStmt.run(key, value));
    psStmt.finalize();

    const defaultAgentAvatars = [
        ['Sarah Mitchell', 'rb_medical_female_01.glb'],
        ['Dr. James Chen', 'rb_medical_male_03.glb'],
        ['Family Member', 'rb_female_adult_07.glb']
    ];
    const aaStmt = db.prepare(
        `UPDATE agent_templates SET avatar_url = ?
         WHERE name = ? AND (avatar_url IS NULL OR avatar_url = '')`
    );
    defaultAgentAvatars.forEach(([name, file]) => aaStmt.run(file, name));
    aaStmt.finalize();
}

async function initDb() {
    await runMigrations(db);

    seedDefaultTreatmentEffects();
    seedDefaultModelPricing();
    seedDefaultAgents();
    seedAvatarDefaults();

    console.log('Database migrations and seed defaults initialized.');
}

export default db;
