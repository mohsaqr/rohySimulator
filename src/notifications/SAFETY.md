# Clinical Alarm Safety Acceptance Criteria

This file is the load-bearing reference for how Rohy's notification center
treats clinical alarms. The audit (`module-audits/client-notifications.md`)
flagged that these contracts existed only in code comments, not as a separate
acceptance document. Treat this as the safety spec; the code in
`routing.js` and `NotificationContext.jsx` is the implementation, and the
tests in `routing.test.js` are the regression locks.

If you change behaviour here, update **all four**: this doc, the routing
code, the routing tests, and the comment headers in `routing.js`. None of
the four can be the authoritative source on its own.

## 1. Critical clinical alarms BYPASS blanket suppression

A notification with `source = clinical` and `severity = critical` is **NOT**
suppressed by:

- Global DND / "paused" preference
- A `minSeverity` filter set above `info`
- The clinical source being on the `mutedSources` list

Rationale: the safety floor is "the clinician must see life-threatening
abnormalities even on a misconfigured workstation." Any blanket suppression
that hides a critical clinical alarm is a clinical-safety regression.

Test: `routing.test.js > critical clinical bypasses blanket suppression`.

## 2. Critical clinical alarms are SUPPRESSED by explicit ack and snooze

The bypass rule above does **not** apply to:

- An explicit `acknowledge` on the same key (the clinician saw it).
- An explicit `snooze` on the same key (the clinician chose to defer it).

This is intentional. A blanket auto-suppression is unsafe; an explicit
clinician action is the lawful way to silence an alarm — both clinically
and per the bedside-monitor convention the audit references.

The 2s periodic evaluator in `useAlarms` only calls `resolve(key)` once the
key is **both acked AND the vital has recovered**. A still-breached vital
that's been acked stays in `silencedAlarms` so the clinician can see what
they've muted.

Test: `routing.test.js > explicit ack/snooze suppress even critical clinical`.

## 3. Severity classification rules

`useAlarms.pickSeverity()` upgrades a breach from `warning` to `critical`
when the value is severely out of range. The exact bands are conservative
and admin-overridable per vital, but the floors are:

| Vital | Critical when                       |
|-------|--------------------------------------|
| spo2  | < 85                                 |
| hr    | < 35 OR > 150                        |
| bpSys | < 70 OR > 200                        |
| rr    | < 5 OR > 40                          |
| temp  | < 34 OR > 40                         |

Anything else is `warning`. Below the per-vital `low`/`high` threshold but
above the critical floor is still a real breach — it produces a warning
notification, drives the audio pattern `BEEP`, and is not bypass-eligible
under rule 1.

## 4. Latching behaviour

Once a breach fires it stays in the active list until the clinician acks,
even after the vital recovers. This matches bedside-monitor convention —
a brief transient is information the clinician needs to see, not noise to
hide. Without latching, a 1-sample HR=121 spike would flash and disappear
within 2 seconds and the clinician would be unsure whether they imagined it.

Test: `useAlarms.test.js > does not resolve a recovered alarm until it has been acknowledged`.

## 5. Backend persistence is best-effort

Alarm log POSTs to `/api/alarms/log` (and the matching `/acknowledge` PUT)
are fire-and-forget — failure does **not** alter the local UI state. The
audit flagged this as needing observable telemetry; finding #20 tracks the
follow-up to surface backend persistence failures in the diagnostic bar.
Until that lands, missing alarm log rows are silently dropped after one
attempt — see `BackendSurface.js` for the bounded-retry policy.

## 6. Per-user scoping

All notification preference / acked / snoozed state is scoped per user
(`rohy_notification_*:<userId>`). On a shared workstation, user A's acks
must NOT silence alarms for user B. The one-shot legacy-key migration in
`persistence.js` handles upgrades from the pre-scoping era; any future
key shape changes must follow the same scoped-by-default convention. See
`src/storage/registry.js` for the canonical key registry.

Test: `routing.test.js > stable per-user key derivation`.

## 7. What this document does NOT cover

- Audio-pattern assignment (`AUDIO_PATTERNS.URGENT` vs `BEEP`) — that's a
  UX decision, not a safety contract.
- Cross-tab broadcast — last-write-wins is documented but not load-bearing
  for safety.
- Alarm-log retention / archival — covered by the data-retention spec
  outside the notification subsystem.

When in doubt about a change to this subsystem, prefer additive: a new
opt-in suppression mode is safer than relaxing one of these existing
contracts.
