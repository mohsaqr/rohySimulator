import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrationRunner.js';
import { seedTreatmentEffects } from '../scripts/seed-treatment-effects.js';
import { seedCuratedMedications } from '../scripts/seed-curated-medications.js';
import { seedLabTestsFromJson } from '../scripts/seed-lab-tests-from-json.js';
import { importLoincMapping } from '../scripts/import-loinc-mapping.js';
import { seedPediatricRanges } from '../scripts/seed-pediatric-ranges.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlite = sqlite3.verbose();
const dbLog = logger('db');

// Connect to SQLite database
export const dbPath = process.env.ROHY_DB || path.resolve(__dirname, 'database.sqlite');
let resolveDbReady;
let rejectDbReady;
export const dbReady = new Promise((resolve, reject) => {
    resolveDbReady = resolve;
    rejectDbReady = reject;
});
const db = new sqlite.Database(dbPath, (err) => {
    if (err) {
        dbLog.error('database open failed', { db_path: dbPath, error: err.message });
        rejectDbReady(err);
    } else {
        dbLog.info('sqlite database connected', { db_path: dbPath });
        // Audit finding #8: startup runs migrations always, but seeding is
        // gated. Production deploys can set ROHY_NO_AUTO_SEED=1 and run
        // `node scripts/seed.js` from a one-off job — keeps the
        // request-serving process from doing first-boot work in the same
        // process. Default behaviour (seed-on-boot) is preserved so dev
        // ergonomics don't regress.
        bootDb().then(resolveDbReady).catch(rejectDbReady);
    }
});

async function bootDb() {
    await runDbMigrations();
    if (process.env.ROHY_NO_AUTO_SEED === '1') {
        dbLog.info('auto seed skipped', { reason: 'ROHY_NO_AUTO_SEED=1' });
        return;
    }
    await seedDbDefaults();
}

function runDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            err ? reject(err) : resolve(this);
        });
    });
}

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
                voice: { gender: 'female', case_voice: 'af_sky' },
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
                voice: { gender: 'male', case_voice: 'am_liam' },
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
                voice: { gender: 'female', case_voice: 'af_nicole' },
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
                voice: { gender: 'male', case_voice: 'bm_lewis' },
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
                voice: { gender: 'male', case_voice: 'am_michael' },
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
        },
        {
            // Sibling patient persona for female cases. ChatInterface picks
            // this one when case demographics.gender starts with "f"; the
            // generic "Default Patient" above is used otherwise. Both are
            // is_default=1; the seeder dedups on (agent_type, name) so the
            // pair can coexist. Voice config carries gender='female' so
            // resolveVoice's tier 2 falls through to voice_<provider>_female
            // when no per-case override is set.
            agent_type: 'patient',
            name: 'Default Female Patient',
            role_title: 'Female Simulated Patient',
            avatar_url: 'rb_female_adult_01.glb',
            system_prompt: `You are the patient in this simulation. You stay in character throughout the conversation.

Your role:
- Answer the learner's questions truthfully when they're asked, the way a real patient would.
- Use lay language unless the learner specifically asks for medical detail.
- Describe symptoms in your own words; if asked about pain, use a 0–10 scale.
- Express how you're feeling emotionally as well as physically — worried, tired, in pain, relieved — when relevant.
- It's fine to be uncertain ("I'm not sure", "I think it started yesterday") rather than perfectly accurate.
- Communication style: tend toward more context and hedging than minimum-word answers ("it's been bothering me since..."), and acknowledge concern more readily when present.

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
                voice: { gender: 'female', case_voice: 'af_bella' },
                dos: [
                    'Stay in character throughout',
                    'Use lay terms unless asked otherwise',
                    'Answer truthfully when asked directly',
                    'Express emotion alongside symptoms',
                    'Acknowledge worry or discomfort when relevant rather than minimising'
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
async function seedDefaultAgents() {
    // Insert a shipped standard ONLY if no is_default=1 row exists for its
    // (agent_type, name) yet. This relaxation (2026-05-13) was needed to ship
    // sibling defaults like "Default Patient" + "Default Female Patient" —
    // dedup on agent_type alone blocked the second one. The trade-off: if an
    // admin renames a shipped default (e.g. "Default Patient" → "Acme
    // Patient") and the server restarts, the seeder re-creates the original
    // "Default Patient" alongside the renamed copy. We accept that one-time
    // duplicate as the cost of allowing multiple defaults per agent_type.
    // findDefaultAgent() still resolves by name for reset-to-defaults.
    for (const agent of DEFAULT_AGENTS) {
        try {
            await runDb(
                `INSERT INTO agent_templates
                 (agent_type, name, role_title, avatar_url, system_prompt, context_filter, communication_style, is_default, config)
                 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
                 WHERE NOT EXISTS (
                   SELECT 1 FROM agent_templates WHERE is_default = 1 AND agent_type = ? AND name = ? LIMIT 1
                 )`,
                [
                    agent.agent_type,
                    agent.name,
                    agent.role_title,
                    agent.avatar_url || null,
                    agent.system_prompt,
                    agent.context_filter,
                    agent.communication_style,
                    agent.is_default,
                    agent.config,
                    agent.agent_type,
                    agent.name
                ]
            );
        } catch (err) {
            dbLog.warn('default agent seed failed', { agent_type: agent.agent_type, name: agent.name, error: err.message });
        }
    }

    dbLog.info('default agent personas seeded');

    // Backfill avatar_url for default rows seeded before each row had a
    // shipped avatar. Idempotent — only updates rows currently NULL or empty.
    const avatarPatches = [
        { type: 'nurse', name: 'Sarah Mitchell', avatar: 'rb_medical_female_01.glb' },
        { type: 'consultant', name: 'Dr. James Chen', avatar: 'avatarsdk.glb' },
        { type: 'relative', name: 'Family Member', avatar: 'rb_female_adult_05.glb' },
        { type: 'discussant', name: 'Default Discussant', avatar: 'rb_medical_male_03.glb' },
        { type: 'patient', name: 'Default Patient', avatar: 'rb_male_adult_03.glb' },
        { type: 'patient', name: 'Default Female Patient', avatar: 'rb_female_adult_01.glb' },
    ];
    for (const p of avatarPatches) {
        await runDb(
            `UPDATE agent_templates SET avatar_url = ?
             WHERE agent_type = ? AND name = ? AND is_default = 1
               AND (avatar_url IS NULL OR avatar_url = '')`,
            [p.avatar, p.type, p.name]
        );
    }

    // Backfill config.dos / config.donts / voice slot for default rows seeded
    // before this feature landed. Uses SQLite JSON1 json_patch so existing
    // keys are preserved. Each patch only fires if the target keys are absent.
    const configPatches = [
        { type: 'nurse', name: 'Sarah Mitchell', voice: { gender: 'female', case_voice: 'af_sky' }, dos: ['Be clear and professional with nursing terminology', 'Speak up if an order seems unsafe', 'Report observations factually'], donts: ['Do the doctor\'s diagnostic work for them', 'Volunteer interpretations beyond your scope', 'Skip clarifying unclear orders'] },
        { type: 'consultant', name: 'Dr. James Chen', voice: { gender: 'male', case_voice: 'am_liam' }, dos: ['Ask clarifying questions about the presentation', 'Explain reasoning and differential diagnoses', 'Suggest evidence-based next steps'], donts: ['Take over the case from the learner', 'Skip the differential when one is warranted', 'Give recommendations without reviewing the data'] },
        { type: 'relative', name: 'Family Member', voice: { gender: 'female', case_voice: 'af_nicole' }, dos: ['Use lay terms — you\'re not medically trained', 'Express genuine worry and ask for explanation', 'Share what you know about the patient\'s daily life'], donts: ['Use medical jargon you wouldn\'t actually know', 'Stay calm if a learner ignores you for long stretches', 'Speak for the patient about clinical details you don\'t know'] },
        { type: 'discussant', name: 'Default Discussant', voice: { gender: 'male', case_voice: 'bm_lewis' }, dos: ['Ask before you tell — favour open-ended questions', 'Anchor questions in the specific decisions the learner made', 'Validate effort, then surface gaps clearly', 'Keep replies conversational and concise'], donts: ['Lecture when a question would teach more', 'Paper over real errors with reassurance', 'Run past the learner\'s pace — pause and listen', 'Treat the debrief as assessment'] },
        { type: 'patient', name: 'Default Patient', voice: { gender: 'male', case_voice: 'am_michael' }, dos: ['Stay in character throughout', 'Use lay terms unless asked otherwise', 'Answer truthfully when asked directly', 'Express emotion alongside symptoms'], donts: ['Volunteer differential diagnoses', 'Use medical jargon unprompted', 'Break character even if the learner asks meta questions', 'Reveal information the patient wouldn\'t actually know'] },
        { type: 'patient', name: 'Default Female Patient', voice: { gender: 'female', case_voice: 'af_bella' }, dos: ['Stay in character throughout', 'Use lay terms unless asked otherwise', 'Answer truthfully when asked directly', 'Express emotion alongside symptoms', 'Acknowledge worry or discomfort when relevant rather than minimising'], donts: ['Volunteer differential diagnoses', 'Use medical jargon unprompted', 'Break character even if the learner asks meta questions', 'Reveal information the patient wouldn\'t actually know'] },
    ];
    for (const p of configPatches) {
        // Patch dos/donts if missing
        await runDb(
            `UPDATE agent_templates
             SET config = json_patch(COALESCE(config, '{}'), ?)
             WHERE agent_type = ? AND name = ? AND is_default = 1
               AND json_extract(COALESCE(config, '{}'), '$.dos') IS NULL`,
            [JSON.stringify({ dos: p.dos, donts: p.donts }), p.type, p.name]
        );
        // Patch the entire voice block if missing. Existing rows that
        // already have `voice` set (e.g. from earlier seeds with just
        // gender) skip this and fall through to the case_voice-specific
        // patch below.
        await runDb(
            `UPDATE agent_templates
             SET config = json_patch(COALESCE(config, '{}'), ?)
             WHERE agent_type = ? AND name = ? AND is_default = 1
               AND json_extract(COALESCE(config, '{}'), '$.voice') IS NULL`,
            [JSON.stringify({ voice: p.voice }), p.type, p.name]
        );
        // Patch case_voice when the voice block exists but the case_voice
        // field inside it is missing — covers rows seeded before
        // 2026-05-13 (which had `voice: { gender: 'X' }` only). json_set
        // adds the field without touching gender / tts_rate / tts_pitch.
        // No-op if case_voice is already set (admin-picked value wins).
        if (p.voice?.case_voice) {
            await runDb(
                `UPDATE agent_templates
                 SET config = json_set(COALESCE(config, '{}'), '$.voice.case_voice', ?)
                 WHERE agent_type = ? AND name = ? AND is_default = 1
                   AND json_extract(COALESCE(config, '{}'), '$.voice.case_voice') IS NULL`,
                [p.voice.case_voice, p.type, p.name]
            );
        }
    }
}


async function seedDefaultModelPricing() {
    const defaultPricing = [
        ['openai', 'gpt-3.5-turbo', 0.0005, 0.0015],
        ['openai', 'gpt-4', 0.03, 0.06],
        ['openai', 'gpt-4-turbo', 0.01, 0.03],
        ['openai', 'gpt-4o', 0.005, 0.015],
        ['openai', 'gpt-4o-mini', 0.00015, 0.0006],
        ['ollama', 'default', 0, 0],
        ['lmstudio', 'default', 0, 0]
    ];

    for (const [provider, model, input, output] of defaultPricing) {
        await runDb(
            `INSERT OR IGNORE INTO llm_model_pricing
             (provider, model, input_cost_per_1k, output_cost_per_1k)
             VALUES (?, ?, ?, ?)`,
            [provider, model, input, output]
        );
    }
}

async function seedAvatarDefaults() {
    const avatarSettings = [
        ['default_avatar_male', 'rb_male_adult_03.glb'],
        ['default_avatar_female', 'rb_female_adult_07.glb']
    ];
    for (const [key, value] of avatarSettings) {
        await runDb(
            `INSERT OR IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?, ?)`,
            [key, value]
        );
    }

    const defaultAgentAvatars = [
        ['Sarah Mitchell', 'rb_medical_female_01.glb'],
        ['Dr. James Chen', 'rb_medical_male_03.glb'],
        ['Family Member', 'rb_female_adult_07.glb']
    ];
    for (const [name, file] of defaultAgentAvatars) {
        await runDb(
            `UPDATE agent_templates SET avatar_url = ?
             WHERE name = ? AND (avatar_url IS NULL OR avatar_url = '')`,
            [file, name]
        );
    }
}

// Migrations only — safe to run on every boot. Idempotent.
//
// Before running any migration that hasn't been applied yet, snapshot the
// sqlite file to a sibling .bak.<timestamp>.<version> file. Cheap insurance:
// if the migration corrupts data we can roll back by copying the snapshot
// back over database.sqlite. Snapshot is skipped for in-memory DBs and when
// ROHY_BACKUP_BEFORE_MIGRATE=0 (CI/test where DBs are throwaway anyway).
export async function runDbMigrations() {
    if (process.env.ROHY_BACKUP_BEFORE_MIGRATE !== '0' && dbPath !== ':memory:') {
        try {
            // Compare on-disk migration files vs schema_migrations to decide
            // if we'd apply anything. If yes, snapshot the DB first.
            const { discoverMigrations } = await import('./migrationRunner.js');
            const all = discoverMigrations();
            const applied = await new Promise((resolve) => {
                db.all('SELECT version FROM schema_migrations', [], (err, rows) => {
                    if (err) return resolve(new Set());  // table not yet created → first boot
                    resolve(new Set((rows || []).map(r => r.version)));
                });
            });
            const willApply = all.filter(m => !applied.has(m.version));
            if (willApply.length > 0) {
                const ts = new Date().toISOString().replace(/[:.]/g, '-');
                const targetVersion = willApply[willApply.length - 1].version;
                const backupPath = `${dbPath}.bak.${ts}.${targetVersion}`;
                const fs = await import('node:fs/promises');
                await fs.copyFile(dbPath, backupPath);
                dbLog.info('pre-migration backup created', {
                    backup_path: backupPath,
                    pending_migrations: willApply.length,
                    target_version: targetVersion,
                });
            }
        } catch (err) {
            // Backup failure is non-fatal — we still attempt migrations
            // (the existing checksum guard catches mid-run corruption,
            // and refusing to migrate when backup fails would brick
            // upgrades on read-only filesystems / disk-full scenarios).
            dbLog.warn('pre-migration backup failed', { error: err.message });
        }
    }
    await runMigrations(db);
}


// First-boot seeders. Idempotent (each seeder is INSERT OR IGNORE / NOT
// EXISTS-guarded). Exported so a one-off job (`node scripts/seed.js`) can
// invoke it without booting the request-serving process.
//
// Each catalogue seeder is wrapped in its own try/catch so one failure
// doesn't silently abort every downstream seeder. The previous single
// shared try block meant a treatment_effects.json schema drift could leave
// the lab DB and pediatric ranges empty even though their own data was
// fine — the symptom looked like "lab seeder broken" when the real
// failure was upstream.
async function runSeeder(name, fn) {
    try {
        await fn();
    } catch (err) {
        dbLog.error('catalogue seeder failed', {
            seeder: name,
            error: err.message,
        });
    }
}

export async function seedDbDefaults() {
    await runSeeder('treatment_effects',   () => seedTreatmentEffects(db,   { log: () => {} }));
    await runSeeder('curated_medications', () => seedCuratedMedications(db, { log: () => {} }));
    await runSeeder('lab_tests',           () => seedLabTestsFromJson(db,   { log: () => {} }));
    await runSeeder('loinc_mapping',       () => importLoincMapping(db,     { log: () => {} }));
    await runSeeder('pediatric_ranges',    () => seedPediatricRanges(db,    { log: () => {} }));

    await seedDefaultModelPricing();
    await seedDefaultAgents();
    await seedAvatarDefaults();

    dbLog.info('database seed defaults initialized');
}

export default db;
