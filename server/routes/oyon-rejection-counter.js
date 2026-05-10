// In-memory rejection-rate counter for Oyon endpoints.
//
// Why this exists: when the May-2026 label-set bug was live, the server
// emitted structured warnings ('emotion batch rejected') for every
// rejected POST — but nobody was watching them. Logs went to journalctl
// and nothing surfaced the rejection rate to operators. The first signal
// of failure was a user reporting empty analytics, hours later.
//
// This module gives /api/addons/oyon/admin/health a window into 4xx
// activity without parsing journalctl: per-endpoint counts for the last
// 5 minutes and the last hour, plus the most recent status code seen.
// In-memory, per-process, lost on restart — that's fine for a "did the
// last deploy break something" indicator. For long-term trend analysis
// promote it to a metrics sink later.

const TTL_MS = 60 * 60 * 1000;          // 1h ring window
const SHORT_WINDOW_MS = 5 * 60 * 1000;  // also expose 5min count
const MAX_BUCKETS = 4096;               // hard cap per endpoint to bound memory

// Map<endpointKey, Array<{ ts: number, status: number }>>
const buckets = new Map();

export function recordRejection(endpointKey, status) {
  if (!endpointKey || !Number.isFinite(status)) return;
  if (status < 400) return;
  let arr = buckets.get(endpointKey);
  if (!arr) {
    arr = [];
    buckets.set(endpointKey, arr);
  }
  arr.push({ ts: Date.now(), status });
  // Bound array length even if pruning lags. Drop oldest first.
  if (arr.length > MAX_BUCKETS) arr.splice(0, arr.length - MAX_BUCKETS);
}

function pruneAndCount(arr, now) {
  const cutoff = now - TTL_MS;
  while (arr.length && arr[0].ts < cutoff) arr.shift();
  let last5m = 0;
  const lastWindowCutoff = now - SHORT_WINDOW_MS;
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (arr[i].ts < lastWindowCutoff) break;
    last5m += 1;
  }
  return { count_1h: arr.length, count_5m: last5m };
}

export function getStats() {
  const now = Date.now();
  const out = {};
  for (const [key, arr] of buckets.entries()) {
    const { count_1h, count_5m } = pruneAndCount(arr, now);
    if (count_1h === 0) {
      buckets.delete(key);
      continue;
    }
    const last = arr[arr.length - 1];
    out[key] = {
      count_5m,
      count_1h,
      last_status: last?.status ?? null,
      last_at: last ? new Date(last.ts).toISOString() : null,
    };
  }
  return out;
}

// Express middleware: after the response finishes, if status >= 400,
// record it under "<METHOD> <route_path>" so all probes against the
// same endpoint accumulate together (regardless of path params).
export function rejectionMiddleware(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    // Use req.route?.path (the matched router pattern, e.g. '/emotion-records')
    // when available; fall back to the request path otherwise. The router
    // pattern keeps the bucket count bounded — distinct path-params (e.g.
    // session ids) all roll up to the same endpoint key.
    const routePath = req.route?.path || req.baseUrl || req.path || 'unknown';
    const key = `${req.method} ${routePath}`;
    recordRejection(key, res.statusCode);
  });
  next();
}

// Test seam: clear all buckets (used by unit tests; not exposed via HTTP).
export function _resetForTests() {
  buckets.clear();
}
