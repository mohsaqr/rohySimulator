#!/usr/bin/env node
/**
 * screenshot-shots.mjs — the pictures screenshots.html is built from. It lives
 * beside the page builders rather than under scripts/ because it is website
 * tooling: its BASE / ONLY / PROBE variables are for this tool, not platform
 * configuration, and the config reference is generated from scripts/**.
 *
 *   npm run dev                                   # in another terminal
 *   node website/screenshot-shots.mjs               # every scene
 *   ONLY=login,patient-room node website/screenshot-shots.mjs
 *   PROBE=1 ONLY=ecg-studio node website/screenshot-shots.mjs   # also dump the
 *                                                 # accessibility tree per scene
 *
 * One Chromium, one page, the dev server at BASE (default http://localhost:5173),
 * driven the way a person drives it: sign in as the seeded admin, load a case,
 * then open each surface and photograph it. Every scene lands as
 * website/assets/screenshots/<name>.png and shots.json records the caption and
 * section for each. A scene that throws is reported and skipped, so a missing
 * picture is never silent; the build then refuses a page that references it.
 *
 * Nothing here writes outside website/assets/screenshots and the scratch probe
 * directory. The seeded dev database is what it runs against — a session is
 * started, orders are placed, a case is edited; do not point it at production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const OUT = path.join(repo, 'website', 'assets', 'screenshots');
const MINI = path.join(OUT, 'mini');
const PROBE_DIR = process.env.PROBE_DIR || path.join(repo, 'tmp', 'screenshots-probe');
fs.mkdirSync(MINI, { recursive: true });
if (process.env.PROBE) fs.mkdirSync(PROBE_DIR, { recursive: true });

const BASE = process.env.BASE || 'http://localhost:5173';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const W = 1440; const H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-GB' });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

// ── harness ────────────────────────────────────────────────────────────────
const shots = []; const failed = [];
const existing = fs.existsSync(path.join(OUT, 'shots.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'shots.json'), 'utf8')).shots : [];

const btn = (name, opts = {}) => page.getByRole('button', { name, ...opts });
const tab = (name) => page.getByRole('tab', { name });
const menuItem = (name) => page.getByRole('menuitem', { name });

async function settle(ms = 700) { await sleep(ms); }

/** The header's settings/profile menu, then one of its items. */
async function menu(item) {
    await btn('Settings and profile menu').first().click();
    await menuItem(item).click();
    await settle();
}
/** A tab in the full-page settings' left nav. */
async function settingsTab(label) {
    const nav = page.locator('.rohy-settings-nav-item, nav button, aside button').filter({ hasText: new RegExp(`^${label}$`) });
    if (await nav.count()) await nav.first().click();
    else await btn(label, { exact: true }).first().click();
    await settle();
}
async function openSettings() {
    if (!(await page.getByRole('heading', { name: /Settings & Administration/ }).isVisible().catch(() => false))) {
        await menu('Open Settings');
    }
}
async function backToSimulation() {
    const b = btn('Back to Simulation');
    if (await b.isVisible().catch(() => false)) { await b.click(); await settle(); }
}
async function room(label) {
    // Full surfaces (Course, analytics) replace the navigator; leave them first.
    const back = page.getByRole('button', { name: /^Back to simulation$/i }).first();
    if (await back.isVisible().catch(() => false)) { await back.click(); await settle(600); }
    const inNav = page.getByRole('navigation', { name: 'Room navigation' }).getByRole('button', { name: label });
    if (await inNav.count()) await inNav.click(); else await btn(label, { exact: true }).first().click();
    await settle(900);
}
async function escapeAll() {
    // Close whatever is open on top: a dialog through its own close button,
    // any panel through its × (lucide-x) icon, else Escape. Three rounds
    // cover a modal over a drawer over a menu.
    for (let i = 0; i < 3; i += 1) {
        // An open menu (the header's settings menu) has no dialog role and no ×;
        // its trigger reports aria-expanded, and clicking it again closes it.
        // Escape first: a click on the trigger races the menu's own
        // click-outside handler and toggles it straight back open.
        const trigger = page.locator('button[aria-expanded="true"]:visible').first();
        if (await trigger.isVisible().catch(() => false)) {
            await page.keyboard.press('Escape').catch(() => {});
            await sleep(250);
            if (await trigger.isVisible().catch(() => false)) { await trigger.click({ timeout: 3000 }).catch(() => {}); await sleep(250); }
            continue;
        }
        const dialog = page.getByRole('dialog').last();
        const x = page.locator('button:has(svg.lucide-x):visible, button[aria-label="Close"]:visible, button[aria-label="Close help"]:visible').last();
        if (await dialog.isVisible().catch(() => false)) {
            const close = dialog.getByRole('button', { name: /^(close|close help|cancel|done|dismiss|skip|×|✕)$/i }).first();
            if (await close.isVisible().catch(() => false)) await close.click({ timeout: 3000 }).catch(() => {});
            else await page.keyboard.press('Escape').catch(() => {});
        } else if (await x.isVisible().catch(() => false)) {
            await x.click({ timeout: 3000 }).catch(() => {});
        } else {
            await page.keyboard.press('Escape').catch(() => {});
            break;
        }
        await sleep(350);
    }
}
/** The Simulator Controls drawer closes through its own × (it is a side panel, not a modal). */
async function closeSimulator() {
    const heading = page.getByRole('heading', { name: 'Simulator Controls' });
    if (await heading.isVisible().catch(() => false)) {
        await heading.locator('xpath=..').getByRole('button').first().click({ timeout: 3000 }).catch(() => {});
        await settle(400);
    }
}
async function probe(name) {
    if (!process.env.PROBE) return;
    const tree = await page.locator('body').ariaSnapshot();
    fs.writeFileSync(path.join(PROBE_DIR, `${name}.yml`), tree);
}
/**
 * Screenshot as PNG, then WebP when cwebp is on the PATH (q 90 is visually
 * lossless on UI and 5–10× smaller; 94 PNGs weighed 16 MB). Returns the file
 * name the manifest records, so the builder never guesses the extension.
 */
async function shot(name, { clip } = {}) {
    // The floating "Diag" pill is the admin's diagnostic-bar toggle; it sits
    // in the corner of every admin screen and says nothing about the surface
    // being photographed, so it is hidden for the picture. Injected per shot
    // because a navigation drops the stylesheet.
    await page.addStyleTag({ content: 'button[aria-label="Show diagnostic bar"]{display:none!important}' }).catch(() => {});
    const png = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: png, clip, animations: 'disabled', timeout: 60_000 });
    try {
        execFileSync('cwebp', ['-quiet', '-q', '90', png, '-o', path.join(OUT, `${name}.webp`)]);
        // A 480 px miniature beside it, for the room cards and the tiles on
        // the hand-written pages (index.html, rooms.html), which show the
        // screens small and tinted and only load the full picture on click.
        execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '480', '0', png, '-o', path.join(MINI, `${name}.webp`)]);
        fs.unlinkSync(png);
        return `${name}.webp`;
    } catch {
        return `${name}.png`;
    }
}

async function scene(name, section, caption, fn) {
    if (ONLY && !ONLY.has(name)) {
        const prior = existing.find((s) => s.name === name);
        if (prior && fs.existsSync(path.join(OUT, prior.file ?? `${name}.png`))) shots.push(prior);
        return;
    }
    const before = pageErrors.length;
    try {
        await fn();
        const file = await shot(name);
        await probe(name);
        shots.push({ name, file, section, caption });
        const errs = pageErrors.slice(before);
        console.log(`  ✓ ${name}${errs.length ? `  (${errs.length} page error(s): ${errs[0].slice(0, 120)})` : ''}`);
    } catch (e) {
        failed.push({ name, error: String(e.message || e).split('\n')[0] });
        console.log(`  ✗ ${name}: ${String(e.message || e).split('\n')[0]}`);
        await probe(`${name}.failed`);
        await shot(`${name}.failed`).catch(() => {});
    }
}

// ── sign in, fresh session ─────────────────────────────────────────────────
await page.goto(BASE);
await page.getByPlaceholder('Enter your username').fill(process.env.ROHY_USER || 'admin');
await page.getByPlaceholder('Enter your password').fill(process.env.ROHY_PASS || 'admin123');

await scene('login', 'signing-in', 'The sign-in page: six interface languages, an account, an invitation code', async () => {
    await settle(400);
});

await btn('Sign In').click();
await page.getByRole('navigation', { name: 'Room navigation' }).waitFor({ timeout: 30_000 });
await settle(1200);
// A restored surface from an earlier visit (Oyon dashboard, settings) is closed.
if (await page.getByRole('heading', { name: 'Oyon Dashboard' }).isVisible().catch(() => false)) {
    await page.getByRole('banner').getByRole('button', { name: 'Close' }).first().click();
}
// A fresh browser gets the guided tour; it is a scene, then it is skipped.
await scene('getting-started', 'signing-in', 'The guided tour on first sign-in: a few steps over the rooms, the monitor and the debrief, skippable and recallable from Help', async () => {
    await page.getByRole('dialog', { name: 'Getting started' }).waitFor({ timeout: 5000 });
    await settle(400);
});
async function skipTour() {
    const dialog = page.getByRole('dialog', { name: 'Getting started' });
    if (await dialog.isVisible().catch(() => false)) {
        const skip = dialog.getByRole('button', { name: /^(Skip|Done)$/ }).first();
        if (await skip.isVisible().catch(() => false)) await skip.click(); else await page.keyboard.press('Escape');
        await settle(400);
    }
}
await skipTour();
await backToSimulation();

// Start the first case afresh so the session clock and the transcript are clean.
async function loadCase(index = 0) {
    await openSettings();
    await settingsTab('Cases');
    await btn('Load').nth(index).click();
    await page.getByRole('navigation', { name: 'Room navigation' }).waitFor({ timeout: 30_000 });
    await settle(1500);
}
await loadCase(0);

// ── the patient room ───────────────────────────────────────────────────────
await scene('patient-room', 'patient', 'The Patient room: the avatar, the transcript, and the live monitor with its ECG, pleth and respiration traces', async () => {
    await room('Patient').catch(() => {});
    await escapeAll();
    await settle(800);
});

await scene('patient-menu', 'patient', 'The settings and profile menu: cases, profile, settings, help, language, the three analytics surfaces and the setup wizard', async () => {
    await btn('Settings and profile menu').first().click();
    await settle(300);
});
await escapeAll();

await scene('chat-turn', 'patient', 'A history question typed to the patient; the reply arrives from the configured language model with the persona and the case in play', async () => {
    const box = page.getByPlaceholder(/Message /);
    // The reply comes back through the LLM proxy; wait for that response
    // rather than a guess at how long the configured model thinks. A
    // deployment without a model shows the error honestly, and so does this.
    const reply = page.waitForResponse((r) => r.url().includes('/api/proxy/llm'), { timeout: 240_000 }).catch(() => null);
    await box.fill('Hello, what brings you in today? When did the pain start?');
    await box.press('Enter');
    await page.getByText(/what brings you in today/).waitFor({ timeout: 10_000 });
    await reply;
    await settle(2500);
});

await scene('voice-mode', 'patient', 'Voice mode: speak to the patient, hear the reply through the configured voice, with subtitles', async () => {
    await btn('Voice').first().click();
    await settle(800);
});
await btn('Voice').first().click().catch(() => {});
await settle(300);

await closeSimulator();
await escapeAll();
await scene('monitor-settings', 'patient', 'Monitor settings: which traces and parameters the learner sees', async () => {
    await btn('Monitor Settings').first().click();
    await settle(600);
});
await escapeAll();

for (const [name, label, caption] of [
    ['sim-rhythm', 'rhythm', 'Simulator controls — rhythm: the educator switches the patient to any of ten rhythms while the learner watches'],
    ['sim-vitals', 'vitals', 'Simulator controls — vitals: every parameter on a slider, changes ramp over the chosen time'],
    ['sim-scenarios', 'scenarios', 'Simulator controls — scenarios: timed deterioration and recovery steps, paused, resumed or jumped'],
    ['sim-alarms', 'alarms', 'Simulator controls — alarms'],
    ['sim-labs', 'labs', 'Simulator controls — labs: release or edit a result during the session'],
]) {
    await scene(name, 'simulator', caption, async () => {
        const panel = page.getByRole('heading', { name: 'Simulator Controls' });
        if (!(await panel.isVisible().catch(() => false))) {
            await page.locator('button[aria-label*="imulator" i], button:has(svg.lucide-sliders-horizontal), button:has(svg.lucide-settings-2)').first().click();
            await settle(500);
        }
        await btn(label, { exact: true }).first().click();
        await settle(500);
    });
}
await closeSimulator();
await escapeAll();

// ── orders drawer ──────────────────────────────────────────────────────────
await scene('orders-treatments', 'orders', 'The order entry drawer — Treatments: medications, IV fluids, oxygen and nursing orders, searched from the catalogue', async () => {
    await btn('Treatments').first().click();
    await settle(700);
});
await scene('orders-medications-search', 'orders', 'Searching the medication catalogue; each entry carries its dose, route and the effects the physiology engine will apply', async () => {
    await page.getByPlaceholder('Search medications...').fill('aspirin');
    await settle(700);
});
await scene('orders-records', 'orders', 'The Records tab: the patient record the learner has assembled — history, findings, results, notes', async () => {
    await btn('Records').first().click();
    await settle(700);
});
await scene('orders-memory', 'orders', 'The Memory tab (admin): what the patient model remembers of the encounter so far', async () => {
    await btn('Memory').first().click();
    await settle(700);
});
await btn('Close').first().click().catch(() => {});
await escapeAll();

// ── the other rooms ────────────────────────────────────────────────────────
// Orders go in first so their results are ready by the time the rooms are
// revisited below: lab turnaround is minutes, imaging one minute, and an
// imaging order is what makes the PACS room appear in the navigator.
await scene('laboratory', 'rooms', 'The Laboratory room: 200 tests in the catalogue, grouped and searchable; ordering is one click, results arrive on the test\'s own turnaround', async () => {
    await room('Laboratory');
    await settle(1200);
});
await scene('laboratory-order', 'rooms', 'Four tests ticked and ordered: the worklist shows them pending with their turnaround', async () => {
    for (const name of [/^Hemoglobin/, /^White Blood Cell/, /^Platelet Count/]) {
        await page.getByRole('checkbox', { name }).first().click();
        await settle(300);
    }
    const search = page.getByPlaceholder(/Search tests/);
    await search.fill('troponin');
    await settle(500);
    await page.getByRole('checkbox', { name: /troponin/i }).first().click();
    await search.fill('');
    await settle(400);
    await btn(/^Order \d+ tests?$/).first().click();
    await settle(1200);
});
await scene('laboratory-results', 'rooms', 'Results ready: the worklist turns green and the report opens in the middle pane with reference ranges and flags. "Order instantly" is the educator\'s shortcut past the turnaround', async () => {
    const search = page.getByPlaceholder(/Search tests/);
    await search.fill('potassium');
    await settle(500);
    await page.getByRole('checkbox', { name: /potassium/i }).first().click();
    await search.fill('');
    await settle(300);
    await btn('Order instantly').first().click();
    await settle(1500);
    const ready = page.getByRole('button', { name: /potassium/i }).first();
    if (await ready.isVisible().catch(() => false)) await ready.click();
    await settle(1200);
});
await scene('radiology', 'rooms', 'The Radiology room: the imaging and diagnostics catalogue, X-ray to MRI, each with a turnaround', async () => {
    await room('Radiology');
    await settle(1200);
});
await scene('radiology-report', 'rooms', 'A chest X-ray ordered and reported: the radiologist\'s text as the case author wrote it', async () => {
    await page.getByRole('checkbox', { name: /^Chest X-Ray \(PA\/Lateral\)/ }).first().click();
    await settle(400);
    await btn('Order instantly').first().click();
    await settle(1500);
    const ready = page.getByRole('button', { name: /Chest X-Ray/i }).first();
    if (await ready.isVisible().catch(() => false)) await ready.click();
    await settle(1200);
});
await scene('pacs', 'rooms', 'The PACS room, which appeared in the navigator the moment imaging was ordered: the study in a DICOM reading room with a series rail, window presets, measurements and a report pane', async () => {
    await room('PACS');
    await settle(6000);
});
await scene('pacs-study', 'rooms', 'The second series of the study and a sigmoid transfer function: the reading room keeps window, level, gamma and edge enhancement per pane, and measurements stay in acquired units', async () => {
    await btn(/Lateral Chest/).first().click();
    await settle(2500);
    await btn('Sigmoid', { exact: true }).first().click();
    await settle(2500);
});
await scene('ecg-room', 'rooms', 'The 12-lead ECG room: the admission tracing on calibrated paper with gain, speed, filter and caliper controls, lead topography and a measurement list', async () => {
    await room('12-lead ECG');
    await settle(2500);
});
await scene('ecg-caliper', 'rooms', 'An interval caliper spanning two points of the rhythm strip, and the Measure tab where every caliper the learner places is kept with its classification', async () => {
    await tab('Measure').click();
    await settle(500);
    // Two clicks on the lead II rhythm strip span an interval.
    await page.mouse.click(300, 590);
    await settle(300);
    await page.mouse.click(372, 590);
    await settle(900);
});

await scene('examination', 'rooms', 'The Examination room: a body map, front and back, general and neurological exams', async () => {
    await room('Examination');
    await settle(1200);
});
await scene('examination-region', 'rooms', 'A region chosen on the body map: the exam types it offers, and the findings the case holds for it', async () => {
    const body = page.locator('img[alt="male body anterior view"], img[alt="female body anterior view"]').first();
    const box = await body.boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.27);
    await settle(1200);
});
await scene('examination-finding', 'rooms', 'An examination performed: the finding is recorded in the log and in the patient record', async () => {
    const act = page.getByRole('button', { name: /auscultat|palpat|inspect|percuss|examine/i }).first();
    await act.click({ timeout: 5000 });
    await settle(1500);
});
await scene('consultant', 'rooms', 'The Consultant room: present the case to a senior colleague who knows only what the learner tells them', async () => {
    await room('Consultant');
    await settle(1200);
});
await scene('course', 'rooms', 'The Course room: the learner\'s course with its lessons and surveys, as cards or a list', async () => {
    await room('Course');
    await settle(1500);
});
await scene('course-lesson', 'rooms', 'A lesson opened: sections, video and reading, with progress kept per learner', async () => {
    await btn(/^STEMI: Recognition/).first().click();
    await settle(2500);
});
await scene('bedside', 'rooms', 'The Bedside room: the patient in 3D at the bedside, examined by walking around the bed', async () => {
    await room('Bedside');
    // The ward and the patient model stream in after the room mounts; with
    // software GL the patient is the last to appear.
    await settle(14000);
});
await room('Patient').catch(() => {});

// ── help and profile ───────────────────────────────────────────────────────
await scene('help-centre', 'patient', 'Help & Support: role-gated articles that open the documentation', async () => {
    await menu('Help & Support');
    await settle(800);
});
await escapeAll();
await scene('profile', 'patient', 'My Profile: account, personal details and the dialogue language for this user\'s sessions', async () => {
    await menu('My Profile');
    await settle(800);
});
for (const [name, label, caption] of [
    ['profile-password', 'Password', 'My Profile — Password: the same policy the server enforces, mirrored in the form'],
    ['profile-ai', 'AI Settings', 'My Profile — AI settings: a per-user provider and model, baked into each new session'],
    ['profile-join', 'Join a class', 'My Profile — Join a class: an invitation code enrols the learner in a course'],
]) {
    await scene(name, 'patient', caption, async () => {
        await btn(label, { exact: true }).first().click();
        await settle(600);
    });
}
await escapeAll();
await backToSimulation();

// ── settings ───────────────────────────────────────────────────────────────
const SETTINGS = [
    ['settings-overview', 'Overview', 'Settings — Overview: the platform at a glance'],
    ['settings-cases', 'Cases', 'Settings — Cases: every case with its course, a default, load, export, duplicate and edit'],
    ['settings-scenarios', 'Scenarios', 'Settings — Scenarios: the deterioration scripts a case can run'],
    ['settings-agents', 'Agents', 'Settings — Agents: the care team personas — nurse, consultant, relative, discussant — each with a knowledge boundary'],
    ['settings-avatars', 'Avatars', 'Settings — Avatars: the patient faces, framing and animation'],
    ['settings-voice', 'Voice', 'Settings — Voice: every engine and every voice per language; the voice owns its engine'],
    ['settings-affect', 'Affect', 'Settings — Affect: how Oyon\'s emotion signal reaches the patient model, off by default'],
    ['settings-users', 'Users', 'Settings — Users: accounts, roles, status, invitations and the registration policy'],
    ['settings-courses', 'Courses', 'Settings — Courses: cohorts, their members, their cases, and reports'],
    ['settings-lessons', 'Lessons', 'Settings — Lessons: authoring lectures and videos for the Course room'],
    ['settings-oyon', 'Oyon', 'Settings — Oyon: consent, capture, on-device models and the analytics that read them'],
    ['settings-logs', 'Logs', 'Settings — Logs: sessions, activity, chat, system and rejected events, filterable and exportable'],
    ['settings-bodymap', 'Body Map', 'Settings — Body Map: the examination regions and what each reveals'],
    ['settings-labdb', 'Lab Database', 'Settings — Lab Database: the LOINC-mapped catalogue behind the Laboratory room'],
    ['settings-medications', 'Medications', 'Settings — Medications: the drug catalogue with doses, routes and physiologic effects'],
    ['settings-treatments', 'Treatments', 'Settings — Treatments library: interventions a case can expect or forbid'],
    ['settings-platform', 'Platform', 'Settings — Platform: general, AI provider and model, users, monitor'],
    ['settings-plugins', 'Plugins', 'Settings — Plugins: the installed rooms, their versions, content and per-tenant switches'],
    ['settings-notifications', 'Notifications', 'Settings — Notifications: one centre, six surfaces; every source routed per severity'],
];
await openSettings();
for (const [name, label, caption] of SETTINGS) {
    await scene(name, 'settings', caption, async () => {
        await openSettings();
        await settingsTab(label);
        await settle(1200);
    });
}

await scene('settings-platform-ai', 'settings', 'Platform — AI: provider, model from the curated catalogue, keys, and per-voice-mode model swap', async () => {
    await settingsTab('Platform');
    await btn('AI / LLM', { exact: true }).first().click();
    await settle(800);
});

// ── the case editor ────────────────────────────────────────────────────────
const STEPS = [
    ['case-demographics', '👤 Demographics', 'Case editor — Demographics: identity, measurements, contact'],
    ['case-avatar-voice', '🎭 Avatar & Voice', 'Case editor — Avatar & Voice: the face and the literal voice this patient speaks with'],
    ['case-story', '📖 Story', 'Case editor — Story: presentation, history, what the patient knows and withholds'],
    ['case-scenario', '📈 Scenario', 'Case editor — Scenario: timed physiological steps'],
    ['case-vitals', '💓 Vitals', 'Case editor — Vitals: the starting physiology and the rhythm'],
    ['case-labs', '🧪 Labs', 'Case editor — Labs: values for this patient, the rest of the catalogue stays available'],
    ['case-radiology', '📷 Radiology & diagnostics', 'Case editor — Radiology & diagnostics: reports per study'],
    ['case-exam', '🩺 Exam', 'Case editor — Exam: findings per region and exam type'],
    ['case-records', '📄 Records', 'Case editor — Records: the chart the learner can open'],
    ['case-treatments', '💊 Treatments', 'Case editor — Treatments: expected, contraindicated, and their effects'],
    ['case-agents', '🤖 Agents', 'Case editor — Agents: which care-team personas this case pages in, and how fast they arrive'],
    ['case-plugins', '🧩 Plugins', 'Case editor — Plugins: the ECG studio, the pathology editor and the imaging editor, each authoring material that travels with the case'],
];
await scene('case-editor', 'authoring', 'Editing a case: twelve steps in a rail, save as you go', async () => {
    await openSettings();
    await settingsTab('Cases');
    await btn('Edit').first().click();
    await settle(1200);
});
for (const [name, label, caption] of STEPS) {
    await scene(name, 'authoring', caption, async () => {
        await btn(label).first().click();
        await settle(900);
    });
}
for (const [name, heading, caption] of [
    ['ecg-studio', 'ECG case studio', 'The ECG case studio: a 12-lead record built from a rhythm preset, a seed and a patient'],
    ['pathology-editor', 'Pathology case editor', 'The pathology case editor: slides from the starter archive, a task, an answer key and regions of interest'],
    ['imaging-editor', 'Imaging case editor', 'The imaging case editor: a worklist built from the DICOM archive, with substitutions per case'],
]) {
    await scene(name, 'authoring', caption, async () => {
        // Each editor is reached from the Plugins step of the case editor;
        // leaving one (Discard) returns to the case list, so the path is
        // walked again for every editor.
        await openSettings();
        await settingsTab('Cases');
        if (!(await btn('🧩 Plugins').first().isVisible().catch(() => false))) {
            await btn('Edit').first().click();
            await settle(1000);
        }
        await btn('🧩 Plugins').first().click();
        await settle(500);
        // The card is the nearest ancestor of the heading that holds an
        // "Open editor" button; a looser container match picks the first card.
        await page.getByRole('heading', { name: heading })
            .locator('xpath=ancestor::*[.//button[normalize-space()="Open editor"]][1]')
            .getByRole('button', { name: 'Open editor' }).click();
        await settle(3000);
    });
    await btn('Discard').first().click({ timeout: 3000 }).catch(() => {});
    await settle(600);
    await btn('Cancel').first().click({ timeout: 2000 }).catch(() => {});
    await settle(400);
}
await btn('Exit').first().click().catch(() => {});
await btn('Cancel').first().click().catch(() => {});
await settle(400);

// ── analytics ──────────────────────────────────────────────────────────────
const TNA = [
    ['analytics-activity', 'Activity', 'Analytics — Activity: every learning event, filtered by course, case, learner, dates and room'],
    ['analytics-network', 'Network', 'Analytics — Network: the transition network of clinical states, with edge weights and centralities'],
    ['analytics-patterns', 'Patterns', 'Analytics — Patterns: frequent sequences and their support'],
    ['analytics-process', 'Process Map', 'Analytics — Process map: the paths learners take between rooms and acts'],
    ['analytics-clusters', 'Clusters', 'Analytics — Clusters: learners grouped by how they reason'],
    ['analytics-attention', 'Attention', 'Analytics — Attention: Oyon\'s gaze and engagement over the session'],
    ['analytics-affect', 'Affect', 'Analytics — Affect: emotion over the timeline of the encounter'],
    ['analytics-gaze', 'Gaze', 'Analytics — Gaze: where the learner looked, per screen, each grid drawn over a miniature of that room'],
    ['analytics-compare', 'Compare', 'Analytics — Compare: two cohorts or two learners side by side'],
];
await backToSimulation();
await scene('analytics', 'analytics', 'Case analytics: the transition-network dashboard over every learning event, with the same course, case, learner, date and room filters on every tab', async () => {
    await menu('Case Analytics');
    await settle(3000);
});
for (const [name, label, caption] of TNA) {
    await scene(name, 'analytics', caption, async () => {
        // With ONLY= the 'analytics' scene that opens the dashboard is skipped.
        if (!(await btn(label, { exact: true }).first().isVisible().catch(() => false))) {
            await backToSimulation();
            await menu('Case Analytics');
            await settle(3000);
        }
        await btn(label, { exact: true }).first().click();
        await settle(3000);
        // The Gaze tab's picture is its per-screen maps, further down the page.
        if (name === 'analytics-gaze') {
            const maps = page.getByText('Gaze maps by screen').first();
            if (await maps.isVisible().catch(() => false)) { await maps.scrollIntoViewIfNeeded(); await settle(800); }
        }
    });
}
await scene('analytics-sessions', 'analytics', 'Analytics — Sessions: every session with its learner, case, length and event count', async () => {
    await btn('Sessions', { exact: true }).first().click();
    await settle(2000);
});
await scene('analytics-settings', 'analytics', 'Analytics — Settings: the lens, the merge rules and the thresholds the network is built with', async () => {
    await btn('Settings', { exact: true }).first().click();
    await settle(1500);
});
await page.getByRole('heading', { name: 'Analytics' }).locator('xpath=preceding-sibling::button[1]').click().catch(() => {});
await settle(800);
await escapeAll();
await scene('cohort-reports', 'analytics', 'Cohort reports: completion, pulse and debrief per course', async () => {
    await openSettings();
    await settingsTab('Courses');
    await settle(800);
    const rep = page.getByRole('button', { name: /report/i }).first();
    if (await rep.isVisible().catch(() => false)) { await rep.click(); await settle(2000); }
});

await backToSimulation();
await scene('oyon-dashboard', 'oyon', 'The Oyon dashboard: affect, dynamics, patterns, typing, voice, attention, gaze, position, heart and breathing — from the on-device signals only', async () => {
    await menu('Oyon Dashboard');
    await settle(2000);
    // The dashboard opens on the most recent session; the picture wants the
    // one with the most windows. Options read "<who> · <session> · <count>".
    const picker = page.getByRole('banner').getByRole('combobox').first();
    if (await picker.isVisible().catch(() => false)) {
        const options = await picker.locator('option').evaluateAll((els) => els.map((o) => ({ value: o.value, count: Number(o.textContent.trim().split('·').pop()) || 0 })));
        const richest = options.sort((a, b) => b.count - a.count)[0];
        if (richest) { await picker.selectOption(richest.value); await settle(1500); }
    }
});
for (const [name, label, caption] of [
    ['oyon-dynamics', 'Dynamics', 'Oyon — Dynamics: affect speed and instability over the session'],
    ['oyon-attention', 'Attention & engagement', 'Oyon — Attention & engagement'],
    ['oyon-gaze', 'Gaze', 'Oyon — Gaze: fixations per area of interest'],
    ['oyon-heart', 'Heart & breathing', 'Oyon — Heart & breathing, estimated from the face'],
    ['oyon-comparison', 'Comparison', 'Oyon — Comparison across sessions'],
]) {
    await scene(name, 'oyon', caption, async () => {
        if (!(await tab(label).isVisible().catch(() => false))) {
            await backToSimulation();
            await menu('Oyon Dashboard');
            await settle(2000);
        }
        await tab(label).click();
        await settle(1500);
    });
}
await btn('Close').first().click().catch(() => {});
await scene('emotion-analytics', 'oyon', 'Emotion analytics: the affect timeline of the current session', async () => {
    await menu('Emotion Analytics');
    await settle(2000);
});
await btn('Close').first().click().catch(() => {});
await escapeAll();

// ── setup wizard ───────────────────────────────────────────────────────────
await scene('setup-wizard', 'setup', 'The platform setup wizard: six steps from language and AI provider to the first course, recallable from the menu', async () => {
    await menu('Platform setup');
    await settle(1200);
});
await escapeAll();
await btn('Finish later').first().click().catch(() => {});
await btn('Close').first().click().catch(() => {});

// ── end and debrief (last: it ends the session) ────────────────────────────
await scene('end-confirm', 'debrief', 'Ending the session asks first', async () => {
    await room('Patient').catch(() => {});
    await btn('End & Debrief').click();
    await settle(600);
});
await scene('debrief', 'debrief', 'The debrief: the encounter summary, a discussant persona, and the learner\'s notes — with the encounter record when the educator allows it', async () => {
    const confirm = page.getByRole('button', { name: /end|debrief|confirm|yes/i }).last();
    await confirm.click();
    await settle(3000);
    // The debrief opens in the Consultant room; starting it brings the
    // discussant in through the same LLM proxy as the patient.
    const start = btn('Start debrief').first();
    if (await start.isVisible().catch(() => false)) {
        const reply = page.waitForResponse((r) => r.url().includes('/api/proxy/llm'), { timeout: 120_000 }).catch(() => null);
        await start.click();
        await reply;
        await settle(2500);
    }
});

// ── done ───────────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ base: BASE, viewport: { width: W, height: H }, takenAt: new Date().toISOString(), shots }, null, 2) + '\n');
await browser.close();
console.log(`\n${shots.length} shot(s) in ${path.relative(repo, OUT)}${failed.length ? `, ${failed.length} failed:` : ''}`);
for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
if (pageErrors.length) console.log(`${pageErrors.length} page error(s) during the run; first: ${pageErrors[0].slice(0, 200)}`);
process.exit(failed.length ? 1 : 0);
