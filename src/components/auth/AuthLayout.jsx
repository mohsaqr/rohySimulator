import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../contexts/LanguageContext';
import { LANGUAGES } from '../../i18n/languages';
import {
    Globe,
    HeartPulse,
    MessagesSquare,
    FlaskConical,
    ScanFace,
    Network,
} from 'lucide-react';

// The feature story on the brand panel. These are the platform's documented
// claims (docs/product/index.md), not marketing invented for this screen — if
// a claim changes there, change it here.
const FEATURES = [
    { key: 'patient', icon: HeartPulse },
    { key: 'team', icon: MessagesSquare },
    { key: 'labs', icon: FlaskConical },
    { key: 'affect', icon: ScanFace },
    { key: 'analytics', icon: Network },
];

/**
 * The logged-out shell: brand + feature panel on the left, whatever card the
 * caller passes (login, register, pending-approval…) on the right, and the
 * attribution footer under the card.
 *
 * Owned by AuthGate — LoginPage and RegisterPage stay pure cards with no idea
 * this panel exists, so they remain testable without the layout and reusable
 * inside it.
 */
export default function AuthLayout({ children }) {
    const { t } = useTranslation('auth');
    const { uiLanguage, setUiLanguage } = useLanguage();

    return (
        <div className="min-h-screen bg-neutral-950 flex">
            {/* Brand panel — hidden on small screens, where the card is the point. */}
            <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative overflow-hidden flex-col justify-between p-12 bg-gradient-to-br from-blue-950 via-sky-950 to-teal-950">
                {/* Soft radial glows so the gradient reads as depth, not banding. */}
                <div aria-hidden="true" className="absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full bg-blue-600/20 blur-3xl" />
                <div aria-hidden="true" className="absolute -bottom-48 -right-24 w-[32rem] h-[32rem] rounded-full bg-teal-500/15 blur-3xl" />

                <div className="relative flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center border border-white/15">
                        <HeartPulse className="w-5 h-5 text-teal-300" />
                    </div>
                    <span className="text-2xl font-bold text-white tracking-tight">Rohy</span>
                    <span className="ml-1 px-2.5 py-0.5 rounded-full border border-white/20 bg-white/5 text-[11px] font-semibold uppercase tracking-widest text-teal-200">
                        {t('brand_badge')}
                    </span>
                </div>

                <div className="relative max-w-xl">
                    <h1 className="text-4xl xl:text-[2.75rem] font-bold leading-tight text-white mb-5">
                        {t('hero_headline')}
                    </h1>
                    <p className="text-base text-blue-100/80 leading-relaxed mb-10">
                        {t('hero_sub')}
                    </p>

                    <ul className="space-y-5">
                        {FEATURES.map(({ key, icon: Icon }) => (
                            <li key={key} className="flex items-start gap-4">
                                <div className="w-9 h-9 shrink-0 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center">
                                    <Icon className="w-[18px] h-[18px] text-teal-300" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-white">
                                        {t(`feature_${key}_title`)}
                                    </p>
                                    <p className="text-sm text-blue-100/70 leading-snug">
                                        {t(`feature_${key}_desc`)}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>

                <p className="relative text-xs text-blue-200/50">
                    {t('brand_baseline')}
                </p>
            </div>

            {/* Card column */}
            <div className="flex-1 flex flex-col min-h-screen">
                {/* Language selector — pre-login, persisted to localStorage so the
                    whole login/register flow renders in the chosen language. */}
                <div className="flex justify-end p-4">
                    <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
                        <select
                            value={uiLanguage}
                            onChange={(e) => setUiLanguage(e.target.value)}
                            aria-label={t('language', { defaultValue: 'Language' })}
                            className="appearance-none bg-neutral-900 border border-neutral-800 rounded-lg pl-9 pr-8 py-2 text-sm text-neutral-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                        >
                            {Object.entries(LANGUAGES).map(([code, lang]) => (
                                <option key={code} value={code}>
                                    {lang.flag} {lang.native === lang.name ? lang.native : `${lang.native} (${lang.name})`}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="flex-1 flex items-center justify-center px-4 py-8">
                    <div className="w-full max-w-md">
                        {/* Compact brand header for small screens, where the panel is hidden. */}
                        <div className="lg:hidden text-center mb-8">
                            <h1 className="text-4xl font-bold text-white mb-2">Rohy</h1>
                            <p className="text-neutral-400">{t('platform_tagline')}</p>
                        </div>

                        {children}
                    </div>
                </div>

                {/* Attribution footer — proper nouns, deliberately not translated. */}
                <footer className="px-4 pb-6 text-center text-xs text-neutral-600 space-y-0.5">
                    <p className="font-medium text-neutral-500">Rohy — {t('platform_tagline')}</p>
                    <p>Mohammed Saqr, PhD · University of Eastern Finland</p>
                    <p>
                        <a href="https://saqr.me" target="_blank" rel="noreferrer" className="hover:text-neutral-400 transition-colors">saqr.me</a>
                        {' · '}
                        <a href="mailto:saqr@saqr.me" className="hover:text-neutral-400 transition-colors">saqr@saqr.me</a>
                    </p>
                    <p>Carm Research License v1.0 · © 2025–2026</p>
                </footer>
            </div>
        </div>
    );
}
