// Preload (via NODE_OPTIONS=--require) for the e2e webServer process.
//
// Why this exists:
//   server/server.js statically imports server/services/kokoroTts.js,
//   which imports `kokoro-js`, which imports
//   node_modules/phonemizer/dist/phonemizer.js. The phonemizer module is
//   transpiled-Emscripten boilerplate that registers global handlers on
//   the Node process:
//
//     process.on('uncaughtException', (A) => { if (!(A instanceof O)) throw A })
//     process.on('unhandledRejection', (A) => { throw A })
//
//   The first one re-throws any uncaught exception that is NOT an
//   Emscripten-internal error, which kills the process even though
//   server.js intends to log-and-continue (its own
//   `process.on('uncaughtException')` handler runs first but doesn't
//   stop propagation). The second one converts any unhandled rejection
//   anywhere in the server into a synchronous throw, which the first
//   handler then re-throws → process exit.
//
//   For e2e we don't need TTS at all, but we can't tree-shake the static
//   import from server.js without modifying server source (forbidden by
//   the Phase 5 brief). The minimum-invasive workaround is to override
//   `process.on` here, BEFORE phonemizer is imported, so that any
//   handlers it tries to register on `uncaughtException` and
//   `unhandledRejection` are silently dropped. The server's own handlers
//   (registered later, from server.js) still work.
//
// Scope:
//   This file is consumed only by playwright.config.js via NODE_OPTIONS.
//   Production code is untouched.

const HIJACKED_EVENTS = new Set(['uncaughtException', 'unhandledRejection']);
const originalOn = process.on.bind(process);

process.on = function patchedOn(event, listener) {
    if (HIJACKED_EVENTS.has(event)) {
        // Inspect the listener source to spot phonemizer's handlers
        // specifically (they re-throw). Other handlers — server.js'
        // logging handlers, vitest internals, etc. — are still registered
        // normally.
        try {
            const src = String(listener);
            if (src.includes('throw A') || src.includes('throw a')) {
                // Drop it on the floor.
                return process;
            }
        } catch {
            // Fall through — never block legitimate handler registration
            // because of an introspection error.
        }
    }
    return originalOn(event, listener);
};

// Also expose the same protection on `addListener`, which is the
// underlying call `.on` delegates to. Node's stream-internal code may
// call addListener directly.
const originalAddListener = process.addListener.bind(process);
process.addListener = function patchedAddListener(event, listener) {
    if (HIJACKED_EVENTS.has(event)) {
        try {
            const src = String(listener);
            if (src.includes('throw A') || src.includes('throw a')) {
                return process;
            }
        } catch { /* ignore */ }
    }
    return originalAddListener(event, listener);
};
