import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useEffect } from 'react';

// A fake plugin in place of the registry: a manifest that asks for the
// 'conversation' capability, and a component that reports what it received.
const received = [];
let mounts = 0;
function Room({ conversation }) {
    useEffect(() => { mounts += 1; }, []);
    received.push(conversation);
    return <div data-testid="room">{conversation?.sessionId ?? 'none'}</div>;
}
// One stored descriptor, as the real registry keeps: PluginRoom memoises
// its context on the descriptor's identity, so a mock that minted a new
// object per call would remount the room on every render.
const descriptor = {
    manifest: {
        id: 'fake', room: { key: 'fake' }, vocabulary: { verbs: {} },
        capabilities: ['conversation'],
    },
    component: Room,
    available: () => true,
    props: (ctx) => ({ conversation: ctx.capabilities.conversation ?? null }),
    authorProps: () => ({}),
};
vi.mock('./registry.js', () => ({
    registry: { get: () => descriptor },
}));

const { PluginRoom } = await import('./PluginRoom.jsx');

const session = { id: 's1', caseId: 'c1', userId: 1, role: 'student', language: 'en', examMode: false };
const grantsWith = (conversation) => ({ conversation });
// Stable, as App's frozen case snapshot is: a fresh `{}` per render would be
// a new case to the mount and legitimately re-seed the room.
const caseConfig = {};

describe('PluginRoom', () => {
    it('hands a plugin the LIVE conversation grant, not the one from first mount', async () => {
        const first = { sessionId: null, messages: [], loading: false, voiced: null, send: vi.fn() };
        const view = render(
            <PluginRoom pluginId="fake" session={session} caseConfig={caseConfig} eventLogger={{}} grants={grantsWith(first)} navigate={() => {}} />,
        );
        // Nothing mounts until the (empty) persisted state has resolved.
        expect((await view.findByTestId('room')).textContent).toBe('none');

        // The chat room mounts and publishes its session: the SAME plugin
        // mount must see it, without being torn down and re-seeded.
        const live = { ...first, sessionId: 's1', messages: [{ role: 'user', content: 'hi' }] };
        view.rerender(
            <PluginRoom pluginId="fake" session={session} caseConfig={caseConfig} eventLogger={{}} grants={grantsWith(live)} navigate={() => {}} />,
        );
        expect((await view.findByTestId('room')).textContent).toBe('s1');
        expect(received.at(-1)).toBe(live);
        expect(mounts).toBe(1);
    });
});
