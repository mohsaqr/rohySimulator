// The terms of use, readable before signing in (GET /api/terms is public):
// terms you must accept to use an account should not need an account to read.
// Opened from the link under the login card.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import TermsDocument from './TermsDocument';

export default function TermsPublicPage({ onBack }) {
    const { t } = useTranslation('auth');
    const [terms, setTerms] = useState(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        apiFetch('/terms')
            .then((data) => { if (!cancelled) setTerms(data?.terms || null); })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 flex justify-center p-4 sm:p-8">
            <div className="w-full max-w-3xl space-y-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t('terms_back')}
                </button>
                <article className="rounded-xl border border-neutral-800 bg-neutral-900 px-6 py-5">
                    {failed && <p className="text-sm text-neutral-400">{t('terms_load_failed')}</p>}
                    {!failed && !terms && <p className="text-sm text-neutral-500">{t('loading')}</p>}
                    {terms && (
                        <>
                            <header className="mb-4 flex items-start justify-between gap-4 border-b border-neutral-800 pb-4">
                                <h1 className="text-lg font-semibold text-white">{terms.title}</h1>
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400">
                                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                                    {t('terms_version', { version: terms.version })}
                                </span>
                            </header>
                            <TermsDocument body={terms.body} />
                        </>
                    )}
                </article>
            </div>
        </div>
    );
}
