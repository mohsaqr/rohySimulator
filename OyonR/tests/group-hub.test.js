// examples/group-hub/server.mjs — clock, window ingest, roster, export, marker,
// and the hand-rolled RFC 6455 relay, driven by a hand-rolled WebSocket client.
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGroupHub, parseFrame, encodeFrame, BUNDLE_SCHEMA, parseRequestPath, windowKey } from '../examples/group-hub/server.mjs';

let clock = 1_800_000_000_000;
const hub = createGroupHub({ port: 0, host: '127.0.0.1', max_body_bytes: 64 * 1024, now: () => clock });
const { url, port } = await hub.listen();

const win = (member, k, extra = {}) => ({
  window_id: `G1-${member}-w${k}`,
  session_id: `G1-${member}`,
  group_id: 'G1',
  member_id: member,
  seat: member === 'm1' ? 'left' : 'right',
  window_start: new Date(Date.UTC(2026, 0, 1, 0, 0, k * 10)).toISOString(),
  window_end: new Date(Date.UTC(2026, 0, 1, 0, 0, k * 10 + 10)).toISOString(),
  clock_offset_ms: member === 'm1' ? 12 : -30,
  clock_rtt_ms: 40,
  missing_face_ratio: 0.25,
  ...extra,
});
const post = (path, body, raw = false) => fetch(`${url}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? body : JSON.stringify(body),
});

// ── frame codec ─────────────────────────────────────────────────────────────
function clientFrame(opcode, payload, { fin = true, mask = true } = {}) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = (fin ? 0x80 : 0) | opcode;
  if (len < 126) head[1] = len; else if (len < 65536) { head[1] = 126; head.writeUInt16BE(len, 2); } else { head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  if (!mask) return Buffer.concat([head, payload]);
  head[1] |= 0x80;
  const key = crypto.randomBytes(4);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i += 1) body[i] ^= key[i & 3];
  return Buffer.concat([head, key, body]);
}
{
  const f = parseFrame(clientFrame(0x1, Buffer.from('héllo')));
  assert.equal(f.opcode, 1); assert.equal(f.fin, true); assert.equal(f.payload.toString(), 'héllo');
  assert.equal(parseFrame(clientFrame(0x1, Buffer.from('x')).subarray(0, 3)), null, 'incomplete frame waits');
  assert.equal(parseFrame(clientFrame(0x1, Buffer.from('x'), { mask: false })).code, 1002, 'unmasked client frame is a protocol error');
  const big = Buffer.alloc(70000, 97);
  assert.equal(parseFrame(clientFrame(0x1, big)).payload.length, 70000, '64-bit length');
  const enc = encodeFrame(0x1, Buffer.alloc(300, 98));
  assert.equal(enc[1], 126); assert.equal(enc.readUInt16BE(2), 300);
}

/** Minimal WebSocket client: handshake, masked sends, unmasked server frames → parsed JSON messages. */
function wsConnect(path) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: '127.0.0.1', port, path, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    req.on('response', r => reject(new Error(`no upgrade: ${r.statusCode}`)));
    req.on('error', reject);
    req.on('upgrade', (res, socket, head) => {
      const expected = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      assert.equal(res.headers['sec-websocket-accept'], expected, 'Sec-WebSocket-Accept per RFC 6455 §4.2.2');
      let buf = Buffer.from(head);
      const messages = []; const control = []; const waiters = [];
      const flush = () => {
        for (;;) {
          if (buf.length < 2) break;
          let len = buf[1] & 0x7f; let off = 2;
          if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          assert.equal(buf[1] & 0x80, 0, 'server frames are never masked');
          if (buf.length < off + len) break;
          const opcode = buf[0] & 0x0f; const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (opcode === 0x1) messages.push(JSON.parse(payload.toString('utf8'))); else control.push({ opcode, payload: Buffer.from(payload) });
        }
        for (const w of waiters.splice(0)) w();
      };
      socket.on('data', (c) => { buf = Buffer.concat([buf, c]); flush(); });
      flush();
      const until = (pred, label) => new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error(`timeout waiting for ${label}`)), 3000);
        const check = () => { if (pred()) { clearTimeout(t); ok(); } else waiters.push(check); };
        check();
      });
      resolve({ socket, messages, control, until, send: (obj) => socket.write(clientFrame(0x1, Buffer.from(JSON.stringify(obj)))), raw: b => socket.write(b) });
    });
    req.end();
  });
}

try {
  // ── clock ──────────────────────────────────────────────────────────────────
  const c = await fetch(`${url}/clock`);
  assert.equal(c.status, 200);
  assert.deepEqual(await c.json(), { ts_ms: clock });
  assert.equal(c.headers.get('access-control-allow-origin'), '*');
  assert.equal(c.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${url}/clock`, { method: 'OPTIONS' })).status, 204, 'CORS preflight');

  // ── POST + roster ──────────────────────────────────────────────────────────
  let r = await post('/groups/G1/windows', { events: [win('m1', 0), win('m1', 1), win('m2', 0, { heart_rate: { snr_mean: 6.5 } })] });
  assert.equal(r.status, 200);
  let body = await r.json();
  assert.deepEqual(body, { accepted: 3, duplicates: 0, buffered: 3, persisted: false });
  r = await post('/groups/G1/windows', { events: [win('m1', 1, { missing_face_ratio: 0 })] });
  body = await r.json();
  assert.equal(body.duplicates, 1, 'same member + window_start replaces, not appends');
  assert.equal(body.buffered, 3);

  const roster = await (await fetch(`${url}/groups/G1/roster`)).json();
  assert.equal(roster.group_id, 'G1');
  assert.equal(roster.n_windows, 3);
  assert.deepEqual(roster.members.map(m => m.member_id), ['m1', 'm2']);
  const m1 = roster.members[0];
  assert.equal(m1.n_windows, 2);
  assert.equal(m1.seat, 'left');
  assert.equal(m1.clock_offset_ms, 12);
  assert.equal(m1.clock_rtt_ms, 40);
  assert.equal(m1.face_valid_share, (0.75 + 1) / 2);
  assert.equal(m1.last_window_end, win('m1', 1).window_end);
  assert.equal(roster.members[1].hr_snr, 6.5);

  // ── errors ─────────────────────────────────────────────────────────────────
  r = await post('/groups/G1/windows', '{"events": [', true);
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'bad_json');
  r = await post('/groups/G1/windows', { events: [{ group_id: 'G1' }] });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'bad_event', 'member_id is required');
  r = await post('/groups/G1/windows', { events: [win('m1', 5, { group_id: 'OTHER' })] });
  assert.equal(r.status, 400, 'a window of another group is refused, not silently re-labelled');
  r = await post('/groups/G1/windows', { nope: 1 });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'events_not_array');
  r = await post('/groups/G1/windows', { events: [win('m1', 9, { pad: 'x'.repeat(70 * 1024) })] });
  assert.equal(r.status, 413); assert.equal((await r.json()).error, 'payload_too_large');
  assert.equal((await fetch(`${url}/groups/bad%20id/roster`)).status, 400);
  assert.equal((await fetch(`${url}/nope`)).status, 404);
  assert.equal((await fetch(`${url}/groups/G1/windows`)).status, 405);

  // ── WebSocket: replay on subscribe, relay, ingest over WS, ping, marker ────
  const ws = await wsConnect('/groups/G1/stream');
  await ws.until(() => ws.messages.filter(m => m.type === 'windows').length >= 1, 'replay');
  assert.equal(ws.messages[0].type, 'hello');
  assert.equal(ws.messages[0].n_buffered, 3);
  const replay = ws.messages.filter(m => m.type === 'windows' && m.replay);
  assert.equal(replay.flatMap(m => m.events).length, 3, 'buffer replayed on subscribe');

  clock += 1000;
  await post('/groups/G1/windows', { events: [win('m2', 1)] });
  await ws.until(() => ws.messages.some(m => m.type === 'windows' && !m.replay), 'relay');
  const live = ws.messages.find(m => m.type === 'windows' && !m.replay);
  assert.equal(live.events.length, 1);
  assert.equal(live.events[0].window_id, 'G1-m2-w1');
  assert.equal(live.events[0].hub_received_ms, clock, 'hub stamps receipt time beside, never over, the member stamps');

  // A member pushes over the socket, fragmented across two frames.
  const text = Buffer.from(JSON.stringify({ type: 'windows', events: [win('m3', 0)] }));
  ws.raw(clientFrame(0x1, text.subarray(0, 10), { fin: false }));
  ws.raw(clientFrame(0x0, text.subarray(10)));
  await ws.until(() => ws.messages.some(m => m.type === 'ack'), 'ack');
  assert.equal(ws.messages.find(m => m.type === 'ack').accepted, 1);

  ws.raw(clientFrame(0x9, Buffer.from('pp')));
  await ws.until(() => ws.control.some(f => f.opcode === 0xA), 'pong');
  assert.equal(ws.control.find(f => f.opcode === 0xA).payload.toString(), 'pp');

  r = await post('/groups/G1/marker', { label: 'flash' });
  const marker = await r.json();
  assert.equal(marker.group_ms, clock);
  assert.equal(marker.label, 'flash');
  await ws.until(() => ws.messages.some(m => m.type === 'marker'), 'marker');

  // ── export ─────────────────────────────────────────────────────────────────
  const ex = await fetch(`${url}/groups/G1/export`);
  assert.match(ex.headers.get('content-disposition'), /oyon-group-G1\.json/);
  const bundle = await ex.json();
  assert.equal(bundle.schema_version, BUNDLE_SCHEMA);
  assert.equal(bundle.schema_version, 'oyon-group-bundle-v1');
  assert.equal(bundle.group_id, 'G1');
  assert.equal(bundle.windows.length, 5);
  assert.ok(bundle.windows.every(w => w.group_id === 'G1' && typeof w.member_id === 'string'));
  assert.equal(bundle.markers.length, 1);

  // Close handshake: the server echoes a close frame.
  ws.raw(clientFrame(0x8, Buffer.from([0x03, 0xe8])));
  await ws.until(() => ws.control.some(f => f.opcode === 0x8), 'close echo');
  ws.socket.destroy();

  // A second subscriber sending an unmasked frame is closed with 1002.
  const bad = await wsConnect('/groups/G1/stream');
  bad.raw(clientFrame(0x1, Buffer.from('{}'), { mask: false }));
  await bad.until(() => bad.control.some(f => f.opcode === 0x8), 'protocol close');
  assert.equal(bad.control.find(f => f.opcode === 0x8).payload.readUInt16BE(0), 1002);
  bad.socket.destroy();

  // Wrong upgrade path is refused.
  await assert.rejects(wsConnect('/groups/G1/roster'));
} finally {
  await hub.close();
}
// ── Codex #5: a malformed URL is a 400, never a crash ────────────────────────
{
  assert.ok(parseRequestPath('/groups/%/roster').error, 'bad percent-encoding is reported');
  assert.deepEqual(parseRequestPath('/groups/G1/roster').parts, ['groups', 'G1', 'roster']);
  const h = createGroupHub({ port: 0, now: () => clock });
  const { url: u, port: p } = await h.listen();
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: p, path: '/groups/%/roster' }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 400, 'request handler answers 400');
    const upgrade = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: p, path: '/groups/%E0%A4%A/stream', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13' } });
      req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
      req.on('upgrade', () => reject(new Error('malformed path was upgraded')));
      req.on('error', reject);
      req.end();
    });
    assert.equal(upgrade, 400, 'upgrade handler answers 400');
    assert.equal((await fetch(`${u}/clock`)).status, 200, 'the hub is still up');
  } finally {
    await h.close();
  }
}

// ── Codex #6: nothing accepted is evicted; only the replay is bounded ───────
{
  const h = createGroupHub({ port: 0, max_replay_windows: 2, now: () => clock });
  const { url: u } = await h.listen();
  try {
    const r = await fetch(`${u}/groups/G2/windows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [0, 1, 2].map(k => win('m1', k, { group_id: 'G2' })) }) });
    assert.equal((await r.json()).buffered, 3);
    const bundle = await (await fetch(`${u}/groups/G2/export`)).json();
    assert.deepEqual(bundle.windows.map(w => w.window_id), ['G1-m1-w0', 'G1-m1-w1', 'G1-m1-w2'], 'all three accepted windows are exported');
    assert.equal('dropped' in bundle, false);
  } finally {
    await h.close();
  }
}

// ── data_dir: every accepted window and marker is on disk and reloads ───────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oyon-hub-'));
  try {
    const h1 = createGroupHub({ port: 0, data_dir: dir, now: () => clock });
    const { url: u1 } = await h1.listen();
    await fetch(`${u1}/groups/G3/windows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [win('m1', 0, { group_id: 'G3' }), win('m2', 0, { group_id: 'G3' })] }) });
    await fetch(`${u1}/groups/G3/marker`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"label":"go"}' });
    await h1.close();
    fs.appendFileSync(path.join(dir, 'G3.ndjson'), '{not json\n');
    const h2 = createGroupHub({ port: 0, data_dir: dir, now: () => clock });
    const { url: u2 } = await h2.listen();
    const bundle = await (await fetch(`${u2}/groups/G3/export`)).json();
    assert.equal(bundle.windows.length, 2, 'windows reloaded after a restart');
    assert.equal(bundle.markers.length, 1, 'markers reloaded');
    const roster = await (await fetch(`${u2}/groups/G3/roster`)).json();
    assert.equal(roster.corrupt_lines, 1, 'a damaged line is counted, not fatal');
    assert.equal(roster.persisted, true);
    await h2.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── the window key keeps distinct records apart (split parts, modalities) ───
{
  const base = { member_id: 'm1', window_start: '2026-01-01T00:00:00.000Z' };
  const keys = new Set([
    windowKey(base),
    windowKey({ ...base, modality: 'typing' }),
    windowKey({ ...base, raw_part: { id: 'rp', index: 0, count: 2 } }),
    windowKey({ ...base, modality: 'raw', raw_reason: 'continuation', raw_part: { id: 'rp', index: 1, count: 2 } }),
    windowKey({ ...base, track_id: 't2' }),
  ]);
  assert.equal(keys.size, 5);
  assert.equal(windowKey(base), windowKey({ ...base }), 'a re-sent window has the same key');
}

console.log('group-hub.test.js: ok');
