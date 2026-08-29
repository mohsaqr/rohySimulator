// RPS-1 §11a — the document contract, as the pathology descriptor implements it.
//
// These lock the two rules 1.3 added, both of which describe a failure that is
// invisible until a learner hits it:
//
//   R19  a plugin that ships an editor MUST expose validate(doc), or the
//        material every learner is assessed against goes out unreviewable.
//   R20  available() judges the DOCUMENT, not the presence of the key — a
//        saved-but-empty document must not light a room onto nothing.
//
// The judgements themselves belong upstream in the package (hostDocument.js);
// what is asserted here is that the adapter delegates to them and that the
// shapes the host consumes are the shapes the standard specifies.
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import descriptor from '../../src/plugins/pathology/index.jsx';
import { CaseAuthor } from '../../src/components/pathology/CaseAuthor.jsx';
import {
    addStudioBlock, addStudioGrossImage, addStudioSlide, createStudioDocument,
    updateStudioEntity,
} from '../../src/components/pathology/caseStudioModel.js';

function ids() {
    const count = new Map();
    return (kind) => {
        const next = (count.get(kind) ?? 0) + 1;
        count.set(kind, next);
        return `${kind}-${next}`;
    };
}

const catalogAsset = () => ({
    id: 'catalog-a1',
    label: 'catalog-a1 H&E',
    status: 'ready',
    sourceId: 'archive',
    format: 'svs',
    currentRevisionId: 'rev-1',
    revisions: [{
        id: 'rev-1',
        status: 'ready',
        createdAt: '2026-01-01T00:00:00.000Z',
        sourceChecksum: 'sha256:catalog-a1:rev-1',
        derivatives: { dzi: { url: 'https://cdn.example/catalog-a1.dzi' } },
        optics: {
            nativeObjective: 40, nativeMpp: 0.25, downsample: 4,
            slideWidthPx: 1000, slideHeightPx: 800, provenance: 'scanner',
        },
    }],
});

const blank = () => createStudioDocument({
    idFactory: ids(), now: () => '2026-08-28T12:00:00.000Z', createdBy: 'tester',
});

function withSlide() {
    const factory = ids();
    let doc = createStudioDocument({
        idFactory: factory, now: () => '2026-08-28T12:00:00.000Z', createdBy: 'tester',
    });
    doc = updateStudioEntity(doc, 'specimen', 'specimen-1', { part: 'A', label: 'Breast' });
    doc = addStudioBlock(doc, 'specimen-1', { label: 'A1' }, factory);
    return addStudioSlide(doc, 'block-1', catalogAsset(), {
        label: 'A1 — H&E', stainCode: 'HE', stainDisplay: 'H&E',
    }, factory);
}

function withPhotographOnly() {
    const factory = ids();
    let doc = createStudioDocument({
        idFactory: factory, now: () => '2026-08-28T12:00:00.000Z', createdBy: 'tester',
    });
    doc = updateStudioEntity(doc, 'specimen', 'specimen-1', { part: 'A', label: 'Breast' });
    return addStudioGrossImage(doc, 'specimen-1', {
        uri: 'https://cdn.example/gross/a.jpg', scaleMm: 120, checksum: 'sha256:abc',
    }, factory);
}

describe('R20 — available() judges the document, not the key', () => {
    it('declines a case with no pathology material at all', () => {
        expect(descriptor.available({ data: null })).toBe(false);
        expect(descriptor.available({ data: undefined })).toBe(false);
    });

    it('declines a document that was saved but never filled', () => {
        // The regression this rule exists for. `ctx.data != null` is TRUE here:
        // there is a real document, with a real specimen part in it, and
        // nothing a learner could look at. The old gate lit the room.
        const empty = blank();
        expect(empty).not.toBeNull();
        expect(empty.manifest.specimens.length).toBe(1);
        expect(descriptor.available({ data: empty })).toBe(false);
        expect(descriptor.available({ data: {} })).toBe(false);
    });

    it('accepts a slide alone, and a gross photograph alone', () => {
        expect(descriptor.available({ data: withSlide() })).toBe(true);
        // A specimen photographed but not yet sectioned is a normal case.
        expect(descriptor.available({ data: withPhotographOnly() })).toBe(true);
    });

    it('is unavailable rather than explosive on a malformed document', () => {
        // §9: a gate that throws is treated as unavailable, but a gate that
        // cannot throw is better — this one runs for every case in the list.
        for (const data of ['nonsense', 7, [], { manifest: { slides: 'no' } }]) {
            expect(() => descriptor.available({ data })).not.toThrow();
            expect(descriptor.available({ data })).toBe(false);
        }
    });
});

describe('R19 — the plugin judges its own document', () => {
    it('exposes validate(), because it declares authoring', () => {
        expect(descriptor.manifest.authoring).toBeTruthy();
        expect(typeof descriptor.validate).toBe('function');
    });

    it('returns issues in the { level, message } shape the host renders', () => {
        const issues = descriptor.validate(blank());
        expect(issues.length).toBeGreaterThan(0);
        for (const issue of issues) {
            expect(['error', 'warning']).toContain(issue.level);
            expect(typeof issue.message).toBe('string');
            expect(issue.message).not.toBe('');
        }
    });

    it('passes a case that has material', () => {
        expect(descriptor.validate(withSlide()).filter((i) => i.level === 'error')).toEqual([]);
    });

    it('agrees with available() about every document', () => {
        // The two halves must not contradict each other. A green card beside a
        // room that never appears leaves the author with nothing to read.
        for (const doc of [blank(), withSlide(), withPhotographOnly()]) {
            const publishable = !descriptor.validate(doc).some((i) => i.level === 'error');
            expect(publishable).toBe(descriptor.available({ data: doc }));
        }
    });

    it('reports rather than throws on material it cannot read', () => {
        expect(() => descriptor.validate({ manifest: { schemaVersion: '1.0.0', slides: 'no' } })).not.toThrow();
        expect(descriptor.validate({ manifest: { schemaVersion: '1.0.0', slides: 'no' } })[0].level).toBe('error');
        expect(descriptor.validate(null)).toEqual([]);
    });
});

describe('summarize() names its sentence rather than writing one', () => {
    it('counts material and returns a label key for the host to translate', () => {
        expect(descriptor.summarize(withSlide())).toEqual({ count: 1, labelKey: 'pathology_summary_slides' });
        expect(descriptor.summarize(withPhotographOnly()))
            .toEqual({ count: 1, labelKey: 'pathology_summary_photographs' });
        expect(descriptor.summarize(null)).toEqual({ count: 0, labelKey: 'pathology_summary_empty' });
    });
});

describe('the room receives the learner projection, never the author document', () => {
    const ctx = (data) => ({
        data,
        session: { examMode: false },
        eventLogger: { log() {} },
        t: (key, fallback) => fallback,
    });
    const persist = { state: {}, save() {} };

    it('hands the viewer a case with no rubric attached', () => {
        const doc = withSlide();
        expect(doc.rubric).toBeTruthy(); // the author's document HAS one
        const props = descriptor.props(ctx(doc), persist);
        expect(props.pathologyCase).toBeTruthy();
        expect(props.pathologyCase.rubric).toBeUndefined();
        // Nothing anywhere in the projection may name protected material.
        expect(JSON.stringify(props.pathologyCase)).not.toMatch(/rubric|answerKey|tissueBounds/);
    });

    it('carries the learner-visible slide through', () => {
        const props = descriptor.props(ctx(withSlide()), persist);
        expect(props.pathologyCase.slides).toHaveLength(1);
        expect(props.pathologyCase.slides[0].dzi).toBe('https://cdn.example/catalog-a1.dzi');
    });
});

describe('the editor is handed the whole canonical document, both ways', () => {
    it('opens a new case with no material rather than a legacy shell', () => {
        // `undefined`, not `null`: it means "no case", which is what makes the
        // editor create one and hand the CANONICAL document back. A legacy
        // shell would round-trip lossily and drop the rubric.
        expect(descriptor.authorProps({}, { value: null, save() {} }).initialCase).toBeUndefined();
    });

    it('normalises whatever the host stored before the editor sees it', () => {
        const legacy = {
            id: 'c1',
            accession: 'S26-9',
            slides: [{ id: 's1', label: 'A1', stain: 'H&E', dzi: '/slides/a.dzi' }],
        };
        const opened = descriptor.authorProps({}, { value: legacy, save() {} }).initialCase;
        expect(opened.manifest.schemaVersion).toBe('1.0.0');
        expect(opened.manifest.slides).toHaveLength(1);
        expect(opened.rubric).toBeTruthy();
    });
});

describe('a new case comes back canonical, not as a lossy legacy shell', () => {
    // The editor projects its document back OUT in whatever shape the host put
    // IN, so a legacy host keeps its contract. A host that put in NOTHING is
    // creating a new case and has no legacy contract to honour — and the legacy
    // projection drops the rubric, which is where every expected answer, ROI
    // and dwell threshold lives. Getting this wrong loses the assessment half
    // of every case rohy creates, silently, at the moment of creation.
    it('hands onChange a document with its rubric when opened on nothing', async () => {
        const saved = vi.fn();
        const props = descriptor.authorProps({}, { value: null, save: saved });
        expect(props.initialCase).toBeUndefined();

        // createElement rather than JSX: this project does not transform JSX
        // inside a .js test file.
        render(createElement(CaseAuthor, props));
        await userEvent.click(screen.getByRole('button', { name: /Save draft/i }));

        expect(saved).toHaveBeenCalledTimes(1);
        const [document] = saved.mock.calls[0];
        // A legacy projection has `slides` at the top and NO rubric at all.
        expect(document.manifest).toBeTruthy();
        expect(document.rubric).toBeTruthy();
        expect(document.manifest.schemaVersion).toBe('1.0.0');
        cleanup();
    });

    it('keeps manifest AND rubric when an existing document round-trips', () => {
        const opened = descriptor.authorProps({}, {
            value: { id: 'c1', slides: [{ id: 's1', label: 'A1', stain: 'H&E', dzi: '/a.dzi' }] },
            save() {},
        }).initialCase;
        expect(opened.manifest).toBeTruthy();
        expect(opened.rubric).toBeTruthy();
        expect(opened.manifest.schemaVersion).toBe('1.0.0');
    });
});
