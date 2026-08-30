import { ECGRoom } from './ECGRoom.jsx';

/** Full-viewport clinical shell around the host-neutral ECG room. */
export function ECGScreen({ top_bar_controls = null, ...room_props }) {
  return (
    <div className="ecg-screen">
      <header className="ecg-topbar">
        <div className="ecg-brand-mark" aria-hidden="true"><span /></div>
        <div className="ecg-brand-copy">
          <strong>Cardoyon</strong>
          <span>12-lead ECG workstation</span>
        </div>
        <div className="ecg-topbar-actions">{top_bar_controls}</div>
      </header>
      <ECGRoom {...room_props} />
    </div>
  );
}
