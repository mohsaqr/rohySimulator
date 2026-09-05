import { describe, it, expect, vi } from 'vitest';
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

// RPS-1 1.6: the narrowed logger replaces the raw singleton.
describe('plugin context: ctx.log', () => {
    const sink = () => ({ log: vi.fn() });

    it('hands a plugin a narrowed log() that stamps its id, and never the raw singleton', () => {
        const eventLogger = sink();
        const m = { ...manifest([]), vocabulary: { verbs: { DID: { severity: 'INFO', category: 'CLINICAL' } }, objectTypes: { T: 'demo_t' } } };
        const ctx = createPluginContext({ manifest: m, session, caseConfig: {}, eventLogger, t: (k) => k, navigate: () => {} });
        expect(typeof ctx.log).toBe('function');
        expect(ctx.surface).toBe('room');
        ctx.log('DID', 'demo_t', { objectId: '1' });
        const [verb, objectType, options] = eventLogger.log.mock.calls[0];
        expect([verb, objectType]).toEqual(['DID', 'demo_t']);
        expect(options).toMatchObject({ room: 'demo', pluginId: 'demo', sessionId: 's1' });
        // The deprecated shim forwards log and refuses the mutators.
        ctx.eventLogger.log('DID', 'demo_t');
        expect(eventLogger.log).toHaveBeenCalledTimes(2);
        expect(() => ctx.eventLogger.setContext({ room: 'chat' })).toThrow();
        expect(ctx.eventLogger.currentVitals).toBeUndefined();
    });

    it('grants vitals as a frozen getter only when requested and provided', () => {
        const live = { hr: 88, spo2: 96 };
        const yes = createPluginContext({ manifest: manifest(['vitals']), session, caseConfig: {}, eventLogger: sink(), t: (k) => k, navigate: () => {}, grants: { vitals: () => live } });
        const snap = yes.capabilities.vitals();
        expect(snap).toEqual(live);
        expect(Object.isFrozen(snap)).toBe(true);
        const no = createPluginContext({ manifest: manifest([]), session, caseConfig: {}, eventLogger: sink(), t: (k) => k, navigate: () => {}, grants: { vitals: () => live } });
        expect(no.capabilities.vitals).toBeUndefined();
    });
});
