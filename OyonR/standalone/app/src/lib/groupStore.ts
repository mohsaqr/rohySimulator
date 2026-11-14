import { create } from 'zustand';
import {
  applyHubMessage,
  createLiveStore,
  hubStreamUrl,
  liveInput,
  type DashboardView,
  type GroupInput,
  type LiveStore,
} from './groupDashboard';
import type { CooccurrenceBootstrap, NetworkTab } from './groupNetworks';
import type { VarFitRequest } from './groupVarFit';
import { runVarFit, type VarFitHandle, type VarFitOutcome } from './varFitRunner';

/*
 * Group store — everything the group dashboard's sub-pages share.
 *
 * The dashboard used to be one long page holding a dozen `useState`s; split
 * into /group/overview, /synchrony, /attention, … each sub-page unmounts when
 * you leave it, so the state lives here instead: the loaded input, every
 * selection, the brushed span, the null result, the feedback flag and the
 * Networks section's choices and VAR fit. A span brushed on Synchrony is the
 * span on Regimes, and a null computed once is not lost by looking elsewhere.
 *
 * The live group-hub connection lives here too, not in a component: a socket
 * owned by a sub-page would close the moment you switched pages. Messages land
 * in a mutable buffer (de-duplicated by applyHubMessage); the store publishes a
 * new snapshot at most every HUB_THROTTLE_MS, so the dashboard is not
 * recomputed on every message. The connection stays open until Disconnect, a
 * new connection, or loading a file/demo — like the loaded data, it outlives a
 * visit to another section of the app.
 *
 * No analysis here: views are derived from this state with useMemo in the
 * pages that show them (routes/group/model.tsx), by the lib files' ladyna and
 * psychaj calls.
 */

export type NullChoice = 'auto' | 'circular_shift' | 'segment_shuffle' | 'iaaft' | 'pseudo_group';
export type RegimeChoice = 'affect' | 'arousal' | 'attention';
export type NetworkScope = 'group' | 'all';

export interface BrushSpan {
  start_s: number;
  end_s: number;
}

export interface LoadedInput {
  input: GroupInput;
  label: string;
  version: number;
}

export interface NullState {
  key: string;
  running: boolean;
  view: DashboardView | null;
  error: string | null;
}

export type HubStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface HubState {
  status: HubStatus;
  url: string | null;
  input: GroupInput | null;
  error: string | null;
  replay_duplicates: number;
  live_replaced: number;
  n_windows: number;
  /**
   * The live data's content revision, `<connection>:<buffer version>`: it
   * changes on every new, replaced or marker message, and never repeats across
   * connections. Every analysis key on live data is built from it (dataKey),
   * so a replaced window or a new marker can never reuse a stale result.
   */
  revision: string;
}

export interface VarFitState {
  key: string;
  running: boolean;
  outcome: VarFitOutcome | null;
}

export interface NetworksState {
  tab: NetworkTab;
  scope: NetworkScope;
  channelSel: string | null;
  memberA: string | null;
  memberB: string | null;
  varSel: string[] | null;
  fit: VarFitState | null;
  boot: { key: string; result: CooccurrenceBootstrap } | null;
}

export interface GroupState {
  loaded: LoadedInput | null;
  mode: 'file' | 'live';
  loadError: string | null;
  hub: HubState;

  groupSel: string | null;
  channelSel: string | null;
  methodByChannel: Record<string, string>;
  measureSel: string | null;
  span: BrushSpan | null;
  regimeSel: RegimeChoice | null;
  nullChoice: NullChoice;
  nullState: NullState | null;
  /** A file or demo gets its null once, right after it loads. */
  autoNull: boolean;
  feedback: boolean;
  networks: NetworksState;

  load: (input: GroupInput, label: string) => void;
  setLoadError: (message: string | null) => void;
  connectHub: (hubUrl: string, groupId: string) => void;
  disconnectHub: () => void;

  selectGroup: (groupId: string) => void;
  selectChannel: (channel: string) => void;
  selectMethod: (channel: string, method: string) => void;
  selectMeasure: (measure: string) => void;
  setSpan: (span: BrushSpan | null) => void;
  selectRegime: (kind: RegimeChoice) => void;
  setNullChoice: (choice: NullChoice) => void;
  setNullState: (state: NullState | null) => void;
  consumeAutoNull: () => void;
  setFeedback: (on: boolean) => void;

  setNetworks: (patch: Partial<Omit<NetworksState, 'fit'>>) => void;
  startVarFit: (key: string, request: VarFitRequest) => void;
  failVarFit: (key: string, outcome: VarFitOutcome) => void;
  cancelVarFit: () => void;
}

export const HUB_THROTTLE_MS = 3000;

const HUB_IDLE: HubState = { status: 'idle', url: null, input: null, error: null, replay_duplicates: 0, live_replaced: 0, n_windows: 0, revision: '0:0' };

const NETWORKS_INITIAL: NetworksState = {
  tab: 'sequences',
  scope: 'group',
  channelSel: null,
  memberA: null,
  memberB: null,
  varSel: null,
  fit: null,
  boot: null,
};

/** A new data source starts from a clean selection (as the single page did). */
const SELECTION_RESET = {
  groupSel: null,
  span: null,
  nullState: null,
  measureSel: null,
} as const;

// The socket, its message buffer and the throttle timers are not state any
// component renders, so they sit beside the store rather than in it.
let socket: WebSocket | null = null;
let liveBuffer: LiveStore | null = null;
let shownVersion = -1;
// Counts connections, so a new buffer's versions never repeat an old one's.
let connectionSeq = 0;
let firstPublish: number | null = null;
let publishInterval: number | null = null;
let varHandle: VarFitHandle | null = null;

function stopHubTimers() {
  if (firstPublish !== null) window.clearTimeout(firstPublish);
  if (publishInterval !== null) window.clearInterval(publishInterval);
  firstPublish = null;
  publishInterval = null;
}

function cancelRunningFit() {
  varHandle?.cancel();
  varHandle = null;
}

export const useGroupStore = create<GroupState>((set, get) => {
  const publish = () => {
    const buffer = liveBuffer;
    if (!buffer || buffer.version === shownVersion) return;
    shownVersion = buffer.version;
    const input = liveInput(buffer);
    const last = buffer.errors[buffer.errors.length - 1];
    set((s) => ({
      hub: {
        ...s.hub,
        input: input.windows.length ? input : s.hub.input,
        replay_duplicates: buffer.replay_duplicates,
        live_replaced: buffer.live_replaced,
        n_windows: buffer.windows.size,
        revision: `${connectionSeq}:${buffer.version}`,
        error: last ? `${last.type}: ${last.message}` : s.hub.error,
      },
    }));
  };

  const closeSocket = () => {
    stopHubTimers();
    const ws = socket;
    socket = null;
    ws?.close();
  };

  return {
    loaded: null,
    mode: 'file',
    loadError: null,
    hub: HUB_IDLE,

    groupSel: null,
    channelSel: null,
    methodByChannel: {},
    measureSel: null,
    span: null,
    regimeSel: null,
    nullChoice: 'auto',
    nullState: null,
    autoNull: false,
    feedback: false,
    networks: NETWORKS_INITIAL,

    load: (input, label) => {
      get().disconnectHub();
      cancelRunningFit();
      set((s) => ({
        ...SELECTION_RESET,
        mode: 'file',
        loaded: { input, label, version: (s.loaded?.version ?? 0) + 1 },
        loadError: null,
        autoNull: true,
        networks: { ...s.networks, fit: null, boot: null },
      }));
    },

    setLoadError: (loadError) => set({ loadError }),

    connectHub: (hubUrl, groupId) => {
      closeSocket();
      cancelRunningFit();
      set((s) => ({ ...SELECTION_RESET, mode: 'live', autoNull: false, networks: { ...s.networks, fit: null, boot: null } }));
      let url: string;
      try {
        url = hubStreamUrl(hubUrl, groupId);
      } catch (err) {
        set({ hub: { ...HUB_IDLE, status: 'error', error: (err as Error).message } });
        return;
      }
      liveBuffer = createLiveStore();
      shownVersion = -1;
      connectionSeq += 1;
      set({ hub: { ...HUB_IDLE, status: 'connecting', url, revision: `${connectionSeq}:0` } });
      const ws = new WebSocket(url);
      socket = ws;
      // Events from a socket that has since been replaced must not touch the
      // new connection's status.
      const current = () => socket === ws;
      ws.onopen = () => {
        if (current()) set((s) => ({ hub: { ...s.hub, status: 'open' } }));
      };
      ws.onmessage = (ev) => {
        if (current() && liveBuffer && typeof ev.data === 'string') applyHubMessage(liveBuffer, ev.data);
      };
      ws.onerror = () => {
        if (current()) set((s) => ({ hub: { ...s.hub, status: 'error', error: `WebSocket error on ${url}` } }));
      };
      ws.onclose = () => {
        if (!current()) return;
        stopHubTimers();
        publish();
        socket = null;
        set((s) => ({ hub: { ...s.hub, status: s.hub.status === 'error' ? 'error' : 'closed' } }));
      };
      firstPublish = window.setTimeout(publish, 500);
      publishInterval = window.setInterval(publish, HUB_THROTTLE_MS);
    },

    disconnectHub: () => {
      if (socket) publish();
      closeSocket();
      set((s) => ({ hub: { ...s.hub, status: s.hub.status === 'idle' ? 'idle' : 'closed' } }));
    },

    selectGroup: (groupSel) => set({ groupSel, span: null }),
    selectChannel: (channelSel) => set({ channelSel, measureSel: null }),
    selectMethod: (channel, method) =>
      set((s) => ({ methodByChannel: { ...s.methodByChannel, [channel]: method }, measureSel: null })),
    selectMeasure: (measureSel) => set({ measureSel }),
    setSpan: (span) => set({ span }),
    selectRegime: (regimeSel) => set({ regimeSel }),
    setNullChoice: (nullChoice) => set({ nullChoice }),
    setNullState: (nullState) => set({ nullState }),
    consumeAutoNull: () => set({ autoNull: false }),
    setFeedback: (feedback) => set({ feedback }),

    setNetworks: (patch) => set((s) => ({ networks: { ...s.networks, ...patch } })),

    // The fit runs in a Web Worker and reports here, so it finishes (and its
    // result stays) even when the Networks page is no longer on screen.
    startVarFit: (key, request) => {
      cancelRunningFit();
      set((s) => ({ networks: { ...s.networks, fit: { key, running: true, outcome: null } } }));
      // runVarFit never calls back after cancel(), so a replaced fit is silent.
      varHandle = runVarFit(request, (outcome) => {
        varHandle = null;
        set((s) => ({ networks: { ...s.networks, fit: { key, running: false, outcome } } }));
      });
    },
    failVarFit: (key, outcome) => {
      cancelRunningFit();
      set((s) => ({ networks: { ...s.networks, fit: { key, running: false, outcome } } }));
    },
    cancelVarFit: () => {
      cancelRunningFit();
      set((s) => ({ networks: { ...s.networks, fit: s.networks.fit ? { ...s.networks.fit, running: false } : null } }));
    },
  };
});
