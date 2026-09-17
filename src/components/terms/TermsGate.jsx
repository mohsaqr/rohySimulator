// The terms-of-use step — shown once per account and per version, BETWEEN
// signing in and the app, in place of it. Ported from chatoyon+'s LicenseGate.
//
// A full page, not a dialog over the app: nothing (the simulator, a case, the
// Oyon runtime) mounts until the agreement is accepted. It appears only when an
// administrator has made acceptance required (Settings → Platform → Users).
//
// Declining signs out. There is no "later": an agreement you can dismiss is not
// one anyone has accepted.
//
// Failure posture matches FirstRunGate: if the status probe fails, log it and
// let the person through. A broken read must never lock everyone out, and the
// agreement is shown again on the next successful probe.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FileText, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch, ApiError } from '../../services/apiClient';
import TermsDocument from './TermsDocument';

export default function TermsGate({ children }) {
    const { t } = useTranslation('auth');
    const { user, logout } = useAuth();
    const [terms, setTerms] = useState(null);    // status payload, or null while loading
    const [phase, setPhase] = useState('loading'); // 'loading' | 'pending' | 'ready'
    const [agreed, setAgreed] = useState(false);
    const [readToEnd, setReadToEnd] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const scrollRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const data = await apiFetch('/terms/status');
            setTerms(data?.terms || null);
            setPhase(data?.terms?.pending ? 'pending' : 'ready');
        } catch (err) {
            console.error('[TermsGate] status probe failed, continuing:', err);
            setPhase('ready');
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        apiFetch('/terms/status')
            .then((data) => {
                if (cancelled) return;
                setTerms(data?.terms || null);
                setPhase(data?.terms?.pending ? 'pending' : 'ready');
            })
            .catch((err) => {
                console.error('[TermsGate] status probe failed, continuing:', err);
                if (!cancelled) setPhase('ready');
            });
        return () => { cancelled = true; };
    }, [user?.id]);

    // The checkbox unlocks once the text has been scrolled to the end — a small
    // piece of friction that makes "I have read this" less of a fiction. A text
    // short enough to fit counts as read on arrival.
    const checkScroll = useCallback(() => {
        const el = scrollRef.current;
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 24) setReadToEnd(true);
    }, []);
    useEffect(() => { if (phase === 'pending') checkScroll(); }, [phase, terms?.body, checkScroll]);

    if (phase === 'loading') {
        return (
            <div className="flex items-center justify-center h-screen bg-neutral-950">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }
    if (phase === 'ready' || !terms) return children;

    const accept = async () => {
        setSaving(true);
        setError(null);
        try {
            const data = await apiFetch('/terms/accept', { method: 'POST', json: { version: terms.version } });
            setTerms(data?.terms || terms);
            setPhase('ready');
        } catch (err) {
            if (err instanceof ApiError && err.status === 409) {
                // A new version was published while this page was open: show it.
                setError(t('terms_updated'));
                setAgreed(false);
                setReadToEnd(false);
                await load();
            } else {
                setError(t('terms_accept_failed'));
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 flex justify-center p-4 sm:p-8">
            <div className="flex w-full max-w-3xl flex-col rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-4rem)]">
                <header className="flex items-start justify-between gap-4 border-b border-neutral-800 px-6 py-4">
                    <div>
                        <h1 className="text-lg font-semibold text-white">{terms.title}</h1>
                        <p className="mt-1 text-sm text-neutral-400">{t('terms_gate_intro')}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400">
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('terms_version', { version: terms.version })}
                    </span>
                </header>

                <div
                    ref={scrollRef}
                    onScroll={checkScroll}
                    className="flex-1 overflow-y-auto px-6 py-5"
                    data-testid="terms-scroll"
                >
                    <TermsDocument body={terms.body} />
                </div>

                <footer className="space-y-3 border-t border-neutral-800 px-6 py-4">
                    <label className={`flex items-center gap-2 text-sm ${readToEnd ? 'text-neutral-200 cursor-pointer' : 'text-neutral-500'}`}>
                        <input
                            type="checkbox"
                            checked={agreed}
                            disabled={!readToEnd}
                            onChange={(e) => setAgreed(e.target.checked)}
                            className="h-4 w-4 rounded border-neutral-600 bg-neutral-800"
                        />
                        {t('terms_checkbox')}
                        {!readToEnd && <span className="text-neutral-500">{t('terms_scroll_hint')}</span>}
                    </label>
                    {error && <p role="alert" className="text-sm text-amber-400">{error}</p>}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={() => logout()}
                            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
                        >
                            <LogOut className="h-4 w-4" aria-hidden="true" />
                            {t('terms_decline')}
                        </button>
                        <div className="flex items-center gap-3">
                            {user?.username && <span className="text-xs text-neutral-500">{t('terms_signing_as', { name: user.username })}</span>}
                            <button
                                type="button"
                                onClick={accept}
                                disabled={!agreed || saving}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                                {t('terms_accept')}
                            </button>
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
}
