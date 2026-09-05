/**
 * The integration gate on the PACS room.
 *
 * The node tests in the upstream Radoyon package prove the DICOM pipeline and
 * the document model in isolation, and they pass whether or not the room
 * actually mounts. Pathology learned this the expensive way: threading one prop
 * broke the app with `resolveRef is not defined` while all 452 of its node
 * tests stayed green, and only a rendered drive caught it.
 *
 * So this test renders the real room, with real synthetic DICOM, through the
 * real plugin descriptor — the adapter's props(), the learner projection, and
 * the swap — and asserts what a learner would actually see.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import descriptor from '../../../src/plugins/pacs/index.jsx';
import { manifest as pacsManifest } from '../../../src/plugins/pacs/manifest.js';
import { createPluginLogger } from '../../../src/plugins/logger.js';
import { SOURCE_KIND, SUBSTITUTION_SCOPE } from '../../../src/components/pacs/caseDocument.js';
import { parseDicom } from '../../../src/components/pacs/dicomParse.js';
import { buildSeries, describeInstance } from '../../../src/components/pacs/series.js';

// --- a synthetic CT series, built the same way the upstream tests build one ---

const enc = new TextEncoder();

function el(tag, vr, value, longForm = false) {
    const group = parseInt(tag.slice(0, 4), 16);
    const element = parseInt(tag.slice(4), 16);
    const body = value instanceof Uint8Array
        ? value
        : (() => {
            if (vr === 'US') { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value, true); return b; }
            const s = Array.isArray(value) ? value.join('\\') : String(value);
            const b = enc.encode(s);
            if (b.length % 2 === 0) return b;
            const out = new Uint8Array(b.length + 1);
            out.set(b); out[b.length] = vr === 'UI' ? 0 : 0x20;
            return out;
        })();
    const head = new Uint8Array(longForm ? 12 : 8);
    const dv = new DataView(head.buffer);
    dv.setUint16(0, group, true);
    dv.setUint16(2, element, true);
    head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1);
    if (longForm) dv.setUint32(8, body.length, true); else dv.setUint16(6, body.length, true);
    const out = new Uint8Array(head.length + body.length);
    out.set(head); out.set(body, head.length);
    return out;
}

function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0; parts.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
}

/** One CT slice at `z`, painted with a known Hounsfield band pattern. */
function ctSlice({ z, instanceNumber, seriesUid, seriesDescription, rows = 8, columns = 8 }) {
    const stored = new Int16Array(rows * columns);
    for (let r = 0; r < rows; r++) {
        const hu = [-1000, -100, 0, 40, 300][Math.floor((r / rows) * 5)] ?? 0;
        stored.fill(Math.round(hu + 1024), r * columns, (r + 1) * columns);
    }
    const dataset = concat([
        el('00080016', 'UI', '1.2.840.10008.5.1.4.1.1.2'),
        el('00080018', 'UI', `1.2.3.${seriesUid}.${instanceNumber}`),
        el('00080060', 'CS', 'CT'),
        el('0008103e', 'LO', seriesDescription),
        el('0020000d', 'UI', '1.2.3.0'),
        el('0020000e', 'UI', `1.2.3.${seriesUid}`),
        el('00200011', 'IS', '2'),
        el('00200013', 'IS', String(instanceNumber)),
        el('00200032', 'DS', ['-250', '-250', String(z)]),
        el('00200037', 'DS', ['1', '0', '0', '0', '1', '0']),
        el('00201041', 'DS', String(z)),
        el('00280002', 'US', 1),
        el('00280004', 'CS', 'MONOCHROME2'),
        el('00280010', 'US', rows),
        el('00280011', 'US', columns),
        el('00280030', 'DS', ['0.7', '0.7']),
        el('00280100', 'US', 16),
        el('00280101', 'US', 16),
        el('00280102', 'US', 15),
        el('00280103', 'US', 1),
        el('00281050', 'DS', '-600'),
        el('00281051', 'DS', '1500'),
        el('00281052', 'DS', '-1024'),
        el('00281053', 'DS', '1'),
        el('7fe00010', 'OW', new Uint8Array(stored.buffer.slice(0)), true),
    ]);
    const meta = concat([
        el('00020002', 'UI', '1.2.840.10008.5.1.4.1.1.2'),
        el('00020003', 'UI', `1.2.3.${seriesUid}.${instanceNumber}`),
        el('00020010', 'UI', '1.2.840.10008.1.2.1'),
    ]);
    const groupLen = el('00020000', 'UL', (() => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, meta.length, true); return b; })());
    const preamble = new Uint8Array(132);
    preamble.set(enc.encode('DICM'), 128);
    return concat([preamble, groupLen, meta, dataset]);
}

const NORMAL = Array.from({ length: 6 }, (_, i) => ctSlice({
    z: i * 1.25, instanceNumber: i + 1, seriesUid: 'normal', seriesDescription: 'AXIAL CHEST',
}));
const DISEASED = Array.from({ length: 4 }, (_, i) => ctSlice({
    z: i * 1.25, instanceNumber: i + 1, seriesUid: 'pe', seriesDescription: 'CTPA SADDLE EMBOLUS',
}));

/** The archive the host would relay from its configured origin. */
const ARCHIVE = {
    name: 'Normals',
    entries: [{
        id: 'normal/ct_chest_adult_m',
        studyId: 'ct_chest',
        modality: 'CT',
        bodyRegion: 'Chest',
        label: 'Normal chest CT, adult male',
        series: [{
            key: 's2', description: 'AXIAL CHEST', plane: 'axial', instances: 6,
            ref: 'remote:dicom/normal/ct_chest_adult_m/s2/',
            geometry: { rows: 8, columns: 8, pixelSpacing: [0.7, 0.7], spacing: 1.25, plane: 'axial' },
        }],
        provenance: { dataset: 'Synthetic', licence: 'CC0', redistribution: 'permitted' },
    }],
};

/** A fetch that serves the two series through the plugin proxy's URL shape. */
function fakeFetch(url) {
    const path = String(url);
    const serve = (body, type) => Promise.resolve({
        ok: true, status: 200,
        json: async () => body,
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        headers: { get: () => type },
    });
    // Deliberately strict: an earlier version of this fake matched
    // endsWith('index.json'), which '…/peindex.json' also satisfies — and that
    // masked a real bug where the loader built the base URL without a
    // separator. A fake that is laxer than the server it stands in for tests
    // nothing.
    if (path.endsWith('/index.json')) {
        const files = path.includes('/pe/') ? DISEASED : NORMAL;
        return serve({ instances: files.map((_, i) => `${String(i).padStart(3, '0')}.dcm`) }, 'application/json');
    }
    const files = path.includes('/pe/') ? DISEASED : NORMAL;
    const index = Number(path.match(/(\d{3})\.dcm$/)?.[1] ?? 0);
    return serve(files[index], 'application/dicom');
}

/** The document an author would have written: normal chest CT, PE substituted. */
const CASE_DOCUMENT = {
    version: 1,
    worklist: [{
        id: 'w1',
        studyId: 'ct_chest',
        description: 'CT Pulmonary Angiogram',
        accession: 'RAD-000042',
        baseline: { kind: SOURCE_KIND.ARCHIVE, ref: 'normal/ct_chest_adult_m' },
        substitutions: [{
            id: 'sub1',
            label: 'Saddle embolus',
            scope: SUBSTITUTION_SCOPE.SERIES,
            targetSeriesKey: 's2',
            source: { kind: SOURCE_KIND.REMOTE, ref: 'remote:dicom/case42/pe/' },
            geometry: { rows: 8, columns: 8, pixelSpacing: [0.7, 0.7], spacing: 1.25, plane: 'axial', instances: 4 },
        }],
        report: { findings: 'Filling defect in the main pulmonary artery.', impression: 'Acute saddle PE.', released: true },
        rubric: { expectedFindings: ['saddle pulmonary embolus'], keyImages: [2] },
    }],
};

// The narrowed logger (RPS-1 1.6), exactly as PluginRoom builds it, over a
// spy sink. Radoyon 0.4 speaks log(verb, objectType, options) through its
// own createRadoyonLogger; the SINK must see three positionals with the
// plugin stamped — the pre-0.4 assertion (`([e]) => e.verb`) had enshrined
// the object shape that lost every PACS row at ingest.
const sink = { log: vi.fn() };
const ctx = {
    pluginId: 'pacs',
    data: CASE_DOCUMENT,
    archive: ARCHIVE,
    log: createPluginLogger({ manifest: pacsManifest, eventLogger: sink, sessionId: null }),
    t: (key, fallback) => fallback ?? key,
    session: { examMode: false },
};
const persist = { state: {}, save: vi.fn() };

beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    // jsdom has no canvas backend; the room must still mount and drive its
    // loading, ordering and worklist logic without one.
    HTMLCanvasElement.prototype.getContext = () => ({
        setTransform: () => {}, fillRect: () => {}, drawImage: () => {},
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: () => {}, save: () => {}, restore: () => {}, beginPath: () => {},
        moveTo: () => {}, lineTo: () => {}, stroke: () => {}, arc: () => {},
        fillText: () => {}, measureText: () => ({ width: 10 }),
    });
    global.ResizeObserver = class { observe() {} disconnect() {} };
});

describe('PACS room — the end-to-end thin slice', () => {
    it('the descriptor gates on real material, not on a key existing', () => {
        expect(descriptor.available(ctx)).toBe(true);
        expect(descriptor.available({ data: { version: 1, worklist: [] } })).toBe(false);
        expect(descriptor.available({ data: null })).toBe(false);
        // Must not throw on a malformed document: one bad row would otherwise
        // take the navigator down for every other case.
        expect(() => descriptor.available({ data: { worklist: 'nonsense' } })).not.toThrow();
    });

    it('validates and summarises the authored document', () => {
        expect(descriptor.validate(CASE_DOCUMENT).filter((i) => i.level === 'error')).toEqual([]);
        expect(descriptor.summarize(CASE_DOCUMENT)).toEqual({ count: 1, labelKey: 'radoyon_studies_count' });
    });

    it('the swap reaches the learner: the worklist points at the DISEASED series', () => {
        const props = descriptor.props(ctx, persist);
        expect(props.worklist).toHaveLength(1);
        const [study] = props.worklist;
        expect(study.description).toBe('CT Pulmonary Angiogram');
        expect(study.available).toBe(true);
        // The baseline was normal/…/s2; the substitution replaced it, and the
        // reference was rewritten onto this plugin's proxy mount.
        expect(study.ref).toBe('/api/plugins/pacs/dicom/case42/pe');
        expect(study.series[0].origin).toBe('substitution');
    });

    it('the rubric never leaves the host', () => {
        const props = descriptor.props(ctx, persist);
        const serialised = JSON.stringify(props);
        expect(serialised).not.toContain('rubric');
        expect(serialised).not.toContain('saddle pulmonary embolus');
    });

    it('renders the room and loads the substituted study through the host loader', async () => {
        const props = descriptor.props(ctx, persist);
        const Room = descriptor.component;
        render(<Room {...props} />);

        // Radoyon 0.3.x renders the study identity in both the worklist and
        // the reading-pane header, so "at least once" is the stable assertion.
        expect(screen.getAllByText('CT Pulmonary Angiogram').length).toBeGreaterThan(0);
        expect(screen.getAllByText('RAD-000042').length).toBeGreaterThan(0);

        // The series rail is populated only after the study has been fetched,
        // parsed and ordered — so its appearance proves the whole chain.
        await waitFor(() => {
            expect(screen.getAllByText('CTPA SADDLE EMBOLUS').length).toBeGreaterThan(0);
        }, { timeout: 5000 });

        // Four slices, the DISEASED count — not the baseline's six.
        expect(screen.getByText(/^4 /)).toBeInTheDocument();
        expect(screen.getByText('axial')).toBeInTheDocument();

        // Opening the study is an analytics event, which is what makes any of
        // this assessable.
        //
        // Awaited, not read at the instant the rail appears. The rail rendering
        // and the events being logged are two INDEPENDENT async effects, and
        // assuming an order between them is a race: radoyon's lazy-loading path
        // (vendored at 029e4e1) moved the emit later, and this passed on a fast
        // machine while failing in CI.
        await waitFor(() => {
            const verbs = sink.log.mock.calls.map(([verb]) => verb);
            expect(verbs).toContain('OPENED_STUDY');
            expect(verbs).toContain('SELECTED_SERIES');
        }, { timeout: 5000 });
        // Every row reached the host as three positionals with the plugin
        // stamped, in the POSITIONAL shape (no `_log_shape` compatibility
        // marker), naming its object and carrying explicit metadata — the
        // conformance property, asserted where it was broken.
        for (const call of sink.log.mock.calls) {
            expect(typeof call[0]).toBe('string');
            expect(typeof call[1]).toBe('string');
            expect(call[2]).toMatchObject({ room: 'pacs', pluginId: 'pacs', pluginVersion: '0.2.0' });
            expect(call[2].context?._log_shape).toBeUndefined();
            expect(call[2].severity).toBeTruthy();
            expect(call[2].category).toBeTruthy();
        }
        const opened = sink.log.mock.calls.find(([verb]) => verb === 'OPENED_STUDY');
        expect(opened[1]).toBe('imaging_study');
        expect(opened[2].objectId).toBeTruthy();
    });

    it('the fetched bytes really are DICOM, and order spatially', () => {
        // Guards the fixture itself: if these stopped being valid DICOM the
        // render test above could pass for the wrong reason.
        const instances = DISEASED.map((bytes, i) => describeInstance(
            parseDicom(bytes, { stopBeforePixelData: true }), { source: i },
        ));
        const [series] = buildSeries(instances);
        expect(series.modality).toBe('CT');
        expect(series.orderedBy).toBe('position');
        expect(series.count).toBe(4);
        expect(series.spacing).toBeCloseTo(1.25, 6);
        expect(series.spacingIsUniform).toBe(true);
    });

    // Regression lock: the PACS room stranded the learner — no room tabs, no
    // End & Debrief, no top-bar chrome; only a reload escaped. PluginRoom
    // spreads the chrome props, but the vendored PacsScreen destructures a
    // closed prop list, so the adapter (PacsRoom) must render the host chrome
    // itself. This fails against the un-fixed adapter.
    it('renders the host chrome: top bar controls, case title, room navigator', () => {
        const props = descriptor.props(ctx, persist);
        const Room = descriptor.component;
        render(
            <Room
                {...props}
                caseTitle="Case of the day"
                topBarControls={<div data-testid="host-top-bar" />}
                roomNav={<nav data-testid="host-room-nav" />}
            />,
        );
        expect(screen.getByTestId('host-top-bar')).toBeInTheDocument();
        expect(screen.getByTestId('host-room-nav')).toBeInTheDocument();
        expect(screen.getByText('Case of the day')).toBeInTheDocument();
        expect(screen.getByText('PACS')).toBeInTheDocument();
    });

    // Regression lock: "renders" is not "reachable". The first version of this
    // gate asserted only that the nav was in the document, which a nav rendered
    // INSIDE the plugin's own scroll/clip pane also satisfies — and that is
    // precisely how a room strands a learner: the tabs exist, at y = 2000, in a
    // box with `overflow: hidden`. jsdom has no layout, so the assertion is on
    // the structure that produces the layout: the nav is a direct child of the
    // room shell, it is a sibling of the content pane rather than inside it,
    // and it is marked un-shrinkable so a tall study cannot squeeze it to zero.
    it('the room navigator sits outside the plugin pane and cannot be shrunk away', () => {
        const props = descriptor.props(ctx, persist);
        const Room = descriptor.component;
        const { container } = render(
            <Room
                {...props}
                caseTitle="Case of the day"
                topBarControls={<div data-testid="host-top-bar" />}
                roomNav={<nav data-testid="host-room-nav" />}
            />,
        );

        const shell = container.firstChild;
        expect(shell.className).toContain('flex-col');

        const navSlot = screen.getByTestId('host-room-nav').parentElement;
        expect(navSlot.parentElement).toBe(shell);
        expect(navSlot.className).toContain('shrink-0');

        // The pane that holds the vendored workstation is a DIFFERENT child of
        // the shell, and it clips rather than grows: content that outgrows it
        // scrolls inside the package's own panes instead of pushing the nav out
        // of the viewport.
        const pane = [...shell.children].find((child) => child.className.includes('flex-1'));
        expect(pane).toBeTruthy();
        expect(pane).not.toBe(navSlot);
        expect(pane.contains(navSlot)).toBe(false);
        expect(pane.className).toContain('min-h-0');
        expect(pane.className).toContain('overflow-hidden');

        // The header is chrome too — it carries the top-bar controls — so it is
        // held to the same rule.
        const header = shell.querySelector('header');
        expect(header.className).toContain('shrink-0');
    });

    // Regression lock: a `remote:` BASELINE (no archive entry, no
    // substitutions) resolved to zero series, so the study rendered as an
    // unclickable "Pending" with no message and no network attempt. The host
    // now synthesises the baseline series from the reference; geometry comes
    // from index.json when the study is opened.
    it('a remote-baseline study is available and points at the proxy mount', () => {
        const doc = {
            version: 1,
            worklist: [{
                id: 'w2',
                studyId: 'ct_head',
                description: 'CT Head (remote baseline)',
                accession: 'RAD-000043',
                baseline: { kind: SOURCE_KIND.REMOTE, ref: 'remote:dicom/case43/head/' },
                substitutions: [],
                report: { findings: '', impression: '', released: false },
            }],
        };
        const props = descriptor.props({ ...ctx, data: doc }, persist);
        expect(props.worklist).toHaveLength(1);
        const [study] = props.worklist;
        expect(study.available).toBe(true);
        expect(study.ref).toBe('/api/plugins/pacs/dicom/case43/head');
        expect(study.series[0].origin).toBe('baseline');
    });
});
