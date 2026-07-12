// Student (and teacher) first-run screen (todo/first-run-setup-spec.md §3).
//
// ONE page, not a wizard: language, a preview of the case they'll land on,
// a voice preference, and — where the tenant runs Oyon — the emotion-capture
// consent made VISIBLE (previously a silent default-on localStorage flag the
// student never saw). Completion is stored server-side in
// user_preferences.onboarding_settings so it follows the user across devices;
// the informational room tour (OnboardingTour) still plays afterwards.
//
// Educators get the same page plus an authoring pointer card. Admins never
// see this screen — they get the AdminSetupWizard instead.

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    BookOpen, Check, Languages, Loader2, Mic, ScanFace, Stethoscope, Volume2
} from 'lucide-react';
import { apiFetch, apiPut } from '../../services/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { LANGUAGES } from '../../i18n/languages';
import { pickLandingCase } from '../../services/landingCase';
import { caseDisplayLabel } from '../../utils/caseDisplayLabel';

// Bump to re-show this screen to everyone (checked in FirstRunGate).
export const FIRST_RUN_VERSION = 1;

// Same key OyonCaptureWidget reads; kept in sync on save so the widget
// honours the choice immediately, even before it learns to prefer the
// server-side copy.
const OYON_CONSENT_LS_KEY = 'oyon.defaultConsent';

const cardClass = 'bg-neutral-900 border border-neutral-800 rounded-xl p-5';

function CardTitle({ icon: Icon, children }) {
    return (
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
            <Icon className="w-4 h-4 text-blue-400" />
            {children}
        </h2>
    );
}

export default function StudentFirstRun({ onDone }) {
    const { t } = useTranslation('first_run');
    const { user } = useAuth();
    const { uiLanguage, setUiLanguage } = useLanguage();

    const [cases, setCases] = useState([]);
    const [voicePlatformOn, setVoicePlatformOn] = useState(false);
    const [oyonConfig, setOyonConfig] = useState(null); // null = tenant has Oyon off / unavailable

    const [wantsVoice, setWantsVoice] = useState(false);
    // Mirrors today's behaviour (consent defaults ON once the tenant opts
    // in) — but now the student SEES and can flip it before first capture.
    // Pre-migration users who had opted out in this browser keep their 'no'.
    const [oyonConsent, setOyonConsent] = useState(() => {
        try { return localStorage.getItem(OYON_CONSENT_LS_KEY) !== '0'; } catch { return true; }
    });
    const [micStatus, setMicStatus] = useState(null); // null | 'ok' | 'blocked'
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        apiFetch('/cases').then(list => setCases(Array.isArray(list) ? list : [])).catch(() => {});
        apiFetch('/platform-settings/voice')
            .then(v => setVoicePlatformOn(Boolean(v?.voice_mode_enabled)))
            .catch(() => {});
        apiFetch('/addons/oyon/config')
            .then(c => { if (c?.enabled) setOyonConfig(c); })
            .catch(() => {}); // gated off server-side → simply no consent card
    }, []);

    const landingCase = useMemo(() => pickLandingCase(cases, uiLanguage), [cases, uiLanguage]);
    const landingLang = landingCase?.config?.case_language;
    const isTeacher = user?.role === 'educator';

    const testMicrophone = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            setMicStatus('ok');
        } catch {
            setMicStatus('blocked');
        }
    };

    const start = async () => {
        setSaving(true);
        try {
            await apiPut('/users/preferences', {
                onboarding_settings: {
                    first_run_done: FIRST_RUN_VERSION,
                    voice_mode: wantsVoice,
                    oyon_consent: oyonConsent
                }
            });
        } catch (err) {
            // Non-fatal: the screen will show again next login, which is the
            // right failure mode for "the preference didn't stick".
            console.error('[FirstRun] could not save preferences:', err);
        }
        try { localStorage.setItem(OYON_CONSENT_LS_KEY, oyonConsent ? '1' : '0'); } catch { /* private mode */ }
        setSaving(false);
        onDone();
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 flex justify-center p-4 sm:p-8 overflow-y-auto">
            <div className="w-full max-w-2xl space-y-4 my-auto">
                <div className="text-center mb-2">
                    <h1 className="text-3xl font-bold text-white mb-1">{t('welcome_title')}</h1>
                    <p className="text-sm text-neutral-400">{t('welcome_intro')}</p>
                </div>

                {/* Language */}
                <section className={cardClass}>
                    <CardTitle icon={Languages}>{t('lang_card_title')}</CardTitle>
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                        {Object.entries(LANGUAGES).map(([code, lang]) => (
                            <button
                                key={code}
                                type="button"
                                onClick={() => { setUiLanguage(code).catch(() => {}); }}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm ${
                                    uiLanguage === code
                                        ? 'border-blue-500 bg-blue-500/10 text-white'
                                        : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
                                }`}
                            >
                                <span aria-hidden="true">{lang.flag}</span>
                                <span className="truncate">{lang.native}</span>
                                {uiLanguage === code && <Check className="w-3.5 h-3.5 ml-auto text-blue-400 shrink-0" />}
                            </button>
                        ))}
                    </div>
                </section>

                {/* First case preview */}
                <section className={cardClass}>
                    <CardTitle icon={Stethoscope}>{t('case_card_title')}</CardTitle>
                    {landingCase ? (
                        <div className="flex items-center gap-3 text-sm text-neutral-300">
                            <span className="text-lg" aria-hidden="true">
                                {(LANGUAGES[landingLang] || LANGUAGES.en).flag}
                            </span>
                            <span className="font-mono text-xs text-neutral-500">{landingCase.case_code}</span>
                            {/* Student-safe label — the raw case name can spoil the diagnosis. */}
                            <span>{caseDisplayLabel(landingCase, user, t('case_card_patient'))}</span>
                        </div>
                    ) : (
                        <p className="text-sm text-neutral-400">{t('case_card_none')}</p>
                    )}
                    {landingCase && landingLang !== uiLanguage && (
                        <p className="text-xs text-amber-400/90 mt-2">{t('case_card_language_fallback')}</p>
                    )}
                    <p className="text-xs text-neutral-500 mt-2">{t('case_card_hint')}</p>
                </section>

                {/* Voice — only when the platform has voice mode on at all */}
                {voicePlatformOn && (
                    <section className={cardClass}>
                        <CardTitle icon={Volume2}>{t('voice_card_title')}</CardTitle>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={wantsVoice}
                                onChange={e => setWantsVoice(e.target.checked)}
                                className="w-4 h-4 accent-blue-500"
                            />
                            <span className="text-sm text-neutral-200">{t('voice_card_toggle')}</span>
                        </label>
                        {wantsVoice && (
                            <div className="mt-3 flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={testMicrophone}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 text-xs border border-neutral-700 rounded-lg text-neutral-300 hover:bg-neutral-800"
                                >
                                    <Mic className="w-3.5 h-3.5" />
                                    {t('voice_card_test')}
                                </button>
                                {micStatus === 'ok' && <span className="text-xs text-emerald-400">{t('voice_mic_ok')}</span>}
                                {micStatus === 'blocked' && <span className="text-xs text-red-400">{t('voice_mic_blocked')}</span>}
                            </div>
                        )}
                    </section>
                )}

                {/* Emotion-capture consent — only when the tenant runs Oyon */}
                {oyonConfig && (
                    <section className={cardClass}>
                        <CardTitle icon={ScanFace}>{t('oyon_card_title')}</CardTitle>
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={oyonConsent}
                                onChange={e => setOyonConsent(e.target.checked)}
                                className="w-4 h-4 mt-0.5 accent-blue-500"
                            />
                            <span className="text-sm text-neutral-200">{t('oyon_card_toggle')}</span>
                        </label>
                        <p className="text-xs text-neutral-500 mt-2">
                            {t('oyon_card_note', { version: oyonConfig.consent_version || '' })}
                        </p>
                    </section>
                )}

                {/* Teacher pointer */}
                {isTeacher && (
                    <section className={`${cardClass} border-blue-900/50`}>
                        <CardTitle icon={BookOpen}>{t('teacher_card_title')}</CardTitle>
                        <p className="text-sm text-neutral-400">{t('teacher_card_body')}</p>
                    </section>
                )}

                <div className="flex justify-center pt-2 pb-6">
                    <button
                        type="button"
                        onClick={start}
                        disabled={saving}
                        className="inline-flex items-center gap-2 px-8 py-3 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        {t('start_cta')}
                    </button>
                </div>
            </div>
        </div>
    );
}
