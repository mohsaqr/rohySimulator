import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registry } from './registry.js';
import { createPluginContext, readOrders } from './context.js';
import ErrorBoundary from '../components/common/ErrorBoundary.jsx';
import { NotificationContextObject } from '../notifications/NotificationContextObject.js';
import { SOURCES, SEVERITY } from '../notifications/types.js';

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
    // Bumped when the store hands back a different document than the one the
    // plugin was seeded with (another tab or device saved first). A plugin
    // seeds from `persist.state` ONCE, so the only way to show it the server's
    // copy is to remount it — the `key` below.
    const [generation, setGeneration] = useState(0);
    // The document the store itself just handed us (load, conflict reload).
    // Writing it straight back would be an echo: a PUT on every room open,
    // and a second revision for nothing after every conflict.
    const echoRef = useRef(null);

    // Through the context object rather than useNotifications(): the hook
    // throws outside a provider, and a plugin room must still render (and keep
    // saving) in a host or test that mounted none.
    const notifications = useContext(NotificationContextObject);
    const notifyRef = useRef(null);
    const tRef = useRef(t);
    useEffect(() => {
        notifyRef.current = notifications?.notify ?? null;
        tRef.current = t;
    }, [notifications, t]);

    // The store's events: a conflict (another tab or device saved since this
    // one loaded — the server copy wins and the room reloads from it) and a
    // failed save (offline: kept on this device and retried; refused: kept on
    // this device, and the learner must know it is not on the server).
    useEffect(() => {
        const store = base?.store;
        if (!store?.subscribe) return undefined;
        const unsubscribe = store.subscribe((event) => {
            // The translator current when the event ARRIVES (tRef), not the
            // one from when the room opened.
            const t = tRef.current;
            if (event.type === 'conflict' && event.name === 'state') {
                const next = event.value ?? {};
                echoRef.current = next;
                setState(next);
                setGeneration((g) => g + 1);
                notifyRef.current?.({
                    source: SOURCES.SYSTEM,
                    severity: SEVERITY.WARNING,
                    key: `plugin-state-conflict:${base.pluginId}`,
                    message: t('plugin_state_conflict', 'This room was saved from another tab or device. It now shows the latest saved version.'),
                });
            } else if (event.type === 'save_failed') {
                base.log('RAISED_ERROR', 'plugin_state', {
                    objectId: base.pluginId,
                    result: event.offline ? 'persist_offline' : `persist_refused:${event.code ?? event.status}`,
                    severity: 'IMPORTANT',
                    category: 'ERROR',
                });
                notifyRef.current?.({
                    source: SOURCES.SYSTEM,
                    severity: event.offline ? SEVERITY.WARNING : SEVERITY.ERROR,
                    key: `plugin-state-save:${base.pluginId}`,
                    message: event.offline
                        ? t('plugin_state_offline', 'Your work in this room is saved on this device only. It will be saved to the server when the connection returns.')
                        : t('plugin_state_save_failed', 'Your work in this room could not be saved to the server. It is kept on this device; keep this tab open and try again.'),
                });
            }
        });
        return () => {
            unsubscribe();
            // Leaving the room (or this session): send anything still queued.
            store.dispose?.();
        };
    }, [base]);

    // Keyed on `base`, never on `ctx`: `base` is the mount's IDENTITY (this
    // plugin, this session, this case) and `ctx` additionally carries orders
    // that change under the learner. Reloading persisted state because an order
    // finished its turnaround would drop the room mid-read.
    useEffect(() => {
        let cancelled = false;
        if (!base) return undefined;
        const load = base.store ? base.store.get('state', {}) : Promise.resolve({});
        load.then((loaded) => {
            if (cancelled) return;
            const seeded = loaded ?? {};
            echoRef.current = seeded;
            setState(seeded);
        });
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
        // What the store just handed us is already saved — see echoRef.
        if (state === echoRef.current) return;
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
            <Component key={generation} {...chrome} {...plugin.props(ctx, persist)} />
        </ErrorBoundary>
    );
}

export default PluginRoom;
