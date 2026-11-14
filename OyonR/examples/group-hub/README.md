# Oyon group hub

A small Node server for a group session (docs/GROUP_SYNCHRONY_PLAN.md §2.1, §7). It does three jobs:

1. Serves the group clock that each member's `GroupSessionClock` syncs against.
2. Receives the members' window batches and keeps them in memory, one buffer per group.
3. Relays every window to the dashboards subscribed over WebSocket (`/group` in `standalone/app`). A new subscriber is first sent everything already buffered.

It uses only Node ≥ 20 built-ins and has no `npm install` step. The WebSocket server follows RFC 6455 and is written by hand.

## Run

```bash
node examples/group-hub/server.mjs                         # http://127.0.0.1:8787
node examples/group-hub/server.mjs --host 0.0.0.0 --port 8787   # reachable from the members' laptops
```

From code:

```js
import { createGroupHub } from './examples/group-hub/server.mjs';
const hub = createGroupHub({ port: 0, host: '127.0.0.1' });
const { url } = await hub.listen();
// …
await hub.close();
```

Nothing a member sent is ever evicted: every accepted window stays in its group and in the export. `max_replay_windows` (20 000 by default) bounds only how many of the newest windows a dashboard that subscribes is replayed over the WebSocket; the rest are in the export.

Without `data_dir` the session lives in memory, so export each group before you stop the hub. With `data_dir` (CLI `--data-dir <dir>` or `OYON_HUB_DATA_DIR`), every accepted window and marker is appended to `<dir>/<group_id>.ndjson` before it is acknowledged, and a hub started again on the same directory loads the groups back. A damaged line is skipped and counted as `corrupt_lines` on the roster.

## Endpoints

| Method | Path | Body / answer |
|---|---|---|
| GET | `/clock` | `{ ts_ms }`. CORS is open and the answer is `no-store`. |
| POST | `/groups/:group_id/windows` | `{ events: [...] }`, which is the `HttpEmotionTransport` body, or a bare array. The limit is 4 MB; a larger body is answered `413`. Every event needs a `member_id`. An event whose `group_id` names another group is answered `400`. The hub adds `hub_received_ms` to each event and changes no other field. A window with the same member, modality, track, start and split part (`raw_part`) as a stored one replaces it, so a retried batch is not counted twice; distinct records never replace each other. The answer is `{ accepted, duplicates, buffered, persisted }`. |
| GET | `/groups/:group_id/roster` | `{ group_id, n_windows, duplicates, persisted, corrupt_lines, subscribers, members: [...] }`, with one row per member: `member_id, seat, session_ids, n_windows, first_window_start, last_window_end, last_received_ms, clock_offset_ms, clock_rtt_ms, face_valid_share, last_face_valid, hr_snr`. |
| GET | `/groups/:group_id/export` | The replay bundle `{ schema_version: 'oyon-group-bundle-v1', group_id, exported_at, generator, markers, windows }` — every accepted window. The `/group` dashboard loads this file. |
| POST | `/groups/:group_id/marker` | `{ label? }` → `{ type: 'marker', group_id, marker_id, group_ms, label }`, also broadcast to every subscriber. This is the sync-marker fallback for when members cannot reach `/clock`. |
| WS | `/groups/:group_id/stream` | The server sends `{ type: 'hello', n_buffered, n_replayed }`, then the newest `max_replay_windows` windows as `{ type: 'windows', replay: true, events }` in chunks of 200, then the markers. After that it sends every new batch as `{ type: 'windows', replay: false, events }` and every marker as `{ type: 'marker', … }`. A client may also send `{ type: 'windows', events }`, which is answered `{ type: 'ack', … }`. Client frames must be masked, a protocol violation closes the connection with 1002, and binary frames are refused with 1003. The server sends a ping every 30 s. |

Errors are JSON `{ error, message? }`: `bad_json` (400), `bad_event` (400), `events_not_array` (400), `bad_group_id` (400), `payload_too_large` (413), `bad_url` (400, a path that cannot be decoded), `not_found` (404) and `method_not_allowed` (405).

## A member page

Each member runs Oyon with three additions. The group context keys go on every window, the clock points at the hub, and the transport posts to the hub:

```js
import { EmotionRuntime, HttpEmotionTransport, createOyonSettings } from 'oyon';

const HUB = 'http://192.168.1.20:8787';
const GROUP = 'G07';

const runtime = new EmotionRuntime({
  settings: createOyonSettings({
    group_clock_url: `${HUB}/clock`,          // NTP-style offset on join and every 60 s
    window_anchor_ms: Date.UTC(2026, 10, 13, 9, 0, 0), // the same value for every member, in group time
  }),
  // Context keys ride on every window: group_id and member_id are required, seat is optional.
  contextProvider: () => ({ session_id: `${GROUP}-m1`, group_id: GROUP, member_id: 'm1', seat: 'left' }),
  transport: new HttpEmotionTransport({
    baseUrl: HUB,
    endpointForSession: () => `/groups/${encodeURIComponent(GROUP)}/windows`,
  }),
});
```

Each window then carries `clock_offset_ms`, `clock_rtt_ms`, `window_anchor_ms` and `raw_streams`, which `groupTimeline()` (`oyon/group`) aligns on the group clock. `member_id` is an id the study assigns. Consent is handled outside the app.

**Without the clock endpoint** (for example, the members cannot reach the hub over HTTP): subscribe each member page to `/groups/:id/stream`. On every `{ type: 'marker', group_ms }`, call `runtime.groupClock.markSync({ group_ms })`, and have the facilitator `POST /groups/:id/marker` once at the start of the session.

## The dashboard

Open `standalone/app` at `/group`. Under **Live**, enter the hub URL (`http://…:8787`) and the group id. The page subscribes over WebSocket, collects the windows and recomputes on a throttle. Under **Replay**, load a file saved from `/groups/:id/export`.

## Test

`node tests/group-hub.test.js`, run on the ci VM (`mini-ci -- node tests/group-hub.test.js`). It covers the clock, POST and roster, a hand-written WebSocket client (handshake, replay, live relay, fragmented ingest, ping/pong, close, the unmasked-frame refusal), the export bundle, and the error paths (400, 413, 404, 405).

## Two-laptop alignment check (Phase 4)

`alignment-check.html` is the live test of the group clock: every laptop runs
the same NTP-style handshake as `GroupSessionClock`, then flashes its screen
for 100 ms at each whole group-time multiple of the period.

1. Start the hub on a machine both laptops can reach (`--host 0.0.0.0`).
2. Serve this folder (e.g. `npx serve examples/group-hub`) and open
   `alignment-check.html` on each laptop; enter the hub URL and press **Sync**.
3. Film both screens in one shot at ≥ 60 fps. Pass: every flash pair starts
   within 6 frames (100 ms).
4. Optional fallback check: `curl -X POST <hub>/groups/G1/marker` — each page
   logs the marker-based offset next to the handshake offset (Δ includes the
   relay latency, so it bounds the marker method's error, not the handshake's).

The handshake's own error is bounded by RTT / 2, which each page logs. This
check has not yet been run on real hardware.
