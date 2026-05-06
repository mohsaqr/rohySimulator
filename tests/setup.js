// Global test setup for the client (jsdom) environment.
//
// Loaded by vitest.config.js for every client test. Anything that has to
// exist on `window`, `document`, or `globalThis` BEFORE a component mounts
// belongs here. Server tests do NOT load this file.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Reset RTL DOM after every test so renders don't leak between tests.
afterEach(() => {
    cleanup();
});

// --- window.matchMedia ---------------------------------------------------
// jsdom doesn't implement matchMedia. A handful of components (Tailwind
// breakpoints, prefers-reduced-motion checks) call it on mount.
if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    });
}

// --- AudioContext + HTMLMediaElement.play --------------------------------
// jsdom doesn't implement Web Audio. voiceService.js scheduling tests will
// stub these per-test for assertions; we just need the constructor to exist
// so the module's top-level `new AudioContext()` calls don't blow up at
// import time.
if (typeof window !== 'undefined' && !window.AudioContext) {
    class StubAudioContext {
        constructor() {
            this.state = 'suspended';
            this.currentTime = 0;
            this.destination = {};
            this.sampleRate = 48000;
        }
        createBuffer() { return { getChannelData: () => new Float32Array(0) }; }
        createBufferSource() {
            return {
                buffer: null,
                playbackRate: { value: 1 },
                connect: () => {},
                disconnect: () => {},
                start: () => {},
                stop: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                onended: null,
            };
        }
        createGain() {
            return {
                gain: { value: 1, setValueAtTime: () => {} },
                connect: () => {},
                disconnect: () => {},
            };
        }
        decodeAudioData(_buf) { return Promise.resolve({ duration: 0, getChannelData: () => new Float32Array(0) }); }
        resume() { this.state = 'running'; return Promise.resolve(); }
        suspend() { this.state = 'suspended'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
    }
    window.AudioContext = StubAudioContext;
    window.webkitAudioContext = StubAudioContext;
}

if (typeof window !== 'undefined' && window.HTMLMediaElement) {
    if (!window.HTMLMediaElement.prototype.play || window.HTMLMediaElement.prototype.play.toString().includes('[native code]')) {
        window.HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
        window.HTMLMediaElement.prototype.pause = function pause() {};
        window.HTMLMediaElement.prototype.load = function load() {};
    }
}

// --- localStorage --------------------------------------------------------
// jsdom ships a real localStorage but it's shared across the whole test
// run. We swap in an in-memory implementation that we reset between tests
// so test order can never matter.
function createMemoryStorage() {
    let store = new Map();
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: (i) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
        // Helper for tests that need to forcibly nuke everything; not part
        // of the standard Storage API but harmless to expose.
        __reset: () => { store = new Map(); },
    };
}

if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        writable: true,
        value: createMemoryStorage(),
    });
    Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        writable: true,
        value: createMemoryStorage(),
    });
}

beforeEach(() => {
    if (typeof window !== 'undefined') {
        window.localStorage.__reset?.();
        window.sessionStorage.__reset?.();
    }
});

// --- crypto.randomUUID ---------------------------------------------------
// Older jsdom versions don't expose randomUUID. Newer ones do. Polyfill
// only if missing.
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.randomUUID !== 'function') {
    const baseCrypto = globalThis.crypto ?? {};
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
            ...baseCrypto,
            randomUUID() {
                // RFC 4122 v4 shape; deterministic-ish for tests is fine.
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                    const r = (Math.random() * 16) | 0;
                    const v = c === 'x' ? r : (r & 0x3) | 0x8;
                    return v.toString(16);
                });
            },
        },
    });
}

// --- fakeTimers helper ---------------------------------------------------
// Tests that need to advance time can do:
//   const timers = fakeTimers();
//   ...
//   timers.advance(500);
//   timers.restore();
//
// Wrapping vi.useFakeTimers() so call sites read clearly.
export function fakeTimers(opts = {}) {
    vi.useFakeTimers(opts);
    return {
        advance: (ms) => vi.advanceTimersByTime(ms),
        runAll: () => vi.runAllTimers(),
        runPending: () => vi.runOnlyPendingTimers(),
        restore: () => vi.useRealTimers(),
    };
}

// Make it accessible without importing in every test, but importing is the
// preferred pattern (keeps usage greppable).
globalThis.fakeTimers = fakeTimers;
