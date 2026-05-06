// Component-level contract for DiscussionScreen.jsx — the post-session
// debrief screen. The hook (useDiscussionEngine) is unit-tested separately
// in tests/utils/useDiscussionEngine.js + a sibling Phase-4 file, so here
// we mock it and only verify how the *component* wires its state, props,
// and side effects:
//
//   1. fetches discussant on mount via discussionService.fetchDiscussantForCase
//   2. renders a loading placeholder until the discussant resolves
//   3. shows a "Start debrief" gate before startConversation() runs
//   4. clicking Start invokes the hook's startConversation()
//   5. PatientAvatar is mounted with the discussant's avatarUrl + speaking/visemes
//   6. "Back to Cases" button invokes the onClose prop (the close affordance)
//   7. when the discussant resolves to null, an empty-case banner is shown
//      ("No discussant configured.")
//   8. re-rendering with the same activeCase.id does NOT refetch the discussant
//
// Heavy React-three-fiber children (PatientAvatar, PatientSummaryCard) and
// modal/drawer siblings are stubbed — the contract under test is the
// state machine in DiscussionScreen, not those leaves.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';

// --- Mock the hook BEFORE importing the SUT --------------------------------
// CONTRACT: DiscussionScreen consumes { messages, busy, speaking, visemes,
// sendMessage, startConversation } from useDiscussionEngine. We hand-roll a
// controllable spy state so individual tests can flip values mid-test by
// re-rendering after mutating `hookState`.
const hookState = {
    messages: [],
    busy: false,
    speaking: false,
    visemes: null,
    sendMessage: vi.fn(),
    startConversation: vi.fn(() => Promise.resolve()),
};

vi.mock('../../hooks/useDiscussionEngine', () => ({
    useDiscussionEngine: () => hookState,
}));

// --- Mock the discussant fetcher -------------------------------------------
// CONTRACT: DiscussionScreen calls fetchDiscussantForCase(activeCase.id)
// inside a mount-time useEffect. We mock the module so we can assert call
// count and shape without standing up an msw server.
const fetchDiscussantForCase = vi.fn();
vi.mock('../../services/discussionService', () => ({
    fetchDiscussantForCase: (...args) => fetchDiscussantForCase(...args),
}));

// --- Mock the lazy-loaded 3D avatar ----------------------------------------
// CONTRACT: DiscussionScreen lazy()-imports PatientAvatar.jsx. We replace
// it with a tiny DOM probe that surfaces the props we care about so tests
// can assert wiring (avatarId, speaking, visemes) without spinning up
// react-three-fiber inside jsdom.
vi.mock('../chat/PatientAvatar.jsx', () => ({
    default: function PatientAvatarStub(props) {
        return (
            <div
                data-testid="patient-avatar"
                data-avatar-id={props.avatarId ?? ''}
                data-speaking={String(!!props.speaking)}
                data-has-visemes={props.visemes ? 'yes' : 'no'}
                data-patient-id={props.patient?.id ?? ''}
            />
        );
    },
}));

// --- Mock heavy sibling components -----------------------------------------
// These are tested elsewhere; they only complicate this file's mounts.
vi.mock('./PatientSummaryCard', () => ({
    default: function PatientSummaryCardStub({ activeCase }) {
        return <div data-testid="patient-summary-card" data-case-id={activeCase?.id ?? ''} />;
    },
}));
vi.mock('./NotesDrawer', () => ({
    default: function NotesDrawerStub({ open }) {
        return open ? <div data-testid="notes-drawer" /> : null;
    },
}));
vi.mock('./TextComposerModal', () => ({
    default: function TextComposerModalStub() { return <div data-testid="text-composer" />; },
}));
vi.mock('./CaseSummaryModal', () => ({
    default: function CaseSummaryModalStub() { return <div data-testid="case-summary" />; },
}));
vi.mock('./DiscussionTranscript', () => ({
    default: function DiscussionTranscriptStub() { return <div data-testid="discussion-transcript" />; },
}));
vi.mock('./VoiceControl', () => ({
    default: function VoiceControlStub({ onSend, busy }) {
        return (
            <button
                type="button"
                data-testid="voice-control"
                data-busy={String(!!busy)}
                onClick={() => onSend?.('hi')}
            >voice-control</button>
        );
    },
}));

// EventLogger writes to a network endpoint we don't want to hit in tests.
vi.mock('../../services/eventLogger', () => ({
    default: { componentOpened: vi.fn(), componentClosed: vi.fn() },
    COMPONENTS: { DISCUSSION_SCREEN: 'DISCUSSION_SCREEN' },
}));

// Now import the SUT and providers helper after all mocks are registered.
import DiscussionScreen from './DiscussionScreen.jsx';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

// --- Helpers ----------------------------------------------------------------
function makeDiscussant(overrides = {}) {
    return {
        id: 'd-1',
        templateId: 't-1',
        name: 'Dr. Debrief',
        roleTitle: 'Case Debrief Tutor',
        avatarUrl: 'avatar://glb/clinician_male.glb',
        systemPrompt: '',
        voice: { gender: 'male' },
        ...overrides,
    };
}

const ACTIVE_CASE = { id: 'case-42', name: 'Chest Pain', config: {} };

function resetHookState() {
    hookState.messages = [];
    hookState.busy = false;
    hookState.speaking = false;
    hookState.visemes = null;
    hookState.sendMessage = vi.fn();
    hookState.startConversation = vi.fn(() => Promise.resolve());
}

beforeEach(() => {
    fetchDiscussantForCase.mockReset();
    resetHookState();
});

afterEach(() => {
    // renderWithProviders + setup.js handle DOM cleanup; nothing extra here.
});

// --- Tests ------------------------------------------------------------------

describe('DiscussionScreen — component contract', () => {
    it('CONTRACT 1: fetches the discussant for activeCase.id on mount', async () => {
        // Pending promise so the loading state is observable before resolution.
        let resolveFetch;
        fetchDiscussantForCase.mockImplementation(() => new Promise((res) => { resolveFetch = res; }));

        renderWithProviders(
            <DiscussionScreen sessionId="sess-1" activeCase={ACTIVE_CASE} onClose={() => {}} />
        );

        // Loading: discussant name slot shows the ellipsis placeholder.
        expect(screen.getByText('…')).toBeInTheDocument();
        expect(fetchDiscussantForCase).toHaveBeenCalledTimes(1);
        expect(fetchDiscussantForCase).toHaveBeenCalledWith('case-42');

        // Resolve so the unmount cleanup doesn't see an unhandled rejection.
        await act(async () => {
            resolveFetch(makeDiscussant());
        });
    });

    it('CONTRACT 2: renders the "Start debrief" gate once the discussant resolves', async () => {
        fetchDiscussantForCase.mockResolvedValue(makeDiscussant());

        renderWithProviders(
            <DiscussionScreen sessionId="sess-1" activeCase={ACTIVE_CASE} onClose={() => {}} />
        );

        // Wait for the discussant name to appear (loading → ready transition).
        const startBtn = await screen.findByRole('button', { name: /start debrief/i });
        expect(startBtn).toBeInTheDocument();
        expect(startBtn).not.toBeDisabled();
        // No VoiceControl yet — we're still pre-start.
        expect(screen.queryByTestId('voice-control')).toBeNull();
    });

    it('CONTRACT 3: clicking Start invokes the hook startConversation() and swaps in VoiceControl', async () => {
        fetchDiscussantForCase.mockResolvedValue(makeDiscussant());

        renderWithProviders(
            <DiscussionScreen sessionId="sess-1" activeCase={ACTIVE_CASE} onClose={() => {}} />
        );

        const startBtn = await screen.findByRole('button', { name: /start debrief/i });
        await act(async () => { fireEvent.click(startBtn); });

        expect(hookState.startConversation).toHaveBeenCalledTimes(1);
        // After Start the gate is replaced by the VoiceControl affordance.
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /start debrief/i })).toBeNull();
            expect(screen.getByTestId('voice-control')).toBeInTheDocument();
        });
    });

    it('CONTRACT 4: PatientAvatar receives the discussant avatarUrl and the hook speaking/visemes flags', async () => {
        const visemes = { jawOpen: 0.5 };
        hookState.speaking = true;
        hookState.visemes = visemes;
        fetchDiscussantForCase.mockResolvedValue(makeDiscussant({
            id: 'd-7',
            avatarUrl: 'avatar://glb/special.glb',
        }));

        renderWithProviders(
            <DiscussionScreen sessionId="sess-1" activeCase={ACTIVE_CASE} onClose={() => {}} />
        );

        const avatar = await screen.findByTestId('patient-avatar');
        expect(avatar.getAttribute('data-avatar-id')).toBe('avatar://glb/special.glb');
        expect(avatar.getAttribute('data-speaking')).toBe('true');
        expect(avatar.getAttribute('data-has-visemes')).toBe('yes');
        expect(avatar.getAttribute('data-patient-id')).toBe('d-7');
    });

    it('CONTRACT 5: "Back to Cases" button calls the onClose prop (the close affordance)', async () => {
        fetchDiscussantForCase.mockResolvedValue(makeDiscussant());
        const onClose = vi.fn();

        renderWithProviders(
            <DiscussionScreen sessionId="sess-1" activeCase={ACTIVE_CASE} onClose={onClose} />
        );

        const back = await screen.findByRole('button', { name: /back to cases/i });
        fireEvent.click(back);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('CONTRACT 6: when fetch resolves to null, the empty-case banner is rendered (no Start gate)', async () => {
        fetchDiscussantForCase.mockResolvedValue(null);

        renderWithProviders(
            <DiscussionScreen sessionId="sess-1" activeCase={ACTIVE_CASE} onClose={() => {}} />
        );

        // The "No discussant configured" copy is the friendly empty/error state.
        await waitFor(() => {
            expect(screen.getByText(/no discussant configured/i)).toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: /start debrief/i })).toBeNull();
    });

    it('CONTRACT 7: when fetch rejects, loading clears and the empty-case banner is shown', async () => {
        // The component swallows fetch errors and falls through to the
        // (!discussant && !loading) banner — same surface the user sees.
        fetchDiscussantForCase.mockRejectedValue(new Error('boom'));

        renderWithProviders(
            <DiscussionScreen sessionId="sess-1" activeCase={ACTIVE_CASE} onClose={() => {}} />
        );

        await waitFor(() => {
            expect(screen.getByText(/no discussant configured/i)).toBeInTheDocument();
        });
        // Loading placeholder is gone.
        expect(screen.queryByText('…')).toBeNull();
    });

    it('CONTRACT 8: re-rendering with the same activeCase.id does NOT refetch the discussant', async () => {
        fetchDiscussantForCase.mockResolvedValue(makeDiscussant());

        const { rerender } = renderWithProviders(
            <DiscussionScreen sessionId="sess-1" activeCase={ACTIVE_CASE} onClose={() => {}} />
        );

        await screen.findByRole('button', { name: /start debrief/i });
        expect(fetchDiscussantForCase).toHaveBeenCalledTimes(1);

        // Same id, new object identity — useEffect dep is activeCase?.id.
        rerender(
            <DiscussionScreen
                sessionId="sess-1"
                activeCase={{ ...ACTIVE_CASE }}
                onClose={() => {}}
            />
        );
        // No additional fetch.
        expect(fetchDiscussantForCase).toHaveBeenCalledTimes(1);
    });

    it('CONTRACT 9: changing activeCase.id DOES refetch the discussant (sanity check on the dep)', async () => {
        fetchDiscussantForCase.mockResolvedValue(makeDiscussant());

        const { rerender } = renderWithProviders(
            <DiscussionScreen sessionId="sess-1" activeCase={ACTIVE_CASE} onClose={() => {}} />
        );

        await screen.findByRole('button', { name: /start debrief/i });
        expect(fetchDiscussantForCase).toHaveBeenCalledTimes(1);
        expect(fetchDiscussantForCase).toHaveBeenLastCalledWith('case-42');

        rerender(
            <DiscussionScreen
                sessionId="sess-1"
                activeCase={{ id: 'case-99', name: 'Other', config: {} }}
                onClose={() => {}}
            />
        );

        await waitFor(() => {
            expect(fetchDiscussantForCase).toHaveBeenCalledTimes(2);
        });
        expect(fetchDiscussantForCase).toHaveBeenLastCalledWith('case-99');
    });

    it('CONTRACT 10: a prior persisted history seeds `started=true` and skips the Start gate', async () => {
        // The component reads localStorage[`rohy_discussion_history_${sid}`]
        // on first render and bypasses the gate when it's a non-empty array.
        // setup.js gives us a fresh in-memory localStorage per test.
        window.localStorage.setItem(
            'rohy_discussion_history_sess-resume',
            JSON.stringify([{ role: 'assistant', content: 'welcome back' }])
        );
        fetchDiscussantForCase.mockResolvedValue(makeDiscussant());

        renderWithProviders(
            <DiscussionScreen sessionId="sess-resume" activeCase={ACTIVE_CASE} onClose={() => {}} />
        );

        // Should land on VoiceControl directly — never show the gate.
        await screen.findByTestId('voice-control');
        expect(screen.queryByRole('button', { name: /start debrief/i })).toBeNull();
        expect(hookState.startConversation).not.toHaveBeenCalled();
    });
});
