import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import { apiGet, apiFetch, ApiError } from '../../services/apiClient';
import { PLUGIN_MANIFESTS } from '../../../server/shared/plugins/manifests.generated.js';

/**
 * Settings → Plugins (RPS-1 1.4 §11c).
 *
 * The host renders this GENERICALLY from the schema each manifest declares.
 * Pathology is the first user; a second plugin gets an admin page by adding a
 * `settings` block to its manifest, not by anyone writing another React screen.
 * That is the difference between closing §14.4's gap and closing it once.
 *
 * Every label comes from the schema's `labelKey`, so `t()` is called with a
 * variable here. That is normally forbidden (the extractor cannot see it), which
 * is why the keys are written into src/locales/en/authoring_config.json by hand
 * and this file is the one documented exception.
 */

/** Human bytes, for a field the schema calls `bytes`. */
function formatBytes(value) {
    if (!Number.isFinite(value)) return '—';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let n = value; let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n % 1 === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

/** One control per schema type. The switch IS the contract with §11c.1. */
function Field({ fieldKey, spec, value, onChange, t }) {
    const label = t(spec.labelKey, { defaultValue: spec.labelKey });
    const id = `plugin-setting-${fieldKey.replace(/\W/g, '-')}`;

    if (spec.type === 'boolean') {
        return (
            <label htmlFor={id} className="flex items-start gap-3 py-2">
                <input
                    id={id} type="checkbox" className="mt-1"
                    checked={Boolean(value)}
                    onChange={(e) => onChange(e.target.checked)}
                />
                <span className="text-sm">{label}</span>
            </label>
        );
    }

    if (spec.type === 'enum') {
        return (
            <div className="py-2">
                <label htmlFor={id} className="block text-sm mb-1">{label}</label>
                <select
                    id={id} className="rohy-input w-full"
                    value={String(value ?? '')}
                    onChange={(e) => {
                        // The schema's options carry their own type — a tileSize
                        // is a number and a targetObjective is a string. Sending
                        // the string form of a numeric option would be refused
                        // by the server's own validator.
                        const picked = spec.options.find((o) => String(o) === e.target.value);
                        onChange(picked ?? e.target.value);
                    }}
                >
                    {spec.options.map((option) => (
                        <option key={String(option)} value={String(option)}>{String(option)}</option>
                    ))}
                </select>
            </div>
        );
    }

    if (spec.type === 'enumList') {
        const selected = Array.isArray(value) ? value : [];
        return (
            <fieldset className="py-2">
                <legend className="text-sm mb-1">{label}</legend>
                <div className="flex flex-wrap gap-3">
                    {spec.options.map((option) => (
                        <label key={String(option)} className="flex items-center gap-1.5 text-sm">
                            <input
                                type="checkbox"
                                checked={selected.includes(option)}
                                onChange={(e) => onChange(e.target.checked
                                    ? [...selected, option]
                                    : selected.filter((v) => v !== option))}
                            />
                            {String(option)}
                        </label>
                    ))}
                </div>
            </fieldset>
        );
    }

    if (spec.type === 'origins') {
        const list = Array.isArray(value) ? value : [];
        return (
            <fieldset className="py-2">
                <legend className="text-sm mb-1">{label}</legend>
                {list.length === 0 && (
                    <p className="text-xs text-neutral-500 mb-2">
                        {t('plugin_settings_no_origins', { defaultValue: 'No hosts allowed. Imports are refused until one is added.' })}
                    </p>
                )}
                {list.map((origin, index) => (
                    <div key={origin} className="flex items-center gap-2 mb-1">
                        <code className="flex-1 text-xs">{origin}</code>
                        <button
                            type="button" className="rohy-btn-ghost text-xs"
                            onClick={() => onChange(list.filter((_, i) => i !== index))}
                        >
                            {t('plugin_settings_remove', { defaultValue: 'Remove' })}
                        </button>
                    </div>
                ))}
                <OriginAdder onAdd={(origin) => onChange([...list, origin])} t={t} />
            </fieldset>
        );
    }

    // int / bytes
    return (
        <div className="py-2">
            <label htmlFor={id} className="block text-sm mb-1">
                {label}
                {spec.type === 'bytes' && Number.isFinite(value) && (
                    <span className="ml-2 text-xs text-neutral-500 tabular-nums">{formatBytes(value)}</span>
                )}
            </label>
            <input
                id={id} type="number" className="rohy-input w-full"
                min={spec.min} max={spec.max}
                value={Number.isFinite(value) ? value : ''}
                onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            />
            <p className="text-xs text-neutral-500 mt-1 tabular-nums">
                {spec.type === 'bytes' ? `${formatBytes(spec.min)} – ${formatBytes(spec.max)}` : `${spec.min} – ${spec.max}`}
            </p>
        </div>
    );
}

function OriginAdder({ onAdd, t }) {
    const [draft, setDraft] = useState('');
    return (
        <div className="flex gap-2 mt-2">
            <input
                className="rohy-input flex-1" value={draft} placeholder="https://slides.example.edu"
                onChange={(e) => setDraft(e.target.value)}
            />
            <button
                type="button" className="rohy-btn-secondary text-sm"
                disabled={!draft.trim()}
                onClick={() => { onAdd(draft.trim()); setDraft(''); }}
            >
                {t('plugin_settings_add', { defaultValue: 'Add' })}
            </button>
        </div>
    );
}

/** The managed slide library: every imported asset, whatever state it is in. */
function LibraryCard({ pluginId, t }) {
    const [assets, setAssets] = useState([]);
    // `settled` is not cosmetic. Until the first /assets call answers, the card
    // does not know whether this deployment HAS a managed library — and a
    // header that appears for a moment and then vanishes is worse than one that
    // arrives a beat late. Rendering nothing until the answer is known also
    // removes the flash entirely.
    const [state, setState] = useState({ loading: true, settled: false, error: '', unavailable: false });

    const refresh = useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: '' }));
        try {
            const body = await apiGet(`/plugins/${pluginId}/assets`);
            setAssets(Array.isArray(body?.assets) ? body.assets : []);
            setState({ loading: false, settled: true, error: '', unavailable: false });
        } catch (err) {
            // No server module, or no library directory provisioned. Both are
            // operator states, not errors: the card simply says so.
            if (err instanceof ApiError && (err.status === 404 || err.status === 503)) {
                setState({ loading: false, settled: true, error: '', unavailable: true });
                return;
            }
            setState({ loading: false, settled: true, error: err?.message ?? String(err), unavailable: false });
        }
    }, [pluginId]);
    useEffect(() => { refresh(); }, [refresh]);

    const remove = async (assetId) => {
        try {
            await apiFetch(`/plugins/${pluginId}/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
            await refresh();
        } catch (err) { setState((s) => ({ ...s, error: err?.message ?? String(err) })); }
    };

    if (!state.settled || state.unavailable) return null;

    return (
        <section className="rohy-card p-4">
            <header className="flex items-center gap-2 mb-3">
                <h3 className="font-semibold text-sm">
                    {t('plugin_settings_library', { defaultValue: 'Imported slides' })}
                </h3>
                <button type="button" className="rohy-btn-ghost text-xs ml-auto" onClick={refresh}>
                    <RefreshCw className={`h-3.5 w-3.5 ${state.loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                </button>
            </header>
            {state.error && <p role="alert" className="text-xs text-red-500 mb-2">{state.error}</p>}
            {!state.loading && assets.length === 0 && (
                <p className="text-xs text-neutral-500">
                    {t('plugin_settings_library_empty', { defaultValue: 'Nothing has been imported yet.' })}
                </p>
            )}
            {assets.length > 0 && (
                <table className="w-full text-xs">
                    <thead className="text-neutral-500 text-left">
                        <tr>
                            <th className="py-1">{t('plugin_settings_col_slide', { defaultValue: 'Slide' })}</th>
                            <th>{t('plugin_settings_col_state', { defaultValue: 'State' })}</th>
                            <th>{t('plugin_settings_col_optics', { defaultValue: 'Optics' })}</th>
                            <th aria-label="actions" />
                        </tr>
                    </thead>
                    <tbody>
                        {assets.map((asset) => (
                            <tr key={asset.id} className="border-t border-neutral-800">
                                <td className="py-1.5">
                                    <div className="font-medium">{asset.label || asset.id}</div>
                                    {asset.error && (
                                        <div className="text-red-400 flex items-center gap-1 mt-0.5">
                                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />{asset.error}
                                        </div>
                                    )}
                                </td>
                                <td className="tabular-nums">{asset.status}</td>
                                <td className="tabular-nums">
                                    {asset.revisions?.[0]?.optics?.nativeObjective
                                        ? `${asset.revisions[0].optics.nativeObjective}× · ${asset.revisions[0].optics.nativeMpp} µm/px`
                                        : '—'}
                                </td>
                                <td className="text-right">
                                    <button
                                        type="button" className="rohy-btn-ghost text-xs"
                                        onClick={() => remove(asset.id)}
                                        aria-label={`Remove ${asset.label || asset.id}`}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

/** One plugin's settings, rendered from its schema. */
function PluginSettings({ pluginId, t }) {
    const [schema, setSchema] = useState(null);
    const [values, setValues] = useState({});
    const [dirty, setDirty] = useState({});
    const [state, setState] = useState({ loading: true, error: '', saved: false });

    // No synchronous setState here: the initial state is already `loading`, and
    // setting it again in the effect body costs a cascading render on every
    // mount. A REFRESH sets it (see the button), because there the spinner is
    // the whole point.
    const load = useCallback(async () => {
        try {
            const body = await apiGet(`/plugins/${pluginId}/settings`);
            setSchema(body.schema);
            setValues(body.settings ?? {});
            setDirty({});
            setState({ loading: false, error: '', saved: false });
        } catch (err) {
            setState({ loading: false, error: err?.body?.error ?? err?.message ?? String(err), saved: false });
        }
    }, [pluginId]);
    useEffect(() => { load(); }, [load]);

    const save = async () => {
        setState((s) => ({ ...s, error: '', saved: false }));
        try {
            // ONLY the keys that changed. The PUT is a key-presence merge, so
            // sending everything would overwrite a field another admin edited
            // between this page loading and this click.
            const body = await apiFetch(`/plugins/${pluginId}/settings`, {
                method: 'PUT',
                body: JSON.stringify(Object.fromEntries(Object.keys(dirty).map((k) => [k, values[k]]))),
            });
            setValues(body.settings ?? values);
            setDirty({});
            setState({ loading: false, error: '', saved: true });
        } catch (err) {
            // The server names the offending field; showing that beats a
            // generic "save failed" when four cards are on screen.
            setState({ loading: false, error: err?.body?.error ?? err?.message ?? String(err), saved: false });
        }
    };

    const groups = useMemo(() => (schema?.groups ?? []).map((group) => ({
        ...group,
        fields: Object.entries(schema.fields ?? {}).filter(([key]) => key.startsWith(`${group.key}.`)),
    })).filter((group) => group.fields.length > 0), [schema]);

    if (state.loading) return <p className="text-sm text-neutral-500">…</p>;
    if (!schema) {
        return <p role="alert" className="text-sm text-red-500">{state.error || 'No settings.'}</p>;
    }

    return (
        <div className="space-y-4">
            {groups.map((group) => (
                <section key={group.key} className="rohy-card p-4">
                    <h3 className="font-semibold text-sm mb-2">
                        {t(group.labelKey, { defaultValue: group.labelKey })}
                    </h3>
                    {group.fields.map(([key, spec]) => (
                        <Field
                            key={key} fieldKey={key} spec={spec} value={values[key]} t={t}
                            onChange={(next) => {
                                setValues((v) => ({ ...v, [key]: next }));
                                setDirty((d) => ({ ...d, [key]: true }));
                            }}
                        />
                    ))}
                </section>
            ))}

            <LibraryCard pluginId={pluginId} t={t} />

            <div className="flex items-center gap-3">
                <button
                    type="button" className="rohy-btn-primary"
                    disabled={Object.keys(dirty).length === 0}
                    onClick={save}
                >
                    {t('plugin_settings_save', { defaultValue: 'Save changes' })}
                </button>
                {state.saved && (
                    <span className="text-xs text-green-500">
                        {t('plugin_settings_saved', { defaultValue: 'Saved.' })}
                    </span>
                )}
                {state.error && <span role="alert" className="text-xs text-red-500">{state.error}</span>}
            </div>
        </div>
    );
}

export default function PluginSettingsTab() {
    const { t } = useTranslation('authoring_config');
    // Only plugins that DECLARE settings. A plugin without the slot is not
    // broken and is not listed — the same peaceful exclusion the rest of RPS-1
    // has, applied to a settings page.
    const configurable = useMemo(() => PLUGIN_MANIFESTS.filter((m) => m.settings), []);
    const [active, setActive] = useState(configurable[0]?.id ?? null);

    if (configurable.length === 0) {
        return (
            <p className="text-sm text-neutral-500">
                {t('plugin_settings_none', { defaultValue: 'No installed plugin has configurable settings.' })}
            </p>
        );
    }

    return (
        <div className="space-y-4">
            <header className="flex items-center gap-2">
                <Plug className="h-4 w-4" aria-hidden="true" />
                <h2 className="font-semibold">{t('tab_plugins', { defaultValue: 'Plugins' })}</h2>
            </header>
            {configurable.length > 1 && (
                <nav className="flex gap-2" aria-label={t('tab_plugins', { defaultValue: 'Plugins' })}>
                    {configurable.map((manifest) => (
                        <button
                            key={manifest.id} type="button"
                            className={active === manifest.id ? 'rohy-btn-primary text-sm' : 'rohy-btn-secondary text-sm'}
                            onClick={() => setActive(manifest.id)}
                        >
                            {t(manifest.room.labelKey, { defaultValue: manifest.id })}
                        </button>
                    ))}
                </nav>
            )}
            {active && <PluginSettings key={active} pluginId={active} t={t} />}
        </div>
    );
}
