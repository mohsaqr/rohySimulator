/**
 * CodeRunTracker — a host-facing emitter for code runs (`modality:
 * 'code_run'`, vocabulary `code-run-states-v1`).
 *
 * A host with a code editor or notebook calls `started()` when a run begins
 * and one of `succeeded()` / `failed()` / `interrupted()` when it ends. Each
 * call emits one event through `onEvent`. The ending event carries
 * `duration_ms`, measured HERE on the monotonic clock between `started()` and
 * the ending call for the same `run_id` (`null` when no matching `started()`
 * was seen), and `failed()` carries the KIND of error only (`'syntax'`,
 * `'runtime'`, `'timeout'`, …), never its message, the code or the output.
 *
 * Not a DOM listener: only the host knows a run happened.
 */

import { OYON_CODE_RUN_STATES, OYON_EVENT_SOURCES } from '../version.js';

const MODALITY = 'code_run';

/** Redundancy rule (not a privacy gate): the host owns the code and output. */
const FORBIDDEN_DESCRIPTOR_FIELDS = ['code', 'source_code', 'output', 'stdout', 'stderr', 'message', 'stack', 'text'];

// Bounds the started-but-not-ended map: a host that reports starts and never
// endings would otherwise grow it for the life of the tracker.
const DEFAULT_MAX_PENDING_RUNS = 1000;

function fail(message) {
  throw new TypeError(`createCodeRunTracker: ${message}`);
}

export function createCodeRunTracker(options = {}) {
  const resolvedOptions = {
    onEvent: null,
    now: defaultMonotonicNow,
    wallClockNow: defaultWallClockNow,
    maxPendingRuns: DEFAULT_MAX_PENDING_RUNS,
    ...options,
  };

  // run_id -> monotonic ms at started(). Insertion order is eviction order.
  const pendingRuns = new Map();
  let disposed = false;

  function checkDescriptor(descriptor, methodName) {
    if (!descriptor || typeof descriptor !== 'object') fail(`${methodName}() takes a descriptor object`);
    for (const field of FORBIDDEN_DESCRIPTOR_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(descriptor, field)) {
        fail(`${methodName}() must not carry "${field}" — the host stores code, output and error text; `
          + 'Oyon carries the outcome and its duration only (a redundancy rule, not a privacy rule).');
      }
    }
    const source = descriptor.source ?? 'user';
    if (!OYON_EVENT_SOURCES.includes(source)) {
      fail(`unknown source ${JSON.stringify(source)} (expected one of: ${OYON_EVENT_SOURCES.join(', ')})`);
    }
    return source;
  }

  function takeDurationMs(runId) {
    if (runId === null || runId === undefined || !pendingRuns.has(runId)) return null;
    const startedAt = pendingRuns.get(runId);
    pendingRuns.delete(runId);
    return Math.max(0, resolvedOptions.now() - startedAt);
  }

  function dispatch(state, source, detail, contextId) {
    if (!OYON_CODE_RUN_STATES.includes(state)) fail(`'${state}' is not a member of OYON_CODE_RUN_STATES`);
    const event = {
      modality: MODALITY,
      state,
      source,
      timestamp: resolvedOptions.wallClockNow(),
      monotonic_ms: resolvedOptions.now(),
      detail,
      ...(typeof contextId === 'string' && contextId.length > 0 ? { context_id: contextId } : {}),
    };
    if (typeof resolvedOptions.onEvent === 'function') resolvedOptions.onEvent(event);
    return event;
  }

  /** A run began. `run_id` pairs it with its ending; `language` is optional. */
  function started(descriptor = {}) {
    if (disposed) return null;
    const source = checkDescriptor(descriptor, 'started');
    const { run_id = null, language = null, context_id = null } = descriptor;
    if (run_id !== null && run_id !== undefined) {
      pendingRuns.set(run_id, resolvedOptions.now());
      while (pendingRuns.size > resolvedOptions.maxPendingRuns) {
        pendingRuns.delete(pendingRuns.keys().next().value);
      }
    }
    return dispatch('start', source, { run_id, language, duration_ms: null, error_kind: null }, context_id);
  }

  function ended(state, methodName, descriptor) {
    if (disposed) return null;
    const source = checkDescriptor(descriptor, methodName);
    const { run_id = null, language = null, context_id = null } = descriptor;
    const errorKind = state === 'failure' && typeof descriptor.error_kind === 'string'
      ? descriptor.error_kind
      : null;
    return dispatch(state, source, {
      run_id,
      language,
      duration_ms: takeDurationMs(run_id),
      error_kind: errorKind,
    }, context_id);
  }

  return {
    started,
    /** The run finished without error. */
    succeeded(descriptor = {}) { return ended('success', 'succeeded', descriptor); },
    /** The run ended in an error; pass `error_kind` (a short category), never the message. */
    failed(descriptor = {}) { return ended('failure', 'failed', descriptor); },
    /** The run was stopped before it finished. */
    interrupted(descriptor = {}) { return ended('interrupt', 'interrupted', descriptor); },
    /** Idempotent; later calls return `null`. */
    dispose() {
      disposed = true;
      pendingRuns.clear();
    },
    get active() { return !disposed; },
  };
}

function defaultMonotonicNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultWallClockNow() {
  return Date.now();
}
