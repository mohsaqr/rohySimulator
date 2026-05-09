// Tagged client-side logger for Oyon code paths.
//
// Goal: every Oyon-related client log line carries `[oyon]` and a structured
// fields object, so a developer triaging a session can grep one tag in the
// browser console and reconstruct the full lifecycle (config load → consent
// → preload → start → batch persist → stop) without losing it in Rohy's
// other noise.
//
// Levels map onto console.* directly. We intentionally avoid shipping these
// to the backend — Oyon's failure budget says client telemetry must not be
// load-bearing on Rohy's request loop. If we want server-side mirroring
// later, the existing /api/client-logs route can pick it up via a small
// transport here without touching call sites.

const PREFIX = '[oyon]';

export function oyonClientLog(level, msg, fields = {}) {
   const sink = pickSink(level);
   try {
      sink(PREFIX, msg, fields);
   } catch {
      // Console can't fail in any meaningful way, but never let a logger
      // throw take down the surrounding feature.
   }
}

function pickSink(level) {
   switch (level) {
      case 'debug': return (console.debug || console.log).bind(console);
      case 'warn':  return console.warn.bind(console);
      case 'error': return console.error.bind(console);
      default:      return console.log.bind(console);
   }
}
