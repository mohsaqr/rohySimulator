// Transport for the HOST-DRIVEN Oyon modalities (typing, interaction,
// discourse, ai_assist) — the sibling of the camera path's `persistWindows`.
//
// `createSignalCapture` fans every finalized modality window out through
// `transport.send([row], context)` (OyonR/src/core/SignalCapture.js). This is
// rohy's implementation of that interface: it stamps rohy's own envelope onto
// the row and POSTs it to the same `/addons/oyon/emotion-records` endpoint the
// camera windows use. The server tells the two apart by itself — modality-only
// events route into `oyon_signal_windows`, camera windows into
// `oyon_emotion_records` (see `isModalityOnlyEvent` in oyon-routes.js) — so
// there is deliberately no second endpoint here.
//
// Kept free of React so the payload contract can be tested directly, the same
// reason captureBridge.js is.

import { apiFetch } from '../../services/apiClient';
import { persistBodies } from './captureBridge';
import { oyonClientLog } from './clientLogger';

/**
 * Build a `SignalCapture`-compatible transport.
 *
 * `getContext()` is read at SEND time, not at construction time, because a
 * learner changes room and case while one capture keeps running. It returns
 * `{ persist, sessionId, caseId, room }`, where `persist` is the caller's
 * consent+tenant gate — the same role `persistGateRef` plays in
 * OyonCaptureWidget.
 */
export function createSignalTransport(getContext) {
    if (typeof getContext !== 'function') {
        throw new TypeError('createSignalTransport requires a getContext() function.');
    }

    return {
        // Signature fixed by SignalCapture: send(rows, context). The second
        // argument is the CAPTURE's context, and we deliberately ignore it —
        // see the session note below.
        async send(rows) {
            const windows = Array.isArray(rows) ? rows.filter(Boolean) : [];
            if (windows.length === 0) return;

            const { persist, sessionId, caseId, room } = getContext() || {};

            // Drop rather than POST. The server re-checks consent and would
            // reject these anyway, so this is not the security boundary — it
            // just avoids a round trip that provably stores nothing, and
            // avoids attributing a window to a session that has already ended.
            if (!persist || !sessionId) {
                oyonClientLog('debug', 'signal window dropped before transport', {
                    count: windows.length,
                    reason: !sessionId ? 'no_session' : 'consent_gate_closed',
                });
                return;
            }

            // One envelope for both pipelines. `persistBodies` (via persistBody) encodes
            // the rules that matter here:
            //   - session_id comes from ROHY's session, never from the row's
            //     own `session_id` (SignalCapture stamps its own at window
            //     creation, so a session switch mid-window would otherwise
            //     mis-key a late flush);
            //   - the server overwrites `consent_version` from the accepted
            //     consent row, so the placeholder only exists to satisfy the
            //     payload validator;
            //   - `capture_mode` defaults to 'local-browser'.
            // Reused rather than mirrored on purpose: if the envelope changes,
            // both pipelines have to change together or the server sees two
            // different shapes on one endpoint.
            const bodies = persistBodies(windows, { sessionId, caseId, room });

            try {
                // In order; packed to the server's event and size limits.
                for (const body of bodies) {
                    await apiFetch('/addons/oyon/emotion-records', { method: 'POST', json: body });
                }
                oyonClientLog('debug', 'signal window batch persisted', {
                    session_id: sessionId,
                    count: windows.length,
                    modalities: [...new Set(windows.map(w => w?.modality).filter(Boolean))],
                });
            } catch (e) {
                oyonClientLog('warn', 'signal window batch persist failed', {
                    session_id: sessionId,
                    count: windows.length,
                    error: e?.message || String(e),
                });
                // Rethrow: SignalCapture's `trackWrite` catches this, counts it
                // in `stats.errorCount` and emits it on the `'error'` channel.
                // Swallowing here would log the failure but tell Oyon the write
                // succeeded, so its own error accounting would read clean while
                // telemetry silently went nowhere.
                throw e;
            }
        },
    };
}
