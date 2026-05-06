// Tests for VoiceContext.jsx — the shared voice/avatar state used by
// ChatInterface (writer) and PatientVisual (reader).
//
// CONTRACT (locked from src/contexts/VoiceContext.jsx):
//   - VoiceProvider supplies a context object with these state slots and
//     setters:
//       voiceMode (false), listening (false), speaking (false),
//       visemes ({ viseme_sil: 1 }), voiceSettings (null),
//       headManifest (null), platformAvatars (null),
//       activeParticipant (null)
//   - useVoice() throws "useVoice must be used within VoiceProvider" when
//     called without a provider above it.
//   - Setters update the corresponding slot; the rest of the value object
//     remains referentially stable across re-renders that don't change it
//     (the provider memoizes via useMemo).
//   - There is NO `initialSettings`-style prop — the provider only accepts
//     `children`. We lock that as a non-existent feature.
//
// Implementation notes:
//   - The eslint rule react-hooks/immutability forbids mutating outer-scope
//     variables during a render. We therefore push the live context value
//     out of the consumer through useEffect, which runs after commit and
//     is allowed. Each `act(() => ...)` flushes effects so reads in the
//     test body see the post-effect value.

import { describe, it, expect, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { VoiceProvider, useVoice } from './VoiceContext.jsx';

// Tiny consumer factory that publishes the live context value to an outer
// "snapshot" object via useEffect (the only place outer-scope mutation is
// permitted by react-hooks/immutability).
function makeProbe(snapshotRef, onCommit) {
    function Probe() {
        const ctx = useVoice();
        useEffect(() => {
            snapshotRef.current = ctx;
            if (onCommit) onCommit(ctx);
        });
        return (
            <div>
                <span data-testid="voiceMode">{String(ctx.voiceMode)}</span>
                <span data-testid="listening">{String(ctx.listening)}</span>
                <span data-testid="speaking">{String(ctx.speaking)}</span>
                <span data-testid="voiceSettings">{JSON.stringify(ctx.voiceSettings)}</span>
                <span data-testid="headManifest">{JSON.stringify(ctx.headManifest)}</span>
                <span data-testid="platformAvatars">{JSON.stringify(ctx.platformAvatars)}</span>
                <span data-testid="activeParticipant">{JSON.stringify(ctx.activeParticipant)}</span>
                <span data-testid="visemes">{JSON.stringify(ctx.visemes)}</span>
            </div>
        );
    }
    return Probe;
}

describe('VoiceProvider — defaults', () => {
    it('mounts and exposes default voiceSettings = null', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        expect(snapshotRef.current.voiceSettings).toBeNull();
        expect(screen.getByTestId('voiceSettings').textContent).toBe('null');
    });

    it('exposes default activeParticipant = null', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        expect(snapshotRef.current.activeParticipant).toBeNull();
        expect(screen.getByTestId('activeParticipant').textContent).toBe('null');
    });

    it('exposes default booleans (voiceMode, listening, speaking) = false', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        expect(snapshotRef.current.voiceMode).toBe(false);
        expect(snapshotRef.current.listening).toBe(false);
        expect(snapshotRef.current.speaking).toBe(false);
    });

    it('exposes default visemes = { viseme_sil: 1 }', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        expect(snapshotRef.current.visemes).toEqual({ viseme_sil: 1 });
    });

    it('exposes default headManifest and platformAvatars = null', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        expect(snapshotRef.current.headManifest).toBeNull();
        expect(snapshotRef.current.platformAvatars).toBeNull();
    });

    it('exposes setters for every slot', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        const ctx = snapshotRef.current;
        expect(typeof ctx.setVoiceMode).toBe('function');
        expect(typeof ctx.setListening).toBe('function');
        expect(typeof ctx.setSpeaking).toBe('function');
        expect(typeof ctx.setVisemes).toBe('function');
        expect(typeof ctx.setVoiceSettings).toBe('function');
        expect(typeof ctx.setHeadManifest).toBe('function');
        expect(typeof ctx.setPlatformAvatars).toBe('function');
        expect(typeof ctx.setActiveParticipant).toBe('function');
    });
});

describe('useVoice — guard', () => {
    it('throws when used outside a VoiceProvider', () => {
        // CONTRACT: hook is gated, not silently defaulted.
        function Bare() {
            useVoice();
            return null;
        }
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<Bare />)).toThrow(/useVoice must be used within VoiceProvider/);
        errSpy.mockRestore();
    });
});

describe('VoiceProvider — setters update state', () => {
    it('setVoiceSettings(x) updates voiceSettings', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        act(() => {
            snapshotRef.current.setVoiceSettings({ provider: 'google', voice: 'en-US-Standard-A' });
        });
        expect(snapshotRef.current.voiceSettings).toEqual({ provider: 'google', voice: 'en-US-Standard-A' });
        expect(screen.getByTestId('voiceSettings').textContent).toContain('google');
    });

    it('setActiveParticipant(x) updates activeParticipant', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        const participant = { id: 'p1', name: 'Alice', gender: 'female', avatar_id: 'a1' };
        act(() => {
            snapshotRef.current.setActiveParticipant(participant);
        });
        expect(snapshotRef.current.activeParticipant).toEqual(participant);
        expect(screen.getByTestId('activeParticipant').textContent).toContain('Alice');
    });

    it('boolean setters (setVoiceMode, setListening, setSpeaking) flip flags', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        act(() => {
            snapshotRef.current.setVoiceMode(true);
            snapshotRef.current.setListening(true);
            snapshotRef.current.setSpeaking(true);
        });
        expect(snapshotRef.current.voiceMode).toBe(true);
        expect(snapshotRef.current.listening).toBe(true);
        expect(snapshotRef.current.speaking).toBe(true);
    });

    it('setVisemes(x) replaces the viseme map', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        act(() => {
            snapshotRef.current.setVisemes({ viseme_aa: 0.8, viseme_sil: 0.2 });
        });
        expect(snapshotRef.current.visemes).toEqual({ viseme_aa: 0.8, viseme_sil: 0.2 });
    });

    it('setHeadManifest and setPlatformAvatars update their slots', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        act(() => {
            snapshotRef.current.setHeadManifest({ url: '/heads/m1.glb' });
            snapshotRef.current.setPlatformAvatars({ male: 'm1', female: 'f1' });
        });
        expect(snapshotRef.current.headManifest).toEqual({ url: '/heads/m1.glb' });
        expect(snapshotRef.current.platformAvatars).toEqual({ male: 'm1', female: 'f1' });
    });
});

describe('VoiceProvider — isolation and stability', () => {
    it('two providers do not share state', () => {
        const snapshotA = { current: null };
        const snapshotB = { current: null };
        const ProbeA = makeProbe(snapshotA);
        const ProbeB = makeProbe(snapshotB);
        render(
            <div>
                <VoiceProvider><ProbeA /></VoiceProvider>
                <VoiceProvider><ProbeB /></VoiceProvider>
            </div>
        );
        act(() => {
            snapshotA.current.setVoiceSettings({ tag: 'A' });
        });
        expect(snapshotA.current.voiceSettings).toEqual({ tag: 'A' });
        // CONTRACT: B's state is independent and remains at the default.
        expect(snapshotB.current.voiceSettings).toBeNull();
    });

    it('memoizes the context value across re-renders that do not change state', () => {
        // CONTRACT: useMemo stabilizes the value reference. A parent
        // re-render with no state change must not produce a new value
        // object (otherwise every consumer re-renders unnecessarily).
        const collected = [];
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef, (ctx) => collected.push(ctx));

        function Parent({ tick }) {
            return (
                <VoiceProvider>
                    <span data-testid="tick">{tick}</span>
                    <Probe />
                </VoiceProvider>
            );
        }
        const { rerender } = render(<Parent tick={1} />);
        rerender(<Parent tick={2} />);
        rerender(<Parent tick={3} />);
        // All captured value objects should be the same reference.
        expect(collected.length).toBeGreaterThanOrEqual(3);
        const first = collected[0];
        for (const v of collected) {
            expect(v).toBe(first);
        }
    });

    it('produces a NEW value reference after a state change (memo invalidates)', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        const before = snapshotRef.current;
        act(() => {
            snapshotRef.current.setVoiceSettings({ changed: true });
        });
        const after = snapshotRef.current;
        expect(after).not.toBe(before);
        expect(after.voiceSettings).toEqual({ changed: true });
    });

    it('setting the same primitive value does not re-render the consumer', () => {
        // CONTRACT: React's setState bails out when the new value is
        // Object.is-equal to the previous one. With a memoized context
        // value, no consumer re-render should fire.
        const renderCount = vi.fn();
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef, () => renderCount());
        render(<VoiceProvider><Probe /></VoiceProvider>);
        const initial = renderCount.mock.calls.length;
        act(() => {
            snapshotRef.current.setVoiceMode(false); // same as default
            snapshotRef.current.setListening(false);
            snapshotRef.current.setSpeaking(false);
        });
        expect(renderCount.mock.calls.length).toBe(initial);
    });

    it('does NOT accept an `initialSettings` (or similar) prop — only `children`', () => {
        // CONTRACT: the provider signature is `function VoiceProvider({ children })`.
        // Passing extra props is silently ignored; defaults still apply.
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(
            <VoiceProvider initialSettings={{ provider: 'google' }} initialActiveParticipant={{ id: 'x' }}>
                <Probe />
            </VoiceProvider>
        );
        expect(snapshotRef.current.voiceSettings).toBeNull();
        expect(snapshotRef.current.activeParticipant).toBeNull();
    });

    it('functional setter form works (setVoiceSettings(prev => ...))', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        act(() => {
            snapshotRef.current.setVoiceSettings({ count: 1 });
        });
        act(() => {
            snapshotRef.current.setVoiceSettings((prev) => ({ ...prev, count: prev.count + 1 }));
        });
        expect(snapshotRef.current.voiceSettings).toEqual({ count: 2 });
    });

    it('preserves unrelated slots when one slot updates', () => {
        const snapshotRef = { current: null };
        const Probe = makeProbe(snapshotRef);
        render(<VoiceProvider><Probe /></VoiceProvider>);
        act(() => {
            snapshotRef.current.setVoiceSettings({ a: 1 });
            snapshotRef.current.setActiveParticipant({ id: 'p1' });
        });
        act(() => {
            snapshotRef.current.setVoiceMode(true);
        });
        expect(snapshotRef.current.voiceSettings).toEqual({ a: 1 });
        expect(snapshotRef.current.activeParticipant).toEqual({ id: 'p1' });
        expect(snapshotRef.current.voiceMode).toBe(true);
    });

    it('child remount inside the same provider keeps existing state', () => {
        // CONTRACT: provider state lives in the provider, not the child.
        // Toggling the child shouldn't lose what was already set.
        const snapshotRef = { current: null };
        function Probe() {
            const ctx = useVoice();
            useEffect(() => {
                snapshotRef.current = ctx;
            });
            return <span data-testid="mounted">probe</span>;
        }
        function Wrap({ show }) {
            return <VoiceProvider>{show ? <Probe /> : <span data-testid="empty" />}</VoiceProvider>;
        }
        const { rerender } = render(<Wrap show />);
        act(() => {
            snapshotRef.current.setVoiceSettings({ persisted: true });
        });
        rerender(<Wrap show={false} />);
        rerender(<Wrap show />);
        expect(snapshotRef.current.voiceSettings).toEqual({ persisted: true });
    });
});
