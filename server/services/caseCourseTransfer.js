// The course that goes with a case, inside a case package (`course.json`).
//
// A case linked to a course (cohort_cases) moves with that course's lessons:
// their text, sections, order, published state, and which of them are locked
// behind THIS case's course gate (lessons.unlock_case_id). The import creates
// a new course owned by the person importing, links the case to it, and locks
// the same lessons behind the new case. Members never travel: the learners of
// one server are not the learners of another.
//
// Not carried, and said so in the export notes:
//   - the platform's default course: it holds every language case, so copying
//     it with one case would put a second "Basic course" on the target;
//   - a lesson locked behind a DIFFERENT case: on the target it would have no
//     case to wait for, and would open with the material it was holding back.
//
// Files a lesson uses (`/uploads/...` in its body, its sections, its video)
// travel as the package's uploads. In HTML only an attribute value or a CSS
// url() that starts with `/uploads/` or `./uploads/` is this server's file; a
// link to another host that contains /uploads/ is not.

import dbAdapter from '../dbAdapter.js';
import { sanitizeLessonHtml } from '../lib/lessonSanitize.js';

export const COURSE_DOCUMENT_FORMAT = 'rohy.case-course';
export const COURSE_DOCUMENT_VERSION = 1;

const LIMITS = Object.freeze({
    lessons: 200,
    sections: 200,
    name: 200,
    title: 500,
    text: 2 * 1024 * 1024,
    type: 40,
    url: 2048,
});

const UPLOAD_NAME = '[A-Za-z0-9][A-Za-z0-9._-]*';
// A whole value: `/uploads/x.pdf` or `./uploads/x.pdf` (section files, videos).
const UPLOAD_VALUE_RE = new RegExp(`^(\\.?/uploads/)(${UPLOAD_NAME})$`);
// Inside HTML: right after a quote or a url( paren, so an absolute URL on
// another host never matches.
const UPLOAD_IN_HTML_RE = new RegExp(`(?<=["'(])(\\.?/uploads/)(${UPLOAD_NAME})`, 'g');

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The live course a case is linked to, or null. */
async function courseOfCase(caseId, tenant) {
    return dbAdapter.get(
        `SELECT c.id, c.name, c.description, c.is_default
           FROM cohort_cases cc
           JOIN cohorts c ON c.id = cc.cohort_id
          WHERE cc.case_id = ? AND cc.deleted_at IS NULL
            AND c.tenant_id = ? AND c.deleted_at IS NULL
          ORDER BY cc.id DESC LIMIT 1`,
        [caseId, tenant]
    );
}

/**
 * The course document for a case, or null when the case has no course to carry.
 *
 * @returns {Promise<{course: object|null, notes: object[]}>}
 */
export async function buildCourseDocument({ caseId, tenant }) {
    const notes = [];
    const cohort = await courseOfCase(caseId, tenant);
    if (!cohort) return { course: null, notes };
    if (cohort.is_default) {
        notes.push({ field: 'course', received: cohort.name, hint: 'The platform\'s default course is not carried; only a course of the case\'s own is.' });
        return { course: null, notes };
    }
    const lessonRows = await dbAdapter.all(
        `SELECT id, title, description, content, content_type, video_url, duration, order_index,
                is_published, is_free, unlock_case_id
           FROM lessons
          WHERE cohort_id = ? AND tenant_id = ? AND deleted_at IS NULL
          ORDER BY order_index, id`,
        [cohort.id, tenant]
    );
    const lessons = [];
    for (const row of lessonRows) {
        if (row.unlock_case_id !== null && row.unlock_case_id !== caseId) {
            notes.push({ field: 'course', received: row.title, hint: 'Locked behind another case of the course; not carried, so it cannot open without that case.' });
            continue;
        }
        const sections = await dbAdapter.all(
            `SELECT title, type, content, file_name, file_url, file_type, file_size, order_index
               FROM lesson_sections
              WHERE lesson_id = ? AND deleted_at IS NULL
              ORDER BY order_index, id`,
            [row.id]
        );
        lessons.push({
            title: row.title,
            description: row.description,
            content: row.content,
            content_type: row.content_type,
            video_url: row.video_url,
            duration: row.duration,
            order_index: row.order_index,
            is_published: Boolean(row.is_published),
            is_free: Boolean(row.is_free),
            locked: row.unlock_case_id === caseId,
            sections,
        });
    }
    return {
        course: {
            format: COURSE_DOCUMENT_FORMAT,
            format_version: COURSE_DOCUMENT_VERSION,
            course: { name: cohort.name, description: cohort.description ?? null },
            lessons,
        },
        notes,
    };
}

/** Every text field of a course document, with whether it is HTML. */
function* courseTexts(course) {
    for (const lesson of course.lessons) {
        yield { value: lesson.description, html: true };
        yield { value: lesson.content, html: true };
        yield { value: lesson.video_url, html: false };
        for (const section of lesson.sections) {
            yield { value: section.content, html: true };
            yield { value: section.file_url, html: false };
        }
    }
}

/** Every /uploads file name a course document uses. */
export function courseUploadNames(course) {
    const names = new Set();
    if (!course) return [];
    for (const { value, html } of courseTexts(course)) {
        if (typeof value !== 'string') continue;
        const whole = UPLOAD_VALUE_RE.exec(value);
        if (whole) names.add(whole[2]);
        if (html) [...value.matchAll(UPLOAD_IN_HTML_RE)].forEach((m) => names.add(m[2]));
    }
    return [...names].sort();
}

/**
 * Point a course document at the names its uploads were given on this server.
 *
 * @param {object} course
 * @param {Array<[string, string]>} replacements  [`/uploads/<old>`, `/uploads/<new>`]
 */
export function rewriteCourseUploads(course, replacements) {
    const renames = new Map(replacements
        .filter(([from]) => from.startsWith('/uploads/'))
        .map(([from, to]) => [from.slice('/uploads/'.length), to.slice('/uploads/'.length)]));
    if (renames.size === 0) return course;
    const value = (text) => {
        if (typeof text !== 'string') return text;
        const whole = UPLOAD_VALUE_RE.exec(text);
        return whole && renames.has(whole[2]) ? `${whole[1]}${renames.get(whole[2])}` : text;
    };
    const html = (text) => (typeof text === 'string'
        ? value(text).replace(UPLOAD_IN_HTML_RE, (match, prefix, name) => (renames.has(name) ? `${prefix}${renames.get(name)}` : match))
        : text);
    return {
        ...course,
        lessons: course.lessons.map((lesson) => ({
            ...lesson,
            description: html(lesson.description),
            content: html(lesson.content),
            video_url: value(lesson.video_url),
            sections: lesson.sections.map((section) => ({
                ...section,
                content: html(section.content),
                file_url: value(section.file_url),
            })),
        })),
    };
}

/**
 * Check a course document from a package and return it normalised.
 *
 * @returns {{course: object}|{problem: string}}
 */
export function readCourseDocument(raw) {
    if (!isPlainObject(raw) || raw.format !== COURSE_DOCUMENT_FORMAT) return { problem: 'course.json is not a Rohy course document' };
    if (raw.format_version !== COURSE_DOCUMENT_VERSION) {
        return { problem: `course.json has format ${raw.format_version}; this server reads ${COURSE_DOCUMENT_VERSION}` };
    }
    const problems = [];
    const text = (v, where, max, { required = false } = {}) => {
        if (v === null || v === undefined) {
            if (required) problems.push(`${where} is required`);
            return null;
        }
        if (typeof v !== 'string' || v.length > max || (required && v.trim() === '')) {
            problems.push(`${where} must be ${required ? 'a non-empty ' : 'a '}text of at most ${max} characters`);
            return null;
        }
        return v;
    };
    const link = (v, where) => {
        const s = text(v, where, LIMITS.url);
        // A file of this server or a web address; never javascript: and friends.
        if (s !== null && !UPLOAD_VALUE_RE.test(s) && !/^https?:\/\//i.test(s)) {
            problems.push(`${where} must be an /uploads file or an http(s) address`);
            return null;
        }
        return s;
    };
    const int = (v, where) => {
        if (v === null || v === undefined) return null;
        if (!Number.isSafeInteger(v) || v < 0) { problems.push(`${where} must be a whole number`); return null; }
        return v;
    };
    const course = isPlainObject(raw.course) ? raw.course : (problems.push('course is missing'), {});
    const lessonsIn = Array.isArray(raw.lessons) ? raw.lessons : (problems.push('lessons must be a list'), []);
    if (lessonsIn.length > LIMITS.lessons) problems.push(`a course may carry at most ${LIMITS.lessons} lessons`);
    const out = {
        course: {
            name: text(course.name, 'course.name', LIMITS.name, { required: true })?.trim() ?? null,
            description: text(course.description, 'course.description', LIMITS.text),
        },
        lessons: lessonsIn.slice(0, LIMITS.lessons).map((lesson, i) => {
            const where = `lessons[${i}]`;
            if (!isPlainObject(lesson)) { problems.push(`${where} is malformed`); return null; }
            const sectionsIn = Array.isArray(lesson.sections ?? []) ? (lesson.sections ?? []) : (problems.push(`${where}.sections must be a list`), []);
            if (sectionsIn.length > LIMITS.sections) problems.push(`${where} carries more than ${LIMITS.sections} sections`);
            return {
                title: text(lesson.title, `${where}.title`, LIMITS.title, { required: true })?.trim() ?? null,
                description: text(lesson.description, `${where}.description`, LIMITS.text),
                content: text(lesson.content, `${where}.content`, LIMITS.text),
                content_type: text(lesson.content_type, `${where}.content_type`, LIMITS.type) ?? 'text',
                video_url: link(lesson.video_url, `${where}.video_url`),
                duration: int(lesson.duration, `${where}.duration`),
                order_index: int(lesson.order_index, `${where}.order_index`) ?? i,
                is_published: lesson.is_published === true,
                is_free: lesson.is_free === true,
                locked: lesson.locked === true,
                sections: sectionsIn.slice(0, LIMITS.sections).map((section, j) => {
                    const at = `${where}.sections[${j}]`;
                    if (!isPlainObject(section)) { problems.push(`${at} is malformed`); return null; }
                    return {
                        title: text(section.title, `${at}.title`, LIMITS.title),
                        type: text(section.type, `${at}.type`, LIMITS.type) ?? 'text',
                        content: text(section.content, `${at}.content`, LIMITS.text),
                        file_name: text(section.file_name, `${at}.file_name`, LIMITS.title),
                        file_url: link(section.file_url, `${at}.file_url`),
                        file_type: text(section.file_type, `${at}.file_type`, LIMITS.title),
                        file_size: int(section.file_size, `${at}.file_size`),
                        order_index: int(section.order_index, `${at}.order_index`) ?? j,
                    };
                }),
            };
        }),
    };
    if (problems.length > 0) return { problem: `course.json: ${problems.slice(0, 3).join('; ')}` };
    return { course: out };
}

/**
 * Create the course for an imported case, inside the import's transaction.
 *
 * @returns {Promise<{id: number, name: string, lessons: number, locked: number}>}
 */
export async function insertCourse({ tx, course, caseId, tenant, userId }) {
    const cohort = await tx.run(
        'INSERT INTO cohorts (name, owner_user_id, tenant_id, description) VALUES (?, ?, ?, ?)',
        [course.course.name, userId, tenant, course.course.description]
    );
    const cohortId = cohort.lastID;
    await tx.run('INSERT INTO cohort_cases (cohort_id, case_id) VALUES (?, ?)', [cohortId, caseId]);
    let locked = 0;
    for (const lesson of course.lessons) {
        const inserted = await tx.run(
            `INSERT INTO lessons
               (cohort_id, tenant_id, title, description, content, content_type, video_url, duration,
                order_index, is_published, is_free, unlock_case_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                cohortId, tenant, lesson.title,
                lesson.description !== null ? sanitizeLessonHtml(lesson.description) : null,
                lesson.content !== null ? sanitizeLessonHtml(lesson.content) : null,
                lesson.content_type, lesson.video_url, lesson.duration, lesson.order_index,
                lesson.is_published ? 1 : 0, lesson.is_free ? 1 : 0, lesson.locked ? caseId : null,
            ]
        );
        if (lesson.locked) locked += 1;
        for (const section of lesson.sections) {
            await tx.run(
                `INSERT INTO lesson_sections
                   (lesson_id, title, type, content, file_name, file_url, file_type, file_size, order_index)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    inserted.lastID, section.title, section.type,
                    section.content !== null ? sanitizeLessonHtml(section.content) : null,
                    section.file_name, section.file_url, section.file_type, section.file_size, section.order_index,
                ]
            );
        }
    }
    return { id: cohortId, name: course.course.name, lessons: course.lessons.length, locked };
}
