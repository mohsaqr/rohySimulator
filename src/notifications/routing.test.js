import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS } from './defaults';
import { routeNotification, deriveKey } from './routing';
import { SEVERITY, SOURCES, SURFACES } from './types';

function transient(overrides = {}) {
  return {
    acked: new Set(),
    snoozed: new Map(),
    ...overrides,
  };
}

function notification(overrides = {}) {
  return {
    source: SOURCES.CLINICAL,
    severity: SEVERITY.CRITICAL,
    key: 'alarm:hr_high',
    title: 'HR high',
    message: 'HR = 160',
    ...overrides,
  };
}

describe('routeNotification', () => {
  it('lets clinical critical bypass DND, severity threshold, and source mute blanket rules', () => {
    const prefs = {
      ...DEFAULT_PREFS,
      dnd: true,
      minSeverity: SEVERITY.CRITICAL,
      mutedSources: [SOURCES.CLINICAL],
    };

    const surfaces = routeNotification(notification(), prefs, transient());

    expect(surfaces).toEqual(expect.arrayContaining([SURFACES.AUDIO, SURFACES.HISTORY, SURFACES.BACKEND]));
  });

  it('an acked or snoozed clinical critical is silenced on every surface but still recorded', () => {
    // Regression lock: "stop shouting at me" is not "stop recording". The
    // acked/snoozed branches used to return [] and the alarm rows a learner
    // had already acknowledged vanished from learning_events — the one
    // place a tutor looks to see that the alarm fired again.
    expect(routeNotification(
      notification(),
      DEFAULT_PREFS,
      transient({ acked: new Set(['alarm:hr_high']) })
    )).toEqual([SURFACES.BACKEND]);

    expect(routeNotification(
      notification(),
      DEFAULT_PREFS,
      transient({ snoozed: new Map([['alarm:hr_high', Date.now() + 60_000]]) })
    )).toEqual([SURFACES.BACKEND]);
  });

  it('suppresses non-critical notifications under blanket DND and severity rules', () => {
    const warning = notification({
      source: SOURCES.SYSTEM,
      severity: SEVERITY.WARNING,
      key: 'system:warn',
    });

    expect(routeNotification(warning, { ...DEFAULT_PREFS, dnd: true }, transient())).toEqual([]);
    expect(routeNotification(warning, { ...DEFAULT_PREFS, minSeverity: SEVERITY.CRITICAL }, transient())).toEqual([]);
  });

  // Regression lock: the minSeverity gate ran before the routing matrix, so
  // with the default minSeverity (info) every DEBUG telemetry verb
  // (NAVIGATED / CLICKED / SWITCHED_TAB …) returned [] and never reached the
  // BACKEND surface — `telemetry/debug → [BACKEND]` in defaults.js was dead
  // code and the navigation layer was missing from every TNA analysis.
  const debugTelemetry = () => notification({
    source: SOURCES.TELEMETRY,
    severity: SEVERITY.DEBUG,
    key: 'telemetry:NAVIGATED:room:lab',
  });

  it('persists a DEBUG telemetry event to BACKEND under the default minSeverity', () => {
    expect(routeNotification(debugTelemetry(), DEFAULT_PREFS, transient()))
      .toEqual([SURFACES.BACKEND]);
  });

  it('never shows a DEBUG telemetry event on a user-facing surface', () => {
    const surfaces = routeNotification(debugTelemetry(), DEFAULT_PREFS, transient());

    expect(surfaces).not.toContain(SURFACES.TOAST);
    expect(surfaces).not.toContain(SURFACES.BANNER);
    expect(surfaces).not.toContain(SURFACES.AUDIO);
    expect(surfaces).not.toContain(SURFACES.HISTORY);
  });

  // Regression lock: DND / pause / source-mute are volume controls, not a
  // "stop recording my session" switch — they strip user-facing surfaces only.
  it('keeps BACKEND under DND, pause, a raised minSeverity, and a source mute', () => {
    const cases = [
      { dnd: true },
      { pausedUntil: Date.now() + 60_000 },
      { minSeverity: SEVERITY.CRITICAL },
      { mutedSources: [SOURCES.TELEMETRY] },
    ];

    cases.forEach((override) => {
      expect(routeNotification(debugTelemetry(), { ...DEFAULT_PREFS, ...override }, transient()))
        .toEqual([SURFACES.BACKEND]);
    });
  });

  it('drops a muted CONSOLE surface but keeps BACKEND for telemetry errors', () => {
    const surfaces = routeNotification(
      notification({ source: SOURCES.TELEMETRY, severity: SEVERITY.ERROR, key: 'telemetry:err' }),
      { ...DEFAULT_PREFS, consoleMuted: true },
      transient(),
    );

    expect(surfaces).toEqual([SURFACES.BACKEND]);
  });

  it('keeps BACKEND, and only BACKEND, for an acked or snoozed telemetry key', () => {
    expect(routeNotification(
      debugTelemetry(),
      DEFAULT_PREFS,
      transient({ acked: new Set(['telemetry:NAVIGATED:room:lab']) }),
    )).toEqual([SURFACES.BACKEND]);

    expect(routeNotification(
      debugTelemetry(),
      DEFAULT_PREFS,
      transient({ snoozed: new Map([['telemetry:NAVIGATED:room:lab', Date.now() + 60_000]]) }),
    )).toEqual([SURFACES.BACKEND]);
  });

  it('leaves a blanket-muted notification with no BACKEND route fully silent', () => {
    // SYSTEM/WARNING has no BACKEND row in the matrix — nothing to persist,
    // so the blanket mutes still produce a completely empty surface list.
    const warning = notification({ source: SOURCES.SYSTEM, severity: SEVERITY.WARNING, key: 'system:warn' });

    expect(routeNotification(warning, { ...DEFAULT_PREFS, dnd: true }, transient())).toEqual([]);
  });

  it('removes muted surfaces after routing', () => {
    const surfaces = routeNotification(notification(), {
      ...DEFAULT_PREFS,
      audioMuted: true,
      bannerMuted: true,
      consoleMuted: true,
    }, transient());

    expect(surfaces).not.toContain(SURFACES.AUDIO);
    expect(surfaces).not.toContain(SURFACES.BANNER);
    expect(surfaces).not.toContain(SURFACES.CONSOLE);
    expect(surfaces).toContain(SURFACES.HISTORY);
  });
});

describe('deriveKey', () => {
  it('uses explicit keys and derives stable hashes otherwise', () => {
    expect(deriveKey(notification({ key: 'explicit' }))).toBe('explicit');

    const a = deriveKey(notification({ key: undefined, message: 'same' }));
    const b = deriveKey(notification({ key: undefined, message: 'same' }));
    const c = deriveKey(notification({ key: undefined, message: 'different' }));

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('does not depend on wall-clock time when deriving message keys', () => {
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));
    const first = deriveKey(notification({ key: undefined, message: 'stable' }));
    vi.setSystemTime(new Date('2026-05-06T13:00:00Z'));
    const second = deriveKey(notification({ key: undefined, message: 'stable' }));

    expect(first).toBe(second);
    vi.useRealTimers();
  });
});
