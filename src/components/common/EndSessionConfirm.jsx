import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StopCircle, AlertTriangle } from 'lucide-react';

// role=dialog + Escape-to-cancel, and focus starts on Cancel — the safe
// choice for an irreversible action (QA 2026-10-04, PRV-31: the confirm was
// an unlabelled div that a keyboard user could not dismiss).
//
// `failed`: the last end request did not reach the server. The dialog stays
// open, says so, and its confirm button becomes "Try again" (FI-0010 review
// F10) — the case is still running until the server accepts the end.
// `busy`: a request is in flight; the confirm button waits for it.
export default function EndSessionConfirm({ onCancel, onConfirm, busy = false, failed = false }) {
   const { t } = useTranslation('app');
   useEffect(() => {
      const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
   }, [onCancel]);
   return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
         <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="end-session-confirm-title"
            aria-describedby="end-session-confirm-body"
            className="bg-neutral-900 border border-red-800/70 rounded-lg shadow-2xl w-full max-w-md"
         >
            <div className="px-6 py-5 border-b border-neutral-800 flex items-center gap-3">
               <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" aria-hidden="true" />
               <h2 id="end-session-confirm-title" className="text-base font-semibold text-white">{t('end_session_confirm_title')}</h2>
            </div>
            <div id="end-session-confirm-body" className="px-6 py-5 text-sm text-neutral-300 space-y-2">
               <p>{t('end_session_confirm_intro')}</p>
               <ul className="list-disc list-inside text-neutral-400 space-y-1 ml-1">
                  <li>{t('end_session_confirm_timeline')}</li>
                  <li>{t('end_session_confirm_locked')}</li>
                  <li>{t('end_session_confirm_transcript')}</li>
               </ul>
               {failed && (
                  <p role="alert" data-testid="end-session-failed" className="mt-3 rounded border border-red-700/70 bg-red-950/60 px-3 py-2 text-red-200">
                     {t('end_session_failed')}
                  </p>
               )}
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-800">
               <button
                  type="button"
                  data-testid="end-session-cancel"
                  autoFocus
                  onClick={onCancel}
                  className="px-4 py-2 text-sm rounded border border-neutral-700 text-neutral-300 hover:text-white"
               >
                  {t('cancel')}
               </button>
               <button
                  type="button"
                  data-testid="end-session-confirm"
                  onClick={onConfirm}
                  disabled={busy}
                  aria-busy={busy || undefined}
                  className="px-4 py-2 text-sm rounded text-white font-semibold bg-red-700 hover:bg-red-600 disabled:opacity-60 flex items-center gap-2"
               >
                  <StopCircle className="w-4 h-4" />
                  {failed ? t('end_session_retry') : t('end_debrief')}
               </button>
            </div>
         </div>
      </div>
   );
}
