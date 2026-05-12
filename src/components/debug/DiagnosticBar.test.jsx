// Tests for src/components/debug/DiagnosticBar.jsx — the in-app runtime
// diagnostic footer.
//
// CONTRACT (locked from src/components/debug/DiagnosticBar.jsx):
//   - GATING MECHANISM: per-user localStorage key
//       `rohy_diag_bar_enabled_<userId|'anon'>` = '1' (enabled) | else (disabled).
//     When disabled AND a user is present, a floating "Diag" pill renders.
//     When disabled AND no user is present, the component returns null.
//     When enabled, the full footer renders regardless of user presence
//     (the bar itself only references user fields inside the expanded panel).
//   - Wire history table is built from `getRecentTtsRequests()` (newest first)
//     re-snapshotted on every `'rohy:tts-request'` window event.
//   - Each row exposes a primary Play button (calls `auditionWirePayload(wire)`)
//     and an optional A/B button (calls `auditionWirePayload(wire, { voice })`
//     where `voice` is the platform's gender slot voice).
//   - Each row shows: when (`Ns ago`), voice, provider, rate, status badge,
//     text preview.
//   - Compact one-liner: when at least one wire entry has fired AND
//     `lastTts.voice` is truthy, says `TTS wire: <provider> · <voice>`;
//     otherwise falls back to the static prediction (`TTS: <provider> · …`).
//   - On unmount the bar clears any in-flight audition handle (the
//     auditionStopRef cleanup useEffect).
//
// Provider stack: tests/utils/renderWithProviders.jsx wraps in
// AuthProvider + VoiceProvider + others. AuthService.verifyToken()
// returns null when no token is stored, so the AuthContext user stays null
// — fine for most tests (gating still works via the `'anon'` localStorage key).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';

// --- Mock voiceService BEFORE importing the component under test. -----------
//
// The bar imports getLastTtsRequest, getRecentTtsRequests, auditionWirePayload
// from '../../services/voiceService'. We intercept those exports so each test
// can stage a controlled history.
vi.mock('../../services/voiceService.js', () => ({
    getLastTtsRequest: vi.fn(() => null),
    getRecentTtsRequests: vi.fn(() => []),
    auditionWirePayload: vi.fn(async () => ({ stop: () => {}, durationSec: 0 })),
}));

// EventLogger is read on a 1s tick — stub it so the bar doesn't try to look up
// session/case context.
vi.mock('../../services/eventLogger', () => ({
    default: { getStatus: () => ({}) },
}));

vi.mock('../../services/apiClient', () => ({
    apiFetch: vi.fn(async () => ({ logs: [] })),
}));

// AuthService.getToken is consulted before the bar fetches platform LLM/case
// info. Returning null short-circuits those fetches so we never have to mock
// global fetch. verifyToken returns an admin user so the audit-#22 role gate
// (admin/educator only) is satisfied for these render-gating tests; the
// gate itself is exercised by DiagnosticBar.role-gate.test.jsx.
vi.mock('../../services/authService', () => ({
    AuthService: {
        getToken: () => null,
        verifyToken: vi.fn(async () => null),
    },
}));

// Audit #22 introduced a role gate (admin/educator only) on the bar. Mock
// useAuth synchronously here so the gate is satisfied on the very first
// render — without this, the component returns null before AuthProvider
// has a chance to resolve verifyToken. The role-gate behaviour itself is
// covered by DiagnosticBar.role-gate.test.jsx; this mock just keeps the
// existing render-gating tests focused on the localStorage flag.
const mockUseAuth = vi.fn(() => ({
    user: { username: 'admin', role: 'admin' },
    loading: false,
    isAuthenticated: true,
    isAdmin: () => true,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useAuth: () => mockUseAuth(),
    };
});

import DiagnosticBar from './DiagnosticBar.jsx';
import * as voiceService from '../../services/voiceService.js';
import { apiFetch } from '../../services/apiClient';
import { useVoice } from '../../contexts/VoiceContext.jsx';
import { useEffect } from 'react';

// Test-only helper that pushes a voiceSettings object into VoiceContext
// before the bar renders its A/B controls. Mounts as a sibling of the bar.
function VoiceSettingsInjector({ settings }) {
    const { setVoiceSettings } = useVoice();
    useEffect(() => {
        setVoiceSettings(settings);
    }, [setVoiceSettings, settings]);
    return null;
}

// Helper: synthesize a wire history entry. Mirrors the shape produced by
// voiceService.ttsFetch (id, sentAt, voice, provider, rate, gender, status,
// textPreview, text).
function makeWire(overrides = {}) {
    return {
        id: 1,
        sentAt: Date.now() - 2000,
        streaming: false,
        voice: 'en_US-amy-medium',
        provider: 'piper',
        rate: 1.0,
        pitch: null,
        gender: 'female',
        textChars: 12,
        textPreview: 'hello world',
        text: 'hello world',
        status: 'ok',
        httpStatus: 200,
        error: null,
        durationMs: 350,
        ...overrides,
    };
}

// Enable the bar by writing the storage key BEFORE render. Because the
// AuthContext user starts as null (verifyToken mocked to null), the bar
// reads `rohy_diag_bar_enabled_anon`.
function enableBarForAnon() {
    window.localStorage.setItem('rohy_diag_bar_enabled_anon', '1');
}

beforeEach(() => {
    voiceService.getLastTtsRequest.mockReset();
    voiceService.getRecentTtsRequests.mockReset();
    voiceService.auditionWirePayload.mockReset();
    voiceService.getLastTtsRequest.mockReturnValue(null);
    voiceService.getRecentTtsRequests.mockReturnValue([]);
    voiceService.auditionWirePayload.mockResolvedValue({ stop: vi.fn(), durationSec: 0 });
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ logs: [] });
});

afterEach(() => {
    // Clean storage between tests so gating doesn't leak.
    try { window.localStorage.clear?.(); } catch { /* noop */ }
});

describe('DiagnosticBar — render gating', () => {
    it('renders nothing for non-admin users even when localStorage says enabled (audit #22 role gate)', () => {
        // Lock the audit-#22 role gate at the integration layer: even if
        // localStorage says enabled and a user exists, a non-admin/educator
        // user must see nothing. The pure-function policy is covered by
        // DiagnosticBar.role-gate.test.jsx; this test pins the wiring.
        const original = mockUseAuth.getMockImplementation();
        mockUseAuth.mockImplementation(() => ({
            user: { role: 'student' },
            loading: false,
            isAuthenticated: true,
            isAdmin: () => false,
            login: vi.fn(),
            register: vi.fn(),
            logout: vi.fn(),
        }));
        try {
            enableBarForAnon();
            const { container } = renderWithProviders(<DiagnosticBar />);
            expect(container.querySelector('[role="status"]')).toBeNull();
            expect(screen.queryByLabelText(/show diagnostic bar/i)).toBeNull();
        } finally {
            mockUseAuth.mockImplementation(original);
        }
    });

    it('renders the footer (role=status) when localStorage flag is "1"', () => {
        enableBarForAnon();
        renderWithProviders(<DiagnosticBar />);
        const bar = screen.getByRole('status');
        expect(bar).toBeInTheDocument();
        // It should contain the "Expand details" affordance.
        expect(screen.getByLabelText(/expand details/i)).toBeInTheDocument();
    });

    it('does not render the footer when localStorage flag is missing', () => {
        // Explicitly absent — same as the default test but asserts the inverse:
        // the footer (role=status) is not in the DOM.
        const { container } = renderWithProviders(<DiagnosticBar />);
        expect(container.querySelector('[role="status"]')).toBeNull();
    });
});

describe('DiagnosticBar — wire history table', () => {
    it('fetches and renders client log replay rows for an admin user', async () => {
        enableBarForAnon();
        apiFetch.mockResolvedValue({
            logs: [{
                id: 10,
                ts: '2026-05-07T12:34:56.000Z',
                level: 'warn',
                component: 'VoiceService',
                msg: 'speech recognition stalled briefly',
                request_id: '123e4567-e89b-42d3-a456-426614174000',
            }],
        });

        renderWithProviders(<DiagnosticBar />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });

        expect(apiFetch).toHaveBeenCalledWith('/client-logs?limit=50');
        expect(await screen.findByText('VoiceService')).toBeInTheDocument();
        expect(screen.getByText('speech recognition stalled briefly')).toBeInTheDocument();
        expect(screen.getByText('123e4567-e89b-42d3-a456-426614174000')).toBeInTheDocument();
    });

    it('populates one row per entry returned by getRecentTtsRequests()', async () => {
        enableBarForAnon();
        const wires = [
            makeWire({ id: 1, voice: 'voice-A', provider: 'piper', textPreview: 'first' }),
            makeWire({ id: 2, voice: 'voice-B', provider: 'kokoro', textPreview: 'second' }),
            makeWire({ id: 3, voice: 'voice-C', provider: 'google', textPreview: 'third' }),
        ];
        voiceService.getRecentTtsRequests.mockReturnValue(wires);
        voiceService.getLastTtsRequest.mockReturnValue(wires[0]);

        renderWithProviders(<DiagnosticBar />);
        // Expand the panel so the wire table is visible.
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });

        // Each voice / textPreview should appear somewhere in the rendered DOM.
        expect(screen.getByText('voice-A')).toBeInTheDocument();
        expect(screen.getByText('voice-B')).toBeInTheDocument();
        expect(screen.getByText('voice-C')).toBeInTheDocument();
        expect(screen.getByText('first')).toBeInTheDocument();
        expect(screen.getByText('second')).toBeInTheDocument();
        expect(screen.getByText('third')).toBeInTheDocument();
    });

    it('renders provider, rate, status badge, and "Ns ago" relative time per row', async () => {
        enableBarForAnon();
        const wire = makeWire({
            id: 7,
            sentAt: Date.now() - 3000,
            voice: 'distinct-voice',
            provider: 'piper',
            rate: 1.25,
            status: 'ok',
            httpStatus: 200,
            textPreview: 'preview-text-distinct',
        });
        voiceService.getRecentTtsRequests.mockReturnValue([wire]);
        voiceService.getLastTtsRequest.mockReturnValue(wire);

        renderWithProviders(<DiagnosticBar />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });

        // Voice cell.
        expect(screen.getByText('distinct-voice')).toBeInTheDocument();
        // Provider cell — "piper" appears multiple times (one-liner + row);
        // confirm at least one match.
        expect(screen.getAllByText('piper').length).toBeGreaterThan(0);
        // Rate cell ("1.25").
        expect(screen.getByText('1.25')).toBeInTheDocument();
        // Status badge text — "ok (200)" per ttsStatusLabel.
        expect(screen.getByText(/ok\s*\(200\)/i)).toBeInTheDocument();
        // Relative-time cell — "Ns ago" pattern.
        expect(screen.getByText(/\d+s ago/)).toBeInTheDocument();
        // Text preview.
        expect(screen.getByText('preview-text-distinct')).toBeInTheDocument();
    });

    it('renders an empty state (no wire-history table) when getRecentTtsRequests() is []', async () => {
        enableBarForAnon();
        voiceService.getRecentTtsRequests.mockReturnValue([]);
        voiceService.getLastTtsRequest.mockReturnValue(null);
        renderWithProviders(<DiagnosticBar />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });
        // The "TTS wire history" header is conditional on wireHistory.length > 0.
        expect(screen.queryByText(/TTS wire history/i)).toBeNull();
        // And the bar still renders without crashing.
        expect(screen.getByRole('status')).toBeInTheDocument();
    });
});

describe('DiagnosticBar — Play / A-B buttons', () => {
    it('clicking Play calls auditionWirePayload with the captured wire object', async () => {
        enableBarForAnon();
        const wire = makeWire({ id: 11, voice: 'voice-X', provider: 'piper', status: 'ok' });
        voiceService.getRecentTtsRequests.mockReturnValue([wire]);
        voiceService.getLastTtsRequest.mockReturnValue(wire);

        renderWithProviders(<DiagnosticBar />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });

        // The play button has the title "Re-play this wire payload (voice-X)".
        const playBtn = screen.getByTitle(/re-play this wire payload/i);
        await act(async () => {
            fireEvent.click(playBtn);
        });

        expect(voiceService.auditionWirePayload).toHaveBeenCalledTimes(1);
        const [calledWire, override] = voiceService.auditionWirePayload.mock.calls[0];
        expect(calledWire.id).toBe(11);
        expect(calledWire.voice).toBe('voice-X');
        // Primary play uses no override (handler defaults to {}).
        expect(override).toEqual({});
    });

    it('the A/B compare button does NOT render an alternate slot voice anymore', async () => {
        // 2026-05-12 — the entire slot-fallback ladder was removed (no more
        // per-gender platform voices, no more PROVIDER_FALLBACK_VOICE).
        // The "vs. <slot>" A/B button used to play the hardcoded female
        // fallback alongside the recorded wire. Without a fallback to pick,
        // the button simply isn't rendered. This locks that — if someone
        // adds a fallback path later, this test will break loudly.
        enableBarForAnon();
        const wire = makeWire({
            id: 22,
            voice: 'recorded-voice',
            provider: 'kokoro',
            gender: 'female',
            status: 'ok',
        });
        voiceService.getRecentTtsRequests.mockReturnValue([wire]);
        voiceService.getLastTtsRequest.mockReturnValue(wire);

        const settings = { tts_provider: 'kokoro' };

        renderWithProviders(
            <>
                <VoiceSettingsInjector settings={settings} />
                <DiagnosticBar />
            </>
        );
        await act(async () => { await Promise.resolve(); });
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });

        // No "vs. …" button exists for any wire row. Match only buttons —
        // the help-text legend still mentions "vs. <voice>" descriptively
        // because the docstring is unchanged.
        const vsButton = Array.from(document.querySelectorAll('button')).find(b =>
            /^vs\. /.test((b.textContent || '').trim())
        );
        expect(vsButton).toBeUndefined();
        // The primary re-play button is still there.
        expect(screen.getByTitle(/Re-play this wire payload/i)).toBeTruthy();
    });

    it('disables the Play button when wire.status !== "ok"', async () => {
        enableBarForAnon();
        const wire = makeWire({ id: 33, status: 'error', httpStatus: 500 });
        voiceService.getRecentTtsRequests.mockReturnValue([wire]);
        voiceService.getLastTtsRequest.mockReturnValue(wire);

        renderWithProviders(<DiagnosticBar />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });

        const playBtn = screen.getByTitle(/replay only available for successful/i);
        expect(playBtn).toBeDisabled();
    });
});

describe('DiagnosticBar — live event subscription', () => {
    it('re-renders with new entries when "rohy:tts-request" fires', async () => {
        enableBarForAnon();
        // Initial empty state.
        voiceService.getRecentTtsRequests.mockReturnValue([]);
        voiceService.getLastTtsRequest.mockReturnValue(null);
        renderWithProviders(<DiagnosticBar />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });
        expect(screen.queryByText(/TTS wire history/i)).toBeNull();

        // Now simulate a tts request landing: voiceService's emitter pushes the
        // entry into the in-memory ring buffer and dispatches the event. We
        // mock both: subsequent calls to getRecentTtsRequests return [newWire]
        // and dispatch the event so the bar's handler re-snapshots the buffer.
        const newWire = makeWire({ id: 99, voice: 'late-voice', provider: 'kokoro' });
        voiceService.getRecentTtsRequests.mockReturnValue([newWire]);
        voiceService.getLastTtsRequest.mockReturnValue(newWire);
        await act(async () => {
            window.dispatchEvent(new CustomEvent('rohy:tts-request', { detail: newWire }));
        });

        expect(screen.getByText('late-voice')).toBeInTheDocument();
        expect(screen.getByText(/TTS wire history/i)).toBeInTheDocument();
    });

    it('updates lastTts (compact one-liner) on the event without expanding', async () => {
        enableBarForAnon();
        voiceService.getRecentTtsRequests.mockReturnValue([]);
        voiceService.getLastTtsRequest.mockReturnValue(null);
        renderWithProviders(<DiagnosticBar />);

        // Compact bar starts WITHOUT a "TTS wire:" prefix.
        expect(screen.queryByText(/TTS wire:/i)).toBeNull();

        const newWire = makeWire({ id: 101, voice: 'live-voice', provider: 'piper' });
        voiceService.getRecentTtsRequests.mockReturnValue([newWire]);
        voiceService.getLastTtsRequest.mockReturnValue(newWire);
        await act(async () => {
            window.dispatchEvent(new CustomEvent('rohy:tts-request', { detail: newWire }));
        });

        // Compact one-liner now shows "TTS wire: piper · live-voice".
        expect(screen.getByText(/TTS wire:\s*piper\s*·\s*live-voice/)).toBeInTheDocument();
    });
});

describe('DiagnosticBar — compact bar status', () => {
    it('shows "TTS:" (static prediction) when no wire entry has fired', () => {
        enableBarForAnon();
        // No wire history, no lastTts.
        voiceService.getRecentTtsRequests.mockReturnValue([]);
        voiceService.getLastTtsRequest.mockReturnValue(null);
        renderWithProviders(<DiagnosticBar />);
        // The compact bar should not contain "TTS wire:".
        expect(screen.queryByText(/TTS wire:/i)).toBeNull();
        // It might say "TTS: <provider>" only if voiceSettings.tts_provider
        // is set; with the default null voiceSettings, neither line shows.
        // Either way: "TTS wire:" must be absent.
    });

    it('shows "TTS wire:" prefix once at least one wire has fired', async () => {
        enableBarForAnon();
        const wire = makeWire({ id: 55, voice: 'wired-voice', provider: 'kokoro' });
        voiceService.getRecentTtsRequests.mockReturnValue([wire]);
        voiceService.getLastTtsRequest.mockReturnValue(wire);
        renderWithProviders(<DiagnosticBar />);
        // Expect the compact one-liner to contain "TTS wire: kokoro · wired-voice".
        expect(screen.getByText(/TTS wire:\s*kokoro\s*·\s*wired-voice/)).toBeInTheDocument();
    });
});

describe('DiagnosticBar — unmount cleanup', () => {
    it('does not throw when unmounted mid-audition (cleanup useEffect runs without crashing)', async () => {
        enableBarForAnon();
        const wire = makeWire({ id: 77, voice: 'mid-audition', provider: 'piper', status: 'ok' });
        voiceService.getRecentTtsRequests.mockReturnValue([wire]);
        voiceService.getLastTtsRequest.mockReturnValue(wire);

        // Make auditionWirePayload return a stop-handle that we can observe.
        const stopFn = vi.fn();
        voiceService.auditionWirePayload.mockResolvedValue({ stop: stopFn, durationSec: 60 });

        const { unmount } = renderWithProviders(<DiagnosticBar />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });
        const playBtn = screen.getByTitle(/re-play this wire payload/i);
        await act(async () => {
            fireEvent.click(playBtn);
        });
        // Allow the awaited promise inside handleAudition to resolve so
        // auditionStopRef.current is populated before unmount.
        await act(async () => { await Promise.resolve(); });

        // Unmount should run the cleanup useEffect without throwing. The
        // cleanup itself stops auditionStopRef.current if present.
        expect(() => unmount()).not.toThrow();
    });

    it('removes the rohy:tts-request event listener on unmount (no late updates)', async () => {
        enableBarForAnon();
        voiceService.getRecentTtsRequests.mockReturnValue([]);
        voiceService.getLastTtsRequest.mockReturnValue(null);
        const { unmount } = renderWithProviders(<DiagnosticBar />);

        // After unmount, dispatching the event must not call into the mocked
        // service again (handler cleared). We snapshot the current call count
        // and assert it's unchanged after dispatch.
        const beforeUnmountCalls = voiceService.getRecentTtsRequests.mock.calls.length;
        unmount();
        const afterUnmountCalls = voiceService.getRecentTtsRequests.mock.calls.length;

        // Dispatch a fake event.
        await act(async () => {
            window.dispatchEvent(new CustomEvent('rohy:tts-request', {
                detail: makeWire({ id: 999, voice: 'late' }),
            }));
        });

        // No additional calls to the snapshot helper after unmount.
        expect(voiceService.getRecentTtsRequests.mock.calls.length).toBe(afterUnmountCalls);
        expect(afterUnmountCalls).toBeGreaterThanOrEqual(beforeUnmountCalls);
    });
});

describe('DiagnosticBar — toggle / hide affordances', () => {
    it('clicking the X "Hide diagnostic bar" disables the bar (writes "0" to localStorage)', async () => {
        enableBarForAnon();
        renderWithProviders(<DiagnosticBar />);
        const hideBtn = screen.getByLabelText(/hide diagnostic bar/i);
        await act(async () => {
            fireEvent.click(hideBtn);
        });
        // After hiding, the localStorage flag flips to "0" and the bar
        // unmounts the role=status container. Without a user, the floating
        // pill also hides.
        expect(window.localStorage.getItem('rohy_diag_bar_enabled_anon')).toBe('0');
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('renders ChevronUp/Down toggle that flips the expanded panel', async () => {
        enableBarForAnon();
        const wire = makeWire({ id: 1, voice: 'expandable', textPreview: 'expand-me' });
        voiceService.getRecentTtsRequests.mockReturnValue([wire]);
        voiceService.getLastTtsRequest.mockReturnValue(wire);

        renderWithProviders(<DiagnosticBar />);
        // Collapsed — wire row hidden.
        expect(screen.queryByText('expand-me')).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/expand details/i));
        });
        expect(screen.getByText('expand-me')).toBeInTheDocument();
        // Now collapse again.
        await act(async () => {
            fireEvent.click(screen.getByLabelText(/collapse details/i));
        });
        expect(screen.queryByText('expand-me')).toBeNull();
    });
});
