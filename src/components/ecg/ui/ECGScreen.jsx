import { ECGRoom } from './ECGRoom.jsx';
import { identity_t } from '../i18n.js';

/**
 * Full-viewport clinical shell around the host-neutral ECG room.
 *
 * @param {object} props component props
 * @param {import('react').ReactNode} [props.top_bar_controls] host-supplied top-bar content
 * @param {(key: string, fallback?: string, values?: object) => string} [props.t] host translator. The
 *   identity default returns the English fallback, so the package renders in
 *   English standalone with no i18n dependency of its own, and a host that
 *   passes its own `t` translates the same static keys.
 * @returns {JSX.Element} the shell
 */
export function ECGScreen({ top_bar_controls = null, t = identity_t, ...room_props }) {
  return (
    <div className="ecg-screen">
      <header className="ecg-topbar">
        <div className="ecg-brand-mark" aria-hidden="true"><span /></div>
        <div className="ecg-brand-copy">
          {/* The product name is a name, not copy: it is the same word in every
              language, and translating it would make the workstation
              unrecognisable to a reader who moves between locales. */}
          <strong>Cardoyon</strong>
          <span>{t('workstation_subtitle', '12-lead ECG workstation')}</span>
        </div>
        <div className="ecg-topbar-actions">{top_bar_controls}</div>
      </header>
      <ECGRoom {...room_props} t={t} />
    </div>
  );
}
