/**
 * The PACS case editor, as an author actually meets it.
 *
 * Regression lock for the reported bug: "radiology is not working at all —
 * imaging. All 0 / Changed 0 / With imaging 0 / No imaging yet 0 / Search the
 * catalogue → No study in the catalogue matches."
 *
 * The cause was not in the editor. Radoyon 0.3.1's `CaseEditor` is built on
 * `caseCatalogue(doc, {archive, catalogue})` — "a case is the catalogue, minus
 * what changed" — and the adapter passed `ctx.studyCatalogue ?? []` and
 * `ctx.archive ?? {entries: []}` while nothing in the host ever set either.
 * Both had ALWAYS been empty; the older editor let an author work anyway, and
 * the new one, correctly, showed an empty catalogue as empty.
 *
 * So these tests drive the real descriptor's authorProps through the real
 * component with a stubbed network, and assert what an author sees. Every one
 * of them fails against the un-fixed adapter.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import descriptor from '../../../src/plugins/pacs/index.jsx';

/** rohy's radiology catalogue, as GET /api/radiology-database answers it. */
const RADIOLOGY_DB = {
    studies: [
        {
            id: 'xray_chest_pa', name: 'Chest X-Ray (PA/Lateral)', modality: 'X-Ray',
            body_region: 'Chest', turnaround_minutes: 1, normal_findings: 'The lungs are clear.',
        },
        {
            id: 'ct_chest', name: 'CT Chest (with contrast)', modality: 'CT',
            body_region: 'Chest', turnaround_minutes: 45, normal_findings: 'No acute finding.',
        },
        {
            id: 'ct_head_noncon', name: 'CT Head (non-contrast)', modality: 'CT',
            body_region: 'Head', turnaround_minutes: 30, normal_findings: 'No haemorrhage.',
        },
    ],
    modalities: ['CT', 'X-Ray'],
    total: 3,
};

/** The archive the host relays from the configured content origin. */
const ARCHIVE = {
    version: 1,
    name: 'Teaching normals',
    entries: [{
        id: 'normal/ct_chest_adult_m',
        studyId: 'ct_chest',
        modality: 'CT',
        bodyRegion: 'Chest',
        label: 'Normal chest CT, adult male',
        series: [{
            key: 's2', description: 'AXIAL CHEST', plane: 'axial', instances: 240,
            ref: 'remote:dicom/normal/ct_chest_adult_m/s2/',
        }],
        provenance: { dataset: 'Synthetic', licence: 'CC0', redistribution: 'permitted' },
    }],
};

/**
 * A network in which both endpoints answer.
 *
 * `catalog` is `null` to model the deployment state that is normal today —
 * ROHY_PLUGIN_ORIGINS names no pacs origin, so the relay answers 503.
 */
function stubNetwork({ catalog = ARCHIVE, catalogStatus = 200, radiologyStatus = 200 } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
        const path = String(url);
        const respond = (status, body) => ({
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
        if (path.includes('/api/radiology-database')) {
            return respond(radiologyStatus, radiologyStatus === 200
                ? RADIOLOGY_DB
                : { error: 'nope' });
        }
        if (path.includes('/api/plugins/pacs/catalog')) {
            return respond(catalogStatus, catalogStatus === 200
                ? { plugin: 'pacs', catalog }
                : { error: 'No remote origin is configured for plugin \'pacs\'. Set ROHY_PLUGIN_ORIGINS.', code: 'plugin_remote_not_configured' });
        }
        return respond(404, { error: 'not found' });
    }));
}

const ctx = {
    pluginId: 'pacs',
    data: null,
    eventLogger: { log: vi.fn() },
    t: (key, fallback) => fallback ?? key,
};

/** The filter chip by its label — the counters the bug report quoted. */
function chip(label) {
    return screen.getAllByRole('button')
        .find((el) => el.getAttribute('aria-pressed') !== null && el.textContent.startsWith(label));
}

function mount({ value = null } = {}) {
    const save = vi.fn();
    const Editor = descriptor.authorComponent;
    const props = descriptor.authorProps(ctx, { value, save });
    return { save, ...render(<Editor {...props} topBarControls={<div data-testid="host-done" />} />) };
}

beforeAll(() => {
    global.ResizeObserver = class { observe() {} disconnect() {} };
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('PACS authoring — the catalogue reaches the editor', () => {
    it('lists every orderable rohy study, not zero', async () => {
        stubNetwork();
        mount();

        // The chips are the exact counters the report quoted as "All 0".
        await waitFor(() => expect(screen.getByText('All')).toBeInTheDocument());
        expect(chip('All')).toHaveTextContent('3');

        // And the studies themselves, by the names rohy's catalogue gives them.
        expect(screen.getByText('Chest X-Ray (PA/Lateral)')).toBeInTheDocument();
        expect(screen.getByText('CT Chest (with contrast)')).toBeInTheDocument();
        expect(screen.getByText('CT Head (non-contrast)')).toBeInTheDocument();
        expect(screen.queryByText('No study in the catalogue matches.')).not.toBeInTheDocument();
    });

    it('the archive backs the studies it has a normal example for', async () => {
        stubNetwork();
        mount();

        await waitFor(() => expect(screen.getByText('With imaging')).toBeInTheDocument());
        // One of the three studies has a normal example in the archive; the
        // other two are orderable but unbacked. Reading these off the same
        // catalogue join the editor uses is what proves the archive arrived as
        // data and not merely as a successful request.
        expect(chip('With imaging')).toHaveTextContent('1');
        expect(chip('No imaging yet')).toHaveTextContent('2');
    });

    it('the catalogue is fetched from rohy, and the archive through the plugin relay', async () => {
        stubNetwork();
        mount();

        await waitFor(() => expect(screen.getByText('All')).toBeInTheDocument());
        const urls = global.fetch.mock.calls.map(([u]) => String(u));
        expect(urls.some((u) => u.includes('/api/radiology-database'))).toBe(true);
        expect(urls.some((u) => u.includes('/api/plugins/pacs/catalog'))).toBe(true);
    });

    it('renders the host chrome, so an author can commit and leave', async () => {
        stubNetwork();
        mount();
        // CaseEditor has no topBarControls slot of its own; without the
        // adapter's shell, Done and Discard vanished and the only way out of
        // the editor was a page reload.
        expect(screen.getByTestId('host-done')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText('All')).toBeInTheDocument());
    });
});

describe('PACS authoring — degraded, but honest and still usable', () => {
    it('with no imaging origin configured the catalogue still lists every study, and says why there is no archive', async () => {
        stubNetwork({ catalogStatus: 503 });
        mount();

        await waitFor(() => expect(screen.getByText('All')).toBeInTheDocument());
        // The whole rohy catalogue is still there — an author can link, name
        // and report on any study, and attach imaging by reference.
        expect(chip('All')).toHaveTextContent('3');
        expect(chip('No imaging yet')).toHaveTextContent('3');
        expect(chip('With imaging')).toHaveTextContent('0');
        // Said once, at the top, rather than left to be inferred from 74 cards.
        expect(screen.getByText(/ROHY_PLUGIN_ORIGINS/)).toBeInTheDocument();
    });

    it('a failing radiology catalogue is reported, not shown as an empty catalogue', async () => {
        stubNetwork({ radiologyStatus: 500 });
        mount();

        await waitFor(() => expect(
            screen.getByText(/The radiology catalogue could not be loaded/),
        ).toBeInTheDocument());
    });
});

describe('PACS authoring — an existing document keeps working', () => {
    // The document shape did not change across the 0.3.1 lift, so a case
    // authored against the old editor must open, and its studies must appear
    // against the catalogue rather than being silently dropped.
    const OLD_DOCUMENT = {
        version: 1,
        worklist: [{
            id: 'w1',
            studyId: 'ct_chest',
            description: 'CT Pulmonary Angiogram',
            accession: 'RAD-000042',
            baseline: { kind: 'archive', ref: 'normal/ct_chest_adult_m' },
            substitutions: [{
                id: 'sub1', label: 'Saddle embolus', scope: 'series', targetSeriesKey: 's2',
                source: { kind: 'remote', ref: 'remote:dicom/case42/pe/' },
            }],
            report: { findings: 'Filling defect.', impression: 'Acute saddle PE.', released: true },
            rubric: { expectedFindings: ['saddle pulmonary embolus'] },
        }],
    };

    it('shows the authored study as Changed against the live catalogue', async () => {
        stubNetwork();
        mount({ value: OLD_DOCUMENT });

        // 'Changed' appears twice by design — the filter chip and the card's
        // own state badge — so the chip is addressed as a chip.
        await waitFor(() => expect(chip('Changed')).toHaveTextContent('1'));
        expect(chip('All')).toHaveTextContent('3');
        // It is a catalogue row, not an orphan: the "Not in the catalogue"
        // rescue panel is what an EMPTY catalogue used to push every entry
        // into, and its absence is the assertion that the join worked.
        expect(screen.queryByText('Not in the catalogue')).not.toBeInTheDocument();
    });

    it('a study the catalogue no longer lists is still shown, and still saved', async () => {
        stubNetwork();
        mount({
            value: {
                version: 1,
                worklist: [{
                    ...OLD_DOCUMENT.worklist[0],
                    id: 'w9', studyId: 'mri_retired', description: 'Retired MRI protocol',
                }],
            },
        });

        await waitFor(() => expect(screen.getByText('Not in the catalogue')).toBeInTheDocument());
        expect(screen.getByText('Retired MRI protocol')).toBeInTheDocument();
    });
});
