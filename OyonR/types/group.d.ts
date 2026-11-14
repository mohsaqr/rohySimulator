// oyon/group — group data out (alignment + one long table). Analysis lives in ladyna/synchrony.

export class GroupInputError extends Error {
  /** e.g. 'oyon_group_bad_input' | 'oyon_group_missing_context' | 'oyon_group_ambiguous' | 'oyon_group_unknown_channel' | 'oyon_group_empty' */
  code: string;
  constructor(message: string, code?: string);
}

export type GroupChannelKind = 'continuous' | 'categorical';
export type GroupEvidence = 'primary' | 'secondary' | 'experimental';

export interface GroupChannelSpec {
  kind: GroupChannelKind;
  stream?: string;
  field?: string;
  quality?: string | null;
  grid_hz: number;
  evidence: GroupEvidence;
  derived?: boolean;
  /** Event channel: a state holds until the next event instead of expiring. */
  hold?: boolean;
}

/** One row per member × channel × grid tick. Matches ladyna/synchrony's `SyncRow`. */
export interface GroupTimelineRow {
  group_id: string;
  member_id: string;
  seat: string | null;
  t_s: number;
  t_group_ms: number;
  channel: string;
  kind: GroupChannelKind;
  /** person-z (default) or raw; null = missing tick */
  value: number | null;
  value_raw: number | null;
  state: string | null;
  quality: number;
  /** 'raw:<stream>' | 'window' | 'derived:head' | null */
  source: string | null;
}

export interface GroupChannelMatrix {
  group_id: string;
  channel: string;
  kind: GroupChannelKind;
  members: string[];
  seats: Record<string, string | null>;
  t_s: number[];
  step_s: number | null;
  values: (number | null)[][];
  states: (string | null)[][];
  quality: number[][];
}

export const GROUP_CONTEXT_KEYS: readonly ['group_id', 'member_id', 'seat'];
export const GROUP_REQUIRED_CONTEXT_KEYS: readonly ['group_id', 'member_id'];
export const GROUP_CHANNELS: Readonly<Record<string, GroupChannelSpec>>;

export function groupTimeline(args: {
  windows: Array<Record<string, unknown>>;
  group_id?: string | null;
  channels?: string[];
  grid_hz?: number | Record<string, number> | null;
  anchor_ms?: number | null;
  tolerance_s?: number | null;
  /**
   * Only 'none'. Person-standardising is analysis: use ladyna's
   * `normalizeTimeline(rows, { method: 'person_z' })` (`ladyna/synchrony`).
   * Passing 'person_z' throws `oyon_group_normalize_moved`.
   */
  normalize?: 'none';
}): GroupTimelineRow[];

export function channelMatrix(
  timeline: GroupTimelineRow[],
  args: { channel: string; members?: string[] | null; raw?: boolean },
): GroupChannelMatrix;

export function checkGroupContext(
  windows: Array<Record<string, unknown>>,
): Array<{ index: number; session_id: string | null; missing: string }>;

export function channelSpec(channel: string): GroupChannelSpec | null;
export function listGroupChannels(): Array<{
  channel: string; kind: GroupChannelKind; stream: string | null; grid_hz: number; evidence: GroupEvidence; derived: boolean; hold: boolean;
}>;
/** Voice-turn state (or boolean) → 'speaking' | 'silent' | quality state | null ('end'). */
export function speakingState(state: unknown): string | null;
export function screenZone(x: number, y: number, onScreen?: number | boolean | null): string | null;
