import { describe, it, expect } from 'vitest';
import { interactionSource, INTERACTION_SOURCE } from '../../server/routes/analytics-routes.js';

// `interactions.source` says where a patient-conversation turn came from:
// 'typed' / 'voice' (the chat room) or a plugin room id. It is validated on
// ingest to the plugin-id shape; anything else is stored as NULL — unknown,
// not rejected — so a mistyped client never loses the turn itself.
describe('POST /interactions source validation', () => {
    it('keeps the chat sources and plugin ids', () => {
        expect(interactionSource('typed')).toBe('typed');
        expect(interactionSource('voice')).toBe('voice');
        expect(interactionSource('room3d')).toBe('room3d');
        expect(interactionSource('a_b2')).toBe('a_b2');
    });

    it('stores anything that is not a lower_snake_case id as NULL', () => {
        expect(interactionSource(undefined)).toBeNull();
        expect(interactionSource(null)).toBeNull();
        expect(interactionSource(123)).toBeNull();
        expect(interactionSource('Room3D')).toBeNull();
        expect(interactionSource('room-3d')).toBeNull();
        expect(interactionSource('3room')).toBeNull();
        expect(interactionSource('../x')).toBeNull();
        expect(interactionSource('DROP TABLE interactions')).toBeNull();
        expect(interactionSource('a'.repeat(65))).toBeNull();
        expect(interactionSource('a'.repeat(64))).toBe('a'.repeat(64));
    });

    it('is the same shape the plugin registry enforces for ids', () => {
        expect(INTERACTION_SOURCE.test('pathology')).toBe(true);
        expect(INTERACTION_SOURCE.test('pacs')).toBe(true);
    });
});
