import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { countReachable } from './onCallModel';
import './onCallHandset.css';

// The way in: a round call icon at the right edge of the case screen, in every
// room, which opens the phone (OnCallPhone). Teal-to-blue disc with a white
// handset glyph, the same raised, ringed treatment as Rohy's own buttons, and
// a tally of how many specialists can be reached.
//
// It sits at the edge rather than over the monitor: the floating button this
// replaces covered the EtCO2 reading.
//
// Renders in every case session, and nothing outside one. It no longer hides
// when the case has no specialists: the phone is part of every case (the lab
// and radiology stand on every case, see shared/specialties.js), and a case
// whose educator disabled them all still opens the handset on its "nobody on
// call" contact list rather than making the phone vanish.
const OnCallButton = forwardRef(function OnCallButton({ sessionId, specialists, open = false, onClick }, ref) {
    const { t } = useTranslation('oncall');
    if (!sessionId) return null;
    const count = countReachable(specialists);
    const label = t('open_phone', { count });
    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            aria-label={label}
            aria-expanded={open}
            aria-haspopup="dialog"
            title={label}
            className={`oncall-call-icon${open ? ' is-open' : ''}`}
        >
            <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
                <defs>
                    <linearGradient id="oncall-disc" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#2FC4C9" />
                        <stop offset="48%" stopColor="#1C8FC4" />
                        <stop offset="100%" stopColor="#1447AF" />
                    </linearGradient>
                    <linearGradient id="oncall-sheen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ffffff" stopOpacity=".38" />
                        <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
                    </linearGradient>
                </defs>
                <circle cx="32" cy="32" r="31" fill="url(#oncall-disc)" />
                <path d="M32 1a31 31 0 0 1 31 31A31 31 0 0 0 32 14 31 31 0 0 0 1 32A31 31 0 0 1 32 1z" fill="url(#oncall-sheen)" />
                {/* handset glyph: earpiece top-left, mouthpiece bottom-right */}
                <path
                    fill="#ffffff"
                    d="M23.9 13.6c1.3-.6 2.9-.2 3.7 1l4 6.2c.7 1.1.5 2.6-.5 3.5l-2.6 2.3c-.8.7-1 1.9-.5 2.8a26 26 0 0 0 9.1 9.1c.9.5 2.1.3 2.8-.5l2.3-2.6c.9-1 2.4-1.2 3.5-.5l6.2 4c1.2.8 1.6 2.4 1 3.7-1.2 2.6-3.4 5.3-6.2 6a8.4 8.4 0 0 1-4.6-.2c-5-1.6-11-5.6-16.2-10.8S17.7 26.1 16.1 21.1a8.4 8.4 0 0 1-.2-4.6c.7-2.8 3.4-5 6-6.2z"
                />
            </svg>
            {count > 0 && (
                <span className="tally" data-testid="oncall-badge" aria-hidden="true">{count}</span>
            )}
        </button>
    );
});

export default OnCallButton;
