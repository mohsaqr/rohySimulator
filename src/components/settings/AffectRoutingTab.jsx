import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScanFace, Save, RefreshCw, Info, AlertTriangle } from 'lucide-react';
import { ApiError, apiFetch, apiPut } from '../../services/apiClient.js';
import { useToast } from '../../contexts/ToastContext.jsx';

// Affect routing (Plan A, todo/plan-a-implementation-spec.md): platform-wide
// config for routing the learner's live Oyon-observed affect into the LLM as
// a transient per-turn prompt note. This tab only edits the stored config —
// the actual gate lives server-side (resolveAffectNote in
// server/shared/affectNote.js), re-read on every LLM call.
//
// Defaults are deliberately conservative: OFF, the privacy-lightest signal
// (anxious yes/no), local providers only. Affect is biometric-derived data;
// widening any of these is an explicit admin decision.

const blankSettings = {
    enabled: false,
    affect_mode: 'anxious',
    min_confidence: 0.4,
    max_age_ms: 20000,
    reactivity: 'subtle',
    may_acknowledge: false,
    providers: 'local_only',
};

export default function AffectRoutingTab() {
    const { t } = useTranslation('authoring_config');
    const toast = useToast();
    const [settings, setSettings] = useState(blankSettings);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadAll = async () => {
        setLoading(true);
        try {
            const cfg = await apiFetch('/platform-settings/affect');
            setSettings({ ...blankSettings, ...cfg });
        } catch (err) {
            toast.error?.(err instanceof ApiError ? (err.body?.error || err.message) : err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(); }, []);

    const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

    const save = async () => {
        setSaving(true);
        try {
            const payload = {
                enabled: settings.enabled,
                affect_mode: settings.affect_mode,
                min_confidence: Number(settings.min_confidence),
                max_age_ms: Number(settings.max_age_ms),
                providers: settings.providers,
            };
            const saved = await apiPut('/platform-settings/affect', payload);
            setSettings(prev => ({ ...prev, ...saved }));
            toast.success?.(t('affect_saved'));
        } catch (err) {
            toast.error?.(err instanceof ApiError ? (err.body?.error || err.message) : err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-neutral-400">
                <RefreshCw className="w-4 h-4 animate-spin" /> {t('affect_loading')}
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                    <ScanFace className="w-5 h-5 text-purple-400" />
                    <h3 className="text-lg font-bold">{t('affect_title')}</h3>
                </div>
            </div>

            <div className="flex items-start gap-2 p-3 rounded border border-sky-800 bg-sky-950/30 text-sky-200 text-sm">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>{t('affect_intro')}</div>
            </div>

            <section className="space-y-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={!!settings.enabled}
                        onChange={(e) => update('enabled', e.target.checked)}
                        className="w-4 h-4 accent-purple-500"
                    />
                    <span className="text-sm font-bold text-white">{t('affect_enabled')}</span>
                </label>
                <p className="text-xs text-neutral-500">{t('affect_consent_note')}</p>

                <div>
                    <label className="block text-sm font-bold text-neutral-200 mb-1">{t('affect_mode')}</label>
                    <select
                        value={settings.affect_mode}
                        onChange={(e) => update('affect_mode', e.target.value)}
                        className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-white w-full max-w-md"
                    >
                        <option value="off">{t('affect_mode_off')}</option>
                        <option value="anxious">{t('affect_mode_anxious')}</option>
                        <option value="dominant">{t('affect_mode_dominant')}</option>
                    </select>
                    <p className="text-xs text-neutral-500 mt-1">{t('affect_mode_help')}</p>
                </div>

                <div>
                    <label className="block text-sm font-bold text-neutral-200 mb-1">{t('affect_providers')}</label>
                    <select
                        value={settings.providers}
                        onChange={(e) => update('providers', e.target.value)}
                        className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-white w-full max-w-md"
                    >
                        <option value="local_only">{t('affect_providers_local')}</option>
                        <option value="any">{t('affect_providers_any')}</option>
                    </select>
                    {settings.providers === 'any' && (
                        <div className="flex items-start gap-2 mt-2 p-3 rounded border border-amber-800 bg-amber-950/30 text-amber-200 text-sm">
                            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <div>{t('affect_providers_warning')}</div>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-md">
                    <div>
                        <label className="block text-sm font-bold text-neutral-200 mb-1">{t('affect_min_confidence')}</label>
                        <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            value={settings.min_confidence}
                            onChange={(e) => update('min_confidence', e.target.value)}
                            className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-white w-full"
                        />
                        <p className="text-xs text-neutral-500 mt-1">{t('affect_min_confidence_help')}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-neutral-200 mb-1">{t('affect_max_age')}</label>
                        <input
                            type="number"
                            min="1"
                            max="120"
                            step="1"
                            value={Math.round(Number(settings.max_age_ms) / 1000)}
                            onChange={(e) => update('max_age_ms', Number(e.target.value) * 1000)}
                            className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-white w-full"
                        />
                        <p className="text-xs text-neutral-500 mt-1">{t('affect_max_age_help')}</p>
                    </div>
                </div>
            </section>

            {/* Sticky save bar — same pattern as VoiceSettingsTab: pinned to
                the bottom of ConfigPanel's scroll pane, last element in the tab. */}
            <div className="sticky bottom-0 z-10 bg-[var(--rohy-bg)] border-t border-neutral-200/10 py-3 flex gap-2">
                <button
                    onClick={save}
                    disabled={saving}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-white text-sm font-bold flex items-center gap-2"
                >
                    {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {t('affect_save')}
                </button>
                <button
                    onClick={loadAll}
                    disabled={saving}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded text-neutral-300 text-sm flex items-center gap-2"
                >
                    <RefreshCw className="w-4 h-4" /> {t('affect_reload')}
                </button>
            </div>
        </div>
    );
}
