import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScanFace, Loader2 } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import { parseOnboardingSettings } from '../../utils/onboardingSettings';
import {
   needsConsentUpgrade, needsPhysioChoice, acceptableVersion, consentRank,
   OYON_CONSENT_VOICE, OYON_CONSENT_PHYSIO_KEY, OYON_CONSENT_VERSION_LS_KEY, announceOyonConsentChanged,
} from '../../utils/oyonConsent';
import { CONSENT_PREF_KEY } from './OyonCaptureWidget';
import OyonPhysioSwitch from './OyonPhysioSwitch';
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
 *
 * The card also shows the camera consent again, ONCE, to a learner who said
 * yes before it offered the heart-rate and breathing-rate switch, while the
 * tenant has heart rate or respiration switched on (terms 1.2, 2026-10-26;
 * utils/oyonConsent needsPhysioChoice). That is the same consent
 * with a switch under it, not a new contract: when no contract upgrade is due
 * the card asks only for the switch, leaves the camera choice and its version
 * exactly as they are, and saving with the switch off records "off".
 */
export default function OyonConsentUpdate() {
   const { t } = useTranslation('oyon');
   // { requiredVersion, upgrade } once needed; `upgrade` false means only the
   // heart-rate and breathing switch is being asked about.
   const [state, setState] = useState(null);
   const [physio, setPhysio] = useState(false);
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
            const upgrade = needsConsentUpgrade({
               granted: onboarding.oyon_consent,
               acceptedVersion: onboarding.oyon_consent_version,
               requiredVersion: config.consent_version,
            });
            if (upgrade || needsPhysioChoice(onboarding, config.runtime)) {
               setPhysio(onboarding[OYON_CONSENT_PHYSIO_KEY] === true);
               setState({ requiredVersion: config.consent_version, upgrade });
            }
         } catch {
            // Oyon gated off, offline, or preferences unavailable — never block
            // the app on a consent probe.
         }
      })();
      return () => { cancelled = true; };
   }, []);

   // Only the switch is due: record it and nothing else, so the camera consent
   // and the version it was given under stay exactly as they are. "No, keep it
   // as it is" records the switch as off.
   const savePhysio = async (value) => {
      if (busy || !state) return;
      setBusy(true);
      EventLogger.consentRecorded(OYON_CONSENT_PHYSIO_KEY, value ? 'granted' : 'declined', 'OyonConsentUpdate');
      try {
         await apiFetch('/users/preferences', {
            method: 'PUT',
            json: { onboarding_settings: { [OYON_CONSENT_PHYSIO_KEY]: value } },
         });
      } catch {
         // Not saved: the card returns next load, and the server keeps storing
         // no heart rate or breathing until a `true` is on record.
      }
      setState(null);
      setBusy(false);
      announceOyonConsentChanged();
   };

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
                  // Declining the consent turns the switch under it off too.
                  [OYON_CONSENT_PHYSIO_KEY]: granted && physio,
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
      announceOyonConsentChanged();
   };

   if (!state) return null;

   // The card must SHOW everything the version it records covers: `answer()`
   // records acceptableVersion(requiredVersion), so asking for v3 without
   // naming the microphone would repeat the v2 mistake one version later.
   const asksForVoice = consentRank(state.requiredVersion) >= consentRank(OYON_CONSENT_VOICE);

   return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
         <div className="w-full max-w-lg rounded-lg border border-neutral-700 bg-neutral-900 p-5 space-y-4">
            <div className="flex items-center gap-2">
               <ScanFace className="w-5 h-5 text-blue-400" />
               <h2 className="text-base font-semibold text-neutral-100">{t('reconsent_title')}</h2>
            </div>

            {state.upgrade ? (
               <>
                  <p className="text-sm text-neutral-300">{t('reconsent_body')}</p>

                  <ul className="text-sm text-neutral-300 list-disc pl-5 space-y-1">
                     <li>{t('reconsent_item_typing')}</li>
                     <li>{t('reconsent_item_interaction')}</li>
                     <li>{t('reconsent_item_discourse')}</li>
                     {asksForVoice && <li>{t('reconsent_item_voice')}</li>}
                     {asksForVoice && <li>{t('reconsent_item_ai_assist')}</li>}
                  </ul>
               </>
            ) : (
               <p className="text-sm text-neutral-300">{t('reconsent_physio_body')}</p>
            )}

            <p className="text-sm text-neutral-300">{t('card_toggle')}</p>
            <OyonPhysioSwitch checked={physio} onChange={setPhysio} disabled={busy} className="ml-1" />

            {state.upgrade && (
               <p className="text-xs text-neutral-500">
                  {/* Voice keeps a per-frame series of measurements, not only a
                      summary, so the typing-era note ("only summaries are stored")
                      would be untrue once voice is in scope. */}
                  {t(asksForVoice ? 'reconsent_note_voice' : 'reconsent_note')}
               </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
               <button
                  type="button"
                  disabled={busy}
                  onClick={state.upgrade ? () => answer(false) : () => savePhysio(false)}
                  className="px-3 py-1.5 rounded text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
               >
                  {t('reconsent_decline')}
               </button>
               <button
                  type="button"
                  disabled={busy}
                  onClick={state.upgrade ? () => answer(true) : () => savePhysio(physio)}
                  className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 flex items-center gap-2"
               >
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t(state.upgrade ? 'reconsent_accept' : 'reconsent_physio_save')}
               </button>
            </div>
         </div>
      </div>
   );
}
