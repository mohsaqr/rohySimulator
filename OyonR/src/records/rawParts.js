/**
 * joinRawParts — rebuild windows that were split across POSTs.
 *
 * `HttpEmotionTransport` splits a window too large for one request into the
 * window plus raw-only continuation parts (src/transport/chunkWindowBatch.js).
 * All parts share `raw_part.id`; the window is index 0. Receivers store each
 * part as it arrives (no state across requests); readers call this to put the
 * rows back:
 *
 *   joinRawParts(storedWindows)
 *
 * - The parts of one id are merged onto index 0 in index order; per stream the
 *   rows are concatenated (a field list that differs between parts is unioned,
 *   missing cells null). The joined window keeps `raw_part` with `joined: n`
 *   (parts found) so an incomplete set is visible, never hidden.
 * - Parts whose index-0 window is missing stay as they are (raw-only events).
 * - Raw-only envelopes without `raw_part` (rows sent on stop or at the
 *   recorder's row bound) are returned unchanged: they are their own records.
 * - Order otherwise follows the input; nothing is dropped.
 *
 * @param {object[]} windows
 * @returns {object[]}
 */
export function joinRawParts(windows) {
  if (!Array.isArray(windows)) throw new TypeError('joinRawParts: windows must be an array');
  const groups = new Map();
  windows.forEach((w, position) => {
    const id = w?.raw_part?.id;
    if (typeof id !== 'string' || !id) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ w, position });
  });
  if (!groups.size) return windows.slice();

  const replaced = new Map(); // position → joined window, or null to skip
  for (const parts of groups.values()) {
    const head = parts.find(p => p.w.raw_part.index === 0);
    if (!head) continue;
    const ordered = parts.slice().sort((a, b) => a.w.raw_part.index - b.w.raw_part.index || a.position - b.position);
    const raw = {};
    for (const { w } of ordered) mergeStreams(raw, w.raw_streams);
    replaced.set(head.position, {
      ...head.w,
      raw_streams: raw,
      raw_part: { ...head.w.raw_part, joined: ordered.length },
    });
    for (const p of ordered) if (p !== head) replaced.set(p.position, null);
  }
  const out = [];
  windows.forEach((w, position) => {
    if (!replaced.has(position)) out.push(w);
    else if (replaced.get(position)) out.push(replaced.get(position));
  });
  return out;
}

function mergeStreams(into, streams) {
  if (!streams || typeof streams !== 'object') return;
  for (const [name, block] of Object.entries(streams)) {
    if (!block || !Array.isArray(block.fields) || !Array.isArray(block.rows)) continue;
    const target = into[name];
    if (!target) {
      into[name] = { ...block, fields: block.fields.slice(), rows: block.rows.slice() };
      continue;
    }
    const added = block.fields.filter(f => !target.fields.includes(f));
    if (added.length) {
      target.fields.push(...added);
      target.rows = target.rows.map(r => [...r, ...added.map(() => null)]);
    }
    const index = target.fields.map(f => block.fields.indexOf(f));
    for (const row of block.rows) target.rows.push(index.map(i => (i < 0 ? null : row[i])));
  }
}
