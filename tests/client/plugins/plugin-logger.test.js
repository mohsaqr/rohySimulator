// RPS-1 1.6 §6 — the narrowed plugin logger (`ctx.log`).
//
// What it locks: both call shapes reach the host as three positionals; an
// undeclared verb is redirected (never dropped) and throws in strict mode;
// object type and component are soft gates; prose never reaches context or
// objectName; room / plugin id / version / surface are host-stamped; the
// deprecation proxy forwards `log` and refuses global-state mutation.
import { describe, it, expect, vi } from 'vitest';
import {
    createPluginLogger, normalizeLogArgs, sanitizeContext, deprecatedEventLoggerProxy,
    PROSE_DENYLIST, CONTEXT_MAX_BYTES, OBJECT_NAME_MAX,
} from '../../../src/plugins/logger.js';

const manifest = {
    id: 'demo',
    version: '2.1.0',
    vocabulary: {
        verbs: { DID_A_THING: { severity: 'INFO', category: 'CLINICAL' } },
        coreVerbs: ['PERFORMED_PHYSICAL_EXAM'],
        objectTypes: { THING: 'demo_thing' },
        components: { ROOM: 'DemoRoom', PANEL: 'DemoPanel' },
    },
};

const sink = () => ({ log: vi.fn(() => ({ ok: true })) });
const make = (over = {}) => {
    const eventLogger = sink();
    const log = createPluginLogger({ manifest, eventLogger, sessionId: 42, ...over });
    return { log, eventLogger };
};
const lastCall = (eventLogger) => eventLogger.log.mock.calls.at(-1);

describe('normalizeLogArgs', () => {
    it('passes the canonical three positionals through', () => {
        expect(normalizeLogArgs('V', 'o', { objectId: '1' })).toEqual({ verb: 'V', objectType: 'o', options: { objectId: '1' }, shape: 'positional' });
    });
    it('accepts the object form and maps detail → context', () => {
        const out = normalizeLogArgs({ verb: 'V', objectType: 'o', component: 'C', detail: { a: 1 } });
        expect(out).toEqual({ verb: 'V', objectType: 'o', options: { component: 'C', context: { a: 1 } }, shape: 'object' });
    });
});

describe('sanitizeContext', () => {
    it('removes prose keys at any depth, case-insensitively, and reports them', () => {
        const { context, dropped } = sanitizeContext({ words: 12, Answer: 'x', nested: { notes: 'y', keep: 1 }, list: [{ text: 'z' }] });
        expect(context).toEqual({ words: 12, nested: { keep: 1 }, list: [{}] });
        expect(dropped).toEqual(['Answer', 'nested.notes', 'list[0].text']);
        expect(PROSE_DENYLIST.has('answer_key')).toBe(true);
    });
});

describe('ctx.log — non-strict (production)', () => {
    it('stamps room, plugin id, version, surface and parent component on every row', () => {
        const { log, eventLogger } = make({ strict: false });
        log('DID_A_THING', 'demo_thing', { objectId: 'x', objectName: 'X' });
        const [verb, objectType, options] = lastCall(eventLogger);
        expect(verb).toBe('DID_A_THING');
        expect(objectType).toBe('demo_thing');
        expect(options).toMatchObject({
            room: 'demo', pluginId: 'demo', pluginVersion: '2.1.0', sessionId: 42,
            parentComponent: 'PluginRoom', component: 'DemoRoom', objectId: 'x', objectName: 'X',
        });
        expect(options.context).toEqual({ surface: 'room' });
    });

    it('accepts the object call shape (Radoyon) and marks it', () => {
        const { log, eventLogger } = make({ strict: false });
        log({ verb: 'DID_A_THING', objectType: 'demo_thing', component: 'DemoPanel', detail: { n: 1 } });
        const [verb, objectType, options] = lastCall(eventLogger);
        expect([verb, objectType]).toEqual(['DID_A_THING', 'demo_thing']);
        expect(options.component).toBe('DemoPanel');
        expect(options.context).toMatchObject({ n: 1, _log_shape: 'object', surface: 'room' });
    });

    it('redirects an undeclared verb to UNDECLARED_VERB with the attempt in context — never drops', () => {
        const { log, eventLogger } = make({ strict: false });
        log('SOMETHING_NEW', 'demo_thing');
        const [verb, objectType, options] = lastCall(eventLogger);
        expect(verb).toBe('UNDECLARED_VERB');
        expect(objectType).toBe('plugin_event');
        expect(options.context).toMatchObject({ attempted_verb: 'SOMETHING_NEW', attempted_object_type: 'demo_thing' });
    });

    it('refuses another plugin\'s verb but accepts a listed core verb and a host-delegable verb', () => {
        const { log, eventLogger } = make({ strict: false });
        log('OPENED_SLIDE', 'demo_thing');
        expect(lastCall(eventLogger)[0]).toBe('UNDECLARED_VERB');
        log('PERFORMED_PHYSICAL_EXAM', 'physical_exam');
        expect(lastCall(eventLogger)[0]).toBe('PERFORMED_PHYSICAL_EXAM');
        log('RAISED_ERROR', 'plugin_render', { result: 'boom' });
        expect(lastCall(eventLogger)[0]).toBe('RAISED_ERROR');
    });

    it('keeps an undeclared object type / component, marked', () => {
        const { log, eventLogger } = make({ strict: false });
        log('DID_A_THING', 'mystery', { component: 'Elsewhere' });
        const [, objectType, options] = lastCall(eventLogger);
        expect(objectType).toBe('mystery');
        expect(options.component).toBe('Elsewhere');
        expect(options.context._undeclared).toEqual({ objectType: 'mystery', component: 'Elsewhere' });
    });

    it('strips prose from context, objectName and the message columns', () => {
        const { log, eventLogger } = make({ strict: false });
        log('DID_A_THING', 'demo_thing', {
            objectName: 'first line\nsecond line',
            context: { answer: 'the diagnosis', words: 3 },
            messageContent: 'learner prose', messageRole: 'user',
        });
        const [, , options] = lastCall(eventLogger);
        expect(options.objectName).toBe('first line');
        expect(options.context).toEqual({ words: 3, _dropped: ['answer'], surface: 'room' });
        expect(options).not.toHaveProperty('messageContent');
        expect(options).not.toHaveProperty('messageRole');
    });

    it('caps objectName and context size', () => {
        const { log, eventLogger } = make({ strict: false });
        log('DID_A_THING', 'demo_thing', { objectName: 'n'.repeat(500), context: { blob: 'x'.repeat(CONTEXT_MAX_BYTES * 2) } });
        const [, , options] = lastCall(eventLogger);
        expect(options.objectName.length).toBe(OBJECT_NAME_MAX);
        expect(options.context._truncated).toBe(true);
    });

    it('ignores an out-of-enum severity/category override rather than forwarding it', () => {
        const { log, eventLogger } = make({ strict: false });
        log('DID_A_THING', 'demo_thing', { severity: 'URGENT', category: 'VIBES' });
        const [, , options] = lastCall(eventLogger);
        expect(options.severity).toBeUndefined();
        expect(options.category).toBeUndefined();
        log('DID_A_THING', 'demo_thing', { severity: 'DEBUG' });
        expect(lastCall(eventLogger)[2].severity).toBe('DEBUG');
    });

    it('a caller cannot override the host-stamped fields', () => {
        const { log, eventLogger } = make({ strict: false });
        log('DID_A_THING', 'demo_thing', { room: 'chat', pluginId: 'other', parentComponent: 'App' });
        const [, , options] = lastCall(eventLogger);
        expect(options.room).toBe('demo');
        expect(options.pluginId).toBe('demo');
        expect(options.parentComponent).toBe('PluginRoom');
    });

    it('the author surface stamps surface=author and parent PluginAuthor, room stays the plugin id', () => {
        const { log, eventLogger } = make({ strict: false, surface: 'author' });
        log('DID_A_THING', 'demo_thing');
        const [, , options] = lastCall(eventLogger);
        expect(options.room).toBe('demo');
        expect(options.parentComponent).toBe('PluginAuthor');
        expect(options.context.surface).toBe('author');
    });
});

describe('ctx.log — strict (dev/test)', () => {
    it('throws on the object shape, an undeclared verb, an undeclared object type, and prose', () => {
        const { log } = make({ strict: true });
        // The object call shape is compatibility (Radoyon), warned not thrown —
        // throwing would take the PACS room down until its upstream is re-vendored.
        expect(() => log({ verb: 'DID_A_THING', objectType: 'demo_thing' })).not.toThrow();
        expect(() => log('NOPE', 'demo_thing')).toThrow(/NOPE.*not in its manifest vocabulary/);
        expect(() => log('DID_A_THING', 'mystery')).toThrow(/object type 'mystery'/);
        expect(() => log('DID_A_THING', 'demo_thing', { context: { answer: 'x' } })).toThrow(/prose keys \(answer\)/);
        expect(() => log('DID_A_THING', 'demo_thing', { objectName: 'a\nb' })).toThrow(/newline/);
    });
    it('a clean call goes through', () => {
        const { log, eventLogger } = make({ strict: true });
        expect(() => log('DID_A_THING', 'demo_thing', { objectId: '1', context: { count: 2 } })).not.toThrow();
        expect(eventLogger.log).toHaveBeenCalledTimes(1);
    });
});

describe('deprecatedEventLoggerProxy', () => {
    it('forwards log in both shapes and throws on global-state mutation', () => {
        const log = vi.fn();
        const proxy = deprecatedEventLoggerProxy(log, 'demo');
        proxy.log('V', 'o', { a: 1 });
        proxy.log({ verb: 'V', objectType: 'o' });
        expect(log).toHaveBeenCalledTimes(2);
        expect(() => proxy.setContext({ room: 'chat' })).toThrow(/ctx\.log/);
        expect(() => proxy.roomChanged('chat')).toThrow(/not available/);
        expect(() => proxy.clearContext()).toThrow();
        expect(proxy.currentVitals).toBeUndefined();
        expect(proxy[Symbol.for('rohy.deprecated')]).toBe(true);
    });
});
