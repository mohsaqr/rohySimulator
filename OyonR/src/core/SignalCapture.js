/**
 * createSignalCapture — the orchestrator for the NON-CAMERA modalities:
 * typing, voice, interaction, discourse, and ai_assist.
 *
 * This is a SIBLING of `EmotionRuntime`, deliberately not an extension of it.
 * `EmotionRuntime` is a camera-frame orchestrator: everything it coordinates
 * is driven by one RAF/sample loop over video frames. The modalities here are
 * host-driven with their own lifecycles — a typing episode starts when the
 * host attaches a composer, a voice turn starts on a push-to-talk gesture, a
 * discourse episode opens on the first analyzed message — none of which is a
 * camera frame. Per CLAUDE.md, new pipelines arrive as injectable
 * collaborators, and `EmotionRuntime` stays an orchestrator of the camera
 * pipelines only; this factory is the matching orchestrator for the rest,
 * built in the same shape (constructor-injected collaborators, settings-gated
 * construction, deterministic teardown, an `EventEmitter` surface).
 *
 * ── One log, one clock (the whole point) ─────────────────────────────────
 * Every enabled modality's per-event stream is recorded into ONE shared
 * `SignalEventLog`, so `sequence_index` is monotonic ACROSS modalities on a
 * single timeline. That shared ordering is what this orchestrator exists to
 * provide: it is what makes cross-channel sequence questions — "did a
 * `thinking` discourse move follow a long typing `pause`?", "did the learner
 * `suggestion_accept` right after a voice `silence`?" — answerable at all.
 * Separate per-modality logs (what every hand-wired consumer built before
 * this) can each be sorted internally, but the interleaving BETWEEN channels
 * is unrecoverable once the events live in different ordering domains.
 * `log.toSequences()` with no modality filter returns that interleaved
 * chain, ready for dynajs `tna()`.
 *
 * ── What it wires together ───────────────────────────────────────────────
 *   SignalEventLog                (src/logging/)  ordered per-event log
 *   createSignalEventPersistence  (src/storage/)  batched writes → `signal_events`
 *   TypingAggregator + createTypingComposerAdapter
 *   VoiceTurnAggregator + createVoiceTurnController
 *   InteractionAggregator + createInteractionTracker
 *   DiscourseAggregator (delegating to analytics/TextAnalyzer)
 *   AiAssistAggregator + createAiAssistTracker
 *   createDocumentEditTracker / createCodeRunTracker (events only)
 *
 * Finalized modality windows go to the `signal_windows` store (stamped with
 * `window_id` / `capture_id` / `session_id`) and, when a `transport` is
 * supplied, out through `transport.send([row], context)` — plus the
 * `onWindow` callback and the `'window'` event.
 *
 * ── Settings gate CONSTRUCTION, not just behaviour ───────────────────────
 * A disabled modality's collaborators are never constructed: no DOM
 * listeners attach, `getUserMedia` is unreachable, no aggregator exists.
 * Its handle is `null`, not a stub — a host can (and should) branch on
 * `capture.voice === null` rather than call into a silent no-op.
 *
 * ── Teardown (the headline guarantee) ────────────────────────────────────
 * `stop()` finalizes any in-flight typing episode (as abandoned) and any
 * in-flight voice turn (releasing every MediaStreamTrack synchronously via
 * the controller), stops the interaction tracker (removing every DOM
 * listener and cancelling its timers), finalizes the discourse/ai_assist
 * windows, flushes the batched event persistence, and awaits outstanding
 * window writes. After `stop()` resolves nothing is running and late calls
 * on stale handles are ignored. `dispose()` is idempotent and safe after
 * `stop()`.
 *
 * ── Injection contract ───────────────────────────────────────────────────
 * Aggregators are injectable as INSTANCES (`typingAggregator`,
 * `voiceAggregator`, `interactionAggregator`, `discourseAggregator`,
 * `aiAssistAggregator`) — injected instances are re-wired into the shared
 * log (their `options.onEvent` is replaced) and torn down with the capture.
 * Capture-side collaborators are closures and cannot be re-wired after
 * construction, so they are injectable as FACTORIES
 * (`typingAdapterFactory`, `voiceControllerFactory`,
 * `interactionTrackerFactory`, `aiAssistTrackerFactory`), each called with
 * the fully wired option bag. `documentRef`/`windowRef`/`now`/
 * `monotonicNow`/`idFactory` inject the environment, so tests need no DOM,
 * no IndexedDB, and no audio stack (`MockVadAdapter` covers voice).
 */

import { EventEmitter } from './EventEmitter.js';
import { createOyonSettings } from '../settings/OyonSettings.js';
import { SignalEventLog } from '../logging/SignalEventLog.js';
import { createSignalEventPersistence } from '../storage/SignalEventStore.js';
import { oyonRecordId } from '../storage/IndexedDbOyonStore.js';
import { TypingAggregator } from '../aggregation/TypingAggregator.js';
import { createTypingComposerAdapter } from '../capture/TypingComposerAdapter.js';
import { createTypingContentEditableAdapter } from '../capture/TypingContentEditableAdapter.js';
import { createTypingEditReporter } from '../capture/TypingEditReporter.js';
import { createDocumentEditTracker } from '../capture/DocumentEditTracker.js';
import { createCodeRunTracker } from '../capture/CodeRunTracker.js';
import { VoiceTurnAggregator } from '../aggregation/VoiceTurnAggregator.js';
import { createVoiceTurnController } from '../capture/VoiceTurnController.js';
import { InteractionAggregator } from '../aggregation/InteractionAggregator.js';
import { createInteractionTracker } from '../capture/InteractionTracker.js';
import { DiscourseAggregator } from '../aggregation/DiscourseAggregator.js';
import { AiAssistAggregator } from '../aggregation/AiAssistAggregator.js';
import { createAiAssistTracker } from '../capture/AiAssistTracker.js';

const SIGNAL_WINDOWS_STORE = 'signal_windows';
const MODALITY_ORDER = ['typing', 'voice', 'interaction', 'discourse', 'ai_assist', 'document_edit', 'code_run'];

/**
 * Who and what a record belongs to, beside `capture_id` / `session_id`:
 * the person (`user_id`, with an optional display `user_label`), the group
 * the person works in (`group_id`) and the document, case, conversation or
 * task the work belongs to (`context_id`). All optional; only the ones the
 * host supplied are stamped, so records from a host that supplies none look
 * exactly as they did before these fields existed.
 */
const IDENTITY_KEYS = ['user_id', 'user_label', 'group_id', 'group_label', 'class_id', 'class_label', 'context_id'];

function identityFrom(...sources) {
  const identity = {};
  for (const key of IDENTITY_KEYS) {
    for (const source of sources) {
      const value = source ? source[key] : null;
      if (typeof value === 'string' && value.length > 0) {
        identity[key] = value;
        break;
      }
    }
  }
  return identity;
}

export function createSignalCapture(options = {}) {
  const {
    store = null,
    transport = null,
    context: baseContext = {},
    onWindow = null,
    onEvent = null,
    onError = null,
    // Wall clock (Date.now epoch) — ISO window stamps, event `timestamp`.
    now = defaultWallClockNow,
    // Monotonic clock (performance.now epoch) — every duration/interval.
    monotonicNow = defaultMonotonicNow,
    idFactory = oyonRecordId,
    documentRef = typeof document !== 'undefined' ? document : null,
    windowRef = typeof window !== 'undefined' ? window : null,
    maxEvents,
    persistenceFactory = createSignalEventPersistence,
    persistenceOptions = {},
    // `typingAdapterFactory`, when injected, is used for every attached
    // element. Left unset, a text field gets the text-field adapter and a
    // `contenteditable` element gets the contenteditable adapter.
    typingAdapterFactory = null,
    typingEditReporterFactory = createTypingEditReporter,
    voiceControllerFactory = createVoiceTurnController,
    interactionTrackerFactory = createInteractionTracker,
    aiAssistTrackerFactory = createAiAssistTracker,
    documentEditTrackerFactory = createDocumentEditTracker,
    codeRunTrackerFactory = createCodeRunTracker,
  } = options;

  const settings = createOyonSettings(options.settings);
  const events = new EventEmitter();

  let capturing = false;
  let disposed = false;
  let context = { capture_id: null, session_id: null };
  let log = null;
  let persistence = null;
  let errorCount = 0;
  let eventCounts = {};
  let windowCounts = {};
  const pendingWrites = new Set();
  // modality name -> { handle, teardown } for the current capture.
  const modalities = new Map();

  function reportError(scope, error) {
    errorCount += 1;
    if (typeof onError === 'function') {
      try { onError(error, { scope }); } catch { /* never let an error handler throw back */ }
    }
    events.emit('error', { scope, error });
  }

  /** Track an async write so stop() can await it; failures (sync throws
   *  included) surface via onError/stats, never propagate. */
  function trackWrite(scope, thunk) {
    const tracked = (async () => thunk())().catch((error) => reportError(scope, error));
    pendingWrites.add(tracked);
    tracked.finally(() => pendingWrites.delete(tracked));
    return tracked;
  }

  /**
   * Route one modality event into the shared log (which stamps
   * `sequence_index` on the single cross-modality timeline), the batched
   * persistence, the `onEvent` callback, and the `'event'` emitter channel.
   * Events arriving after teardown are ignored; a log rejection (unknown
   * modality/state) is surfaced via onError/stats, never swallowed and never
   * allowed to break the emitting pipeline.
   */
  function recordEvent(event) {
    if (!capturing) return null;
    let stored;
    try {
      stored = log.record(event);
    } catch (error) {
      reportError('event_log', error);
      return null;
    }
    eventCounts[stored.modality] = (eventCounts[stored.modality] || 0) + 1;
    if (persistence) persistence.write(stored);
    if (typeof onEvent === 'function') {
      try { onEvent(stored); } catch (error) { reportError('on_event', error); }
    }
    events.emit('event', stored);
    return stored;
  }

  /**
   * Stamp and fan out one finalized modality window: `signal_windows` row,
   * transport batch, `onWindow` callback, `'window'` event. Returns the
   * stamped row (null when the aggregator had nothing to finalize).
   */
  function emitWindow(modality, windowObject, entryContext = null) {
    if (!windowObject) return null;
    const row = {
      ...windowObject,
      window_id: idFactory('win'),
      capture_id: context.capture_id,
      session_id: context.session_id,
      // An entry-level context (the document this editor holds) wins over
      // the capture-level one.
      ...identityFrom(entryContext, context),
    };
    windowCounts[modality] = (windowCounts[modality] || 0) + 1;
    if (store) trackWrite('window_persistence', () => store.bulkAdd(SIGNAL_WINDOWS_STORE, [row]));
    if (transport) trackWrite('transport', () => transport.send([row], { ...context }));
    if (typeof onWindow === 'function') {
      try { onWindow(row); } catch (error) { reportError('on_window', error); }
    }
    events.emit('window', row);
    return row;
  }

  // ── modality builders ────────────────────────────────────────────────────
  // Each returns { handle, teardown }. Builders run ONLY for enabled
  // modalities, inside start() — construction is the gate, not behaviour.

  function startTyping() {
    const typingOptions = options.typing || {};
    // `context_id` of the entry currently attached (one editor = one
    // document); stamped on that entry's events and window.
    let entryContext = null;
    const recordTypingEvent = (event) => recordEvent(
      entryContext && entryContext.context_id ? { ...event, context_id: entryContext.context_id } : event,
    );
    const aggregator = options.typingAggregator || new TypingAggregator({
      pauseBuckets: settings.typing_pause_buckets,
      burstThresholdMs: settings.typing_burst_threshold_ms,
      maxIntervals: settings.typing_max_intervals,
      now,
      onEvent: recordTypingEvent,
    });
    // Injected instances are adopted: their event stream must land in the
    // shared log or the cross-modality timeline silently loses a channel.
    if (options.typingAggregator) aggregator.options.onEvent = recordTypingEvent;

    // The capture entry in use: a DOM adapter (text field or
    // contenteditable) or an edit reporter. All three share
    // `active` / `submit()` / `abandon()` / `dispose()`.
    let adapter = null;

    function detachAdapter(finalize) {
      if (!adapter) return null;
      let windowObject = null;
      if (finalize && adapter.active) windowObject = adapter.abandon();
      adapter.dispose();
      adapter = null;
      return windowObject;
    }

    function entryContextOf(contextId) {
      return typeof contextId === 'string' && contextId.length > 0 ? { context_id: contextId } : null;
    }

    function isContentEditable(element) {
      return Boolean(element) && element.isContentEditable === true;
    }

    function adapterFactoryFor(element) {
      if (typingAdapterFactory) return typingAdapterFactory;
      return isContentEditable(element) ? createTypingContentEditableAdapter : createTypingComposerAdapter;
    }

    const handle = {
      /** The live capture entry (DOM adapter or edit reporter), or null. */
      get adapter() { return adapter; },
      get active() { return adapter ? adapter.active : false; },
      /**
       * Attach ONE editor element and start an episode: an `<input>` or
       * `<textarea>`, or a `contenteditable` element. Attaching while an
       * episode is in flight finalizes it first (as abandoned) rather than
       * silently discarding it. `contextId` names the document, case or
       * task this editor holds.
       */
      attach(element, { targetKind, targetId = null, contextId = null } = {}) {
        if (!capturing) return null;
        detachAdapter(true);
        entryContext = entryContextOf(contextId);
        const windowContext = entryContext;
        adapter = adapterFactoryFor(element)({
          now: monotonicNow,
          wallClockNow: now,
          ...typingOptions,
          element,
          aggregator,
          targetKind: targetKind ?? (isContentEditable(element) ? 'document_editor' : 'chat_composer'),
          targetId,
          onWindow: (windowObject) => emitWindow('typing', windowObject, windowContext),
        });
        adapter.start();
        return adapter;
      },
      /**
       * Start an episode for an editor whose host reports its own edits
       * (no `input` event to listen to). Returns the edit reporter; call
       * `reportEdit()` / `reportSelection()` on it per edit. `initial`
       * carries the document's `graphemes` / `words` and the selection when
       * the episode opens.
       */
      report({ targetKind, targetId = null, contextId = null, ...initial } = {}) {
        if (!capturing) return null;
        detachAdapter(true);
        entryContext = entryContextOf(contextId);
        const windowContext = entryContext;
        adapter = typingEditReporterFactory({
          now: monotonicNow,
          wallClockNow: now,
          aggregator,
          targetKind: targetKind ?? 'document_editor',
          targetId,
          onWindow: (windowObject) => emitWindow('typing', windowObject, windowContext),
          // Focus / blur / visibility leave as interaction events on the
          // shared timeline, like the ones the interaction tracker emits.
          onInteractionEvent: recordTypingEvent,
        });
        adapter.start(initial);
        return adapter;
      },
      /** Finalize the current episode as submitted; returns the raw window. */
      submit() {
        return adapter && adapter.active ? adapter.submit() : null;
      },
      /** Finalize the current episode as abandoned; returns the raw window. */
      abandon() {
        return adapter && adapter.active ? adapter.abandon() : null;
      },
    };

    return {
      handle,
      teardown() {
        // An episode still in flight at stop() is finalized as abandoned —
        // its window is emitted through the entry's own onWindow — and a DOM
        // adapter's listeners are removed (exact add/remove symmetry is the
        // adapter's tested contract; dispose() preserves it here).
        detachAdapter(true);
      },
    };
  }

  function startVoice() {
    const voiceOptions = options.voice || {};
    const aggregator = options.voiceAggregator || new VoiceTurnAggregator({
      frameMs: settings.voice_frame_ms,
      vadThreshold: settings.voice_vad_threshold,
      pauseThresholdMs: settings.voice_pause_threshold_ms,
      now,
      onEvent: recordEvent,
    });
    if (options.voiceAggregator) aggregator.options.onEvent = recordEvent;

    const controller = voiceControllerFactory({
      settings,
      now: monotonicNow,
      // Constructing a signal capture with voice enabled IS the host's
      // enablement (gate condition 2); the per-turn user action (condition
      // 3) still comes from the host via startTurn().
      hostEnabled: true,
      ...voiceOptions,
      onEvent: (event) => aggregator.recordEvent(event),
      onFrameFeatures: (record) => {
        // Full-rate pass-through of the per-frame record to any host sink,
        // then the aggregator's own accounting (worker-path DSP features).
        if (typeof voiceOptions.onFrameFeatures === 'function') {
          try { voiceOptions.onFrameFeatures(record); } catch (error) { reportError('voice_frame_sink', error); }
        }
        aggregator.recordFrame(record.features, {
          timestamp: record.timestamp_ms,
          speechProbability: record.speech_probability,
          inPlayback: record.in_playback,
          muted: record.muted,
        });
      },
      onError: (error) => reportError('voice', error),
    });

    const handle = {
      get active() { return controller.active; },
      get controller() { return controller; },
      /**
       * Begin a voice turn. `userAction` defaults to true because calling
       * this from a push-to-talk handler IS the deliberate per-turn action;
       * pass `userAction: false` to exercise the controller's refusal path.
       * Resolves the controller's `{ ok, reason? }` result.
       */
      async startTurn({ userAction = true, stream = null, targetKind = null, targetId = null } = {}) {
        if (!capturing) return { ok: false, reason: 'capture_not_active' };
        if (controller.active) return { ok: false, reason: 'turn_already_active' };
        // Start the aggregator FIRST so the controller's own 'start' event
        // (emitted at the end of startTurn) is recorded, not dropped.
        aggregator.start({ timestamp: monotonicNow(), targetKind, targetId });
        let result;
        try {
          result = await controller.startTurn({ userAction, stream });
        } catch (error) {
          // Hardware/context failure after the gate: the controller already
          // released its resources; discard the never-started turn.
          aggregator.finalize({ timestamp: monotonicNow() });
          reportError('voice', error);
          throw error;
        }
        if (!result || result.ok !== true) {
          aggregator.finalize({ timestamp: monotonicNow() }); // discard the refused turn
        }
        return result;
      },
      /**
       * End the turn: releases every MediaStreamTrack synchronously (the
       * controller's contract), finalizes the `voice-v1` window with the
       * controller's report, and emits it. Returns the stamped window row.
       */
      stopTurn(reason = 'host_stop') {
        if (!aggregator.active) return null;
        const report = controller.active ? controller.stopTurn(reason) : null;
        const windowObject = aggregator.finalize({ timestamp: monotonicNow(), report });
        return emitWindow('voice', windowObject);
      },
      aiPlaybackStart() { controller.aiPlaybackStart(); },
      aiPlaybackEnd() { controller.aiPlaybackEnd(); },
    };

    return {
      handle,
      teardown() {
        // A turn still in flight at stop() is finalized — the microphone is
        // released synchronously inside stopTurn — then the controller (and
        // any analyzer it owns) is disposed.
        if (aggregator.active) handle.stopTurn('capture_stopped');
        controller.dispose();
      },
    };
  }

  function startInteraction() {
    const interactionOptions = options.interaction || {};
    const aggregator = options.interactionAggregator || new InteractionAggregator({
      now,
      ...interactionOptions,
    });
    const tracker = interactionTrackerFactory({
      documentRef,
      windowRef,
      now,
      ...interactionOptions,
      onEvent: (event) => {
        recordEvent(event);
        try {
          aggregator.record(event);
        } catch (error) {
          reportError('interaction', error);
        }
      },
    });
    // Ambient within the page: no per-episode host driving — the interaction
    // interval spans the whole capture.
    aggregator.start({ timestamp: now() });
    tracker.start();

    const handle = {
      get active() { return tracker.active; },
      get tracker() { return tracker; },
    };

    return {
      handle,
      teardown() {
        tracker.stop(); // removes every listener, clears idle/selection timers
        emitWindow('interaction', aggregator.finalize({ timestamp: now() }));
        tracker.dispose();
      },
    };
  }

  function startDiscourse() {
    const discourseOptions = options.discourse || {};
    const aggregator = options.discourseAggregator || new DiscourseAggregator({
      now,
      ...discourseOptions,
      onEvent: recordEvent,
    });
    if (options.discourseAggregator) aggregator.options.onEvent = recordEvent;

    const handle = {
      get active() { return aggregator.active; },
      /**
       * Classify every sentence of one host-supplied message; emits one
       * event per sentence into the shared log and returns them. The FIRST
       * non-empty call opens the episode; it closes at stop().
       */
      analyze(text, { timestamp, wallTimestamp } = {}) {
        if (!capturing) return [];
        return aggregator.analyze(text, {
          timestamp: timestamp ?? monotonicNow(),
          wallTimestamp: wallTimestamp ?? now(),
        });
      },
    };

    return {
      handle,
      teardown() {
        emitWindow('discourse', aggregator.finalize({ timestamp: monotonicNow() }));
      },
    };
  }

  function startAiAssist() {
    const aiAssistOptions = options.aiAssist || {};
    const aggregator = options.aiAssistAggregator || new AiAssistAggregator({ now });
    const tracker = aiAssistTrackerFactory({
      ...aiAssistOptions,
      now: monotonicNow,
      wallClockNow: now,
      onEvent: (event) => {
        recordEvent(event);
        try {
          aggregator.record(event);
        } catch (error) {
          reportError('ai_assist', error);
        }
      },
    });
    // Interval window spanning the capture, like interaction.
    aggregator.start({ timestamp: monotonicNow() });

    const handle = {
      get active() { return aggregator.active; },
      get tracker() { return tracker; },
      requested(descriptor) { return tracker.requested(descriptor); },
      shown(descriptor) { return tracker.shown(descriptor); },
      accepted(descriptor) { return tracker.accepted(descriptor); },
      rejected(descriptor) { return tracker.rejected(descriptor); },
      dismissed(descriptor) { return tracker.dismissed(descriptor); },
      aiTurnStart(descriptor) { return tracker.aiTurnStart(descriptor); },
      aiTurnEnd(descriptor) { return tracker.aiTurnEnd(descriptor); },
    };

    return {
      handle,
      teardown() {
        emitWindow('ai_assist', aggregator.finalize({ timestamp: monotonicNow() }));
        tracker.dispose();
      },
    };
  }

  /**
   * A host-driven tracker with no window of its own: its events go into the
   * shared log on the cross-modality timeline and nowhere else.
   */
  function startEventTracker(trackerFactory, trackerOptions) {
    const tracker = trackerFactory({
      ...(trackerOptions || {}),
      now: monotonicNow,
      wallClockNow: now,
      onEvent: recordEvent,
    });
    return {
      handle: tracker,
      teardown() { tracker.dispose(); },
    };
  }

  const BUILDERS = {
    typing: { enabled: () => settings.typing_enabled, build: startTyping },
    voice: { enabled: () => settings.voice_enabled, build: startVoice },
    interaction: { enabled: () => settings.interaction_enabled, build: startInteraction },
    discourse: { enabled: () => settings.discourse_enabled, build: startDiscourse },
    ai_assist: { enabled: () => settings.ai_assist_enabled, build: startAiAssist },
    document_edit: {
      enabled: () => settings.document_edit_enabled,
      build: () => startEventTracker(documentEditTrackerFactory, options.documentEdit),
    },
    code_run: {
      enabled: () => settings.code_run_enabled,
      build: () => startEventTracker(codeRunTrackerFactory, options.codeRun),
    },
  };

  // ── lifecycle ───────────────────────────────────────────────────────────

  /**
   * Begin one capture: (re)start the shared event log under
   * `{ capture_id, session_id }`, wire the batched persistence, and
   * construct ONLY the modalities their settings enable. A modality whose
   * construction throws (e.g. interaction with no DOM) is surfaced via
   * onError/stats and its handle stays null — never a silent stub.
   */
  function start(startContext = {}) {
    if (disposed) throw new Error('createSignalCapture: start() called after dispose().');
    if (capturing) return capture;

    context = {
      capture_id: startContext.capture_id ?? baseContext.capture_id ?? null,
      session_id: startContext.session_id ?? baseContext.session_id ?? null,
      ...identityFrom(startContext, baseContext),
    };
    eventCounts = {};
    windowCounts = {};
    errorCount = 0;

    log = options.log || new SignalEventLog({
      now,
      monotonicNow,
      idFactory: () => idFactory('evt'),
      ...(Number.isFinite(maxEvents) ? { maxEvents } : {}),
    });
    log.start(context);

    persistence = store
      ? persistenceFactory({
        store,
        onError: (error) => reportError('persistence', error),
        ...persistenceOptions,
      })
      : null;

    capturing = true;
    modalities.clear();
    for (const modality of MODALITY_ORDER) {
      const builder = BUILDERS[modality];
      if (!builder.enabled()) continue;
      try {
        modalities.set(modality, builder.build());
      } catch (error) {
        reportError(`${modality}:start`, error);
      }
    }

    events.emit('status', { state: 'running', context: { ...context } });
    return capture;
  }

  /**
   * Deterministic teardown — see the class doc. Idempotent; resolves once
   * every in-flight episode/turn is finalized, every listener/track/timer
   * is released, and every pending write has settled.
   */
  async function stop() {
    if (!capturing) return;
    // Finalize while the log is still accepting events, so the terminal
    // events each teardown produces (abandon, voice end, …) are recorded.
    for (const modality of MODALITY_ORDER) {
      const entry = modalities.get(modality);
      if (!entry) continue;
      try {
        entry.teardown();
      } catch (error) {
        reportError(`${modality}:stop`, error);
      }
    }
    modalities.clear();
    capturing = false;
    if (persistence) {
      try {
        await persistence.dispose(); // final flush + timer cleanup
      } catch (error) {
        reportError('persistence', error);
      }
    }
    await Promise.allSettled([...pendingWrites]);
    events.emit('status', { state: 'stopped' });
  }

  /** Idempotent; safe after stop(). Stops first if still capturing. */
  async function dispose() {
    if (disposed) return;
    await stop();
    disposed = true;
    events.emit('status', { state: 'disposed' });
  }

  const capture = {
    start,
    stop,
    dispose,
    on(type, handler) { return events.on(type, handler); },
    off(type, handler) { events.off(type, handler); },

    // Per-modality handles: null when the modality is disabled (or its
    // construction failed, which was surfaced), and null before start().
    get typing() { return modalities.get('typing')?.handle ?? null; },
    get voice() { return modalities.get('voice')?.handle ?? null; },
    get interaction() { return modalities.get('interaction')?.handle ?? null; },
    get discourse() { return modalities.get('discourse')?.handle ?? null; },
    get aiAssist() { return modalities.get('ai_assist')?.handle ?? null; },
    get documentEdit() { return modalities.get('document_edit')?.handle ?? null; },
    get codeRun() { return modalities.get('code_run')?.handle ?? null; },

    /** The shared cross-modality event log (null before the first start()). */
    get log() { return log; },
    get settings() { return settings; },
    get context() { return { ...context }; },
    get active() { return capturing; },

    /**
     * Liveness without reading the database: per-modality recorded-event and
     * emitted-window counts, ring-buffer drops, persistence written/failed/
     * pending, and how many errors were surfaced.
     */
    get stats() {
      return {
        active: capturing,
        events: { ...eventCounts },
        windows: { ...windowCounts },
        dropped_events: log ? log.droppedEvents : 0,
        persistence: {
          written: persistence ? persistence.writtenCount : 0,
          failed: persistence ? persistence.failedCount : 0,
          pending: persistence ? persistence.pendingCount : 0,
        },
        errors: errorCount,
      };
    },
  };

  return capture;
}

function defaultWallClockNow() {
  return Date.now();
}

function defaultMonotonicNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
