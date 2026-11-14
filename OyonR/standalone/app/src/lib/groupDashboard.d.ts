// Types for groupDashboard.js — the group-synchrony dashboard's view-model
// layer. Every number in these shapes comes from ladyna/synchrony.
import type { GroupTimelineRow } from 'oyon/group';

/** A long-table row: Oyon's groupTimeline() row, or any ladyna SyncRow. */
export type TimelineRow = Partial<GroupTimelineRow> & {
  group_id: string;
  member_id: string;
  t_s: number;
  channel: string;
  [extra: string]: unknown;
};

export interface HubMarker {
  type?: string;
  group_id?: string;
  marker_id?: string;
  group_ms?: number;
  label?: string | null;
  [extra: string]: unknown;
}

export type GroupWindow = Record<string, unknown> & { group_id?: string; member_id: string };

export interface GroupInput {
  source: 'bundle' | 'windows' | 'rows' | 'live';
  schema_version: string | null;
  windows: GroupWindow[];
  rows: TimelineRow[];
  markers: HubMarker[];
  group_ids: string[];
}

export declare const BUNDLE_SCHEMA: 'oyon-group-bundle-v1';
export declare const CODING_SCHEMA: 'oyon-group-coding-v1';
export declare const OKABE_ITO: Readonly<{
  orange: string; sky: string; green: string; yellow: string; blue: string;
  vermillion: string; purple: string; grey: string; black: string;
}>;
export declare const LOW_QUALITY: number;
export declare const DEFAULT_NULL_N: number;
export declare const PRIMARY_MEASURE: Readonly<Record<string, string>>;
export declare const TIMELINE_COLUMNS: readonly string[];
export declare const PAIR_COLUMNS: readonly string[];
export declare const GROUP_COLUMNS: readonly string[];
export declare const REGIME_COLUMNS: readonly string[];

export declare class GroupDashboardError extends Error {
  /** 'group_dashboard_bad_json' | 'group_dashboard_bad_schema' | 'group_dashboard_bad_input' | 'group_dashboard_empty' | 'group_dashboard_missing_context' | 'group_dashboard_bad_span' | 'group_dashboard_unknown_channel' | 'group_dashboard_ambiguous' */
  code: string;
  constructor(message: string, code?: string);
}

export declare function parseGroupInput(input: unknown): GroupInput;

export interface LiveStore {
  windows: Map<string, GroupWindow>;
  markers: HubMarker[];
  marker_ids: Set<string>;
  hello: Record<string, unknown> | null;
  version: number;
  replay_duplicates: number;
  live_replaced: number;
  errors: Array<{ type: string; message: string }>;
}
export declare function createLiveStore(): LiveStore;
export declare function windowKey(w: GroupWindow): string;
export declare function applyHubMessage(store: LiveStore, message: unknown): { changed: boolean; type: string };
export declare function liveInput(store: LiveStore): GroupInput;
export declare function hubStreamUrl(hubUrl: string, groupId: string): string;

export declare function availableChannels(windows: GroupWindow[]): string[];
export interface BuiltTimelines {
  group_ids: string[];
  timelines: Record<string, TimelineRow[]>;
  channels: string[];
  errors: Array<{ group_id: string | null; code: string; message: string }>;
}
export declare function buildTimelines(input: GroupInput, opts?: { channels?: string[] | null; normalize?: 'person_z' | 'none' }): BuiltTimelines;
export declare function timeExtent(rows: TimelineRow[]): { min_s: number; max_s: number };
export interface Span { start_s?: number | null; end_s?: number | null }
export declare function filterSpan<R extends { t_s: number }>(rows: R[], span?: Span): R[];

export type ChannelClass = 'categorical' | 'oscillatory' | 'continuous';
export interface ChannelInfo {
  channel: string;
  kind: 'continuous' | 'categorical';
  n_ticks: number;
  n_valid: number;
  evidence: 'primary' | 'secondary' | 'experimental' | null;
  channel_class: ChannelClass;
}
export declare function channelsInTimeline(rows: TimelineRow[]): ChannelInfo[];
export declare function channelClass(channel: string, kind: string): ChannelClass;
export interface MethodOption { method: string; measures: string; reference: string; is_default: boolean }
export declare function methodOptions(channel: string, kind: string): MethodOption[];
export declare function defaultMethod(channel: string, kind: string): string;
export declare function regimeKinds(channels: Array<string | { channel: string }>): Array<'affect' | 'arousal' | 'attention'>;
export declare function regimeChannelFor(kind: string, channels: Array<string | { channel: string }>): string | null;
export declare function demoRows(opts?: { seed?: number; duration_s?: number; group_id?: string }): TimelineRow[];
export declare function demoGroupRows(opts?: { n_groups?: number; seed?: number; duration_s?: number }): TimelineRow[];
export declare function memberClock(windows: GroupWindow[], groupId: string | null): Record<string, { clock_offset_ms: number | null; clock_rtt_ms: number | null; clock_source: string | null }>;

export interface NullOptions {
  /** Surrogates (default 49). */
  n?: number;
  /** Default 'pseudo_group' when `pool` holds other groups, else 'circular_shift'. */
  method?: 'pseudo_group' | 'circular_shift' | 'segment_shuffle' | 'iaaft' | null;
  /** Other groups' timelines (same task); used by 'pseudo_group'. */
  pool?: TimelineRow[][] | null;
  seed?: number;
  min_shift_s?: number;
}

export interface DashboardOptions {
  channel: string;
  method?: string;
  measure?: string | null;
  span?: Span | null;
  bin_s?: number;
  regime_kind?: 'affect' | 'arousal' | 'attention' | null;
  /** Channel for shared-arousal events; default 'arousal'. null switches the events off. */
  events_channel?: string | null;
  /** Categorical gaze channel for joint attention; default the first gaze channel present. */
  attention_channel?: string | null;
  null?: NullOptions | null;
  windows?: GroupWindow[];
  markers?: HubMarker[];
}

export type EventKind = 'shared_arousal' | 'out_of_sync' | 'sparse' | 'attention_break' | 'marker';
export interface DashboardEvent {
  kind: EventKind;
  start_s: number | null;
  end_s: number | null;
  label: string;
  detail: string;
  channel: string | null;
}

export interface StripPoint {
  window_start_s: number;
  window_end_s: number;
  t_mid_s: number;
  value: number | null;
  overlap: number;
  n_pairs: number;
  null_lo: number | null;
  null_hi: number | null;
  null_mean: number | null;
  z: number | null;
  p_null: number | null;
  /** true outside the null band, false inside, null without a null. */
  outside: boolean | null;
}

export interface PairSummary {
  pair: string;
  member_a: string;
  member_b: string;
  value: number | null;
  /** The estimated lag (positive = member_a leads); null for measures that estimate none. */
  lag_s: number | null;
  /** ladyna's leader (member id) from that lag; null at lag 0 or without a lag. */
  leader: string | null;
  /** The measure the lag came from (the row's own, or CRQA's lag_of_max_recurrence); null without one. */
  lead_source: string | null;
  overlap: number;
  n: number;
  z: number | null;
  p_null: number | null;
  null_lo: number | null;
  null_hi: number | null;
}

export interface MatrixCell {
  pair: string;
  value: number | null;
  overlap: number;
  z: number | null;
  p_null: number | null;
  /** ladyna's leader from the ROW member's point of view; 'none' at lag 0; null when the measure has no lag. */
  lead: 'row' | 'col' | 'none' | null;
  /** The pair's lag in seconds (positive = its member_a leads). */
  lag_s: number | null;
  lead_source: string | null;
}

export interface RibbonPoint { t_s: number; value: number | null; state: string | null; quality: number }
export interface Ribbon {
  member_id: string;
  seat: string | null;
  kind: 'continuous' | 'categorical';
  points: RibbonPoint[];
  low_quality_spans: Array<{ start_s: number; end_s: number }>;
  n_ticks: number;
  quality_share: number | null;
  /** ladyna qualitySummary reading of the share (good ≥ 0.8, fair ≥ 0.5). */
  quality_reading: 'good' | 'fair' | 'poor' | 'no data';
}

export interface MemberSummary {
  member_id: string;
  seat: string | null;
  n_ticks: number;
  /** Share of the selected channel's ticks with quality ≥ 0.5. */
  quality_share: number | null;
  /** ladyna qualitySummary reading of the share (good ≥ 0.8, fair ≥ 0.5). */
  quality_reading: 'good' | 'fair' | 'poor' | 'no data';
  clock_offset_ms: number | null;
  clock_rtt_ms: number | null;
  clock_source: string | null;
}

export interface RegimeRowView {
  group_id: string;
  bin: number;
  bin_start_s: number;
  bin_end_s: number;
  regime: string;
  n_members: number;
  n_valid: number;
  modal_state: string | null;
  modal_share: number | null;
  mean_valence: number | null;
  da: number | null;
}

export interface JointAttentionPair {
  pair: string;
  member_a: string;
  member_b: string;
  p_joint: number | null;
  p_joint_expected: number | null;
  jva_cosine: number | null;
  initiation_balance: number | null;
  overlap: number;
}

export interface DashboardView {
  group_id: string;
  channel: string;
  channel_kind: 'continuous' | 'categorical';
  channel_class: ChannelClass;
  evidence: ChannelInfo['evidence'];
  channels: ChannelInfo[];
  method: string;
  methods: MethodOption[];
  measure: string | null;
  measures: string[];
  span: { start_s: number; end_s: number; min_s: number; max_s: number };
  members: MemberSummary[];
  events: DashboardEvent[];
  latest_event: DashboardEvent | null;
  events_channel: string | null;
  attention_channel: string | null;
  strip: StripPoint[];
  null: { method: string; n: number; seed: number; pool_groups: number } | null;
  pairs: PairSummary[];
  matrix: { members: string[]; cells: Array<Array<MatrixCell | null>> };
  ribbons: Ribbon[];
  regime: {
    kind: 'affect' | 'arousal' | 'attention' | null;
    kinds: Array<'affect' | 'arousal' | 'attention'>;
    channel: string | null;
    bin_s: number;
    rows: RegimeRowView[];
    transitions: Array<{ from: string; to: string; count: number; /** ladyna tna: share of the transitions out of `from`. */ prob: number }>;
  };
  joint_attention: JointAttentionPair[];
  rho_group: number | null;
  member_indices: Array<{ member_id: string; member_rho: number | null; mean_rel_phase: number | null }>;
  errors: Array<{ panel: string; code: string; message: string }>;
  tables: {
    timeline: TimelineRow[];
    pairs: Array<Record<string, unknown>>;
    group: Array<Record<string, unknown>>;
    regimes: Array<Record<string, unknown>>;
    coding: { schema_version: string; generated_by: string; options: Record<string, unknown>; rules: Array<{ channel: string; state: string; rule: string }> };
    arousal_events: Array<Record<string, unknown>>;
  };
}

export declare function computeDashboard(timeline: TimelineRow[], opts: DashboardOptions): DashboardView;
/** One colour per regime (Okabe–Ito), shared by the band and the transition network. */
export declare const REGIME_COLOURS: Readonly<Record<string, string>>;
/** One regime kind for the /group/regimes page. */
export interface RegimePanel {
  kind: 'affect' | 'arousal' | 'attention';
  channel: string | null;
  bin_s: number;
  rows: DashboardView['regime']['rows'];
  transitions: Array<{ from: string; to: string; count: number; /** ladyna tna: share of the transitions out of `from`. */ prob: number }>;
  /** ladyna plotNetwork of the ftna transition model, or null with fewer than two bins. */
  network: string | null;
  errors: Array<{ panel: string; code: string; message: string }>;
}
/** Every regime kind the timeline supports, over the span. */
export declare function regimePanels(timeline: TimelineRow[], opts?: { span?: Span | null; bin_s?: number }): RegimePanel[];
/** Every member's ribbon on one channel (ladyna channelMatrix). Throws for a channel the rows lack. */
export declare function channelRibbons(rows: TimelineRow[], channel: string): Ribbon[];

export interface ExportFile { name: string; mime: string; content: string }
export declare function toCsv(rows: Array<Record<string, unknown>>, columns?: readonly string[] | null): string;
export declare function exportFiles(view: DashboardView): ExportFile[];
export declare function bundleFile(input: GroupInput, groupId?: string | null): ExportFile;
