// "About" dialog opened from the Settings & Administration header: product
// name, running version (GET /api/health — the same `version` the server
// reports to probes), copyright, the licence name, and the full LICENSE and
// NOTICE.md texts (GET /api/help/license), rendered read-only through the
// terms renderer — text only, never HTML.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import TermsDocument from '../terms/TermsDocument';

// Proper nouns and the legal notice are not translated.
const PRODUCT_NAME = 'Rohy';
const COPYRIGHT_LINE = '© 2025–2026 Professor Mohammed Saqr, PhD';
const CONTACT_URL = 'https://www.saqr.me';

const TABS = ['about', 'license', 'notices'];

export default function AboutDialog({ onClose }) {
    const { t } = useTranslation('authoring_config');
    const [tab, setTab] = useState('about');
    const [version, setVersion] = useState(null);
    const [texts, setTexts] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const closeRef = useRef(null);
    const tabRefs = useRef({});

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => { closeRef.current?.focus(); }, []);

    useEffect(() => {
        let cancelled = false;
        apiFetch('/health')
            .then((h) => { if (!cancelled) setVersion(h?.version || null); })
            .catch(() => { if (!cancelled) setVersion(null); });
        apiFetch('/help/license')
            .then((data) => { if (!cancelled) setTexts(data); })
            .catch((err) => { if (!cancelled) setLoadError(err?.body?.error || err?.message || 'error'); });
        return () => { cancelled = true; };
    }, []);

    const onTabKey = (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
        setTab(next);
        tabRefs.current[next]?.focus();
    };

    const tabLabel = { about: t('about_tab_about'), license: t('about_tab_license'), notices: t('about_tab_notices') };

    const renderText = (body) => {
        if (loadError) return <p role="alert" className="text-sm text-red-400">{t('about_load_failed')} ({loadError})</p>;
        if (!texts) return <p className="text-sm text-neutral-400">{t('about_loading')}</p>;
        return <TermsDocument body={body} />;
    };

    return (
        <div
            data-testid="about-dialog"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 backdrop-blur-sm"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="about-dialog-title"
                className="bg-neutral-900 text-neutral-200 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-neutral-700"
            >
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-neutral-700">
                    <h2 id="about-dialog-title" className="flex items-center gap-2 text-base font-bold text-neutral-100">
                        <Info className="w-5 h-5" aria-hidden="true" />
                        {t('about_dialog_title')}
                    </h2>
                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        aria-label={t('about_close')}
                        title={t('about_close')}
                        className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div role="tablist" aria-label={t('about_dialog_title')} className="flex gap-1 px-5 pt-3 border-b border-neutral-700 overflow-x-auto">
                    {TABS.map((id) => (
                        <button
                            key={id}
                            ref={(el) => { tabRefs.current[id] = el; }}
                            type="button"
                            role="tab"
                            id={`about-tab-${id}`}
                            aria-selected={tab === id}
                            aria-controls={`about-panel-${id}`}
                            tabIndex={tab === id ? 0 : -1}
                            onClick={() => setTab(id)}
                            onKeyDown={onTabKey}
                            className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === id
                                ? 'border-sky-500 text-neutral-100'
                                : 'border-transparent text-neutral-400 hover:text-neutral-200'}`}
                        >
                            {tabLabel[id]}
                        </button>
                    ))}
                </div>

                <div
                    role="tabpanel"
                    id={`about-panel-${tab}`}
                    aria-labelledby={`about-tab-${tab}`}
                    tabIndex={0}
                    className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
                >
                    {tab === 'about' && (
                        <div className="space-y-4 text-sm">
                            <div>
                                <p className="text-xl font-bold text-neutral-100">{PRODUCT_NAME}</p>
                                <p className="text-neutral-400">{t('about_description')}</p>
                            </div>
                            <dl className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-4 gap-y-2">
                                <dt className="font-semibold text-neutral-400">{t('about_version_label')}</dt>
                                <dd data-testid="about-version" className="text-neutral-100 font-mono">{version || t('about_version_unknown')}</dd>
                                <dt className="font-semibold text-neutral-400">{t('about_license_label')}</dt>
                                <dd data-testid="about-license-name" className="text-neutral-100">
                                    {texts?.license?.title || (loadError ? t('about_version_unknown') : t('about_loading'))}
                                </dd>
                                <dt className="font-semibold text-neutral-400">{t('about_contact_label')}</dt>
                                <dd>
                                    <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline underline-offset-2 hover:text-sky-300">
                                        {CONTACT_URL.replace(/^https:\/\//, '')}
                                    </a>
                                </dd>
                            </dl>
                            <p className="text-neutral-400">{COPYRIGHT_LINE}</p>
                        </div>
                    )}
                    {tab === 'license' && renderText(texts?.license?.text)}
                    {tab === 'notices' && renderText(texts?.notice?.text)}
                </div>
            </div>
        </div>
    );
}
