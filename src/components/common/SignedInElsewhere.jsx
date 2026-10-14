import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// Shown over everything when another tab of this browser signed in as someone else, or signed out.
// The browser's one sign-in now belongs to that tab, so this one cannot go on as the person it shows
// (services/tabIdentity.js): the only way forward is a reload, which opens as whoever is signed in.
export default function SignedInElsewhere({ other }) {
    const { t } = useTranslation('app');
    const button = useRef(null);
    useEffect(() => { button.current?.focus(); }, []);
    const signedOut = other.userId === null;
    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" data-testid="signed-in-elsewhere">
            <div role="alertdialog" aria-modal="true" aria-labelledby="signed-in-elsewhere-title" aria-describedby="signed-in-elsewhere-text"
                className="max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-6 text-neutral-100 shadow-xl">
                <h2 id="signed-in-elsewhere-title" className="mb-2 text-lg font-semibold">
                    {signedOut ? t('signed_out_elsewhere_title') : t('signed_in_elsewhere_title')}
                </h2>
                <p id="signed-in-elsewhere-text" className="mb-4 text-sm text-neutral-300">
                    {signedOut ? t('signed_out_elsewhere_text') : t('signed_in_elsewhere_text', { name: other.username ?? '?' })}
                </p>
                <button ref={button} type="button" onClick={() => window.location.reload()}
                    className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
                    {t('signed_in_elsewhere_reload')}
                </button>
            </div>
        </div>
    );
}
