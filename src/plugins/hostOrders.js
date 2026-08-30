import { useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../services/apiClient';
import { registry } from './registry.js';

/**
 * RPS-1 — the 'orders' capability: what the learner has ORDERED this session,
 * narrowed by the host.
 *
 * WHY THIS EXISTS AT ALL. rohy's Radiology room is the RIS: a learner orders a
 * study there, waits out its turnaround, and reads the text report. The PACS
 * room is where the IMAGES for that study open. Until this seam existed the two
 * halves never met — PACS could only show studies an educator had explicitly
 * authored into the case, so a learner who ordered a chest X-ray got a report
 * and no pictures, and in a case with no authored imaging the room did not even
 * appear. That is the reported bug, and it is a missing host capability rather
 * than a missing feature in either room.
 *
 * WHY IT IS A HOST ADAPTER AND NOT A FETCH INSIDE THE PLUGIN. The governing
 * rule of the standard: a capability is a NARROWED ADAPTER THE HOST BUILDS,
 * never a reference to a host singleton, and never an endpoint a package is
 * expected to know. A vendored package that called
 * `/api/sessions/:id/radiology-orders` itself would stop being droppable into
 * any other host the moment rohy renamed the route, and would be handed every
 * column the route returns — including `result_data`, which carries the case
 * author's configured findings. So the host reads the route, keeps the fields a
 * worklist legitimately needs, and drops the rest.
 *
 * WHAT IS DELIBERATELY NOT PASSED THROUGH: `result_data`, `image_url`,
 * `viewed_at`. The first two are the radiology REPORT — the text a learner
 * reads in the Radiology room, which may be the author's abnormal findings.
 * Nothing about what the imaging SHOWS may travel on the order; a plugin
 * resolves that through the case document's own learner projection or not at
 * all.
 */

// Off-phase with RoomNavigator's 10s badge poll and OrdersDrawer's 5s, and
// slower than both on purpose: nothing here is a notification. It exists so a
// study that finishes its turnaround while the learner is standing in the PACS
// room stops reading "reporting" without a reload.
const POLL_INTERVAL_MS = 15000;

/** No plugin asked for orders, or there is no session — one frozen empty value
 *  so a consumer's useMemo does not churn on a fresh object every render. */
const NO_ORDERS = Object.freeze({ imaging: Object.freeze([]), loaded: false });

/**
 * Is any INSTALLED plugin asking for this capability?
 *
 * Read off the live registry rather than the generated manifest snapshot, so
 * deleting a plugin directory removes its request too — peaceful exclusion
 * covers the host's fetches as well as its rooms. A deployment whose plugins
 * want no orders makes no request at all.
 *
 * @returns {boolean}
 */
export function ordersAreWanted() {
    return registry.all().some((plugin) => (plugin.manifest.capabilities ?? []).includes('orders'));
}

/**
 * One imaging order, narrowed.
 *
 * `ready` and `minutesRemaining` are the server's own turnaround judgement
 * (`available_at` compared against SQL `now`), not a clock comparison done in
 * the browser: the learner's device clock is not the simulation's.
 */
function readImagingOrder(row) {
    return {
        id: row?.id ?? null,
        studyName: typeof row?.test_name === 'string' ? row.test_name : '',
        modality: typeof row?.modality === 'string' ? row.modality : null,
        orderedAt: row?.ordered_at ?? null,
        availableAt: row?.available_at ?? null,
        ready: Boolean(row?.is_ready),
        minutesRemaining: Number.isFinite(Number(row?.minutes_remaining))
            ? Number(row.minutes_remaining)
            : null,
    };
}

/**
 * What "the orders changed" means, as one comparable string.
 *
 * `minutesRemaining` is deliberately EXCLUDED: it counts down on every poll and
 * would make every poll a change, which is the churn this exists to stop. What
 * a worklist shows is whether a study is ready, and that is `ready`.
 *
 * @param {Array<object>} orders
 * @returns {string}
 */
function signature(orders) {
    return orders.map((o) => `${o.id}:${o.studyName}:${o.ready ? 1 : 0}`).join('|');
}

/**
 * The session's investigation orders, as the host grants them to plugins.
 *
 * Total by construction: a failed or in-flight fetch yields an empty list, not
 * a throw and not a null — every consumer of this is either an `available()`
 * check (which the standard requires to be total) or a worklist build, and
 * neither may fail because the network did.
 *
 * @param {string|number|null} sessionId
 * @returns {{imaging: Array<object>, loaded: boolean}}
 */
export function useHostOrders(sessionId) {
    const wanted = useMemo(() => ordersAreWanted(), []);
    const [state, setState] = useState(NO_ORDERS);

    useEffect(() => {
        if (!wanted || !sessionId) return undefined;
        let cancelled = false;
        const tick = async () => {
            const body = await apiFetch(`/sessions/${sessionId}/radiology-orders`)
                // A transient failure must not empty a worklist the learner is
                // reading — keep the previous value and try again on the next
                // tick, exactly as RoomNavigator's badge does.
                .catch(() => null);
            if (cancelled || body === null) return;
            const imaging = (Array.isArray(body?.orders) ? body.orders : []).map(readImagingOrder);
            // Identity is load-bearing downstream: this value is a dependency of
            // the plugin context and of every worklist built from it, so a fresh
            // array every fifteen seconds would re-render a room in which
            // nothing changed. Only a real change to the orders is a change.
            setState((prev) => (prev.sessionId === sessionId && signature(prev.imaging) === signature(imaging)
                ? prev
                : { sessionId, imaging, loaded: true }));
        };
        tick();
        const id = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(id); };
        // Dropping the previous session's orders is deliberate and happens on
        // the way IN (the state below), not in a cleanup: a cleanup reset would
        // be a setState-in-effect, which is the pattern RoomNavigator documents
        // its way around too.
    }, [wanted, sessionId]);

    // Session identity gates the VALUE, not just the fetch — which is why the
    // session id is stored WITH the orders. Without this the previous case's
    // orders stay readable until the first poll of the new session lands, and
    // a plugin room would be available on the strength of a study ordered in a
    // session the learner has left.
    return state.loaded && state.sessionId === sessionId ? state : NO_ORDERS;
}

export default useHostOrders;
