/*
 * Group pattern sources — the group's sequences for the shared pattern
 * library (lib/patternViews.js). View-model layer, node-testable; every step
 * is a ladyna/synchrony verb, Oyon only picks the inputs.
 *
 *   members      each member's coded states on one channel
 *                (codeStates → toSequences by group × member, aligned bins)
 *   regime       the group's regime per bin, one sequence per group
 *                (codeStates → regimeSequence → toSequences; 'sparse' bins are gaps)
 *   interaction  members' state changes merged on the group clock, τ-gated
 *                (codeStates → interactionSequence → toSequences by group)
 */
import { codeStates, regimeSequence, interactionSequence, toSequences, NA_STATE } from 'ladyna/synchrony';
import { OyonViewError, step } from './ladynaViews.js';
import { channelsInTimeline, regimeKinds, regimeChannelFor } from './groupDashboard.js';
import { INTERACTION_BIN_S, INTERACTION_TAU_S, NETWORK_BIN_S } from './groupNetworks.js';

export const PATTERN_SOURCES = Object.freeze([
  { id: 'members', label: 'Member states' },
  { id: 'regime', label: 'Group regime' },
  { id: 'interaction', label: 'Interaction stream' },
]);

/** What each source can use on these rows: state channels and regime kinds. */
export function patternSourceOptions(rows) {
  const channels = channelsInTimeline(rows).filter((c) => c.n_valid > 0 && c.channel !== 'emotion.confidence');
  return {
    channels: channels.map((c) => ({ channel: c.channel, kind: c.kind, label: `${c.channel} · ${c.kind === 'continuous' ? 'low/mid/high' : 'states'}` })),
    regime_kinds: regimeKinds(channels),
  };
}

/**
 * The sequences one source yields.
 *
 * @param {object[]} rows the long table (one group, or several), already cut to the span
 * @param {{ source: 'members'|'regime'|'interaction', channel?: string, regime_kind?: string, bin_s?: number, tau_s?: number }} opts
 * @returns {{ sequences: (string|null)[][], ids: string[], unit: string, call: string, error: object|null }}
 */
export function groupPatternSequences(rows, {
  source, channel = null, regime_kind: regimeKind = null, bin_s: binS = null, tau_s: tauS = INTERACTION_TAU_S,
} = {}) {
  const res = step(() => {
    if (!Array.isArray(rows) || !rows.length) throw new OyonViewError('no rows in the selected span', 'patterns_empty');
    if (source === 'members') {
      if (!channel) throw new OyonViewError('member sequences need a channel', 'patterns_bad_input');
      const b = binS ?? NETWORK_BIN_S;
      const coded = codeStates(rows, { bin_s: b, channels: [channel] });
      const seq = toSequences(coded, { by: ['group_id', 'member_id'], channel, align: true });
      return { sequences: seq.sequences, ids: seq.ids, unit: `${b} s bin of one member`,
        call: `codeStates(rows, { bin_s: ${b}, channels: ['${channel}'] }) → toSequences(…, { by: ['group_id', 'member_id'], align: true })` };
    }
    if (source === 'regime') {
      const channels = channelsInTimeline(rows);
      const kind = regimeKind ?? regimeKinds(channels)[0] ?? null;
      const ch = kind ? regimeChannelFor(kind, channels) : null;
      if (!ch) throw new OyonViewError('regimes need an emotion, arousal or gaze channel', 'patterns_no_regime');
      const b = binS ?? NETWORK_BIN_S;
      const coded = codeStates(rows, { bin_s: b, channels: [ch] });
      const regimes = regimeSequence(coded, { timeline: rows, kind, channel: ch });
      const seq = toSequences(regimes, { by: 'group_id', state: 'regime', order: 'bin', na_states: [NA_STATE, 'sparse'] });
      return { sequences: seq.sequences, ids: seq.ids, unit: `${b} s bin of the group (${kind} regime)`,
        call: `codeStates(rows, { bin_s: ${b}, channels: ['${ch}'] }) → regimeSequence(…, { kind: '${kind}' }) → toSequences(…, { by: 'group_id', state: 'regime', na_states: ['n/a', 'sparse'] })` };
    }
    if (source === 'interaction') {
      if (!channel) throw new OyonViewError('the interaction stream needs a channel', 'patterns_bad_input');
      const b = binS ?? INTERACTION_BIN_S;
      const coded = codeStates(rows, { bin_s: b, channels: [channel] });
      const events = interactionSequence(coded, { channel, tau_s: tauS, roles: 'member' });
      if (!events.length) throw new OyonViewError(`no ${channel} state changes in this span`, 'patterns_no_events');
      const seq = toSequences(events, { by: 'group_id', state: 'token', order: 't_s' });
      return { sequences: seq.sequences, ids: seq.ids, unit: 'state change (member:state)',
        call: `codeStates(rows, { bin_s: ${b} }) → interactionSequence(…, { roles: 'member', tau_s: ${tauS} }) → toSequences(…, { by: 'group_id', state: 'token', order: 't_s' })` };
    }
    throw new OyonViewError(`unknown pattern source '${String(source)}'`, 'patterns_bad_input');
  });
  if (res.error) return { sequences: [], ids: [], unit: '', call: '', error: res.error };
  return { ...res.ok, error: null };
}
