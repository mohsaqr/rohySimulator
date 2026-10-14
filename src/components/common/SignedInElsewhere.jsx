import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

// Shown over everything when another tab of this browser signed in as someone else, or signed out.
// The browser's one sign-in now belongs to that tab, so this one cannot go on as the person it shows
// (services/tabIdentity.js): the only way forward is a reload, which opens as whoever is signed in.
//
// A blocking state, not a dialog to dismiss (FI-0010 review F17): everything else on the page is made
// `inert` while it shows (no clicks, no focus, hidden from assistive technology), Tab and Shift+Tab stay
// on Reload, and Escape does nothing — nor does it reach a dialog underneath. It renders into
// document.body so the inert sweep covers the app root and every other portal alike.
export default function SignedInElsewhere({ other }) {
    const { t } = useTranslation('app');
    const overlay = useRef(null);
    const button = useRef(null);

    useEffect(() => {
        const root = overlay.current;
        if (!root) return undefined;
        // Make every other top-level element inert; remember which ones we changed so an element that
        // was inert already (another modal's doing) is left as it was.
        const madeInert = [...document.body.children].filter((el) => el !== root && !el.hasAttribute('inert'));
        madeInert.forEach((el) => el.setAttribute('inert', ''));
        button.current?.focus();

        const keepFocus = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (event.key === 'Tab') {
                // Reload is the only control: Tab and Shift+Tab both stay on it.
                event.preventDefault();
                button.current?.focus();
            }
        };
        const pullFocusBack = (event) => {
            if (!root.contains(event.target)) button.current?.focus();
        };
        // Capture on window: runs before any listener in the app, including window-level ones.
        window.addEventListener('keydown', keepFocus, true);
        document.addEventListener('focusin', pullFocusBack, true);
        return () => {
            window.removeEventListener('keydown', keepFocus, true);
            document.removeEventListener('focusin', pullFocusBack, true);
            madeInert.forEach((el) => el.removeAttribute('inert'));
        };
    }, []);

    const signedOut = other.userId === null;
    return createPortal(
        <div ref={overlay} className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" data-testid="signed-in-elsewhere">
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
        </div>,
        document.body
    );
}
