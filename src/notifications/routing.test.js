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

  it('still suppresses clinical critical when explicitly acked or snoozed', () => {
    expect(routeNotification(
      notification(),
      DEFAULT_PREFS,
      transient({ acked: new Set(['alarm:hr_high']) })
    )).toEqual([]);

    expect(routeNotification(
      notification(),
      DEFAULT_PREFS,
      transient({ snoozed: new Map([['alarm:hr_high', Date.now() + 60_000]]) })
    )).toEqual([]);
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
