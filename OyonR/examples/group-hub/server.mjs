#!/usr/bin/env node
/**
 * Oyon group hub — the small server a group session needs (docs/GROUP_SYNCHRONY_PLAN.md §2.1, §7).
 *
 *   GET  /clock                          → { ts_ms }            group clock for GroupSessionClock
 *   POST /groups/:group_id/windows       ← { events: [...] }    members push window batches (≤ 4 MB)
 *   GET  /groups/:group_id/roster        → members seen, last window, clock offset/rtt, quality
 *   GET  /groups/:group_id/export        → { schema_version: 'oyon-group-bundle-v1', group_id, windows, markers }
 *   POST /groups/:group_id/marker        ← { label? }           broadcast a sync marker { group_ms }
 *   WS   /groups/:group_id/stream        dashboards subscribe (buffer replayed, then live);
 *                                        members may also send { type: 'windows', events } here
 *
 * Node ≥ 20 built-ins only. The WebSocket server is RFC 6455 by hand: handshake,
 * masked client frames, fragmentation, ping/pong, close.
 *
 * Nothing accepted is ever evicted: every window a member sent stays in the
 * group and in its export. `max_replay_windows` bounds only what a dashboard
 * that subscribes late is replayed over the WebSocket (the newest ones; the
 * rest are in the export). With `data_dir`, every accepted window is also
 * appended to `<data_dir>/<group_id>.ndjson` as it arrives, and a hub that
 * restarts on the same directory loads it back — so a crash loses nothing.
 * Without `data_dir` the session lives in memory: export before stopping.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUNDLE_SCHEMA = 'oyon-group-bundle-v1';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const GROUP_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REPLAY_CHUNK = 200;

/**
 * @param {object} [options]
 * @param {number} [options.port=8787]   0 picks a free port
 * @param {string} [options.host='127.0.0.1']
 * @param {number} [options.max_body_bytes=4194304]       POST bodies and WebSocket messages
 * @param {number} [options.max_replay_windows=20000]    newest windows replayed to a new subscriber (never a cap on what is kept)
 * @param {string} [options.data_dir]                     append every accepted window to <data_dir>/<group_id>.ndjson, and reload it on start
 * @param {number} [options.ping_interval_ms=30000]       server pings to keep subscribers alive
 * @param {() => number} [options.now=Date.now]           the group clock
 * @returns {{ server: http.Server, groups: Map<string, object>, listen: () => Promise<{host:string, port:number, url:string}>, close: () => Promise<void> }}
 */
export function createGroupHub({
  port = 8787,
  host = '127.0.0.1',
  max_body_bytes: maxBody = 4 * 1024 * 1024,
  max_replay_windows: maxReplay = 20000,
  data_dir: dataDir = null,
  ping_interval_ms: pingMs = 30000,
  now = Date.now,
} = {}) {
  const groups = new Map();
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const fileOf = id => path.join(dataDir, `${id}.ndjson`);
  const group = (id) => {
    if (!groups.has(id)) {
      const g = { id, windows: new Map(), markers: [], subscribers: new Set(), duplicates: 0, corrupt_lines: 0 };
      if (dataDir) load(g);
      groups.set(id, g);
    }
    return groups.get(id);
  };

  /** Reload a group's appended windows/markers (a later copy of a window replaces an earlier one). */
  function load(g) {
    let text;
    try { text = fs.readFileSync(fileOf(g.id), 'utf8'); } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { g.corrupt_lines += 1; continue; }
      if (rec?.type === 'marker') g.markers.push(rec);
      else if (rec && typeof rec === 'object' && typeof rec.member_id === 'string') {
        const key = windowKey(rec);
        g.windows.delete(key);
        g.windows.set(key, rec);
      } else g.corrupt_lines += 1;
    }
  }

  function persist(g, records) {
    if (!dataDir || !records.length) return;
    fs.appendFileSync(fileOf(g.id), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  }

  function ingest(g, events) {
    if (!Array.isArray(events)) return { error: 'events_not_array', message: 'body must be { events: [...] }' };
    const bad = events.findIndex(e => !e || typeof e !== 'object' || Array.isArray(e)
      || typeof e.member_id !== 'string' || !e.member_id
      || (e.group_id != null && e.group_id !== g.id));
    if (bad >= 0) {
      return { error: 'bad_event', message: `event ${bad} needs a member_id and, if it has a group_id, '${g.id}'` };
    }
    const received = now();
    const stamped = events.map(e => ({ ...e, group_id: g.id, hub_received_ms: received }));
    // Written to disk before it is acknowledged: an accepted window survives a crash.
    persist(g, stamped);
    let duplicates = 0;
    for (const e of stamped) {
      // A re-sent window (same member, modality, track, start and part)
      // replaces its earlier copy; distinct records never collide.
      const key = windowKey(e);
      if (g.windows.has(key)) { duplicates += 1; g.windows.delete(key); }
      g.windows.set(key, e);
    }
    g.duplicates += duplicates;
    broadcast(g, { type: 'windows', group_id: g.id, replay: false, events: stamped });
    return { accepted: stamped.length, duplicates, buffered: g.windows.size, persisted: Boolean(dataDir) };
  }

  function roster(g) {
    const byMember = new Map();
    for (const w of g.windows.values()) {
      if (!byMember.has(w.member_id)) byMember.set(w.member_id, []);
      byMember.get(w.member_id).push(w);
    }
    const members = [...byMember.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([member, list]) => {
      const last = list.reduce((a, b) => (String(b.window_end ?? '') > String(a.window_end ?? '') ? b : a));
      const valid = list.map(w => w.missing_face_ratio).filter(Number.isFinite).map(x => 1 - x);
      return {
        member_id: member,
        seat: list.find(w => w.seat != null)?.seat ?? null,
        session_ids: [...new Set(list.map(w => w.session_id).filter(Boolean))].join(','),
        n_windows: list.length,
        first_window_start: list.map(w => w.window_start).filter(Boolean).sort()[0] ?? null,
        last_window_end: last.window_end ?? null,
        last_received_ms: list.reduce((m, w) => Math.max(m, w.hub_received_ms), -Infinity),
        clock_offset_ms: Number.isFinite(last.clock_offset_ms) ? last.clock_offset_ms : null,
        clock_rtt_ms: Number.isFinite(last.clock_rtt_ms) ? last.clock_rtt_ms : null,
        face_valid_share: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
        last_face_valid: Number.isFinite(last.missing_face_ratio) ? 1 - last.missing_face_ratio : null,
        hr_snr: Number.isFinite(last.heart_rate?.snr_mean) ? last.heart_rate.snr_mean : null,
      };
    });
    return { group_id: g.id, hub_ms: now(), n_windows: g.windows.size, duplicates: g.duplicates, persisted: Boolean(dataDir), corrupt_lines: g.corrupt_lines, subscribers: g.subscribers.size, n_markers: g.markers.length, members };
  }

  const exportBundle = g => ({
    schema_version: BUNDLE_SCHEMA,
    group_id: g.id,
    exported_at: new Date(now()).toISOString(),
    generator: 'oyon-group-hub',
    markers: g.markers.slice(),
    windows: [...g.windows.values()],
  });

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const parsed = parseRequestPath(req.url);
    if (parsed.error) return send(res, 400, { error: 'bad_url', message: parsed.error });
    const { url, parts } = parsed;
    if (method === 'OPTIONS') return send(res, 204, null);
    try {
      if (url.pathname === '/clock' && method === 'GET') return send(res, 200, { ts_ms: now() });
      if (url.pathname === '/' && method === 'GET') {
        return send(res, 200, { hub: 'oyon-group-hub', groups: [...groups.keys()].sort(), endpoints: ['GET /clock', 'POST /groups/:id/windows', 'GET /groups/:id/roster', 'GET /groups/:id/export', 'POST /groups/:id/marker', 'WS /groups/:id/stream'] });
      }
      if (parts[0] !== 'groups' || parts.length !== 3) return send(res, 404, { error: 'not_found' });
      if (!GROUP_ID.test(parts[1])) return send(res, 400, { error: 'bad_group_id', message: 'group_id: 1–128 of A-Z a-z 0-9 . _ : -' });
      const g = group(parts[1]);
      const route = `${method} ${parts[2]}`;
      if (route === 'POST windows') {
        const body = await readJson(req, maxBody);
        if (body.status) return send(res, body.status, body.payload);
        const events = Array.isArray(body.value) ? body.value : body.value?.events;
        const out = ingest(g, events);
        return send(res, out.error ? 400 : 200, out);
      }
      if (route === 'POST marker') {
        const body = await readJson(req, maxBody, true);
        if (body.status) return send(res, body.status, body.payload);
        const marker = { type: 'marker', group_id: g.id, marker_id: `${g.id}-k${g.markers.length + 1}`, group_ms: now(), label: typeof body.value?.label === 'string' ? body.value.label : null };
        persist(g, [marker]);
        g.markers.push(marker);
        broadcast(g, marker);
        return send(res, 200, marker);
      }
      if (route === 'GET roster') return send(res, 200, roster(g));
      if (route === 'GET export') {
        res.setHeader('Content-Disposition', `attachment; filename="oyon-group-${g.id}.json"`);
        return send(res, 200, exportBundle(g));
      }
      if (['windows', 'marker', 'roster', 'export', 'stream'].includes(parts[2])) return send(res, 405, { error: 'method_not_allowed' });
      return send(res, 404, { error: 'not_found' });
    } catch (err) {
      return send(res, 500, { error: 'internal', message: err.message });
    }
  });

  // ── WebSocket ───────────────────────────────────────────────────────────────
  server.on('upgrade', (req, socket, head) => {
    const parsed = parseRequestPath(req.url);
    const parts = parsed.error ? [] : parsed.parts;
    const key = req.headers['sec-websocket-key'];
    if (parsed.error || parts[0] !== 'groups' || parts[2] !== 'stream' || parts.length !== 3 || !GROUP_ID.test(parts[1])
      || String(req.headers.upgrade).toLowerCase() !== 'websocket' || typeof key !== 'string') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
    socket.setNoDelay(true);
    const g = group(parts[1]);
    const client = { socket, buffer: Buffer.from(head ?? Buffer.alloc(0)), fragments: null, closed: false };
    g.subscribers.add(client);
    const drop = () => { client.closed = true; g.subscribers.delete(client); clearInterval(client.ping); };
    client.ping = setInterval(() => writeFrame(client, 0x9, Buffer.alloc(0)), pingMs);
    client.ping.unref?.();
    socket.on('close', drop);
    socket.on('error', drop);
    const pump = () => {
      for (;;) {
        const frame = parseFrame(client.buffer, maxBody);
        if (frame === null) return;
        if (frame.error) { closeClient(client, frame.code, frame.error); return; }
        client.buffer = client.buffer.subarray(frame.length);
        onFrame(g, client, frame);
        if (client.closed) return;
      }
    };
    socket.on('data', (chunk) => { client.buffer = Buffer.concat([client.buffer, chunk]); pump(); });
    // Replay the newest windows; everything is still in the group (and the export).
    const all = [...g.windows.values()];
    const events = all.length > maxReplay ? all.slice(all.length - maxReplay) : all;
    sendJson(client, { type: 'hello', group_id: g.id, hub_ms: now(), n_buffered: all.length, n_replayed: events.length, n_markers: g.markers.length });
    for (let i = 0; i < events.length; i += REPLAY_CHUNK) {
      sendJson(client, { type: 'windows', group_id: g.id, replay: true, events: events.slice(i, i + REPLAY_CHUNK) });
    }
    for (const m of g.markers) sendJson(client, { ...m, replay: true });
    if (client.buffer.length) pump();
  });

  function onFrame(g, client, { fin, opcode, payload }) {
    if (opcode === 0x8) { closeClient(client, payload.length >= 2 ? payload.readUInt16BE(0) : 1000, ''); return; }
    if (opcode === 0x9) { writeFrame(client, 0xA, payload); return; }
    if (opcode === 0xA) return;
    if (opcode === 0x2) { closeClient(client, 1003, 'binary frames not supported'); return; }
    if (opcode === 0x1) client.fragments = [payload];
    else if (opcode === 0x0 && client.fragments) client.fragments.push(payload);
    else { closeClient(client, 1002, 'unexpected frame'); return; }
    const size = client.fragments.reduce((s, b) => s + b.length, 0);
    if (size > maxBody) { closeClient(client, 1009, 'message too large'); return; }
    if (!fin) return;
    const text = Buffer.concat(client.fragments).toString('utf8');
    client.fragments = null;
    let msg;
    try { msg = JSON.parse(text); } catch { sendJson(client, { type: 'error', error: 'bad_json' }); return; }
    if (msg?.type === 'windows') {
      const out = ingest(g, msg.events);
      sendJson(client, out.error ? { type: 'error', ...out } : { type: 'ack', ...out });
    } else {
      sendJson(client, { type: 'error', error: 'unknown_type', message: "send { type: 'windows', events: [...] }" });
    }
  }

  function broadcast(g, message) {
    const data = Buffer.from(JSON.stringify(message));
    for (const c of g.subscribers) writeFrame(c, 0x1, data);
  }

  return {
    server,
    groups,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const addr = server.address();
        resolve({ host: addr.address, port: addr.port, url: `http://${addr.family === 'IPv6' ? `[${addr.address}]` : addr.address}:${addr.port}` });
      });
    }),
    close: () => new Promise((resolve) => {
      for (const g of groups.values()) for (const c of g.subscribers) closeClient(c, 1001, 'hub stopping');
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/** Path segments of a request URL, or `{ error }` for a URL that cannot be parsed or decoded. */
export function parseRequestPath(rawUrl) {
  try {
    const url = new URL(rawUrl ?? '/', 'http://hub');
    return { url, parts: url.pathname.split('/').filter(Boolean).map(decodeURIComponent) };
  } catch (err) {
    return { error: err instanceof URIError ? 'malformed percent-encoding in the path' : 'malformed URL' };
  }
}

/** Identity of a stored window: member, modality, track, start (or id) and split part. */
export function windowKey(e) {
  const part = e.raw_part && typeof e.raw_part === 'object' ? `${e.raw_part.id}#${e.raw_part.index}` : '';
  return [
    e.member_id,
    typeof e.modality === 'string' ? e.modality : 'emotion',
    e.track_id ?? '',
    e.window_start ?? e.window_id ?? e.hub_received_ms,
    e.raw_reason ?? '',
    part,
  ].join('|');
}

function send(res, status, payload) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    ...(payload === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
  });
  res.end(payload === null ? undefined : JSON.stringify(payload));
}

/** Read a JSON body up to `limit` bytes. An oversized body is drained, not stored, then answered 413. */
function readJson(req, limit, allowEmpty = false) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) over = true;
      if (!over) chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) return resolve({ status: 413, payload: { error: 'payload_too_large', limit_bytes: limit } });
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim() && allowEmpty) return resolve({ value: {} });
      try { resolve({ value: JSON.parse(text) }); } catch (err) {
        resolve({ status: 400, payload: { error: 'bad_json', message: err.message } });
      }
    });
    req.on('error', () => resolve({ status: 400, payload: { error: 'bad_request' } }));
  });
}

// ── RFC 6455 framing ──────────────────────────────────────────────────────────

/** One frame from the front of `buf`: null when incomplete, `{ error, code }` on a protocol violation. */
export function parseFrame(buf, maxPayload = Infinity) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return { error: 'frame too large', code: 1009 };
    len = Number(big); offset = 10;
  }
  if (!masked) return { error: 'client frames must be masked', code: 1002 };
  if (len > maxPayload) return { error: 'frame too large', code: 1009 };
  if (buf.length < offset + 4 + len) return null;
  const mask = buf.subarray(offset, offset + 4);
  const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + len));
  for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
  return { fin, opcode, payload, length: offset + 4 + len };
}

/** An unmasked server frame. */
export function encodeFrame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) { head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

function writeFrame(client, opcode, payload) {
  if (client.closed || client.socket.destroyed) return;
  client.socket.write(encodeFrame(opcode, payload));
}

function sendJson(client, message) {
  writeFrame(client, 0x1, Buffer.from(JSON.stringify(message)));
}

function closeClient(client, code, reason) {
  if (client.closed) return;
  const body = Buffer.alloc(2 + Buffer.byteLength(reason));
  body.writeUInt16BE(code, 0);
  body.write(reason, 2);
  writeFrame(client, 0x8, body);
  client.closed = true;
  clearInterval(client.ping);
  client.socket.end();
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const hub = createGroupHub({
    port: Number(arg('port') ?? process.env.PORT ?? 8787),
    host: arg('host') ?? process.env.HOST ?? '127.0.0.1',
    data_dir: arg('data-dir') ?? process.env.OYON_HUB_DATA_DIR ?? null,
  });
  hub.listen().then(({ url }) => {
    process.stdout.write(`oyon group hub on ${url}\n  clock: ${url}/clock\n  members POST ${url}/groups/<group_id>/windows\n  dashboard ws: ${url.replace(/^http/, 'ws')}/groups/<group_id>/stream\n`);
  });
  const stop = () => hub.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
