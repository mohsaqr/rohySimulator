// A case package carries the case's course: the lessons, their sections and
// files, and which lessons are locked behind the case. The import creates a new
// course for the new case, with the same locks and no learners.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, run, get, all, seedUser, asUser } from '../utils/authHttp.js';
import { createTarWriter, readTar } from '../../server/lib/tarStream.js';
import { courseUploadNames, rewriteCourseUploads, readCourseDocument } from '../../server/services/caseCourseTransfer.js';

const UPLOADS = join(process.cwd(), 'public', 'uploads');
const PNG = (tag) => Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.from(`png:${tag}`)]);
const PDF = (tag) => Buffer.from(`%PDF-1.4\n% ${tag}\n`);

async function poll(call, jobId) {
    for (let i = 0; i < 200; i++) {
        const job = await (await call(`/api/case-packages/jobs/${jobId}`)).json();
        if (job.state === 'done' || job.state === 'failed') return job;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('job did not finish');
}

async function exportPackage(call, caseId) {
    const started = await call(`/api/cases/${caseId}/package`, { method: 'POST' });
    const job = await poll(call, (await started.json()).id);
    expect(job.state).toBe('done');
    const bytes = Buffer.from(await (await call(`/api/case-packages/jobs/${job.id}/download`)).arrayBuffer());
    return { job, bytes };
}

async function importPackage(call, bytes) {
    const created = await call('/api/case-packages/uploads', { method: 'POST', json: { bytes: bytes.length } });
    const { id } = await created.json();
    const chunk = 64 * 1024;
    for (let i = 0, index = 0; i < bytes.length; i += chunk, index++) {
        await call(`/api/case-packages/uploads/${id}/chunks/${index}`, {
            method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes.subarray(i, i + chunk),
        });
    }
    const done = await call(`/api/case-packages/uploads/${id}/complete`, { method: 'POST' });
    return poll(call, (await done.json()).id);
}

/** The package's entries, in order, as [name, Buffer]. */
async function entriesOf(bytes) {
    const entries = [];
    await readTar([bytes], ({ name }) => {
        const chunks = [];
        return { write: (c) => chunks.push(Buffer.from(c)), end: () => entries.push([name, Buffer.concat(chunks)]) };
    });
    return entries;
}

async function repack(dir, entries) {
    const file = join(dir, `repack-${randomBytes(4).toString('hex')}.rohycase`);
    const writer = createTarWriter(createWriteStream(file));
    for (const [name, data] of entries) await writer.addBuffer(name, data);
    await writer.finish();
    return readFileSync(file);
}

describe('case packages: the case\'s course travels with it', () => {
    let fx; let source; let target; let srcAdmin; let tgtAdmin; let caseId; let pkg; let exportJob;
    const tag = randomBytes(5).toString('hex');
    const pngName = `course-${tag}.png`;
    const pdfName = `course-${tag}.pdf`;

    beforeAll(async () => {
        fx = mkdtempSync(join(tmpdir(), 'rohy-pkg-course-'));
        writeFileSync(join(UPLOADS, pngName), PNG(tag));
        writeFileSync(join(UPLOADS, pdfName), PDF(`source-${tag}`));
        [source, target] = await Promise.all([
            startTestServer({ seed: false, env: { ROHY_CASE_PACKAGE_DIR: join(fx, 'src-work') } }),
            startTestServer({ seed: false, env: { ROHY_CASE_PACKAGE_DIR: join(fx, 'tgt-work') } }),
        ]);
        for (const server of [source, target]) {
            const db = await openDb(server.dbPath);
            await seedUser(db, { username: 'course-admin', role: 'admin' });
            await closeDb(db);
        }
        srcAdmin = await asUser(source.baseUrl, 'course-admin');
        tgtAdmin = await asUser(target.baseUrl, 'course-admin');
        for (const call of [srcAdmin, tgtAdmin]) {
            await call('/api/platform-settings/case-packages', { method: 'PUT', json: { enabled: true } });
        }

        const newCase = async (name) => (await (await srcAdmin('/api/cases', {
            method: 'POST', json: { name, description: 'd', config: { patient_name: 'P', courseGate: { afterMinutes: 15 } } },
        })).json()).id;
        caseId = await newCase('Course case');
        const otherCaseId = await newCase('Other case');
        const cohortId = (await (await srcAdmin('/api/cohorts', {
            method: 'POST', json: { name: 'Patologia: Pentin tapaus', description: 'Kurssi' },
        })).json()).cohort.id;
        for (const id of [caseId, otherCaseId]) {
            expect((await srcAdmin(`/api/cases/${id}/course`, { method: 'PUT', json: { cohortId } })).status).toBe(200);
        }
        const lesson = async (title, content) => (await (await srcAdmin(`/api/courses/modules/${cohortId}/lectures`, {
            method: 'POST', json: { title, content, isPublished: true },
        })).json()).data.id;
        await lesson('Ohjeet', `<p><img src="/uploads/${pngName}"> and <a href="https://elsewhere.example/uploads/${pngName}">a copy elsewhere</a></p>`);
        const locked = await lesson('Vastaus', '<p>The answer.</p>');
        const otherLocked = await lesson('Toisen tapauksen vastaus', '<p>Another case\'s answer.</p>');
        await srcAdmin(`/api/courses/lectures/${locked}/sections`, {
            method: 'POST', json: { title: 'Liite', type: 'file', fileName: 'answer.pdf', fileUrl: `/uploads/${pdfName}`, fileType: 'application/pdf' },
        });
        await srcAdmin(`/api/courses/lectures/${locked}/sections`, {
            method: 'POST', json: { title: 'Teksti', type: 'text', content: `<p>See <a href="/uploads/${pdfName}">the report</a>.</p>` },
        });
        expect((await srcAdmin(`/api/cases/${caseId}/course-locks`, { method: 'PUT', json: { lessonIds: [locked] } })).status).toBe(200);
        expect((await srcAdmin(`/api/cases/${otherCaseId}/course-locks`, { method: 'PUT', json: { lessonIds: [otherLocked] } })).status).toBe(200);
        // A script that reached the database some other way than the lesson routes.
        const db = await openDb(source.dbPath);
        await run(db, `UPDATE lessons SET content = content || '<script>alert(1)</script>' WHERE id = ?`, [locked]);
        await closeDb(db);

        ({ job: exportJob, bytes: pkg } = await exportPackage(srcAdmin, caseId));
    }, 120000);

    afterAll(async () => {
        await Promise.all([source?.close(), target?.close()]);
        rmSync(join(UPLOADS, pngName), { force: true });
        if (existsSync(UPLOADS)) {
            readdirSync(UPLOADS).filter((name) => name.endsWith(pdfName)).forEach((name) => rmSync(join(UPLOADS, name), { force: true }));
        }
        if (fx) rmSync(fx, { recursive: true, force: true });
    });

    it('exports the course and the files its lessons use, not a lesson locked behind another case', async () => {
        expect(exportJob.result.counts.lessons).toBe(2);
        expect(exportJob.result.warnings.some((n) => n.received === 'Toisen tapauksen vastaus')).toBe(true);
        const entries = await entriesOf(pkg);
        expect(entries.slice(0, 3).map(([name]) => name)).toEqual(['case.json', 'manifest.json', 'course.json']);
        const manifest = JSON.parse(entries[1][1]);
        expect(manifest.course).toEqual({ lessons: 2 });
        expect(manifest.uploads.map((u) => u.name).sort()).toEqual([pdfName, pngName].sort());
        const course = JSON.parse(entries[2][1]);
        expect(course.course.name).toBe('Patologia: Pentin tapaus');
        expect(course.lessons.map((l) => [l.title, l.locked])).toEqual([['Ohjeet', false], ['Vastaus', true]]);
    });

    it('imports a new course for the new case: lessons, locks, files, renamed references, no scripts', async () => {
        // Regression lock: case packages left the course out, so an imported pathology case arrived without its lessons
        // The target already has a DIFFERENT file under the pdf's name: the import renames, and the lessons must follow.
        writeFileSync(join(UPLOADS, pdfName), PDF(`target-${tag}`));
        const job = await importPackage(tgtAdmin, pkg);
        expect(job.state).toBe('done');
        expect(job.result.course).toMatchObject({ name: 'Patologia: Pentin tapaus', lessons: 2, locked: 1 });
        expect(job.result.imported.lessons).toBe(2);

        const newCaseId = job.result.case.id;
        const db = await openDb(target.dbPath);
        const cohort = await get(db, 'SELECT id, name, owner_user_id FROM cohorts WHERE id = ?', [job.result.course.id]);
        const admin = await get(db, "SELECT id FROM users WHERE username = 'course-admin'", []);
        const link = await get(db, 'SELECT case_id FROM cohort_cases WHERE cohort_id = ? AND deleted_at IS NULL', [cohort.id]);
        const members = await get(db, 'SELECT COUNT(*) AS n FROM cohort_members WHERE cohort_id = ?', [cohort.id]);
        const lessons = await all(db, 'SELECT id, title, content, unlock_case_id, is_published FROM lessons WHERE cohort_id = ? ORDER BY order_index, id', [cohort.id]);
        const sections = await all(db, 'SELECT type, content, file_url FROM lesson_sections WHERE lesson_id = ? ORDER BY order_index, id', [lessons[1].id]);
        await closeDb(db);

        expect(cohort).toMatchObject({ name: 'Patologia: Pentin tapaus', owner_user_id: admin.id });
        expect(link.case_id).toBe(newCaseId);
        expect(members.n).toBe(0);
        expect(lessons.map((l) => [l.title, l.unlock_case_id, l.is_published])).toEqual([['Ohjeet', null, 1], ['Vastaus', newCaseId, 1]]);
        expect(lessons[1].content).not.toMatch(/<script/i);
        // Same bytes already here: the png keeps its name; a link to another host is not ours and is untouched.
        expect(lessons[0].content).toContain(`src="/uploads/${pngName}"`);
        expect(lessons[0].content).toContain(`https://elsewhere.example/uploads/${pngName}`);
        // Different bytes under the pdf's name: placed under a new name, and both references follow it.
        const renamed = sections[0].file_url;
        expect(renamed).toMatch(new RegExp(`^/uploads/pkg-[0-9a-f]{16}-${pdfName.replace('.', '\\.')}$`));
        expect(readFileSync(join(UPLOADS, renamed.slice('/uploads/'.length))).equals(PDF(`source-${tag}`))).toBe(true);
        expect(sections[1].content).toContain(`href="${renamed}"`);
        expect(readFileSync(join(UPLOADS, pdfName)).equals(PDF(`target-${tag}`))).toBe(true);
    });

    it('a second import of the same package names its course for the new case, remembering where it came from', async () => {
        // Regression lock: F22 re-importing FI-0010 made case FI-0011 with a course called exactly like the first import's
        const job = await importPackage(tgtAdmin, pkg);
        expect(job.state).toBe('done');
        const code = job.result.case.case_code;
        expect(job.result.course).toMatchObject({
            name: `Patologia: Pentin tapaus (${code})`, source_name: 'Patologia: Pentin tapaus', members: 0, lessons: 2, locked: 1,
        });
        expect(job.result.case.is_available).toBe(false);
        const db = await openDb(target.dbPath);
        const cohort = await get(db, 'SELECT name, settings FROM cohorts WHERE id = ?', [job.result.course.id]);
        const named = await all(db, "SELECT id FROM cohorts WHERE name = 'Patologia: Pentin tapaus' AND deleted_at IS NULL", []);
        await closeDb(db);
        expect(cohort.name).toBe(`Patologia: Pentin tapaus (${code})`);
        expect(JSON.parse(cohort.settings)).toEqual({
            imported_from: { case_code: exportJob.result.case_code, course_name: 'Patologia: Pentin tapaus' },
        });
        expect(named).toHaveLength(1); // only the first import's course carries the bare name
    });

    it('exports a case without a course as before: no course.json', async () => {
        const id = (await (await srcAdmin('/api/cases', { method: 'POST', json: { name: 'Lone case', description: 'd', config: { patient_name: 'P' } } })).json()).id;
        const { job, bytes } = await exportPackage(srcAdmin, id);
        expect(job.result.counts.lessons).toBe(0);
        const entries = await entriesOf(bytes);
        expect(entries.map(([name]) => name)).not.toContain('course.json');
        expect(JSON.parse(entries[1][1]).course).toBeUndefined();
    });

    it('refuses a package whose manifest promises a course it does not carry', async () => {
        const entries = (await entriesOf(pkg)).filter(([name]) => name !== 'course.json');
        const job = await importPackage(tgtAdmin, await repack(fx, entries));
        expect(job.state).toBe('failed');
        expect(job.error.code).toBe('invalid_case_package');
    });

    it('refuses a course that links a lesson to anything but a file here or a web address', async () => {
        const entries = await entriesOf(pkg);
        const course = JSON.parse(entries[2][1]);
        course.lessons[0].video_url = 'javascript:alert(1)';
        entries[2] = ['course.json', Buffer.from(JSON.stringify(course))];
        const db = await openDb(target.dbPath);
        const before = await get(db, 'SELECT COUNT(*) AS n FROM cohorts', []);
        await closeDb(db);
        const job = await importPackage(tgtAdmin, await repack(fx, entries));
        expect(job.state).toBe('failed');
        expect(job.error).toMatchObject({ code: 'invalid_case_package' });
        expect(job.error.error).toMatch(/video_url/);
        const db2 = await openDb(target.dbPath);
        expect((await get(db2, 'SELECT COUNT(*) AS n FROM cohorts', [])).n).toBe(before.n);
        await closeDb(db2);
    });
});

describe('course documents: which files are this server\'s', () => {
    const course = (content, extra = {}) => ({
        lessons: [{ description: null, content, video_url: null, sections: [], ...extra }],
    });

    it('finds files in attributes and url(), never on another host', () => {
        const doc = course('<img src="/uploads/a.png"><a href=\'./uploads/b.pdf\'>b</a><div style="background:url(/uploads/c.jpg)"></div>'
            + '<a href="https://x.example/uploads/d.png">d</a> /uploads/e.png in prose');
        expect(courseUploadNames(doc)).toEqual(['a.png', 'b.pdf', 'c.jpg']);
        expect(courseUploadNames(course(null, { video_url: '/uploads/v.mp4' }))).toEqual(['v.mp4']);
    });

    it('rewrites only the renamed file, keeping each reference\'s own prefix', () => {
        const doc = course('<img src="/uploads/a.png"><a href="./uploads/a.png">x</a><img src="/uploads/a.png.bak"><a href="https://x.example/uploads/a.png">y</a>');
        const out = rewriteCourseUploads(doc, [['/uploads/a.png', '/uploads/pkg-0123456789abcdef-a.png']]);
        expect(out.lessons[0].content).toBe('<img src="/uploads/pkg-0123456789abcdef-a.png"><a href="./uploads/pkg-0123456789abcdef-a.png">x</a>'
            + '<img src="/uploads/a.png.bak"><a href="https://x.example/uploads/a.png">y</a>');
    });

    it('names what is wrong with a malformed course document', () => {
        expect(readCourseDocument({ format: 'nope' }).problem).toMatch(/not a Rohy course/);
        const bad = readCourseDocument({ format: 'rohy.case-course', format_version: 1, course: { name: '' }, lessons: [{ title: 'x', sections: [{ file_url: 'file:///etc/passwd' }] }] });
        expect(bad.problem).toMatch(/course\.name/);
        expect(bad.problem).toMatch(/file_url/);
    });
});
