import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registry } from './registry.js';
import { createPluginContext } from './context.js';

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

    const ctx = useMemo(() => (plugin
        ? createPluginContext({
            manifest: plugin.manifest, session, caseConfig, eventLogger, notify, t, navigate, grants,
        })
        : null),
    // `session` / `caseConfig` are the identity of this mount; rebuilding the
    // context on every render would hand the plugin a new store each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, session?.id, session?.caseId, session?.examMode, caseConfig]);

    // `null` means "not loaded yet" — a separate ready flag would need an
    // eager reset inside the effect, which is the setState-in-effect pattern
    // the lint rule (and RoomNavigator's own comment) discourages.
    const [state, setState] = useState(null);

    useEffect(() => {
        let cancelled = false;
        if (!ctx) return undefined;
        const load = ctx.store ? ctx.store.get('state', {}) : Promise.resolve({});
        load.then((loaded) => { if (!cancelled) setState(loaded ?? {}); });
        // Drop the previous plugin/session's state on the way out. Without
        // this, a context change leaves the OLD state renderable while the new
        // load is in flight, and the write-behind effect below flushes that
        // stale document through the NEW context — writing one session's work
        // into another's key.
        return () => { cancelled = true; setState(null); };
    }, [ctx]);

    // Write-behind. Keeping the store write here rather than inside save()
    // means save() is a pure functional update, so two mutations in the same
    // tick compose instead of the second clobbering the first — which is the
    // normal case when a plugin emits one change per annotation edit.
    useEffect(() => {
        if (state === null || !ctx?.store) return;
        // Surface a failed write. store.set() turns quota/private-mode errors
        // into `false`; ignoring that made persistence failure invisible until
        // the learner reloaded and found their work gone.
        Promise.resolve(ctx.store.set('state', state)).then((ok) => {
            if (ok === false) {
                ctx.eventLogger?.log?.('ERROR_OCCURRED', 'plugin_state', {
                    objectId: ctx.pluginId,
                    result: 'persist_failed',
                    severity: 'IMPORTANT',
                    category: 'ERROR',
                });
            }
        });
    }, [state, ctx]);

    const persist = useMemo(() => ({
        state: state ?? {},
        save(patch) { setState((prev) => ({ ...(prev ?? {}), ...patch })); },
    }), [state]);

    if (!plugin) return null;
    if (state === null) return null;   // store still resolving

    const Component = plugin.component;
    return <Component {...chrome} {...plugin.props(ctx, persist)} />;
}

export default PluginRoom;
