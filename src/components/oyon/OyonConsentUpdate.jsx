import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScanFace, Loader2 } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import { parseOnboardingSettings } from '../../utils/onboardingSettings';
import { needsConsentUpgrade, acceptableVersion, OYON_CONSENT_VERSION_LS_KEY } from '../../utils/oyonConsent';
import { CONSENT_PREF_KEY } from './OyonCaptureWidget';
import EventLogger from '../../services/eventLogger';

/*
 * Re-consent prompt for an Oyon contract that has grown in scope.
 *
 * Why a separate surface rather than reusing the first-run card: that card is
 * gated behind `first_run_done`, so every EXISTING learner would never see it —
 * and they are exactly the people whose consent predates the new contract.
 *
 * Shown only to a learner who previously said YES to an older contract.
 * Declining is already an answer, so someone who said no is not re-asked (they
 * can opt in from Settings → Oyon); someone who never answered gets the
 * first-run card instead.
 *
 * Declining here is a real choice, not a dismissal: it records the refusal so
 * the prompt does not return. Camera-derived capture is unaffected either way —
 * it is covered by the contract the learner already accepted, and the server
 * gates only the newly-described signals on the newer version.
 */
export default function OyonConsentUpdate() {
   const { t } = useTranslation('app');
   const [state, setState] = useState(null); // { requiredVersion } once needed
   const [busy, setBusy] = useState(false);

   useEffect(() => {
      let cancelled = false;
      (async () => {
         try {
            const [config, prefs] = await Promise.all([
               apiFetch('/addons/oyon/config'),
               apiFetch('/users/preferences'),
            ]);
            if (cancelled) return;
            if (!config?.enabled) return;              // tenant runs no Oyon
            const onboarding = parseOnboardingSettings(prefs);
            if (needsConsentUpgrade({
               granted: onboarding.oyon_consent,
               acceptedVersion: onboarding.oyon_consent_version,
               requiredVersion: config.consent_version,
            })) {
               setState({ requiredVersion: config.consent_version });
            }
         } catch {
            // Oyon gated off, offline, or preferences unavailable — never block
            // the app on a consent probe.
         }
      })();
      return () => { cancelled = true; };
   }, []);

   const answer = async (granted) => {
      if (busy || !state) return;
      setBusy(true);
      // Record the version ACCEPTED, which is the version actually rendered
      // above — never whatever the server currently advertises.
      const version = acceptableVersion(state.requiredVersion);
      EventLogger.consentRecorded(version, granted ? 'granted' : 'declined', 'OyonConsentUpdate');
      try {
         await apiFetch('/users/preferences', {
            method: 'PUT',
            json: {
               onboarding_settings: {
                  oyon_consent: granted,
                  oyon_consent_version: granted ? version : null,
               },
            },
         });
      } catch {
         // Local mirror still applies on this device; the server re-checks on
         // ingest regardless, so a failed write cannot over-grant.
      }
      try {
         localStorage.setItem(CONSENT_PREF_KEY, granted ? '1' : '0');
         if (granted) localStorage.setItem(OYON_CONSENT_VERSION_LS_KEY, version);
         else localStorage.removeItem(OYON_CONSENT_VERSION_LS_KEY);
      } catch { /* private mode */ }
      setState(null);
      setBusy(false);
   };

   if (!state) return null;

   return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
         <div className="w-full max-w-lg rounded-lg border border-neutral-700 bg-neutral-900 p-5 space-y-4">
            <div className="flex items-center gap-2">
               <ScanFace className="w-5 h-5 text-blue-400" />
               <h2 className="text-base font-semibold text-neutral-100">{t('oyon_reconsent_title')}</h2>
            </div>

            <p className="text-sm text-neutral-300">{t('oyon_reconsent_body')}</p>

            <ul className="text-sm text-neutral-300 list-disc pl-5 space-y-1">
               <li>{t('oyon_reconsent_item_typing')}</li>
               <li>{t('oyon_reconsent_item_interaction')}</li>
               <li>{t('oyon_reconsent_item_discourse')}</li>
            </ul>

            <p className="text-xs text-neutral-500">
               {t('oyon_reconsent_note', { version: state.requiredVersion || '' })}
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
               <button
                  type="button"
                  disabled={busy}
                  onClick={() => answer(false)}
                  className="px-3 py-1.5 rounded text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
               >
                  {t('oyon_reconsent_decline')}
               </button>
               <button
                  type="button"
                  disabled={busy}
                  onClick={() => answer(true)}
                  className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 flex items-center gap-2"
               >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t('oyon_reconsent_accept')}
               </button>
            </div>
         </div>
      </div>
   );
}
