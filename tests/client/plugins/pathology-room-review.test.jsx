// The pathology room as a learner meets it (FI-0010 review F03, F07, F15, F20).
//
// Renders the VENDORED room (src/components/pathology, pathoyon 88c4d47+) with a
// recording OpenSeadragon stand-in, fed the learner projection rohy's server
// produces — no rubric. jsdom has no layout, so the phone-width checks assert
// the drawer CONTRACT (which panels are hidden below lg, what opens and closes
// them) rather than pixels; real 390 px rendering still needs a browser run.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const viewers = [];
vi.mock('openseadragon', () => ({
    default: vi.fn((options) => {
        const handlers = {};
        const viewer = {
            options,
            handlers,
            addHandler: (name, fn) => { (handlers[name] ??= []).push(fn); },
            removeHandler: (name, fn) => { handlers[name] = (handlers[name] ?? []).filter((h) => h !== fn); },
            fire: (name, event = {}) => (handlers[name] ?? []).forEach((fn) => fn(event)),
            destroy: vi.fn(),
            container: { clientWidth: 800, clientHeight: 600 },
            navigator: null,
            world: { getItemAt: () => ({ getContentSize: () => ({ x: 1000, y: 1000 }) }), getItemCount: () => 1 },
            viewport: {
                getBounds: () => ({ x: 0.7, y: 0.7, width: 0.2, height: 0.2 }),
                getBoundsNoRotate: () => ({ x: 0.7, y: 0.7, width: 0.2, height: 0.2 }),
                getZoom: () => 5,
                getRotation: () => 0,
                getFlip: () => false,
                getCenter: () => ({ x: 0.5, y: 0.5 }),
                viewerElementToViewportCoordinates: (p) => p,
                viewportToViewerElementCoordinates: (p) => p,
                applyConstraints: () => {},
                zoomTo: () => {},
                panTo: () => {},
                goHome: () => {},
            },
        };
        viewers.push(viewer);
        return viewer;
    }),
}));

const { PathologyRoom } = await import('../../../src/components/pathology/PathologyRoom.jsx');
const { SpecimenTray } = await import('../../../src/components/pathology/SpecimenTray.jsx');
const { MAX_SLIDE_RETRIES } = await import('../../../src/components/pathology/SlideCanvas.jsx');
const { learnerCase } = await import('../../../src/components/pathology/hostDocument.js');
const { CASE_SCHEMA_URI, CASE_SCHEMA_VERSION, RUBRIC_SCHEMA_URI } = await import('../../../src/components/pathology/caseCore/constants.js');
const { projectCaseConfigForRole } = await import('../../../server/services/caseProjection.js');
const { PLUGIN_MANIFESTS } = await import('../../../server/shared/plugins/manifests.generated.js');
const { hostReadAssessor } = await import('../../../src/plugins/pathology/index.jsx');

function pathologyDocument() {
    return {
        manifest: {
            $schema: CASE_SCHEMA_URI,
            schemaVersion: CASE_SCHEMA_VERSION,
            id: 'case-1',
            revision: { id: 'revision-1', number: 1, status: 'draft', parentRevisionId: null, createdAt: '2026-10-14T10:00:00.000Z', createdBy: 'a' },
            title: 'Two slides',
            clinical: { accession: 'S-1', specimenSummary: 'Synthetic' },
            specimens: [{ id: 'specimen-1', part: 'A', label: 'Part A', description: 'Synthetic', grossImageAssetIds: [] }],
            blocks: [{ id: 'block-1', specimenId: 'specimen-1', label: 'A1' }, { id: 'block-2', specimenId: 'specimen-1', label: 'A2' }],
            assets: [
                {
                    id: 'asset-1', kind: 'wsi',
                    source: { kind: 'catalog', catalogAssetId: 'c1', revision: 'sha256:s1', checksum: null },
                    metadata: { widthPx: 1000, heightPx: 1000, nativeObjective: 40, nativeMpp: 0.25, downsample: 1 },
                    renditions: [{ kind: 'dzi', uri: 'https://cdn.test/s1.dzi', checksum: 'sha256:d1' }],
                },
                {
                    id: 'asset-2', kind: 'wsi',
                    source: { kind: 'catalog', catalogAssetId: 'c2', revision: 'sha256:s2', checksum: null },
                    metadata: { widthPx: 1000, heightPx: 1000, nativeObjective: 40, nativeMpp: 0.25, downsample: 1 },
                    renditions: [{ kind: 'dzi', uri: 'https://cdn.test/s2.dzi', checksum: 'sha256:d2' }],
                },
            ],
            slides: [
                { id: 'slide-1', blockId: 'block-1', assetId: 'asset-1', label: 'A1 — H&E', stain: { code: 'HE', display: 'H&E' } },
                { id: 'slide-2', blockId: 'block-2', assetId: 'asset-2', label: 'A2 — IHC', stain: { code: 'IHC', display: 'IHC' } },
            ],
            activities: [{ id: 'activity-1', kind: 'diagnostic-report', prompt: 'Report both slides.', instructions: 'Screen.' }],
            provenance: {},
        },
        rubric: {
            $schema: RUBRIC_SCHEMA_URI, schemaVersion: CASE_SCHEMA_VERSION, id: 'rubric-1', caseId: 'case-1', caseRevisionId: 'revision-1',
            activities: [{
                activityId: 'activity-1', hints: [],
                slideCriteria: [{
                    slideId: 'slide-1', weight: 1, screeningObjective: 5, coverageObjective: 2, coverageGrid: 10,
                    tissueBounds: { x: 0, y: 0, w: 1000, h: 1000 },
                    rois: [{ id: 'roi-1', label: 'SECRET focus', x: 790, y: 790, w: 20, h: 20, minObjective: 10, dwellMs: 1000, critical: true }],
                }],
            }],
        },
    };
}

/** What the learner's room actually receives: the server projection, then learnerCase. */
const learnerViewerCase = () => learnerCase(projectCaseConfigForRole({ pathology: pathologyDocument() }, PLUGIN_MANIFESTS, 'student').pathology);

const logger = { log: vi.fn() };
const FEEDBACK = {
    version: 1, activityId: 'activity-1', totalTimeMs: 4000, roiTotal: 2, roiReached: 1, criticalTotal: 2, criticalReached: 1,
    slideCoverage: 0.5, maxObjective: 20,
    perSlide: [
        { slideId: 'slide-1', slideCoverage: 0.5, maxObjective: 20, totalTimeMs: 3000, roiTotal: 1, roiReached: 1, criticalTotal: 1, criticalReached: 1 },
        { slideId: 'slide-2', slideCoverage: null, maxObjective: null, totalTimeMs: 1000, roiTotal: 1, roiReached: 0, criticalTotal: 1, criticalReached: 0 },
    ],
    missed: [{ id: 'roi-2', slideId: 'slide-2', label: 'Nests in stroma', critical: true, missReason: 'never_on_screen' }],
};

async function flushViewerTimers() {
    await act(async () => { vi.runOnlyPendingTimers(); });
}

/** Let a resolved/rejected host promise chain settle (setImmediate is not faked). */
async function settle() {
    await act(() => new Promise((resolve) => setImmediate(resolve)));
}

// jsdom has no 2D canvas; the annotation layer only needs calls to land somewhere.
function stubCanvas() {
    const context = new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => {}), set: (target, key, value) => { target[key] = value; return true; } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
}

async function writeAndSubmitReport() {
    fireEvent.click(screen.getAllByRole('tab', { name: /Report/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Add report/ }));
    fireEvent.change(screen.getByPlaceholderText(/Core biopsy/), { target: { value: 'Colon' } });
    fireEvent.change(screen.getByPlaceholderText(/Describe what you examined/), { target: { value: 'Gland-forming tumour.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Submit report/ })); });
}

beforeEach(() => { viewers.length = 0; stubCanvas(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the learner room receives no rubric', () => {
    it('the projected viewer case carries the task but not the rubric', () => {
        const viewerCase = learnerViewerCase();
        expect(viewerCase.task?.id).toBe('activity-1');
        expect(JSON.stringify(viewerCase)).not.toContain('SECRET');
        expect(viewerCase.task?.answerKey ?? null).toBeNull();
    });
});

describe('F03: reading feedback scored by the host', () => {
    // Regression lock: with no rubric the room ran no recorder, finish() was
    // null and "How this slide was read" could never render.
    it('records the read without a rubric, hands the host the packed read, and shows the feedback', async () => {
        const assessRead = vi.fn().mockResolvedValue(FEEDBACK);
        const onReportsChange = vi.fn();
        render(<PathologyRoom pathologyCase={learnerViewerCase()} eventLogger={logger} assessRead={assessRead} onReportsChange={onReportsChange} />);
        await flushViewerTimers();
        await act(async () => { viewers[0].fire('open'); });

        await writeAndSubmitReport();
        expect(assessRead).toHaveBeenCalledTimes(1);
        const { reportId, activityId, read } = assessRead.mock.calls[0][0];
        expect(reportId).toMatch(/report-1$/);
        expect(activityId).toBe('activity-1');
        expect(read.v).toBe(1);
        expect(read.slides).toEqual(['slide-1']);
        expect(read.samples.length).toBeGreaterThan(0);
        expect(read.samples[0]).toHaveLength(8);

        await settle();
        expect(screen.getByText('How this slide was read')).toBeTruthy();
        expect(screen.getByText('Key findings reached').nextSibling.textContent).toBe('1/2');
        expect(screen.getByLabelText('Per slide')).toBeTruthy();
        expect(screen.getByText(/Nests in stroma/)).toBeTruthy();
        // Kept on the report, so a reload still shows it.
        const last = onReportsChange.mock.calls.at(-1)[0];
        expect(last[0]).toMatchObject({ status: 'submitted', readFeedback: FEEDBACK });
    });

    it('a failed assessment says so and offers a bounded retry', async () => {
        const assessRead = vi.fn().mockRejectedValue(new Error('offline'));
        render(<PathologyRoom pathologyCase={learnerViewerCase()} eventLogger={logger} assessRead={assessRead} />);
        await flushViewerTimers();
        await writeAndSubmitReport();
        await settle();
        expect(screen.getByText(/feedback on how you read the slides could not be loaded/)).toBeTruthy();
        for (let i = 0; i < 3; i += 1) {
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Try again/ })); });
            await settle();
        }
        expect(assessRead).toHaveBeenCalledTimes(4);
        expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
        expect(screen.getByText(/Your submitted report is not affected/)).toBeTruthy();
    });

    it('the rohy adapter posts to the session route and unwraps the feedback', async () => {
        expect(hostReadAssessor(null)).toBeUndefined();
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ feedback: FEEDBACK }), {
            status: 201, headers: { 'content-type': 'application/json' },
        }));
        try {
            const assess = hostReadAssessor(42);
            const result = await assess({ reportId: 'r-1', activityId: 'activity-1', read: { v: 1, slides: [], samples: [] } });
            expect(result).toEqual(FEEDBACK);
            const [url, init] = fetchSpy.mock.calls[0];
            expect(String(url)).toMatch(/\/api\/sessions\/42\/pathology-reads$/);
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual({ reportId: 'r-1', activityId: 'activity-1', read: { v: 1, slides: [], samples: [] } });
        } finally {
            fetchSpy.mockRestore();
        }
    });
});

describe('F07: phone width — the side panels are drawers below lg', () => {
    // Regression lock: two fixed columns (w-56 + w-80/w-72) left a 390 px
    // phone no width for the microscope.
    it('hides both panels below lg until asked, and keeps the desktop columns', async () => {
        render(<PathologyRoom pathologyCase={learnerViewerCase()} eventLogger={logger} />);
        const nav = document.getElementById('pathology-slides-drawer');
        const aside = document.getElementById('pathology-side-drawer');
        expect(nav.className).toContain('max-lg:hidden');
        expect(aside.className).toContain('max-lg:hidden');
        // Desktop unchanged: the same fixed columns from lg up.
        expect(nav.className).toMatch(/(^| )w-56( |$)/);
        expect(aside.className).toMatch(/(^| )w-80( |$)/);
        expect(nav.className).toContain('max-lg:absolute');

        const slidesToggle = screen.getByRole('button', { name: /^Slides/ });
        expect(slidesToggle.getAttribute('aria-controls')).toBe('pathology-slides-drawer');
        fireEvent.click(slidesToggle);
        expect(slidesToggle.getAttribute('aria-expanded')).toBe('true');
        expect(nav.className).not.toContain('max-lg:hidden');

        // Picking a slide closes the drawer: the learner wants to look at it.
        fireEvent.click(within(nav).getByText('A2 — IHC'));
        expect(nav.className).toContain('max-lg:hidden');

        const panelToggle = screen.getByRole('button', { name: /Marks & report/ });
        fireEvent.click(panelToggle);
        expect(aside.className).not.toContain('max-lg:hidden');
        // The report controls are reachable inside it.
        fireEvent.click(within(aside).getByRole('tab', { name: /Report/ }));
        expect(within(aside).getByRole('button', { name: /Add report/ })).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(aside.className).toContain('max-lg:hidden');
    });
});

describe('F20: a slide or photograph that fails to load says which, with a bounded retry', () => {
    // Regression lock: only success handlers were registered; a failed
    // descriptor was a black rectangle (or OSD's own English error).
    it('names the failed slide, retries a bounded number of times, then gives up plainly', async () => {
        render(<PathologyRoom pathologyCase={learnerViewerCase()} eventLogger={logger} />);
        await flushViewerTimers();
        expect(screen.getByText(/Loading slide “A1 — H&E”/)).toBeTruthy();
        for (let attempt = 0; attempt < MAX_SLIDE_RETRIES; attempt += 1) {
            await act(async () => { viewers.at(-1).fire('open-failed'); });
            expect(screen.getByRole('alert').textContent).toContain('The slide “A1 — H&E” could not be loaded.');
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Try again/ })); });
            await flushViewerTimers();
        }
        expect(viewers).toHaveLength(MAX_SLIDE_RETRIES + 1);
        await act(async () => { viewers.at(-1).fire('open-failed'); });
        expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
        expect(screen.getByText(/Tell your instructor which slide it was/)).toBeTruthy();
    });

    it('says when tiles are missing rather than letting holes pass as tissue', async () => {
        render(<PathologyRoom pathologyCase={learnerViewerCase()} eventLogger={logger} />);
        await flushViewerTimers();
        await act(async () => { viewers[0].fire('open'); });
        expect(screen.queryByText(/Loading slide/)).toBeNull();
        await act(async () => { viewers[0].fire('tile-load-failed'); });
        expect(screen.getByText(/Parts of “A1 — H&E” did not load/)).toBeTruthy();
    });

    it('distinguishes a failed photograph from a part with no photograph', async () => {
        const specimens = [
            { id: 's-a', part: 'A', name: 'Sigmoid resection', description: '', images: [{ id: 'p1', src: 'https://cdn.test/a.jpg', caption: 'Opened colon' }] },
            { id: 's-b', part: 'B', name: 'Mediastinal nodes', description: '', dimensions: '1.0–1.8 cm', images: [] },
        ];
        render(<SpecimenTray specimens={specimens} logger={{ specimenViewed: vi.fn(), plateOpened: vi.fn() }} />);
        await flushViewerTimers();
        expect(screen.getByText(/Loading photograph “Opened colon”/)).toBeTruthy();
        await act(async () => { viewers.at(-1).fire('open-failed'); });
        expect(screen.getByRole('alert').textContent).toContain('The photograph “Opened colon” could not be loaded.');

        fireEvent.click(screen.getAllByText('Mediastinal nodes')[0]);
        expect(screen.getByText('No gross photograph was taken of Mediastinal nodes.')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
        // F15: the dedicated size field, not "not recorded".
        expect(screen.getByText('1.0–1.8 cm')).toBeTruthy();
    });
});
