// RPS-1 §11a.3(2) and §11a.4 — the authoring surface, and the loop it closes.
//
// The lifecycle the standard describes is:
//
//   wizard -> Plugins step -> Open editor -> PluginAuthor(value = config[id])
//     -> onSave(whole doc) -> wizard draft -> PUT /cases -> case_snapshot
//     -> room: available(ctx) judges ctx.data
//
// The server end of that is locked in tests/server/case-plugin-config.test.js.
// This file locks the client end: the editor is seeded from the case, its Done
// hands the WHOLE document back to the wizard, Discard guards a dirty draft,
// and what comes out is a document the pathology descriptor will actually serve.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';

// A stand-in for a plugin's editor: it renders the host's controls and offers
// one button that emits a document, which is all this surface's contract needs.
const editorSpy = vi.hoisted(() => vi.fn());
vi.mock('../../plugins/index.js', () => ({
    PluginAuthor: ({ value, onSave, topBarControls }) => {
        editorSpy({ value });
        return (
            <div>
                {topBarControls}
                <button type="button" onClick={() => onSave({ edited: true, from: value })}>
                    emit-document
                </button>
            </div>
        );
    },
}));

const { PluginAuthorSurface } = await import('./PluginAuthorSurface.jsx');

const caseData = (config = {}) => ({ id: 42, name: 'Case 42', config });

function renderSurface(config = {}) {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
        <PluginAuthorSurface
            pluginId="demo"
            caseData={caseData(config)}
            user={{ id: 1, role: 'educator' }}
            onCommit={onCommit}
            onClose={onClose}
        />
    );
    return { onCommit, onClose };
}

afterEach(() => { editorSpy.mockReset(); });

describe('PluginAuthorSurface', () => {
    it('seeds the editor from the case, so Open editor edits THIS case', () => {
        renderSurface({ demo: { existing: 'material' } });
        expect(editorSpy).toHaveBeenCalledWith({ value: { existing: 'material' } });
    });

    it('opens on nothing for a case with no material yet', () => {
        // The editor exists precisely when there is nothing — that is why
        // authoring is its own slot and is not gated by available().
        renderSurface({});
        expect(editorSpy).toHaveBeenCalledWith({ value: null });
    });

    it('hands the WHOLE document back to the wizard on Done', () => {
        // §8: the plugin hands back its whole document, never a patch, so the
        // host needs no change log to replay.
        const { onCommit } = renderSurface({ demo: { existing: 'material' } });
        fireEvent.click(screen.getByRole('button', { name: 'emit-document' }));
        fireEvent.click(screen.getByRole('button', { name: /done/i }));
        expect(onCommit).toHaveBeenCalledWith({ edited: true, from: { existing: 'material' } });
    });

    it('closes without asking when nothing was edited', () => {
        const { onClose, onCommit } = renderSurface({});
        fireEvent.click(screen.getByRole('button', { name: /discard/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('guards Discard once the draft is dirty', () => {
        // §11a.3(2): "The host guards Discard on a dirty draft." Authored
        // material is expensive to recreate — a stray click must not drop it.
        const { onClose } = renderSurface({});
        fireEvent.click(screen.getByRole('button', { name: 'emit-document' }));
        fireEvent.click(screen.getByRole('button', { name: /discard/i }));
        expect(onClose).not.toHaveBeenCalled();

        // The confirmation's own Discard is the one that actually leaves.
        const discards = screen.getAllByRole('button', { name: /discard/i });
        fireEvent.click(discards[discards.length - 1]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('§11a.4 — the document the wizard stores is one the room will serve', () => {
    it('a pathology document authored here makes available() true', async () => {
        // The loop, end to end on the client side: what Case Studio produces
        // and the wizard stores is exactly what the descriptor's gate accepts.
        // Without this, each half could be correct against its own fixture and
        // still disagree about a real case.
        const descriptor = (await import('../../plugins/pathology/index.jsx')).default;
        const {
            createStudioDocument, updateStudioEntity, addStudioBlock, addStudioSlide,
        } = await import('../../components/pathology/caseStudioModel.js');

        const count = new Map();
        const ids = (kind) => {
            const next = (count.get(kind) ?? 0) + 1;
            count.set(kind, next);
            return `${kind}-${next}`;
        };
        let doc = createStudioDocument({ idFactory: ids, now: () => '2026-08-29T00:00:00.000Z', createdBy: 't' });
        // Straight out of the editor with nothing in it: not servable, and the
        // wizard card says why rather than showing a clean card.
        expect(descriptor.available({ data: doc })).toBe(false);
        expect(descriptor.validate(doc).some((i) => i.level === 'error')).toBe(true);

        doc = updateStudioEntity(doc, 'specimen', 'specimen-1', { part: 'A', label: 'Breast' });
        doc = addStudioBlock(doc, 'specimen-1', { label: 'A1' }, ids);
        doc = addStudioSlide(doc, 'block-1', {
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
        }, { label: 'A1 — H&E', stainCode: 'HE', stainDisplay: 'H&E' }, ids);

        // Stored on the case exactly as the wizard would store it.
        const config = { demo: null, pathology: doc };
        expect(descriptor.available({ data: config.pathology })).toBe(true);
        expect(descriptor.validate(config.pathology).filter((i) => i.level === 'error')).toEqual([]);
        expect(descriptor.summarize(config.pathology).count).toBe(1);
    });
});
