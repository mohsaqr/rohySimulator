import { describe, it, expect } from 'vitest';
import { createPluginContext, frozenCopy } from './context.js';

const manifest = (capabilities) => ({ id: 'demo', room: { key: 'demo' }, vocabulary: { verbs: {} }, capabilities });
const session = { id: 's1', caseId: 'c1', userId: 1, role: 'student', language: 'en', examMode: false };

// The 'case' grant promises read-only data. The host's live case object is
// shared by every core room, so the plugin gets a deep-frozen COPY: a
// write into it throws in strict mode and never reaches the host.
describe('plugin context: the case, conversation and drawer grants', () => {
    it('hands a plugin a frozen copy of the case, never the host object', () => {
        const live = { id: 'c1', config: { physical_exam: { chest: { palpation: { finding: 'tender' } } } } };
        const ctx = createPluginContext({ manifest: manifest(['case']), session, caseConfig: {}, eventLogger: {}, t: (k) => k, navigate: () => {}, grants: { patientCase: live } });
        expect(ctx.patientCase).toEqual(live);
        expect(ctx.patientCase).not.toBe(live);
        expect(Object.isFrozen(ctx.patientCase)).toBe(true);
        expect(Object.isFrozen(ctx.patientCase.config.physical_exam.chest.palpation)).toBe(true);
        expect(() => { ctx.patientCase.config.physical_exam.chest.palpation.finding = 'normal'; }).toThrow();
        expect(live.config.physical_exam.chest.palpation.finding).toBe('tender');
    });

    it('withholds the case from a plugin that did not ask', () => {
        const ctx = createPluginContext({ manifest: manifest([]), session, caseConfig: {}, eventLogger: {}, t: (k) => k, navigate: () => {}, grants: { patientCase: { id: 'c1' } } });
        expect(ctx.patientCase).toBeNull();
    });

    it('grants conversation and drawer only when requested and provided', () => {
        const conversation = { send: async () => {}, messages: [], loading: false, voiced: null, sessionId: 's1' };
        const openDrawer = () => {};
        const both = createPluginContext({ manifest: manifest(['conversation', 'drawer']), session, caseConfig: {}, eventLogger: {}, t: (k) => k, navigate: () => {}, grants: { conversation, openDrawer } });
        expect(both.capabilities.conversation).toBe(conversation);
        expect(both.capabilities.openDrawer).toBe(openDrawer);
        const neither = createPluginContext({ manifest: manifest([]), session, caseConfig: {}, eventLogger: {}, t: (k) => k, navigate: () => {}, grants: { conversation, openDrawer } });
        expect(neither.capabilities.conversation).toBeUndefined();
        expect(neither.capabilities.openDrawer).toBeUndefined();
    });

    it('frozenCopy: null for nothing, frozen all the way down otherwise', () => {
        expect(frozenCopy(null)).toBeNull();
        expect(frozenCopy(undefined)).toBeNull();
        const copy = frozenCopy({ a: [{ b: 1 }] });
        expect(Object.isFrozen(copy.a)).toBe(true);
        expect(Object.isFrozen(copy.a[0])).toBe(true);
    });
});
