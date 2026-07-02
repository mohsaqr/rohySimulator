import { useState } from 'react';
import {
  CalibrationPill,
  ContextPill,
  ConsentPill,
  PrivacyPill,
} from './TopBarPills';
import { Brand } from './Brand';
import { useSessionContext } from '@/lib/sessionContext';
import { DEFAULT_USER_ID, useResolvedIdentity } from '@/lib/identityStore';

/*
 * TopBar — persistent session context strip. The seven slots map 1:1 to the
 * "Tier 5" research-grade affordances:
 *
 *   1. Study             — which study is this session part of
 *   2. Participant       — who is being recorded
 *   3. Session timestamp — when (also disambiguates same-participant runs)
 *   4. Model             — which classifier is producing predictions
 *   5. Calibration       — gaze accuracy provenance (honest about null)
 *   6. Consent           — data-handling consent state
 *   7. Privacy           — opens the field-by-field privacy inspector
 *
 * Every analytic below this bar inherits this context. Clicking any pill
 * opens a drill-in dialog (wired in Phases B–D).
 */

export function TopBar() {
  const { studyId, participantId, sessionId, modelVersion, settingsHash } =
    useSessionContext();

  return (
    <header
      className="flex items-center justify-between gap-4 border-b border-line bg-surface-1 px-4 py-2.5"
      role="banner"
    >
      <Brand />
      <div className="flex items-center gap-1.5">
        <ContextPill label="Study" value={studyId ?? '—'} />
        <ParticipantPill fallback={participantId} />
        <ContextPill label="Session" value={sessionId ?? 'not started'} />
        <ContextPill label="Model" value={modelVersion} />
        {settingsHash ? (
          <ContextPill label="Settings" value={settingsHash.slice(0, 7)} />
        ) : null}
        <CalibrationPill />
        <ConsentPill />
        <PrivacyPill />
      </div>
    </header>
  );
}

/*
 * ParticipantPill — displays and edits the identity stamped on every
 * captured window (user_id / user_label, read live by the runtime's
 * contextProvider). Via useResolvedIdentity it reads/writes the SAME source
 * the runtime stamps from: the per-instance bridge store in an embed (so the
 * pill shows the host's user-label and an edit actually reaches the windows),
 * or the module identity store standalone. The popover still works for ad-hoc
 * overrides in both.
 */
function ParticipantPill({ fallback }: { fallback: string | null }) {
  const { userId, userLabel, setIdentity } = useResolvedIdentity();
  const [open, setOpen] = useState(false);
  const [draftId, setDraftId] = useState(userId);
  const [draftLabel, setDraftLabel] = useState(userLabel ?? '');

  const display =
    userLabel ?? (userId !== DEFAULT_USER_ID ? userId : (fallback ?? '—'));

  const apply = () => {
    const id = draftId.trim();
    setIdentity({
      userId: id.length > 0 ? id : DEFAULT_USER_ID,
      userLabel: draftLabel.trim().length > 0 ? draftLabel.trim() : null,
    });
    setOpen(false);
  };

  return (
    <div className="relative">
      <ContextPill
        label="Participant"
        value={display}
        onClick={() => {
          setDraftId(userId);
          setDraftLabel(userLabel ?? '');
          setOpen((v) => !v);
        }}
      />
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-line bg-surface-1 p-3 shadow-popover">
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-wider text-ink-3">
              User ID
              <input
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                className="mt-1 w-full rounded border border-line bg-surface-0 px-2 py-1 text-xs text-ink-0"
                placeholder={DEFAULT_USER_ID}
              />
            </label>
            <label className="block text-[10px] uppercase tracking-wider text-ink-3">
              Display name (optional)
              <input
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                className="mt-1 w-full rounded border border-line bg-surface-0 px-2 py-1 text-xs text-ink-0"
                placeholder="e.g. Participant 7"
              />
            </label>
            <p className="text-[10px] leading-snug text-ink-3">
              Stamped as <code>user_id</code> on every captured window.
              Applies live to the next window.
            </p>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-xs text-ink-2 hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:opacity-90"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
