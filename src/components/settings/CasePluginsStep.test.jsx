// RPS-1 §11a.3(1) — the wizard step that makes a plugin's editor discoverable.
//
// The property under test is that this step knows nothing about pathology. Its
// label, its one-line summary and its problem list all come from the plugin's
// descriptor, so a SECOND plugin shipping an editor appears here with no change
// to the component. Every test below therefore drives a FAKE plugin through a
// mocked registry — if any of them needed the real pathology descriptor, the
// component would have failed the standard.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';

const authors = vi.hoisted(() => vi.fn(() => []));
vi.mock('../../plugins/registry.js', () => ({ registry: { authors } }));

const { CasePluginsStep } = await import('./CasePluginsStep.jsx');

const fakePlugin = (over = {}) => ({
    manifest: {
        id: 'demo',
        authoring: { labelKey: 'demo_editor_label', minRole: 'educator' },
    },
    summarize: (doc) => ({ count: doc?.things?.length ?? 0, labelKey: 'demo_count' }),
    validate: () => [],
    ...over,
});

function renderStep({ config = {}, plugin = fakePlugin(), onOpenPluginAuthor } = {}) {
    authors.mockReturnValue(plugin ? [plugin] : []);
    const setCaseData = vi.fn();
    const view = renderWithProviders(
        <CasePluginsStep
            caseData={{ config }}
            setCaseData={setCaseData}
            role="educator"
            onOpenPluginAuthor={onOpenPluginAuthor}
        />
    );
    return { setCaseData, view };
}

afterEach(() => { authors.mockReset(); });

describe('CasePluginsStep', () => {
    it('renders nothing when no registered plugin ships an editor', () => {
        // §11a.3(1): "hidden when no registered plugin ships an editor". An
        // empty step is a dead page in the wizard's linear path.
        const { view } = renderStep({ plugin: null });
        expect(view.container.innerHTML).toBe('');
    });

    it('shows a card for a plugin with no material yet', () => {
        renderStep({ config: {} });
        // The editor must be reachable precisely when there is nothing yet —
        // that is the whole reason authoring is its own slot and is not gated
        // by available().
        expect(screen.getByRole('button', { name: /open editor/i })).toBeTruthy();
        // Nothing to remove when there is nothing there.
        expect(screen.queryByRole('button', { name: /^remove$/i })).toBeNull();
    });

    it('prints the plugin\'s own summary when the case carries material', () => {
        const summarize = vi.fn(() => ({ count: 3, labelKey: 'demo_count' }));
        renderStep({
            config: { demo: { things: [1, 2, 3] } },
            plugin: fakePlugin({ summarize }),
        });
        // The host asked the plugin rather than counting anything itself.
        expect(summarize).toHaveBeenCalledWith({ things: [1, 2, 3] });
        expect(screen.getByRole('button', { name: /^remove$/i })).toBeTruthy();
    });

    it('shows the plugin\'s validation issues, errors first', () => {
        renderStep({
            config: { demo: { things: [] } },
            plugin: fakePlugin({
                validate: () => [
                    { level: 'warning', message: 'A warning about this case' },
                    { level: 'error', message: 'A blocking problem' },
                ],
            }),
        });
        const text = document.body.textContent;
        expect(text).toContain('A blocking problem');
        expect(text).toContain('A warning about this case');
        // Errors first: they are the reasons the case cannot reach learners.
        expect(text.indexOf('A blocking problem')).toBeLessThan(text.indexOf('A warning about this case'));
    });

    it('survives a descriptor whose validate() throws', () => {
        // validate() is required of an authoring plugin, but a descriptor is
        // ordinary code. A plugin's bug must not take the case wizard down.
        expect(() => renderStep({
            config: { demo: { things: [] } },
            plugin: fakePlugin({ validate: () => { throw new Error('boom'); } }),
        })).not.toThrow();
        expect(screen.getByRole('button', { name: /open editor/i })).toBeTruthy();
    });

    it('removes the document only after a confirmation', () => {
        const { setCaseData } = renderStep({ config: { demo: { things: [1] } } });

        fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
        // The first click asks; it must not have written anything yet.
        expect(setCaseData).not.toHaveBeenCalled();

        // Confirm — the second "Remove" is inside the confirmation strip.
        const confirms = screen.getAllByRole('button', { name: /^remove$/i });
        fireEvent.click(confirms[confirms.length - 1]);
        expect(setCaseData).toHaveBeenCalledTimes(1);

        // Deleted, not set to undefined: an explicit undefined key survives a
        // spread and still reads as present to anything checking with `in`.
        const next = setCaseData.mock.calls[0][0]({ config: { demo: { things: [1] }, keep: 1 } });
        expect('demo' in next.config).toBe(false);
        expect(next.config.keep).toBe(1);
    });

    it('hands off to the host surface rather than mounting the editor inline', () => {
        // A plugin editor is a workstation; two headers and a wizard footer
        // around it is the wrong frame (§11a.3(2)).
        const onOpenPluginAuthor = vi.fn();
        renderStep({ config: {}, onOpenPluginAuthor });
        fireEvent.click(screen.getByRole('button', { name: /open editor/i }));
        expect(onOpenPluginAuthor).toHaveBeenCalledWith('demo');
    });

    it('disables the editor button when the host wired no surface', () => {
        renderStep({ config: {}, onOpenPluginAuthor: undefined });
        expect(screen.getByRole('button', { name: /open editor/i }).disabled).toBe(true);
    });
});

describe('CasePluginsStep — plugin keys resolve in the common namespace', () => {
    // Regression lock: the step's own strings are `authoring_config`, but a
    // plugin's `authoring.labelKey` and `summarize().labelKey` live in
    // `common` (where every plugin string lives, room labels included). The
    // hook's namespace rendered the raw keys — "room_pathology_author" on the
    // card instead of "Pathology case editor".
    it('renders the real pathology label and summary sentence, not the keys', () => {
        renderStep({
            config: { pathology: { manifest: { slides: [{ id: 's1' }] } } },
            plugin: fakePlugin({
                manifest: { id: 'pathology', authoring: { labelKey: 'room_pathology_author', minRole: 'educator' } },
                summarize: () => ({ count: 2, labelKey: 'pathology_summary_slides' }),
            }),
        });
        expect(screen.getByText('Pathology case editor')).toBeTruthy();
        expect(screen.getByText('2 slides')).toBeTruthy();
        expect(screen.queryByText('room_pathology_author')).toBeNull();
        expect(screen.queryByText('pathology_summary_slides')).toBeNull();
    });
});
