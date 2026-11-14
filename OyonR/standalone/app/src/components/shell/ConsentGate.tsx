import { useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { useSettings } from '@/lib/settingsStore';
import { useBridge } from '@/lib/hostBridge';
import {
  availableConsentItems,
  consentGateOpen,
  consentVersionFor,
  NO_CONSENT,
  useConsent,
  type ConsentAcceptance,
  type ConsentItemKey,
  type ConsentItemSpec,
} from '@/lib/consentStore';

/*
 * ConsentGate — the startup agreement.
 *
 * Shown before the first capture when the operator has enabled it. OFF by
 * default, so an untouched install behaves exactly as before.
 *
 * Never rendered when embedded: a host that mounts <oyon-app> owns consent
 * itself (chatoyon has a Consent model gating capture, framed against GDPR /
 * EU AI Act Art. 5). Two gates would mean two records for one capture.
 *
 * The participant-facing copy is deliberately plain. Naming the enforcement —
 * validateEmotionBatch and its raw-frame deny-list — makes a claim checkable
 * by a developer reading the source, which is not the audience clicking the
 * button. That requirement lives in docs/CONSENT_PLAN.md instead: every claim
 * below must correspond to something the pipeline actually enforces, and no
 * claim may be added that it does not.
 */

const GUARANTEES: Array<{ lead: string; rest: string }> = [
  {
    lead: 'No video is recorded or uploaded.',
    rest: 'Frames are read in your browser and discarded immediately.',
  },
  {
    lead: 'No audio is recorded.',
    rest: 'Speech is measured for timing and tone. Words are not transcribed.',
  },
  {
    lead: 'Only derived measurements are stored',
    rest: '— numbers such as “attention 0.62”, never images, face landmarks, or gaze coordinates.',
  },
  {
    lead: 'Nothing outside what you accept below is measured.',
    rest: '',
  },
];

export function ConsentGate() {
  const embedded = useBridge((s) => s.embedded);
  const settings = useSettings();
  const answered = useConsent((s) => s.answered);
  const answeredVersion = useConsent((s) => s.answeredVersion);
  const accept = useConsent((s) => s.accept);

  const items = useMemo(() => availableConsentItems(settings), [settings]);
  const version = consentVersionFor(settings.consent_text);
  const requested = useConsent((s) => s.requested);
  const accepted = useConsent((s) => s.accepted);
  const dismissGate = useConsent((s) => s.dismissGate);

  const required = consentGateOpen(settings, { answered, answeredVersion });
  const open = !embedded && (requested || required);

  /*
   * Seeding, which differs by why the dialog is open:
   *
   *   never answered → everything PRE-SELECTED. Opening on all-declined would
   *     present refusal as the default and make agreeing look like extra work,
   *     when accepting is the expected path. The participant unticks what they
   *     do not want; the switches show what will happen if they just continue.
   *   answered before → their actual answer, because this is also the
   *     withdrawal route and it must show what is really running.
   *
   * Re-seeds on each fresh open (tracked by `seeded`) so edits inside one
   * showing are not clobbered by a re-render.
   */
  const allSelected = useMemo(
    () => items.reduce<ConsentAcceptance>(
      (acc, item) => ({ ...acc, [item.key]: true }),
      { ...NO_CONSENT },
    ),
    [items],
  );
  const seed = answered ? accepted : allSelected;

  const [draft, setDraft] = useState<ConsentAcceptance>(seed);
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setDraft(seed);
  }
  if (!open && seeded) setSeeded(false);

  if (!open) return null;

  const allowedCount = items.filter((item) => draft[item.key]).length;

  const submit = (next: ConsentAcceptance) => {
    accept(next, version);
  };

  return (
    // A review opened on purpose can be closed again. A gate the operator
    // requires cannot — declining has to be a deliberate choice, not an Escape
    // keypress or a stray click on the backdrop.
    <Dialog
      open
      labelledBy="consent-gate-title"
      dismissable={!required}
      onDismiss={dismissGate}
      size="md"
    >
      <div>
        <h2 id="consent-gate-title" className="m-0 text-base font-semibold text-ink-0">
          Before sensing starts
        </h2>
        <p className="mt-1 text-sm text-ink-1">
          Oyon measures what your camera and microphone pick up{' '}
          <strong className="font-semibold text-ink-0">on this device</strong>, and keeps
          only the measurements — never the recording.
        </p>
      </div>

      {settings.consent_text ? (
        <div className="whitespace-pre-wrap rounded border border-line bg-surface-1 p-space-3 text-xs text-ink-1">
          {settings.consent_text}
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-space-2 p-0">
          {GUARANTEES.map((g) => (
            <li key={g.lead} className="grid grid-cols-[1rem_1fr] items-start gap-2 text-sm text-ink-1">
              <span aria-hidden="true" className="font-bold leading-normal text-status-ok">
                ✓
              </span>
              <span>
                <strong className="font-semibold text-ink-0">{g.lead}</strong>
                {g.rest ? ` ${g.rest}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <div className="label-eyebrow mb-2">
          Choose what may be measured
        </div>
        <div className="flex flex-col gap-space-2">
          {items.map((item) => (
            <ConsentRow
              key={item.key}
              item={item}
              allowed={draft[item.key]}
              onChange={(allowed) => setDraft((d) => ({ ...d, [item.key]: allowed }))}
            />
          ))}
        </div>
        <p className="mt-space-3 text-xs text-ink-2">
          Change any of these later from the Consent pill — sensing stops straight away.
        </p>
      </div>

      {allowedCount === 0 ? (
        <p className="rounded bg-status-warn-dim px-space-3 py-space-2 text-xs text-status-warn">
          Nothing is selected, so no sensing will run. You can still use the app and
          change this later.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-space-2 border-t border-line pt-space-3">
        <button
          type="button"
          className="rounded-sm bg-status-info px-3 py-2 text-sm font-medium text-status-on hover:brightness-110"
          onClick={() => {
            const all = items.reduce<ConsentAcceptance>(
              (acc, item) => ({ ...acc, [item.key]: true }),
              { ...NO_CONSENT },
            );
            setDraft(all);
            submit(all);
          }}
        >
          Agree to all
        </button>
        <button
          type="button"
          className="rounded-sm border border-line-strong bg-surface-0 px-3 py-2 text-sm font-medium text-ink-0 hover:border-ink-3"
          onClick={() => submit(draft)}
        >
          {allowedCount === 0
            ? 'Continue without sensing'
            : `Continue with ${allowedCount} of ${items.length}`}
        </button>
        {!required ? (
          <button
            type="button"
            className="rounded-sm px-2 py-2 text-sm text-ink-3 hover:text-ink-1"
            onClick={dismissGate}
          >
            Close
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}

function ConsentRow({
  item,
  allowed,
  onChange,
}: {
  item: ConsentItemSpec;
  allowed: boolean;
  onChange: (allowed: boolean) => void;
}) {
  return (
    <div
      className={[
        'grid grid-cols-[1fr_auto] items-start gap-space-3 rounded border p-space-3',
        allowed ? 'border-status-ok bg-status-ok-dim' : 'border-line bg-surface-0',
      ].join(' ')}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-0">
          {item.name}
          {item.specialCategory ? (
            <span className="label-eyebrow rounded-full border border-status-warn px-1.5 py-px text-status-warn">
              Health data
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-ink-2">{item.covers}</div>
        <div
          className={[
            'mt-1 text-xs',
            allowed ? 'font-medium text-status-ok' : 'text-ink-3',
          ].join(' ')}
        >
          {allowed ? item.onLabel : item.offLabel}
        </div>
      </div>
      <label className="relative mt-0.5 h-[1.35rem] w-[2.35rem] shrink-0">
        <input
          type="checkbox"
          checked={allowed}
          aria-label={`Allow ${item.name}`}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full bg-surface-3 transition-colors peer-checked:bg-status-ok peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-status-info"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[3px] top-[3px] size-[1.05rem] rounded-full bg-surface-0 shadow transition-transform peer-checked:translate-x-4"
        />
      </label>
    </div>
  );
}

export type { ConsentItemKey };
