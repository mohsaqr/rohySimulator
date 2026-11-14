import { useState } from 'react';
import { CalibrationPill, ConsentPill, PrivacyPill } from './TopBarPills';
import { useSessionContext } from '@/lib/sessionContext';
import { DEFAULT_USER_ID, useResolvedIdentity } from '@/lib/identityStore';
import { useConsent } from '@/lib/consentStore';

/*
 * SessionContextPanel — the provenance of whatever is on screen.
 *
 * This was a permanent top strip of eight pills (study / participant /
 * session / model / settings hash / calibration / consent / privacy). Every
 * one is provenance: it answers "what produced these numbers?", which is a
 * question you ask when you doubt a result or write it up — not on every
 * screen, every minute. So it costs a click now instead of a band.
 *
 * Participant is edited INLINE here rather than behind its own popover: the
 * old pill opened a second layer on top of the first, and a popover inside a
 * popover is a focus trap nobody can escape with the keyboard.
 */
export function SessionContextPanel() {
  const { studyId, participantId, sessionId, modelVersion, settingsHash } =
    useSessionContext();
  const { userId, userLabel, setIdentity } = useResolvedIdentity();
  const [draftId, setDraftId] = useState(userId);
  const [draftLabel, setDraftLabel] = useState(userLabel ?? '');

  const dirty = draftId !== userId || draftLabel !== (userLabel ?? '');

  const apply = () => {
    const id = draftId.trim();
    setIdentity({
      userId: id.length > 0 ? id : DEFAULT_USER_ID,
      userLabel: draftLabel.trim().length > 0 ? draftLabel.trim() : null,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
        <Row label="Study" value={studyId ?? '—'} />
        <Row label="Session" value={sessionId ?? 'not started'} />
        <Row label="Model" value={modelVersion} />
        {settingsHash ? <Row label="Settings" value={settingsHash.slice(0, 7)} /> : null}
      </dl>

      <div className="border-t border-line pt-3">
        <div className="label-eyebrow mb-1.5">
          Participant
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            aria-label="User ID"
            placeholder={participantId ?? DEFAULT_USER_ID}
            className="w-full rounded border border-line bg-surface-0 px-2 py-1 text-xs text-ink-0"
          />
          <input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            aria-label="Display name"
            placeholder="Display name (optional)"
            className="w-full rounded border border-line bg-surface-0 px-2 py-1 text-xs text-ink-0"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-micro leading-snug text-ink-3">
              Stamped as <code>user_id</code> on every window; applies to the next one.
            </p>
            <button
              type="button"
              onClick={apply}
              disabled={!dirty}
              className="shrink-0 rounded bg-accent px-2 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <CalibrationPill />
        <ConsentPill />
        <PrivacyPill />
        {/* The pills report state; this is how you act on it. The agreement's
            own text promises "change any of these later from the Consent
            pill", so that promise needs somewhere to land. */}
        <button
          type="button"
          onClick={() => useConsent.getState().requestGate()}
          className="ml-auto shrink-0 rounded border border-line-strong bg-surface-0 px-2 py-0.5 text-micro font-medium text-ink-1 hover:border-ink-3 hover:text-ink-0"
        >
          Review consent
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="label-eyebrow m-0">{label}</dt>
      <dd className="m-0 truncate font-mono text-xs text-ink-1" title={value}>
        {value}
      </dd>
    </>
  );
}
