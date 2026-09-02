import { describe, it, expect } from 'vitest';
import { validateManifest, ROOM_PRESENTATIONS } from '../../server/shared/pluginRegistry.js';

const base = (room = {}) => ({
    id: 'demo',
    room: { key: 'demo', labelKey: 'room_demo', subKey: 'room_demo_sub', icon: 'Bed', accent: 'teal', ...room },
    vocabulary: { verbs: {}, objectTypes: {}, components: {} },
    states: { verbFallbacks: {}, objectOverrides: {}, interpretations: {} },
    capabilities: [],
});

// `room.presentation` decides whether the host replaces the chat layout or
// draws the room over it with the session still running underneath. A typo
// would fail open into the wrong mode, so it is validated like the key.
describe('manifest room.presentation', () => {
    it('accepts absent (replace by default) and both named modes', () => {
        expect(() => validateManifest(base())).not.toThrow();
        for (const presentation of ROOM_PRESENTATIONS) {
            expect(() => validateManifest(base({ presentation }))).not.toThrow();
        }
        expect(ROOM_PRESENTATIONS).toEqual(['replace', 'overlay']);
    });

    it('rejects anything else, naming the field', () => {
        expect(() => validateManifest(base({ presentation: 'Overlay' }))).toThrow(/room\.presentation/);
        expect(() => validateManifest(base({ presentation: 'modal' }))).toThrow(/room\.presentation/);
        expect(() => validateManifest(base({ presentation: '' }))).toThrow(/room\.presentation/);
    });
});
