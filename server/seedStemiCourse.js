// Idempotent boot seed: fill the tenant "Basic course" (the automatic default
// class that already holds the default STEMI case) with real STEMI teaching
// content — one published lesson (overview text + a 10-question MCQ block) and
// a clinical-reasoning survey attached to the course.
//
// Runs on every boot but is a no-op once the lesson exists (guarded by title),
// so existing installs get the content without a destructive migration and
// fresh installs get it right after the 0031 default-course backfill.
import dbAdapter from './dbAdapter.js';
import { logger } from './logger.js';

const log = logger('seed-stemi');

const LESSON_TITLE = 'STEMI: Recognition & Management';
const SURVEY_TITLE = 'Clinical Reasoning in STEMI';

// Encode a JSON string so it is safe inside a single-quoted HTML attribute
// (TipTap reads <lecture-mcq data-questions='…'> back out of the DOM).
function attr(json) {
    return json
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const INTRO_HTML = `
<h2>What is a STEMI?</h2>
<p>ST-elevation myocardial infarction (STEMI) is acute myocardial injury caused by
complete, thrombotic occlusion of a coronary artery. The occlusion produces
transmural ischaemia, which is what generates the hallmark ST-segment elevation
on the surface ECG. It is a <strong>time-critical</strong> diagnosis: myocardium
infarcts progressively from the moment of occlusion, so "time is muscle."</p>

<h2>Recognising it on the ECG</h2>
<p>The diagnosis is electrocardiographic. Look for new ST-segment elevation at the
J-point in two contiguous leads:</p>
<ul>
  <li>&ge; 1 mm in the limb leads and most precordial leads;</li>
  <li>&ge; 2 mm (men &ge; 40y), &ge; 2.5 mm (men &lt; 40y), or &ge; 1.5 mm (women) in V2&ndash;V3;</li>
  <li>reciprocal ST depression supports a true occlusion rather than a mimic.</li>
</ul>
<p>Territories: inferior (II, III, aVF), anterior/septal (V1&ndash;V4), lateral
(I, aVL, V5&ndash;V6). New left bundle branch block with a compatible presentation,
and posterior MI (tall R + ST depression in V1&ndash;V3), are important "STEMI-equivalents."</p>

<h2>Immediate management</h2>
<p>The single most important intervention is <strong>prompt reperfusion</strong>.
Primary percutaneous coronary intervention (PCI) is preferred when it can be
delivered within guideline timelines (first-medical-contact-to-device &le; 120 min);
otherwise give fibrinolysis and transfer. Alongside reperfusion: aspirin, a second
antiplatelet agent, anticoagulation, and analgesia, with oxygen only if hypoxaemic.</p>

<p class="rohy-lesson-note"><em>Work through the questions below, then reflect in the
clinical-reasoning survey.</em></p>
`.trim();

// 10 MCQs — a mix of basic knowledge and "problems in STEMI" (pitfalls,
// complications, decision-making). Each: question, options[], correctIndex,
// explanation. Apostrophes are avoided so the attribute stays clean.
const MCQ_QUESTIONS = [
    {
        question: 'What is the underlying pathophysiology of a STEMI?',
        options: [
            'Complete thrombotic occlusion of a coronary artery',
            'Partial, non-occlusive coronary thrombus',
            'Coronary vasospasm without thrombus',
            'Demand ischaemia from tachycardia',
        ],
        correctIndex: 0,
        explanation: 'STEMI results from complete, usually thrombotic, occlusion of a coronary artery causing transmural ischaemia. Partial occlusion typically produces NSTEMI/unstable angina.',
    },
    {
        question: 'ST elevation must be present in how many leads to meet STEMI criteria?',
        options: ['Any single lead', 'Two contiguous leads', 'Any three leads', 'All leads in one territory'],
        correctIndex: 1,
        explanation: 'The threshold is new ST elevation at the J-point in at least two anatomically contiguous leads.',
    },
    {
        question: 'An inferior STEMI is best identified in which leads?',
        options: ['V1 to V4', 'I, aVL, V5, V6', 'II, III, aVF', 'aVR and V1'],
        correctIndex: 2,
        explanation: 'Leads II, III and aVF look at the inferior wall, usually supplied by the right coronary artery.',
    },
    {
        question: 'Which is the preferred reperfusion strategy when it can be delivered in time?',
        options: ['Fibrinolysis', 'Primary PCI', 'Dual antiplatelets alone', 'Elective angiography in 72 hours'],
        correctIndex: 1,
        explanation: 'Primary PCI is preferred when first-medical-contact-to-device time is within guideline limits (about 120 minutes); otherwise give fibrinolysis and transfer.',
    },
    {
        question: 'In a patient with an inferior STEMI, why should you obtain a right-sided ECG?',
        options: [
            'To exclude a pulmonary embolism',
            'To detect right ventricular infarction',
            'To confirm atrial fibrillation',
            'To measure the QT interval',
        ],
        correctIndex: 1,
        explanation: 'Inferior STEMI can involve the right ventricle (ST elevation in V4R). RV infarction is preload-dependent, so nitrates can cause dangerous hypotension.',
    },
    {
        question: 'Which drug is relatively contraindicated in suspected right ventricular infarction?',
        options: ['Aspirin', 'Nitroglycerin', 'Heparin', 'Morphine'],
        correctIndex: 1,
        explanation: 'RV infarction is preload-dependent; nitrates reduce preload and can precipitate profound hypotension.',
    },
    {
        question: 'New left bundle branch block with an ischaemic presentation should be treated as:',
        options: [
            'A benign finding needing no action',
            'A STEMI-equivalent warranting urgent reperfusion assessment',
            'A reason to withhold aspirin',
            'An indication for immediate fibrinolysis regardless of PCI access',
        ],
        correctIndex: 1,
        explanation: 'New or presumed-new LBBB with a compatible clinical picture is treated as a STEMI-equivalent and prompts urgent reperfusion evaluation.',
    },
    {
        question: 'Which ECG pattern suggests a posterior STEMI?',
        options: [
            'ST elevation in V1 to V3',
            'Tall R waves and ST depression in V1 to V3',
            'Diffuse concave ST elevation with PR depression',
            'Deep Q waves in aVR only',
        ],
        correctIndex: 1,
        explanation: 'Posterior infarction is mirrored anteriorly as tall R waves and horizontal ST depression in V1 to V3; posterior leads (V7 to V9) confirm it.',
    },
    {
        question: 'A common mechanical complication in the days after a STEMI is:',
        options: [
            'Aortic dissection',
            'Papillary muscle rupture causing acute mitral regurgitation',
            'Pulmonary fibrosis',
            'Constrictive pericarditis',
        ],
        correctIndex: 1,
        explanation: 'Papillary muscle rupture, ventricular septal rupture and free-wall rupture are feared mechanical complications, typically in the first days post-infarct.',
    },
    {
        question: 'Which is the most appropriate use of oxygen in an acute STEMI?',
        options: [
            'High-flow oxygen for every patient',
            'Only when the patient is hypoxaemic (e.g. SpO2 below 90%)',
            'Never, oxygen is harmful in STEMI',
            'Only if the patient reports breathlessness',
        ],
        correctIndex: 1,
        explanation: 'Routine supplemental oxygen in non-hypoxaemic patients confers no benefit and may cause harm; give oxygen only for hypoxaemia.',
    },
];

const SURVEY_QUESTIONS = [
    {
        questionText: 'Briefly outline your reasoning for the first 10 minutes of managing a patient with chest pain and ST elevation.',
        questionType: 'free_text',
        options: null,
        isRequired: true,
    },
    {
        questionText: 'How confident are you in interpreting a 12-lead ECG for STEMI?',
        questionType: 'single_choice',
        options: ['Not confident', 'Somewhat confident', 'Confident', 'Very confident'],
        isRequired: true,
    },
    {
        questionText: 'Which factors do you weigh when choosing between primary PCI and fibrinolysis?',
        questionType: 'multiple_choice',
        options: ['Time from symptom onset', 'Expected time to PCI', 'Bleeding risk', 'Availability of a cath lab'],
        isRequired: false,
    },
];

// Seed ONE "Basic course" cohort (idempotent: guarded by the lesson title).
async function seedCohort(cohort) {
    const existing = await dbAdapter.get(
        `SELECT id FROM lessons WHERE cohort_id = ? AND title = ? AND deleted_at IS NULL`,
        [cohort.id, LESSON_TITLE]
    );
    if (existing) return; // already seeded

    await dbAdapter.transaction(async () => {
        // Lesson (published).
        const { lastID: lessonId } = await dbAdapter.run(
            `INSERT INTO lessons
               (cohort_id, tenant_id, title, description, content_type, order_index, is_published, is_free)
             VALUES (?,?,?,?,?,?,1,1)`,
            [cohort.id, cohort.tenant_id, LESSON_TITLE,
             'Recognise ST-elevation MI on the ECG, act on it, and reason through the pitfalls.',
             'text', 0]
        );

        // Section 1 — overview text.
        await dbAdapter.run(
            `INSERT INTO lesson_sections (lesson_id, title, type, content, order_index)
             VALUES (?,?,?,?,?)`,
            [lessonId, 'Overview', 'text', INTRO_HTML, 0]
        );

        // Section 2 — the 10-question MCQ block (a single lecture-mcq stepper).
        const mcqHtml = `<lecture-mcq data-questions='${attr(JSON.stringify(MCQ_QUESTIONS))}'></lecture-mcq>`;
        await dbAdapter.run(
            `INSERT INTO lesson_sections (lesson_id, title, type, content, order_index)
             VALUES (?,?,?,?,?)`,
            [lessonId, 'Check your knowledge', 'text', mcqHtml, 1]
        );

        // Survey (published) + questions + attach to the course.
        const { lastID: surveyId } = await dbAdapter.run(
            `INSERT INTO surveys (tenant_id, title, description, created_by_id, is_published, is_anonymous)
             VALUES (?,?,?,?,1,0)`,
            [cohort.tenant_id, SURVEY_TITLE,
             'A short reflection on how you reason through an acute STEMI.',
             cohort.owner_user_id]
        );
        for (let i = 0; i < SURVEY_QUESTIONS.length; i++) {
            const q = SURVEY_QUESTIONS[i];
            await dbAdapter.run(
                `INSERT INTO survey_questions
                   (survey_id, question_text, question_type, options, is_required, order_index)
                 VALUES (?,?,?,?,?,?)`,
                [surveyId, q.questionText, q.questionType,
                 q.options ? JSON.stringify(q.options) : null, q.isRequired ? 1 : 0, i]
            );
        }
        await dbAdapter.run(
            `INSERT INTO cohort_surveys (cohort_id, survey_id, order_index) VALUES (?,?,0)`,
            [cohort.id, surveyId]
        );
    });

    log.info('seeded STEMI course content', { cohort_id: cohort.id });
}

// Ensure every tenant with a staff user has a live "Basic course" (0031's
// backfill re-run at boot). On a FRESH install migrations run against an
// empty DB — 0031 sees no users and creates nothing — and only afterwards do
// the boot seeders insert the default users + cases. Without this step a
// fresh install would never get its default class. Same owner-selection rule
// as 0031 (lowest-id admin, else educator); auto_enroll = 1 so the login
// hook (ensureAutoEnrollMemberships) enrols everyone. Idempotent via the
// NOT EXISTS guard; memberships come from the login hook, not from here.
async function ensureBasicCourses() {
    const { changes } = await dbAdapter.run(
        `INSERT INTO cohorts (name, owner_user_id, tenant_id, description, auto_enroll)
         SELECT 'Basic course',
                (SELECT u.id FROM users u
                  WHERE u.tenant_id = t.tenant_id AND u.deleted_at IS NULL
                    AND u.role IN ('admin', 'educator')
                  ORDER BY (u.role = 'admin') DESC, u.id ASC LIMIT 1),
                t.tenant_id,
                'Default class — every user is enrolled and receives the default case.',
                1
           FROM (SELECT DISTINCT tenant_id FROM users WHERE deleted_at IS NULL) t
          WHERE EXISTS (SELECT 1 FROM users u
                         WHERE u.tenant_id = t.tenant_id AND u.deleted_at IS NULL
                           AND u.role IN ('admin', 'educator'))
            AND NOT EXISTS (SELECT 1 FROM cohorts c
                             WHERE c.tenant_id = t.tenant_id
                               AND c.name = 'Basic course'
                               AND c.deleted_at IS NULL)`
    );
    if (changes) log.info('created Basic course cohorts', { created: changes });
}

// Course layout invariant (idempotent, per tenant with a live Basic course):
//   (a) the tenant's DEFAULT case (cases.is_default = 1) is linked to the
//       "Basic course" — and ONLY the default case lives there;
//   (b) every OTHER live case has its OWN dedicated course: a cohort named
//       exactly after the case (created if missing — same owner/tenant as the
//       Basic course, join_code allocated the same way POST /cohorts does),
//       linked via cohort_cases. auto_enroll stays 0: these courses are the
//       ACCESS layer — a teacher enrols students (or shares the join code) to
//       grant the case; nobody is enrolled automatically;
//   (c) DATA REPAIR — any live link between a NON-default case and the Basic
//       course is soft-deleted (undoes the earlier "link every orphan to
//       Basic course" behaviour of this seed).
// Teacher-made assignments to any OTHER cohort are never touched: a case that
// already has a live link to a non-Basic cohort keeps it and gets nothing new.
// Cases, like agents, are assigned to a course or not — no course is
// manufactured per case. The Basic course carries exactly the default case;
// any other case is visible to students only once a teacher assigns it to a
// course they're enrolled in (unassigned = educator-only, per cases-routes).
async function ensureBasicCourseCaseLink() {
    const basicCourses = await dbAdapter.all(
        `SELECT id, tenant_id, owner_user_id FROM cohorts
          WHERE name = 'Basic course' AND deleted_at IS NULL
          ORDER BY id ASC`
    );
    for (const basic of basicCourses) {
        // Revive-or-insert the default-case link into the Basic course.
        await dbAdapter.run(
            `INSERT INTO cohort_cases (cohort_id, case_id)
             SELECT ?, c.id FROM cases c
              WHERE c.tenant_id = ? AND c.is_default = 1 AND c.deleted_at IS NULL
                AND NOT EXISTS (
                    SELECT 1 FROM cohort_cases cc
                     WHERE cc.cohort_id = ? AND cc.case_id = c.id AND cc.deleted_at IS NULL)`,
            [basic.id, basic.tenant_id, basic.id]
        );

        // Repair: the Basic course holds ONLY the default case. (Undoes the
        // 2026-07-09 blanket linking of every orphan case to Basic course.)
        const { changes: repaired } = await dbAdapter.run(
            `UPDATE cohort_cases SET deleted_at = CURRENT_TIMESTAMP
              WHERE cohort_id = ? AND deleted_at IS NULL
                AND case_id IN (
                    SELECT c.id FROM cases c
                     WHERE c.tenant_id = ? AND c.deleted_at IS NULL
                       AND (c.is_default IS NULL OR c.is_default != 1))`,
            [basic.id, basic.tenant_id]
        );
        if (repaired) {
            log.info('unlinked non-default cases from Basic course', {
                tenant_id: basic.tenant_id, unlinked: repaired,
            });
        }
    }
}

export async function seedStemiCourse() {
    try {
        await ensureBasicCourses();
        // Seed EVERY tenant's default class (multi-tenant installs have one
        // "Basic course" per tenant), each idempotently.
        const cohorts = await dbAdapter.all(
            `SELECT id, tenant_id, owner_user_id FROM cohorts
              WHERE name = 'Basic course' AND deleted_at IS NULL
              ORDER BY id ASC`
        );
        for (const cohort of cohorts) {
            await seedCohort(cohort);
        }
        await ensureBasicCourseCaseLink();
    } catch (err) {
        // Non-fatal: a seed failure must never stop the server booting.
        log.warn('STEMI course seed failed', { error: err.message });
    }
}

export default seedStemiCourse;
