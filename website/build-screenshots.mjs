#!/usr/bin/env node
// build-screenshots.mjs — website/screenshots.html, from the screenshots that
// website/screenshot-shots.mjs takes and the captions it records.
//
//   node website/screenshot-shots.mjs     # against a running dev server
//   node website/build-screenshots.mjs     # this file
//
// The page is a gallery in sections: every picture is the real application,
// driven the way a person drives it, and every caption is written here once
// per scene (in the shot script) and once per section (below). A scene the
// script recorded but whose PNG is missing fails the build, so the page never
// links a picture that is not there; a section with no pictures is dropped.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, shell, subnavHtml } from './build-docs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, 'assets', 'screenshots');
const OUT = join(HERE, 'screenshots.html');

const manifest = JSON.parse(readFileSync(join(ASSETS, 'shots.json'), 'utf8'));

// The page. Each section has a title, a short paragraph and two or three
// scenes chosen from the manifest by name, with the caption written here.
// The shot script records every scene it takes; this list decides which of
// them the page shows.
const PAGE = [
    ['signing-in', 'Signing in',
        'The sign-in page offers six interface languages. A new account can be created directly or with an invitation code from a course. On the first visit a short guided tour points out the rooms, the monitor and the debrief.',
        [
            ['login', 'The sign-in page in English. Italian, Finnish, Swedish, German and Spanish are available from the language menu.'],
            ['getting-started', 'The guided tour shown on the first sign-in. It can be skipped and reopened later from Help & Support.'],
        ]],
    ['patient', 'The Patient room',
        'The Patient room shows the avatar, the conversation and the live monitor on one screen. The patient answers through the configured language model. The monitor traces ECG, plethysmograph and respiration and updates the vital signs as the case progresses.',
        [
            ['patient-room', 'The Patient room at the start of a session with John Martinez, a 55-year-old man with acute chest pain. The monitor shows sinus tachycardia at 110 bpm, SpO2 94% and blood pressure 160/95.'],
            ['chat-turn', 'A typed history question and the patient\'s reply. Every message is logged for the debrief and for the analytics.'],
            ['voice-mode', 'Voice mode. The learner holds the button or the space bar to speak, and the patient answers with the voice configured for the case.'],
        ]],
    ['simulator', 'Simulator controls',
        'The educator opens the simulator controls beside the monitor. Rhythm, vital signs, scenarios, alarms and lab release can be changed during the session. Changes ramp over a chosen time, so the learner sees the patient change gradually.',
        [
            ['sim-rhythm', 'The rhythm tab lists ten rhythms, from normal sinus rhythm to asystole and pulseless electrical activity, with PVC and wide QRS modifiers.'],
            ['sim-scenarios', 'The scenarios tab. The current scenario has timed steps at 0, 10 and 20 minutes. Alternative evolutions such as untreated MI progression can be started at any point.'],
        ]],
    ['orders', 'Orders',
        'The order drawer opens from the monitor. Treatments come from the platform catalogue of medications, IV fluids, oxygen and nursing orders. Each entry carries its dose, its route and the physiological effects the engine applies after administration.',
        [
            ['orders-treatments', 'The Treatments tab of the order drawer with the four order categories and the medication list.'],
            ['orders-medications-search', 'A search for aspirin in the medication catalogue. The result shows the drug class, the indication and the route.'],
        ]],
    ['exam', 'Examination and Bedside',
        'The Examination room presents a body map with anterior and posterior views. Each region offers inspection, palpation, percussion and auscultation, and the findings come from the case. The Bedside room shows the same patient in a 3D ward with the live monitor.',
        [
            ['examination-finding', 'Inspection of the chest. The finding is written to the examination log and to the patient record.'],
            ['bedside', 'The Bedside room. The learner moves around the bed, talks to the patient by voice and reads the monitor on the right.'],
        ]],
    ['labs', 'Laboratory and Radiology',
        'The Laboratory room lists 201 tests in groups. The learner ticks tests and orders them, and each result arrives after its own turnaround. The Radiology room works the same way with 74 imaging and diagnostic studies. Educators can release a result immediately.',
        [
            ['laboratory-results', 'A potassium result opened as a laboratory report with the reference range and a normal flag. Four earlier orders are still pending in the worklist.'],
            ['radiology-report', 'The chest X-ray report with clinical indication, technique, findings and impression, written by the case author.'],
        ]],
    ['pacs', 'PACS',
        'The PACS room appears in the navigator once imaging has been ordered. The study opens in a DICOM reading room with a series rail, window and level controls, transfer functions, measurement tools and a report pane.',
        [
            ['pacs', 'The PA chest film of the ordered study, with window width and level, gamma and edge enhancement in the right panel.'],
            ['pacs-study', 'The lateral series of the same study with a sigmoid transfer function applied.'],
        ]],
    ['ecg', '12-lead ECG',
        'The 12-lead ECG room appears when the case carries a record. The tracing sits on calibrated paper with gain, sweep speed, filters and calipers; a systematic read and the learner\'s measurements are kept with the session.',
        [
            ['ecg-room', 'The admission ECG of the STEMI case on calibrated paper, with the systematic-read panel on the right.'],
            ['ecg-caliper', 'The Measure tab with an interval caliper placed on the rhythm strip.'],
        ]],
    ['consultant', 'Consultant and Course',
        'The Consultant room holds the case debrief with a discussant persona. The Course room holds the lessons, readings and surveys attached to the learner\'s course, with progress kept per learner.',
        [
            ['consultant', 'The Consultant room with the patient summary on the left and the discussant on the right, ready to start the debrief.'],
            ['course-lesson', 'A lesson in the Course room. The STEMI lesson is marked completed and ends with knowledge questions and a reflection survey.'],
        ]],
    ['authoring', 'Authoring a case',
        'A case is edited in twelve steps, from demographics and voice to scenario, vitals, labs, radiology, exam findings, records, treatments and agents. The editor saves as the author works.',
        [
            ['case-editor', 'The Demographics step of the STEMI case, with the twelve steps in the rail above the form.'],
            ['case-scenario', 'The Scenario step. A scenario from the repository gives the patient timed steps, and alternative evolutions can be added for the educator to trigger.'],
            ['case-treatments', 'The Treatments step. Each treatment can be marked expected, contraindicated or hidden for this case, and effect values come from the shared treatment library.'],
        ]],
    ['plugins', 'Plugin editors',
        'The Plugins step of the case editor opens the tools that add their own material to a case. The ECG studio, the pathology editor and the imaging editor each save into the case, so the material travels with it.',
        [
            ['ecg-studio', 'The ECG case studio. The author picks a signal pattern, sets the patient and the learning purpose, and previews the learner\'s 12-lead ECG.'],
            ['pathology-editor', 'The pathology case editor. Slides come from the slide library, gross photographs can be added, and publish checks list what the case still needs.'],
            ['imaging-editor', 'The imaging case editor. The 74 studies of the radiology catalogue are shown with their normal imaging, and the author changes the ones that differ for this patient.'],
        ]],
    ['settings', 'Settings',
        'The settings surface covers cases, scenarios, agents, avatars, voice, affect, users, courses, lessons, analytics, Oyon, logs, the body map, the lab database, medications, treatments, platform configuration, plugins and notifications.',
        [
            ['settings-cases', 'The Cases tab. Cases are grouped by course, and each one can be loaded, exported, duplicated, edited or hidden.'],
            ['settings-voice', 'The Voice tab. Kokoro, Google Cloud TTS, OpenAI TTS and Piper are enabled here, and each voice plays on its own engine.'],
            ['settings-platform-ai', 'The AI section of the Platform tab. The provider, base URL and model apply to every user, and the current wiring is shown below the form.'],
        ]],
    ['analytics', 'Learning analytics',
        'Every learning event feeds the analytics. The same filters for course, case, learner, dates and room apply on each tab. Sequences of clinical states are read as a transition network, as a process map and as clusters of learners.',
        [
            ['analytics-network', 'The Network tab. Ten clinical states form a transition network with edge weights, and the centrality panel ranks them by in-strength.'],
            ['analytics-process', 'The Process map with 6,450 transitions across 45 sessions, with a threshold slider and CSV and PNG export.'],
            ['analytics-clusters', 'The Clusters tab. Forty-five sequences fall into three clusters with a silhouette score of 0.908, each with its own state profile and network.'],
        ]],
    ['oyon', 'Oyon',
        'Oyon estimates affect, attention and gaze from the camera on the learner\'s own device, with consent. The browser sends aggregated ten-second windows to the server, and the dashboard reads them by session.',
        [
            ['oyon-dashboard', 'The Affect tab of the Oyon dashboard with the emotion co-occurrence map, the heat strip, the affect plane and the dynamics timeline.'],
            ['oyon-attention', 'The Attention & engagement tab with focus, eye openness, blink rate, off-screen share and signal quality.'],
        ]],
    ['setup', 'Setup and debrief',
        'The setup wizard walks an administrator through the AI engine, the default language, the default course, voices, emotion capture and access. It can be finished later and reopened from the menu. A session ends on purpose, and the debrief opens in the Consultant room.',
        [
            ['setup-wizard', 'The AI engine step of the platform setup. The connection is tested before students can talk to patients.'],
            ['end-confirm', 'The confirmation before a session ends. The timeline stops, orders and chat are locked, and the transcript stays available in the debrief room.'],
            ['debrief', 'The debrief in progress. The discussant has joined, the learner can talk or type, and the transcript and notes are open from the header.'],
        ]],
];

const byName = new Map(manifest.shots.map((s) => [s.name, s]));
const missing = PAGE.flatMap(([, , , picks]) => picks.map(([name]) => name)).filter((name) => !byName.has(name));
if (missing.length) {
    console.error(`screenshots: the manifest has no scene named ${missing.join(', ')} — re-run website/screenshot-shots.mjs`);
    process.exit(1);
}
for (const shot of byName.values()) {
    const file = join(ASSETS, shot.file ?? `${shot.name}.png`);
    if (!existsSync(file) || statSync(file).size === 0) {
        console.error(`screenshots: ${shot.file ?? shot.name + '.png'} is missing — re-run website/screenshot-shots.mjs`);
        process.exit(1);
    }
}

const figure = ([name, caption]) => {
    const s = byName.get(name);
    return `            <figure class="shot gallery-shot">
                <img src="assets/screenshots/${s.file ?? `${s.name}.png`}" alt="${escapeHtml(caption)}" loading="lazy" width="${manifest.viewport.width}" height="${manifest.viewport.height}">
                <figcaption>${escapeHtml(caption)}</figcaption>
            </figure>`;
};

const body = PAGE.map(([id, label, intro, picks]) => `        <section class="gallery-section" id="${id}">
            <h2>${escapeHtml(label)}</h2>
            <p>${escapeHtml(intro)}</p>
            <div class="gallery-grid">
${picks.map(figure).join('\n')}
            </div>
        </section>`).join('\n');

const sections = PAGE;
const count = PAGE.reduce((n, [, , , picks]) => n + picks.length, 0);
const taken = manifest.takenAt.slice(0, 10);
const version = (() => {
    try { return JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version; } catch { return ''; }
})();

const html = shell({
    depth: 0,
    title: 'Screenshots · Rohy',
    description: `${count} screenshots of the Rohy clinical simulation platform, from sign-in to debrief.`,
    ogImage: `assets/screenshots/${(manifest.shots.find((s) => s.name === 'patient-room') ?? {}).file ?? 'patient-room.png'}`,
    current: 'screenshots',
    eyebrow: 'Screenshots',
    headline: 'Rohy, <span class="accent">screen by screen.</span>',
    lead: `${count} screenshots of Rohy${version ? ` ${version}` : ''}, taken on ${taken} from a running copy with the seeded teaching case. Click a picture to enlarge it.`,
    subnav: subnavHtml(sections.map(([id, label]) => ({ id, label }))),
    body,
    bodyClass: 'gallery',
}).replace('<script src="site.js"></script>', `<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot viewer" hidden>
    <button class="lightbox-close" id="lightbox-close" type="button" aria-label="Close screenshot viewer">×</button>
    <img id="lightbox-img" alt="">
    <div class="lightbox-hint">Click outside or press Esc to close</div>
</div>

<script src="site.js"></script>`);

writeFileSync(OUT, html, 'utf8');
console.log(`screenshots.html written: ${sections.length} sections, ${count} shots, ${html.length} bytes`);
