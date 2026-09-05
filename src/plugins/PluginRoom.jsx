import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registry } from './registry.js';
import { createPluginContext, readOrders } from './context.js';
import ErrorBoundary from '../components/common/ErrorBoundary.jsx';

/**
 * RPS-1 — the generic host mount point.
 *
 * App.jsx renders this for ANY plugin room. It knows nothing about pathology,
 * slides or annotations; it resolves a plugin by id, builds its context, and
 * maps that context onto whatever prop names the plugin actually wants via the
 * descriptor's `props()` adapter. That adapter is what lets a vendored package
 * keep its own prop vocabulary while the host stays generic.
 *
 * Persistence is gated on purpose. A plugin like pathology seeds its internal
 * store from `initialAnnotations` exactly ONCE and deliberately ignores later
 * changes to it (otherwise a parent re-render would discard work in progress).
 * So rendering the component before the store has resolved would seed it empty
 * and silently drop everything the reader saved last time. `ready` prevents
 * that: nothing mounts until the load settles.
 */
export function PluginRoom({
    pluginId,
    session,
    caseConfig,
    eventLogger,
    notify,
    navigate,
    grants,
    ...chrome
}) {
    const { t } = useTranslation();
    const plugin = registry.get(pluginId);

    const base = useMemo(() => (plugin
        ? createPluginContext({
            manifest: plugin.manifest, session, caseConfig, eventLogger, notify, t, navigate, grants,
        })
        : null),
    // `session` / `caseConfig` are the identity of this mount; rebuilding the
    // context on every render would hand the plugin a new store each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, session?.id, session?.caseId, session?.examMode, caseConfig]);

    // The 'orders' capability is the one part of the context that legitimately
    // CHANGES while the room is open — a study finishes its turnaround, or the
    // learner orders another one — so it is layered on top rather than folded
    // into the memo above. Folding it in would rebuild the STORE on every poll,
    // and the load effect below would then unmount the plugin and re-seed it
    // from disk each time: a learner reading a study would be thrown out of it
    // every fifteen seconds. `base.orders === null` means this plugin never
    // asked, and then there is nothing to layer.
    //
    // The 'conversation' capability is the other live one: it is the
    // session's patient transcript as it streams, so a room that captions
    // the patient's answer must see every delta. Same treatment — layered on
    // top of the memoised base, only for a plugin that asked for it.
    const wantsConversation = Boolean(plugin?.manifest?.capabilities?.includes('conversation'));
    const ctx = useMemo(() => {
        if (!base) return base;
        let next = base;
        if (base.orders !== null) next = { ...next, orders: readOrders(grants?.orders) };
        if (wantsConversation) {
            next = { ...next, capabilities: { ...next.capabilities, conversation: grants?.conversation ?? null } };
        }
        return next;
    }, [base, grants?.orders, grants?.conversation, wantsConversation]);

    // `null` means "not loaded yet" — a separate ready flag would need an
    // eager reset inside the effect, which is the setState-in-effect pattern
    // the lint rule (and RoomNavigator's own comment) discourages.
    const [state, setState] = useState(null);

    // Keyed on `base`, never on `ctx`: `base` is the mount's IDENTITY (this
    // plugin, this session, this case) and `ctx` additionally carries orders
    // that change under the learner. Reloading persisted state because an order
    // finished its turnaround would drop the room mid-read.
    useEffect(() => {
        let cancelled = false;
        if (!base) return undefined;
        const load = base.store ? base.store.get('state', {}) : Promise.resolve({});
        load.then((loaded) => { if (!cancelled) setState(loaded ?? {}); });
        // Drop the previous plugin/session's state on the way out. Without
        // this, a context change leaves the OLD state renderable while the new
        // load is in flight, and the write-behind effect below flushes that
        // stale document through the NEW context — writing one session's work
        // into another's key.
        return () => { cancelled = true; setState(null); };
    }, [base]);

    // Write-behind. Keeping the store write here rather than inside save()
    // means save() is a pure functional update, so two mutations in the same
    // tick compose instead of the second clobbering the first — which is the
    // normal case when a plugin emits one change per annotation edit.
    useEffect(() => {
        if (state === null || !base?.store) return;
        // Surface a failed write. store.set() turns quota/private-mode errors
        // into `false`; ignoring that made persistence failure invisible until
        // the learner reloaded and found their work gone.
        Promise.resolve(base.store.set('state', state)).then((ok) => {
            if (ok === false) {
                base.log('RAISED_ERROR', 'plugin_state', {
                    objectId: base.pluginId,
                    result: 'persist_failed',
                    severity: 'IMPORTANT',
                    category: 'ERROR',
                });
            }
        });
    }, [state, base]);

    const persist = useMemo(() => ({
        state: state ?? {},
        save(patch) { setState((prev) => ({ ...(prev ?? {}), ...patch })); },
    }), [state]);

    if (!plugin) return null;
    if (state === null) return null;   // store still resolving

    const Component = plugin.component;
    // The boundary is the host's half of RPS-1 peaceful exclusion: a plugin
    // that throws during render (e.g. a viewer rejecting a malformed slide)
    // loses its own room, not the whole SPA.
    return (
        <ErrorBoundary
            scope={`plugin:${pluginId}`}
            onError={(error) => {
                ctx?.log?.('RAISED_ERROR', 'plugin_render', {
                    objectId: pluginId,
                    result: error?.message ?? 'render error',
                    severity: 'IMPORTANT',
                    category: 'ERROR',
                });
            }}
        >
            <Component {...chrome} {...plugin.props(ctx, persist)} />
        </ErrorBoundary>
    );
}

export default PluginRoom;
