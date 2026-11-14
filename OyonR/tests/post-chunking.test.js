// Byte-aware, lossless POST chunking (Codex #13): HttpEmotionTransport keeps
// every POST under transport_max_post_bytes, splits an oversized window's
// raw_streams into raw-only continuation parts, and joinRawParts() puts the
// window back together exactly. Plain node, throws on failure.
import assert from 'node:assert/strict';
import { chunkWindowBatch, utf8Bytes, DEFAULT_MAX_POST_BYTES, rawPartId } from '../src/transport/chunkWindowBatch.js';
import * as records from '../src/records/index.js';
import { validateEmotionEvent } from '../src/validation/validateEmotionPayload.js';
import { HttpEmotionTransport } from '../src/transport/HttpEmotionTransport.js';
import { joinRawParts } from '../src/records/rawParts.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';
import { createOyonSettings } from '../src/settings/OyonSettings.js';
import { OYON_WINDOW_BATCH_SCHEMA_VERSION } from '../src/version.js';
import * as root from '../src/index.js';

const SCHEMA = OYON_WINDOW_BATCH_SCHEMA_VERSION;
const bodyBytes = events => utf8Bytes(JSON.stringify({ schema_version: SCHEMA, events }));

/** The Codex reproduction: a 60 s window at 250 ms cadence with every stream. */
function bigWindow(start = Date.UTC(2026, 0, 1), streams = 9, perStream = 400) {
  const raw = {};
  for (let s = 0; s < streams; s += 1) {
    raw[`stream_${s}`] = {
      fields: ['ts_ms', 'ts_group_ms', 'a', 'b', 'c', 'd', 'label'],
      rows: Array.from({ length: perStream }, (_, i) => [start + i * 250, start + i * 250 + 40, i / 7, (0 - i) / 11, 0.123456789, i % 3, i % 2 ? 'happy' : 'neutral']),
    };
  }
  return {
    session_id: 's1', member_id: 'm1', group_id: 'G1',
    window_start: new Date(start).toISOString(),
    window_end: new Date(start + 60_000).toISOString(),
    dominant_emotion: 'happy', probabilities: { happy: 0.9, neutral: 0.1 },
    confidence: 0.9, valid_frames: 240, missing_face_ratio: 0,
    engagement: { focus_score: 0.5 },
    clock_offset_ms: 40, window_index: 3,
    raw_streams: raw,
  };
}

const rowsOf = events => {
  const out = {};
  for (const e of events) for (const [name, b] of Object.entries(e.raw_streams ?? {})) (out[name] ??= []).push(...b.rows);
  return out;
};

// ── defaults ────────────────────────────────────────────────────────────────
assert.equal(DEFAULT_MAX_POST_BYTES, 245760);
assert.equal(createOyonSettings({}).transport_max_post_bytes, 245760);
assert.equal(createOyonSettings({ transport_max_post_bytes: 10 }).transport_max_post_bytes, 16384, 'below the range → clamped to 16 KiB');
assert.equal(createOyonSettings({ transport_max_post_bytes: 'x' }).transport_max_post_bytes, 245760, 'not a number → default');
assert.equal(createOyonSettings({ transport_max_post_bytes: 1_000_000 }).transport_max_post_bytes, 1_000_000);
assert.equal(typeof root.chunkWindowBatch, 'function');
assert.equal(typeof root.joinRawParts, 'function');

// ── the Codex case: one window over 256 KiB → parts under the budget, nothing lost ──
{
  const w = bigWindow();
  assert.ok(bodyBytes([w]) > 256 * 1024, `fixture is over Rohy's limit (${bodyBytes([w])} bytes)`);
  let n = 0;
  const batches = chunkWindowBatch([w], { schemaVersion: SCHEMA, newId: () => `rp-${(n += 1)}` });
  assert.ok(batches.length >= 2, 'split into several POSTs');
  for (const b of batches) {
    assert.ok(bodyBytes(b) <= DEFAULT_MAX_POST_BYTES, `a POST is ${bodyBytes(b)} bytes`);
    assert.deepEqual(validateEmotionBatch({ schema_version: SCHEMA, events: b }).errors, []);
  }
  const parts = batches.flat();
  assert.equal(n, 1, 'one id for the window');
  assert.deepEqual(parts.map(p => p.raw_part.index), parts.map((_, i) => i));
  assert.ok(parts.every(p => p.raw_part.id === 'rp-1' && p.raw_part.count === parts.length));
  const head = parts[0];
  assert.equal(head.dominant_emotion, 'happy', 'index 0 is the window itself');
  assert.deepEqual(head.engagement, { focus_score: 0.5 });
  for (const c of parts.slice(1)) {
    assert.equal(c.modality, 'raw');
    assert.equal(c.raw_reason, 'continuation');
    assert.equal(c.raw_parent_modality, 'emotion');
    assert.equal(c.window_start, w.window_start);
    assert.equal(c.window_end, w.window_end);
    assert.equal(c.member_id, 'm1', 'continuations carry identity');
    assert.equal(c.window_index, 3, 'and alignment');
    assert.equal(c.dominant_emotion, undefined, 'but not the window summary');
    assert.equal(c.engagement, undefined, 'nor measurement blocks');
  }
  // Lossless: every row, in order, exactly once.
  assert.deepEqual(rowsOf(parts), rowsOf([w]));
  // joinRawParts rebuilds the window exactly.
  const joined = joinRawParts(parts);
  assert.equal(joined.length, 1);
  const { raw_part: rp, ...rest } = joined[0];
  const { raw_streams: _r, ...expectBase } = w;
  assert.deepEqual(rest.raw_streams, w.raw_streams);
  assert.deepEqual({ ...rest, raw_streams: undefined }, { ...expectBase, raw_streams: undefined });
  assert.equal(rp.joined, parts.length);
}

// ── small windows: packed into as few POSTs as fit, untouched ───────────────
{
  const small = Array.from({ length: 30 }, (_, i) => bigWindow(Date.UTC(2026, 0, 1) + i * 60_000, 1, 40));
  const batches = chunkWindowBatch(small, { schemaVersion: SCHEMA, maxBytes: 40_000 });
  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), small, 'same events, same order, no parts');
  for (const b of batches) assert.ok(bodyBytes(b) <= 40_000);
  // The event-count bound holds too.
  const counted = chunkWindowBatch(small, { schemaVersion: SCHEMA, maxEvents: 7, maxBytes: 10_000_000 });
  assert.ok(counted.every(b => b.length <= 7));
  assert.equal(counted.flat().length, 30);
}

// ── invariant: any budget → every POST under it, rows preserved ─────────────
for (const budget of [16_384, 50_000, 120_000, 245_760]) {
  const ws = [bigWindow(Date.UTC(2026, 0, 1), 3, 600), bigWindow(Date.UTC(2026, 0, 2), 2, 50)];
  const batches = chunkWindowBatch(ws, { schemaVersion: SCHEMA, maxBytes: budget });
  for (const b of batches) assert.ok(bodyBytes(b) <= budget, `budget ${budget}: POST of ${bodyBytes(b)} bytes`);
  assert.deepEqual(rowsOf(batches.flat()), rowsOf(ws));
  assert.deepEqual(rowsOf(joinRawParts(batches.flat())), rowsOf(ws));
  assert.equal(joinRawParts(batches.flat()).length, 2);
}

// ── an event that cannot be split is refused, never truncated ───────────────
{
  const huge = { window_start: '2026-01-01T00:00:00.000Z', window_end: '2026-01-01T00:00:10.000Z', note: 'x'.repeat(30_000) };
  assert.throws(() => chunkWindowBatch([huge], { maxBytes: 16_384 }), /no raw rows to split/);
  assert.throws(() => chunkWindowBatch('nope'), TypeError);
}

// ── joinRawParts leaves everything else alone ────────────────────────────────
{
  const plain = { window_start: 'a', member_id: 'm' };
  const rawOnly = { modality: 'raw', raw_reason: 'stop', window_start: 'b', raw_streams: { s: { fields: ['ts_ms'], rows: [[1]] } } };
  const orphan = { modality: 'raw', raw_part: { id: 'x', index: 1, count: 2 }, raw_streams: { s: { fields: ['ts_ms'], rows: [[2]] } } };
  assert.deepEqual(joinRawParts([plain, rawOnly, orphan]), [plain, rawOnly, orphan], 'no index 0 → kept as is');
  // Differing field lists are unioned, missing cells null.
  const a = { raw_part: { id: 'y', index: 0, count: 2 }, raw_streams: { s: { fields: ['ts_ms', 'p'], rows: [[1, 10]] } } };
  const b = { modality: 'raw', raw_part: { id: 'y', index: 1, count: 2 }, raw_streams: { s: { fields: ['ts_ms', 'q'], rows: [[2, 20]] } } };
  const [j] = joinRawParts([b, a]);
  assert.deepEqual(j.raw_streams.s, { fields: ['ts_ms', 'p', 'q'], rows: [[1, 10, null], [2, null, 20]] });
}

// ── HttpEmotionTransport: several POSTs, each under the budget, in order ────
{
  const bodies = [];
  const transport = new HttpEmotionTransport({
    fetchImpl: async (url, init) => { bodies.push(init.body); return { ok: true, text: async () => '' }; },
  });
  const w = bigWindow();
  const result = await transport.send([w], { session_id: 's1' });
  assert.ok(bodies.length >= 2);
  assert.equal(result.batches, bodies.length);
  for (const body of bodies) assert.ok(utf8Bytes(body) <= 245_760, 'every POST fits Rohy’s 256 KiB parser');
  const received = bodies.flatMap(b => JSON.parse(b).events);
  assert.deepEqual(rowsOf(joinRawParts(received)), rowsOf([w]));

  // A failure part-way says how far it got (at-least-once on retry).
  let calls = 0;
  const failing = new HttpEmotionTransport({
    fetchImpl: async () => { calls += 1; return calls === 2 ? { ok: false, status: 500, text: async () => 'down' } : { ok: true, text: async () => '' }; },
  });
  await assert.rejects(failing.send([w], { session_id: 's1' }), (err) => err.sentBatches === 1 && err.totalBatches >= 2);
}

// ---------- deterministic part ids, the light subpath, raw_part shape ----------
{
  const w = bigWindow();
  const idsOf = (batches) => [...new Set(batches.flat().map((e) => e.raw_part?.id).filter(Boolean))];
  const first = idsOf(chunkWindowBatch([w]));
  const retry = idsOf(chunkWindowBatch([structuredClone(w)]));
  assert.equal(first.length, 1, 'one window, one part-group id');
  assert.deepEqual(retry, first, 'a retried send gives its parts the same id');
  assert.match(first[0], /^rp-[0-9a-f]{16}$/);
  assert.equal(first[0], rawPartId(w));
  // Another window (another span or person) gets another id.
  assert.notEqual(rawPartId(bigWindow(Date.UTC(2026, 0, 1, 0, 1))), first[0]);
  assert.notEqual(rawPartId({ ...w, user_id: 'someone-else' }), first[0]);
  // oyon/records carries the split side too (hosts that post windows themselves).
  assert.equal(records.chunkWindowBatch, chunkWindowBatch);
  assert.equal(records.rawPartId, rawPartId);
  assert.equal(root.rawPartId, rawPartId);
  // raw_part shape is checked; a well-formed part passes.
  const part = chunkWindowBatch([w]).flat().find((e) => e.raw_part?.index === 1);
  assert.deepEqual(validateEmotionEvent(part, 0).filter((e) => e.includes('raw_part')), []);
  const bad = (raw_part) => validateEmotionEvent({ ...part, raw_part }, 0).filter((e) => e.includes('raw_part'));
  assert.ok(bad({ id: '', index: 0, count: 1 }).length);
  assert.ok(bad({ id: 'x', index: 2, count: 2 }).length);
  assert.ok(bad({ id: 'x', index: -1, count: 2 }).length);
  assert.ok(bad({ id: 'x', index: 0, count: 0 }).length);
  assert.ok(bad('x').length);
}

console.log('post-chunking.test.js: ok');
