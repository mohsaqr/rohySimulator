import React from 'react';
import { useTranslation } from 'react-i18next';

/*
 * The heart-rate and breathing-rate switch shown UNDER the camera consent, on
 * every surface that shows that consent (first-run card, Settings → Oyon, the
 * re-consent card). It is a preference within the one consent, not a second
 * consent: the parent renders it only while the camera consent is on, and the
 * parent writes `oyon_consent_physio` (utils/oyonConsent OYON_CONSENT_PHYSIO_KEY)
 * through the same preferences call it uses for the consent.
 */
export default function OyonPhysioSwitch({ checked, onChange, disabled = false, className = '' }) {
    const { t } = useTranslation('oyon');
    return (
        <label
            data-testid="oyon-physio-switch"
            className={`flex items-start gap-3 cursor-pointer ${className}`}
        >
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-blue-500"
            />
            <span>
                <span className="block text-sm text-neutral-200">{t('card_physio_toggle')}</span>
                <span className="block text-xs text-neutral-500 mt-0.5">{t('card_physio_note')}</span>
            </span>
        </label>
    );
}
