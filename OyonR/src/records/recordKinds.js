// recordKinds.js — which KINDS of record a set holds, so a dashboard offers only the pages it can fill.
//
// A host with no camera feeds typing episodes and events and nothing else. Eight of the dashboard's pages
// read interval windows or voice turns; offered over such a feed they are eight empty states. This answers
// one question — what is in the set — and holds no page names: the app maps kinds to pages.
//
// Pure: no DOM, no store.

const isObject = (v) => v !== null && typeof v === 'object';
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * @param {{windows?: unknown[], signalWindows?: unknown[], signalEvents?: unknown[], logEvents?: unknown[]}|null} records
 * @returns {{windows: boolean, typing: boolean, voice: boolean, events: boolean, logEvents: boolean,
 *   modalities: string[], eventModalities: string[]}}
 *   `windows` — any interval window (emotion, gaze, engagement, …); `typing` / `voice` — an episode window of
 *   that modality; `events` — any signal event; `modalities` — every episode-window modality present, sorted;
 *   `eventModalities` — every signal-event modality present, sorted.
 */
export function recordKindsOf(records) {
  const r = isObject(records) ? records : {};
  const episodes = new Set();
  list(r.signalWindows).forEach((w) => { if (isObject(w) && typeof w.modality === 'string' && w.modality) episodes.add(w.modality); });
  const events = new Set();
  list(r.signalEvents).forEach((e) => { if (isObject(e) && typeof e.modality === 'string' && e.modality) events.add(e.modality); });
  return {
    windows: list(r.windows).length > 0,
    typing: episodes.has('typing'),
    voice: episodes.has('voice'),
    events: events.size > 0,
    logEvents: list(r.logEvents).length > 0,
    modalities: [...episodes].sort(),
    eventModalities: [...events].sort(),
  };
}
