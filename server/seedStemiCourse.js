// Idempotent boot seed: fill the tenant "Basic course" (the automatic default
// class that already holds the default STEMI case) with real STEMI teaching
// content — one published lesson (overview text + a 10-question MCQ block) and
// a clinical-reasoning survey attached to the course.
//
// Runs on every boot but is a no-op once the lesson exists (guarded by title),
// so existing installs get the content without a destructive migration and
// fresh installs get it right after the 0031 default-course backfill.
import dbAdapter from './dbAdapter.js';
import { LEGACY_MCQ_QUESTIONS } from './seeders/stemiLegacy.js';
import { logger } from './logger.js';
import { DEFAULT_COURSE_NAME } from './shared/defaultCourse.js';

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
// v2 (3.0.0-rc.16): anterior-focused, to match the default case. The v1 set
// is frozen in seeders/stemiLegacy.js so upgradeStemiQuiz() can tell an
// untouched quiz from an edited one.
//
// Authored with the correct option FIRST, for review; ANSWER_POSITIONS moves
// it, because the lesson's quiz block shows options in stored order and an
// answer that is always "A" teaches the wrong skill.
const ANSWER_POSITIONS = [2, 0, 3, 1, 2, 3, 0, 1, 3, 2];
const AUTHORED_MCQ_QUESTIONS = [
    {
        question: 'A man with 45 minutes of chest pain has ST elevation of 3 mm in V2 and V3 and 2 mm in V1 and V4, with ST depression in III and aVF. Which artery is most likely occluded?',
        options: ['Proximal left anterior descending', 'Right coronary', 'Left circumflex', 'Left main stem'],
        correctIndex: 0,
        explanation: 'ST elevation across V1 to V4 is the anterior territory, supplied by the LAD. The reciprocal inferior depression fits a proximal occlusion of a large vessel.',
    },
    {
        question: 'What does reciprocal ST depression in the inferior leads add to anterior ST elevation?',
        options: [
            'It supports a true coronary occlusion rather than a mimic such as pericarditis',
            'It means a second artery is also occluded',
            'It shows the infarct is already completed',
            'It rules out the need for reperfusion',
        ],
        correctIndex: 0,
        explanation: 'Reciprocal change is the electrical mirror of regional transmural injury. Diffuse ST elevation without reciprocal change, with PR depression, points instead to pericarditis.',
    },
    {
        question: 'ST elevation in aVL alongside V1 to V4 suggests what about the LAD occlusion?',
        options: [
            'It is proximal, before the first diagonal branch, so a larger territory is at risk',
            'It is distal, beyond the apex',
            'It involves the right ventricle',
            'It is a lead placement error',
        ],
        correctIndex: 0,
        explanation: 'aVL looks at the high lateral wall supplied by the first diagonal. Its involvement places the occlusion proximal to that branch.',
    },
    {
        question: 'For a man over 40, what new J-point elevation in V2 and V3 meets the threshold for STEMI?',
        options: ['At least 2 mm', 'At least 1 mm', 'At least 2.5 mm', 'At least 0.5 mm'],
        correctIndex: 0,
        explanation: 'In V2 and V3 the threshold is 2 mm in men aged 40 or over, 2.5 mm in men under 40 and 1.5 mm in women; in other leads it is 1 mm, in two contiguous leads.',
    },
    {
        question: 'The ECG shows a STEMI and the troponin has not come back. What is the next step?',
        options: [
            'Activate the catheter laboratory now',
            'Wait for the troponin to confirm the diagnosis',
            'Repeat the ECG in 30 minutes',
            'Arrange an echocardiogram first',
        ],
        correctIndex: 0,
        explanation: 'STEMI is an ECG diagnosis. Every minute of occlusion costs myocardium; reperfusion must never wait for a biomarker.',
    },
    {
        question: 'Primary PCI can be delivered within 120 minutes of first medical contact. Which reperfusion strategy is preferred?',
        options: ['Primary PCI', 'Fibrinolysis, then transfer', 'Fibrinolysis alone', 'Medical therapy and a delayed angiogram'],
        correctIndex: 0,
        explanation: 'Primary PCI is preferred when it can be delivered within 120 minutes. Fibrinolysis is for when it cannot, and it adds bleeding risk.',
    },
    {
        question: 'He is breathing comfortably with a saturation of 95 percent on room air. Should you give oxygen?',
        options: [
            'No - give oxygen only if saturation falls below 90 percent',
            'Yes - high-flow oxygen limits infarct size',
            'Yes - 2 litres by nasal cannula for every infarct',
            'Only once the troponin is raised',
        ],
        correctIndex: 0,
        explanation: 'Routine oxygen does not benefit a non-hypoxaemic patient with myocardial infarction, and hyperoxia may be harmful.',
    },
    {
        question: 'Ongoing chest pain with upsloping ST depression at the J point and tall, symmetrical T waves across V1 to V6. What is this?',
        options: [
            'The de Winter pattern - treat as a STEMI equivalent',
            'The Wellens pattern - a pain-free warning sign',
            'Left ventricular hypertrophy with strain',
            'Normal early repolarisation',
        ],
        correctIndex: 0,
        explanation: 'The de Winter pattern signals an acute proximal LAD occlusion without classic ST elevation and needs immediate reperfusion. Wellens T waves are seen pain-free, after reperfusion of a critical LAD lesion.',
    },
    {
        question: 'What is the most common cause of death in the first hours of an anterior STEMI?',
        options: ['Ventricular fibrillation', 'Cardiac rupture', 'Complete heart block', 'Pulmonary embolism'],
        correctIndex: 0,
        explanation: 'Most early deaths are arrhythmic. Continuous monitoring with a defibrillator at hand is part of the first ten minutes.',
    },
    {
        question: 'Four days after an anterior STEMI he becomes hypotensive with a new harsh holosystolic murmur at the left sternal edge. What is the most likely cause?',
        options: ['Ventricular septal rupture', 'Pericarditis', 'Left ventricular thrombus', 'Aortic dissection'],
        correctIndex: 0,
        explanation: 'Septal rupture typically follows an anterior infarct in the first days and presents with shock and a new murmur. Papillary muscle rupture, with acute mitral regurgitation, is more typical of inferior and posterior infarcts.',
    },
];

/** Move an authored question's correct option (first) to `index`. */
function answerAt(question, index) {
    const [correct, ...rest] = question.options;
    return { ...question, options: [...rest.slice(0, index), correct, ...rest.slice(index)], correctIndex: index };
}

export const MCQ_QUESTIONS = AUTHORED_MCQ_QUESTIONS.map((q, i) => answerAt(q, ANSWER_POSITIONS[i]));

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
/** The lesson's quiz section, as TipTap stores it. */
export function quizHtml(questions) {
    return `<lecture-mcq data-questions='${attr(JSON.stringify(questions))}'></lecture-mcq>`;
}

/**
 * Bring a quiz that is still exactly as shipped to the v2 questions. A quiz an
 * educator edited no longer equals the v1 HTML byte for byte, so it is left
 * alone. Idempotent: once replaced, nothing equals v1 any more.
 */
export async function upgradeStemiQuiz() {
    const { changes } = await dbAdapter.run(
        `UPDATE lesson_sections SET content = ?
          WHERE content = ?
            AND lesson_id IN (SELECT id FROM lessons WHERE title = ? AND deleted_at IS NULL)`,
        [quizHtml(MCQ_QUESTIONS), quizHtml(LEGACY_MCQ_QUESTIONS), LESSON_TITLE]
    );
    if (changes) log.info('STEMI quiz upgraded to v2', { sections: changes });
    return changes;
}

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
        const mcqHtml = quizHtml(MCQ_QUESTIONS);
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

// Ensure every tenant with a staff user has a live default course (0031's
// backfill re-run at boot). On a FRESH install migrations run against an
// empty DB — 0031 sees no users and creates nothing — and only afterwards do
// the boot seeders insert the default users + cases. Without this step a
// fresh install would never get its default class. Same owner-selection rule
// as 0031 (lowest-id admin, else educator); auto_enroll = 1 so the login
// hook (ensureAutoEnrollMemberships) enrols everyone. Idempotent via the
// NOT EXISTS guard; memberships come from the login hook, not from here.
//
// The default course is identified by `cohorts.is_default = 1` (0044), NOT by
// its name. The seeded name is the English literal 'Basic course' — display
// only, so an admin may rename/localise it. The guard used to match the name,
// which meant a renamed default was invisible here and every boot after the
// rename minted a second "Basic course".
export async function ensureBasicCourses() {
    const { changes } = await dbAdapter.run(
        `INSERT INTO cohorts (name, owner_user_id, tenant_id, description, auto_enroll, is_default)
         SELECT ?,
                (SELECT u.id FROM users u
                  WHERE u.tenant_id = t.tenant_id AND u.deleted_at IS NULL
                    AND u.role IN ('admin', 'educator')
                  ORDER BY (u.role = 'admin') DESC, u.id ASC LIMIT 1),
                t.tenant_id,
                'Default class — every user is enrolled and receives the default case.',
                1,
                1
           FROM (SELECT DISTINCT tenant_id FROM users WHERE deleted_at IS NULL) t
          WHERE EXISTS (SELECT 1 FROM users u
                         WHERE u.tenant_id = t.tenant_id AND u.deleted_at IS NULL
                           AND u.role IN ('admin', 'educator'))
            AND NOT EXISTS (SELECT 1 FROM cohorts c
                             WHERE c.tenant_id = t.tenant_id
                               AND c.is_default = 1
                               AND c.deleted_at IS NULL)`,
        [DEFAULT_COURSE_NAME]
    );
    if (changes) log.info('created default course cohorts', { created: changes });
}

// Course layout (idempotent, per tenant with a live Basic course):
// the tenant's DEFAULT case (cases.is_default = 1) is linked to the single
// default "Basic course" that every user is auto-enrolled in. The seeded
// language cases are added alongside it by server/seedLanguageCases.js, so the
// one default course carries the default case PLUS one case per language —
// students pick the language they want by picking the case (each is flagged by
// its own immutable case language). Teachers may add or remove further cases;
// their assignments to any cohort are never touched here. (Earlier revisions
// stripped every non-default case out of the Basic course to keep it to a
// single case — that repair is intentionally gone: the default course now
// holds many cases.)
async function ensureBasicCourseCaseLink() {
    const basicCourses = await dbAdapter.all(
        `SELECT id, tenant_id, owner_user_id FROM cohorts
          WHERE is_default = 1 AND deleted_at IS NULL
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
    }
}

export async function seedStemiCourse() {
    try {
        await ensureBasicCourses();
        // Seed EVERY tenant's default class (multi-tenant installs have one
        // "Basic course" per tenant), each idempotently.
        const cohorts = await dbAdapter.all(
            `SELECT id, tenant_id, owner_user_id FROM cohorts
              WHERE is_default = 1 AND deleted_at IS NULL
              ORDER BY id ASC`
        );
        for (const cohort of cohorts) {
            await seedCohort(cohort);
        }
        await upgradeStemiQuiz();
        await ensureBasicCourseCaseLink();
    } catch (err) {
        // Non-fatal: a seed failure must never stop the server booting.
        log.warn('STEMI course seed failed', { error: err.message });
    }
}

export default seedStemiCourse;
