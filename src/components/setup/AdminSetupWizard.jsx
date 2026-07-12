// Admin first-run setup wizard (todo/first-run-setup-spec.md §2).
//
// A dismissible, recallable checklist — NOT a hard wall. Six steps cover
// what an admin realistically must decide before students arrive; every
// control writes through the SAME endpoints the Settings tabs own, so the
// wizard never invents state and staying half-finished costs nothing.
// "Finish later" and "Finish setup" both persist platform_settings
// .setup_completed; the wizard stays reachable from the top-bar menu
// (useSetup().openSetupWizard).
//
// The one true day-1 blocker is the AI engine (fresh installs point at a
// local LM Studio that won't exist on a real deploy) — its step carries a
// persistent red warning until a live Test Connection succeeds.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertTriangle, Check, ChevronLeft, ChevronRight, Cpu, Eye, EyeOff,
    Languages, Loader2, RefreshCw, ScanFace, Stethoscope, Users, Volume2, X
} from 'lucide-react';
import { ApiError, apiFetch, apiPut, apiPost } from '../../services/apiClient';
import { useToast } from '../../contexts/ToastContext.jsx';
import { LANGUAGES } from '../../i18n/languages';
import { LLM_PROVIDERS, defaultModelFor } from '../../services/llmCatalogue';
import ModelSelect from '../settings/ModelSelect';

const STEP_IDS = ['llm', 'language', 'case', 'voice', 'emotion', 'access'];

const STEP_ICONS = {
    llm: Cpu,
    language: Languages,
    case: Stethoscope,
    voice: Volume2,
    emotion: ScanFace,
    access: Users
};

// ---------------------------------------------------------------------------
// Small shared pieces

function Toggle({ checked, onChange, label, disabled = false }) {
    return (
        <label className={`flex items-center gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={e => onChange(e.target.checked)}
                className="w-4 h-4 accent-blue-500"
            />
            <span className="text-sm text-neutral-200">{label}</span>
        </label>
    );
}

function StatusChip({ level, label }) {
    const styles = {
        ok: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        warn: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        off: 'bg-neutral-700/40 text-neutral-400 border-neutral-600/40'
    };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${styles[level] || styles.off}`}>
            {level === 'ok' && <Check className="w-3 h-3" />}
            {level === 'warn' && <AlertTriangle className="w-3 h-3" />}
            {label}
        </span>
    );
}

const inputClass = 'w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-blue-500';
const cardClass = 'bg-neutral-900/70 border border-neutral-800 rounded-xl p-6';

// ---------------------------------------------------------------------------
// Step 1 — AI engine (the blocker)

function LLMStep({ t, toast, onChanged, tested, setTested }) {
    const [config, setConfig] = useState(null);
    const [showKey, setShowKey] = useState(false);
    const [detected, setDetected] = useState([]);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    useEffect(() => {
        apiFetch('/platform-settings/llm')
            .then(setConfig)
            .catch(err => toast.error(err instanceof ApiError ? err.message : t('llm_load_failed')));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (!config) {
        return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-neutral-500" /></div>;
    }

    const providerInfo = LLM_PROVIDERS[config.provider] || LLM_PROVIDERS.lmstudio;

    const changeProvider = (provider) => {
        const info = LLM_PROVIDERS[provider];
        setDetected([]);
        setTestResult(null);
        setTested(false);
        setConfig(prev => ({
            ...prev,
            provider,
            baseUrl: info.defaultBase,
            model: defaultModelFor(provider),
            apiKey: info.needsKey ? prev.apiKey : ''
        }));
    };

    const detectModels = async () => {
        try {
            const data = await apiPost('/platform-settings/llm/models/detect', {
                provider: config.provider,
                baseUrl: config.baseUrl,
                apiKey: config.apiKey
            });
            const models = Array.isArray(data.models) ? data.models : [];
            setDetected(models);
            if (models.length === 0) toast.info(t('llm_no_models'));
            else setConfig(prev => (prev.model ? prev : { ...prev, model: models[0] }));
        } catch (err) {
            toast.error(t('llm_detect_failed', { error: err.message }));
        }
    };

    // Save + live round-trip in one go — the wizard's definition of "done"
    // is a real completed chat call, not a saved form.
    const saveAndTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            await apiPut('/platform-settings/llm', config);
            const data = await apiPost('/platform-settings/llm/test', {});
            if (data.success) {
                setTestResult({ ok: true });
                setTested(true);
                toast.success(t('llm_test_success'));
            } else {
                setTestResult({ ok: false, error: data.error });
            }
        } catch (err) {
            setTestResult({ ok: false, error: err.message });
        } finally {
            setTesting(false);
            onChanged();
        }
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-neutral-400">{t('llm_intro')}</p>
            {!tested && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    {t('llm_warning')}
                </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="block text-xs text-neutral-400 mb-1">{t('llm_provider')}</label>
                    <select
                        value={config.provider}
                        onChange={e => changeProvider(e.target.value)}
                        className={inputClass}
                    >
                        {Object.entries(LLM_PROVIDERS).map(([id, info]) => (
                            <option key={id} value={id}>{info.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-neutral-400 mb-1">{t('llm_base_url')}</label>
                    <input
                        type="text"
                        value={config.baseUrl || ''}
                        onChange={e => { setConfig(prev => ({ ...prev, baseUrl: e.target.value })); setTested(false); }}
                        className={inputClass}
                    />
                </div>
                {providerInfo.needsKey && (
                    <div>
                        <label className="block text-xs text-neutral-400 mb-1">{t('llm_api_key')}</label>
                        <div className="relative">
                            <input
                                type={showKey ? 'text' : 'password'}
                                value={config.apiKey || ''}
                                onChange={e => { setConfig(prev => ({ ...prev, apiKey: e.target.value })); setTested(false); }}
                                className={`${inputClass} pr-9`}
                                autoComplete="off"
                            />
                            <button
                                type="button"
                                onClick={() => setShowKey(v => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                                aria-label={showKey ? t('llm_hide_key') : t('llm_show_key')}
                            >
                                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>
                )}
                <div>
                    <label className="block text-xs text-neutral-400 mb-1">{t('llm_model')}</label>
                    <ModelSelect
                        provider={config.provider}
                        value={config.model || ''}
                        onChange={model => { setConfig(prev => ({ ...prev, model })); setTested(false); }}
                        detectedModels={detected}
                        id="setup-llm-model"
                    />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                {!providerInfo.needsKey && (
                    <button type="button" onClick={detectModels} className="rohy-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm border border-neutral-700 rounded-lg text-neutral-300 hover:bg-neutral-800">
                        <RefreshCw className="w-4 h-4" />
                        {t('llm_detect')}
                    </button>
                )}
                <button
                    type="button"
                    onClick={saveAndTest}
                    disabled={testing}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg"
                >
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {t('llm_save_test')}
                </button>
                {testResult?.ok && <span className="text-sm text-emerald-400">{t('llm_status_ok')}</span>}
                {testResult && !testResult.ok && (
                    <span className="text-sm text-red-400 break-all">{t('llm_test_failed', { error: testResult.error || '' })}</span>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 2 — platform default language

function LanguageStep({ t, toast, status, onChanged }) {
    const current = status?.language?.default_ui_language || 'en';

    const pick = async (code) => {
        try {
            await apiPut('/platform-settings/language', { default_ui_language: code });
            toast.success(t('lang_saved', { language: LANGUAGES[code].name }));
            onChanged();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('save_failed'));
        }
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-neutral-400">{t('lang_intro')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(LANGUAGES).map(([code, lang]) => (
                    <button
                        key={code}
                        type="button"
                        onClick={() => pick(code)}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-left text-sm ${
                            current === code
                                ? 'border-blue-500 bg-blue-500/10 text-white'
                                : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
                        }`}
                    >
                        <span className="text-lg" aria-hidden="true">{lang.flag}</span>
                        <span>{lang.native === lang.name ? lang.native : `${lang.native} (${lang.name})`}</span>
                        {current === code && <Check className="w-4 h-4 ml-auto text-blue-400" />}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 3 — default course & case

function CaseStep({ t, toast, status, onChanged }) {
    const cases = status?.cases?.list || [];
    const byLanguage = status?.cases?.by_language || {};

    const setDefault = async (id) => {
        try {
            await apiPut(`/cases/${id}/default`, { is_default: true });
            toast.success(t('case_saved'));
            onChanged();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('save_failed'));
        }
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-neutral-400">{t('case_intro')}</p>
            <div>
                <div className="text-xs text-neutral-400 mb-2">{t('case_coverage')}</div>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(LANGUAGES).map(([code, lang]) => (
                        <StatusChip
                            key={code}
                            level={byLanguage[code] > 0 ? 'ok' : 'warn'}
                            label={`${lang.flag} ${byLanguage[code] || 0}`}
                        />
                    ))}
                </div>
            </div>
            {cases.length === 0 ? (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-300">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    {t('case_none')}
                </div>
            ) : (
                <div>
                    <div className="text-xs text-neutral-400 mb-2">{t('case_default_label')}</div>
                    <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                        {cases.map(c => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setDefault(c.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left text-sm ${
                                    c.is_default
                                        ? 'border-blue-500 bg-blue-500/10 text-white'
                                        : 'border-neutral-800 text-neutral-300 hover:bg-neutral-800'
                                }`}
                            >
                                <span aria-hidden="true">{(LANGUAGES[c.case_language] || LANGUAGES.en).flag}</span>
                                <span className="font-mono text-xs text-neutral-500">{c.case_code}</span>
                                <span className="truncate">{c.name}</span>
                                {c.is_default && (
                                    <span className="ml-auto text-[11px] text-blue-400 shrink-0">{t('case_is_default')}</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <p className="text-xs text-neutral-500">{t('case_hint')}</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 4 — voice

function VoiceStep({ t, toast, status, onChanged }) {
    const enabled = Boolean(status?.voice?.enabled);
    const missing = status?.voice?.languages_missing_default_voice || [];

    const toggle = async (next) => {
        try {
            // Key-presence merge on the server: this single-field PUT cannot
            // clobber sibling voice settings.
            await apiPut('/platform-settings/voice', { voice_mode_enabled: next });
            toast.success(next ? t('voice_enabled') : t('voice_disabled'));
            onChanged();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('save_failed'));
        }
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-neutral-400">{t('voice_intro')}</p>
            <div className={cardClass}>
                <Toggle checked={enabled} onChange={toggle} label={t('voice_enable')} />
            </div>
            {enabled && missing.length > 0 && (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-300">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    {t('voice_missing_defaults', {
                        langs: missing.map(code => (LANGUAGES[code] ? LANGUAGES[code].name : code)).join(', ')
                    })}
                </div>
            )}
            <p className="text-xs text-neutral-500">{t('voice_hint')}</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 5 — emotion capture + affect routing

function EmotionStep({ t, toast, status, onChanged }) {
    const [oyonSettings, setOyonSettings] = useState(null);
    const [oyonUnavailable, setOyonUnavailable] = useState(false);

    useEffect(() => {
        apiFetch('/addons/oyon/settings')
            .then(r => setOyonSettings(r?.settings || null))
            // Oyon can be gated off server-side (OYON_ENABLED!=1) — the step
            // then explains itself instead of showing dead controls.
            .catch(() => setOyonUnavailable(true));
    }, []);

    const toggleCapture = async (next) => {
        if (!oyonSettings) return;
        try {
            // The Oyon settings PUT is a full replace (absent booleans become
            // 0), so always send the whole merged object — same contract
            // OyonSettingsTab uses.
            const res = await apiFetch('/addons/oyon/settings', {
                method: 'PUT',
                json: { ...oyonSettings, emotion_capture_enabled: next }
            });
            setOyonSettings(res?.settings || { ...oyonSettings, emotion_capture_enabled: next });
            toast.success(next ? t('emotion_enabled') : t('emotion_disabled'));
            onChanged();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('save_failed'));
        }
    };

    const toggleAffect = async (next) => {
        try {
            await apiPut('/platform-settings/affect', { enabled: next });
            toast.success(next ? t('affect_enabled') : t('affect_disabled'));
            onChanged();
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('save_failed'));
        }
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-neutral-400">{t('emotion_intro')}</p>
            {oyonUnavailable ? (
                <div className="flex items-start gap-2 bg-neutral-800/60 border border-neutral-700 rounded-lg p-3 text-sm text-neutral-400">
                    {t('emotion_unavailable')}
                </div>
            ) : (
                <div className={`${cardClass} space-y-4`}>
                    <Toggle
                        checked={Boolean(oyonSettings?.emotion_capture_enabled)}
                        onChange={toggleCapture}
                        disabled={!oyonSettings}
                        label={t('emotion_enable')}
                    />
                    <p className="text-xs text-neutral-500">{t('emotion_consent_note')}</p>
                </div>
            )}
            <div className={`${cardClass} space-y-4`}>
                <Toggle
                    checked={Boolean(status?.affect?.enabled)}
                    onChange={toggleAffect}
                    label={t('affect_enable')}
                />
                <p className="text-xs text-neutral-500">{t('affect_note')}</p>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Step 6 — access & users

function AccessStep({ t, toast }) {
    const [enforcement, setEnforcement] = useState(null);

    useEffect(() => {
        apiFetch('/platform-settings/cohort-case-enforcement')
            .then(r => setEnforcement(Boolean(r?.enabled)))
            .catch(() => setEnforcement(false));
    }, []);

    const toggle = async (next) => {
        try {
            await apiPut('/platform-settings/cohort-case-enforcement', { enabled: next });
            setEnforcement(next);
            toast.success(t('access_saved'));
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('save_failed'));
        }
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-neutral-400">{t('access_intro')}</p>
            <div className={cardClass}>
                <Toggle
                    checked={Boolean(enforcement)}
                    onChange={toggle}
                    disabled={enforcement === null}
                    label={t('access_enforce')}
                />
                <p className="text-xs text-neutral-500 mt-2">{t('access_enforce_help')}</p>
            </div>
            <p className="text-sm text-neutral-400">{t('access_users_hint')}</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// The wizard shell

export default function AdminSetupWizard({ onClose }) {
    const { t } = useTranslation('first_run');
    const toast = useToast();
    const [status, setStatus] = useState(null);
    const [stepIndex, setStepIndex] = useState(0);
    const [closing, setClosing] = useState(false);
    // Session-local "the Test Connection round-trip passed" — the strongest
    // signal we have that students can actually chat.
    const [llmTested, setLlmTested] = useState(false);

    const refreshStatus = useCallback(() => {
        apiFetch('/setup/status')
            .then(setStatus)
            .catch(err => console.error('[Setup] status load failed:', err));
    }, []);

    useEffect(() => { refreshStatus(); }, [refreshStatus]);

    // Both exits persist the flag — dismissing means "stop auto-showing",
    // not "pretend I was never here". Persist failure still closes: a
    // network blip must not trap the admin in the wizard.
    const persistAndClose = async () => {
        setClosing(true);
        try {
            await apiPut('/platform-settings/setup', { completed: true });
        } catch (err) {
            console.error('[Setup] could not persist completion flag:', err);
        }
        onClose();
    };

    const chipFor = (id) => {
        if (!status) return { level: 'off', label: t('status_loading') };
        switch (id) {
            case 'llm': {
                const info = LLM_PROVIDERS[status.llm?.provider] || {};
                const configured = status.llm?.enabled
                    && (!info.modelRequired || status.llm?.model)
                    && (!info.needsKey || status.llm?.key_present);
                if (llmTested) return { level: 'ok', label: t('status_tested') };
                return configured
                    ? { level: 'warn', label: t('status_untested') }
                    : { level: 'warn', label: t('status_needs_setup') };
            }
            case 'language':
                return { level: 'ok', label: (LANGUAGES[status.language?.default_ui_language] || LANGUAGES.en).name };
            case 'case':
                return status.cases?.total > 0 && status.cases?.default_case
                    ? { level: 'ok', label: status.cases.default_case.case_code || t('status_done') }
                    : { level: 'warn', label: t('status_needs_setup') };
            case 'voice':
                if (!status.voice?.enabled) return { level: 'off', label: t('status_off') };
                return status.voice.languages_missing_default_voice?.length > 0
                    ? { level: 'warn', label: t('status_voices_missing') }
                    : { level: 'ok', label: t('status_on') };
            case 'emotion':
                return status.oyon?.enabled
                    ? { level: 'ok', label: t('status_on') }
                    : { level: 'off', label: t('status_off') };
            case 'access':
            default:
                return { level: 'ok', label: t('status_optional') };
        }
    };

    const stepId = STEP_IDS[stepIndex];
    const changed = () => refreshStatus();

    const stepBody = {
        llm: <LLMStep t={t} toast={toast} onChanged={changed} tested={llmTested} setTested={setLlmTested} />,
        language: <LanguageStep t={t} toast={toast} status={status} onChanged={changed} />,
        case: <CaseStep t={t} toast={toast} status={status} onChanged={changed} />,
        voice: <VoiceStep t={t} toast={toast} status={status} onChanged={changed} />,
        emotion: <EmotionStep t={t} toast={toast} status={status} onChanged={changed} />,
        access: <AccessStep t={t} toast={toast} />
    }[stepId];

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
            <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
                <div>
                    <h1 className="text-lg font-bold text-white">{t('admin_title')}</h1>
                    <p className="text-xs text-neutral-500">{t('admin_subtitle')}</p>
                </div>
                <button
                    type="button"
                    onClick={persistAndClose}
                    disabled={closing}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm text-neutral-400 hover:text-white border border-neutral-700 rounded-lg hover:bg-neutral-800 disabled:opacity-50"
                >
                    <X className="w-4 h-4" />
                    {t('finish_later')}
                </button>
            </header>

            <div className="flex-1 flex flex-col sm:flex-row min-h-0">
                {/* Step rail */}
                <nav className="sm:w-72 shrink-0 border-b sm:border-b-0 sm:border-r border-neutral-800 p-4 space-y-1 overflow-y-auto">
                    {STEP_IDS.map((id, i) => {
                        const Icon = STEP_ICONS[id];
                        const chip = chipFor(id);
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setStepIndex(i)}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm ${
                                    i === stepIndex ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:bg-neutral-900'
                                }`}
                            >
                                <Icon className="w-4 h-4 shrink-0" />
                                <span className="flex-1 truncate">{t(`step_${id}`)}</span>
                                <StatusChip level={chip.level} label={chip.label} />
                            </button>
                        );
                    })}
                    <p className="text-[11px] text-neutral-600 pt-3 px-1">{t('recall_hint')}</p>
                </nav>

                {/* Step content */}
                <main className="flex-1 overflow-y-auto p-6">
                    <h2 className="text-md font-semibold text-white mb-4">{t(`step_${stepId}`)}</h2>
                    {stepBody}
                </main>
            </div>

            <footer className="flex items-center justify-between px-6 py-4 border-t border-neutral-800">
                <button
                    type="button"
                    onClick={() => setStepIndex(i => Math.max(0, i - 1))}
                    disabled={stepIndex === 0}
                    className="inline-flex items-center gap-1 px-4 py-2 text-sm text-neutral-300 border border-neutral-700 rounded-lg hover:bg-neutral-800 disabled:opacity-40"
                >
                    <ChevronLeft className="w-4 h-4" />
                    {t('back')}
                </button>
                {stepIndex < STEP_IDS.length - 1 ? (
                    <button
                        type="button"
                        onClick={() => setStepIndex(i => Math.min(STEP_IDS.length - 1, i + 1))}
                        className="inline-flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
                    >
                        {t('next')}
                        <ChevronRight className="w-4 h-4" />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={persistAndClose}
                        disabled={closing}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50"
                    >
                        {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        {t('finish_setup')}
                    </button>
                )}
            </footer>
        </div>
    );
}
