import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { registry } from './registry.js';
import { createPluginContext } from './context.js';
import { roleAllows } from '../../server/shared/pluginRegistry.js';

/**
 * RPS-1 — the generic authoring mount point.
 *
 * The sibling of PluginRoom, and deliberately not a mode of it. A room is
 * where a learner USES a plugin's material; an authoring surface is where
 * someone MAKES it, and the two have opposite gates. `available()` declines a
 * case with no material — which is exactly the case an editor exists to fix.
 * Folding authoring into the room would make the editor unreachable precisely
 * when it is needed.
 *
 * PERSISTENCE IS THE HOST'S, AND IT IS NOT `ctx.store`. That store is
 * namespaced `rohy_plugin:<id>:<sessionId>:` — right for a learner's
 * in-progress work, wrong for authored material, which belongs to the CASE and
 * outlives every session. So this component takes the draft and its save
 * callback as PROPS: whoever renders it decides where authored material lives,
 * exactly as §8 has a plugin hand its whole document back rather than writing
 * it. Rohy has no case-config write path yet, so today the caller may pass
 * nothing and the plugin's own export is the way out.
 *
 * The role gate is re-checked here rather than trusted from the caller. A
 * component reachable by URL must not depend on the navigation that usually
 * leads to it having done the check.
 */
export function PluginAuthor({
    pluginId,
    session,
    caseConfig,
    eventLogger,
    notify,
    navigate,
    grants,
    value,
    onSave,
    ...chrome
}) {
    const { t } = useTranslation();
    const plugin = registry.get(pluginId);

    const ctx = useMemo(() => (plugin
        ? createPluginContext({
            manifest: plugin.manifest, session, caseConfig, eventLogger, notify, t, navigate, grants,
        })
        : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, session?.id, session?.caseId, caseConfig]);

    const draft = useMemo(() => ({
        // Falls back to the plugin's slice of the case config, so opening the
        // editor on an existing case edits that case rather than a blank one.
        value: value ?? ctx?.data ?? null,
        save: (next) => onSave?.(next),
    }), [value, ctx, onSave]);

    if (!plugin || !plugin.manifest.authoring || typeof plugin.authorComponent !== 'function') return null;
    if (!roleAllows(session?.role, plugin.manifest.authoring.minRole)) return null;

    const Component = plugin.authorComponent;
    return <Component {...chrome} {...plugin.authorProps(ctx, draft)} />;
}

export default PluginAuthor;
