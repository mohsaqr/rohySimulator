// GroupSessionClock: NTP-style offset estimation, marker fallback, failure
// handling (keep the old offset, report the error), resync timer.
import assert from 'node:assert/strict';
import { GroupSessionClock, estimateClockOffset, httpClockSource } from '../src/core/GroupSessionClock.js';

// ---------- estimateClockOffset: hand-computed ----------
{
  // Server is 1000 ms ahead. Probe A: t0=0, symmetric 40 ms trip → ts = 1020, t1 = 40
  //   offset = 1020 − (0 + 40)/2 = 1000, rtt 40.
  // Probe B: slow asymmetric trip, t0=100, ts=1190, t1=300 → offset = 1190 − 200 = 990, rtt 200.
  const best = estimateClockOffset([
    { t0: 100, ts: 1190, t1: 300 },
    { t0: 0, ts: 1020, t1: 40 },
  ]);
  assert.deepEqual(best, { offset_ms: 1000, rtt_ms: 40, n: 2 });
  // Negative RTT and non-finite samples are ignored, not trusted.
  assert.deepEqual(estimateClockOffset([{ t0: 10, ts: 5, t1: 0 }, { t0: NaN, ts: 1, t1: 2 }]), null);
  assert.equal(estimateClockOffset(null), null);
}

// ---------- sync(): minimum-RTT probe wins; stamps convert both ways ----------
{
  let local = 10_000;
  const trueOffset = 2_500; // server = local + 2500
  const delays = [[30, 30], [5, 5], [100, 10]]; // [out, back] per probe
  let probe = 0;
  const clock = new GroupSessionClock({
    probes: 3,
    now: () => local,
    getServerTime: async () => {
      const [out, back] = delays[probe++];
      local += out;
      const ts = local + trueOffset;
      local += back;
      return ts;
    },
  });
  assert.equal(clock.synced, false);
  assert.equal(clock.toGroupTime(1), null);
  const snap = await clock.sync();
  // Probe 2 (5/5 ms, symmetric) has the smallest RTT and recovers the offset exactly.
  assert.equal(snap.clock_offset_ms, trueOffset);
  assert.equal(snap.clock_rtt_ms, 10);
  assert.equal(snap.clock_source, 'handshake');
  assert.equal(clock.toGroupTime(1_000), 3_500);
  assert.equal(clock.toLocalTime(3_500), 1_000);
}

// ---------- invariant: estimate error is bounded by RTT/2 for any asymmetric split ----------
{
  for (const [out, back] of [[0, 80], [80, 0], [13, 67], [40, 40]]) {
    const t0 = 5_000; const offset = -1_234;
    const ts = t0 + out + offset; const t1 = t0 + out + back;
    const est = estimateClockOffset([{ t0, ts, t1 }]);
    assert.ok(Math.abs(est.offset_ms - offset) <= est.rtt_ms / 2 + 1e-9, `error bound violated for ${out}/${back}`);
  }
}

// ---------- failure keeps the previous offset and is reported ----------
{
  let fail = false;
  const errors = [];
  const clock = new GroupSessionClock({
    probes: 1,
    now: () => 0,
    getServerTime: async () => { if (fail) throw new Error('hub down'); return 700; },
    onError: (e) => errors.push(e.message),
  });
  await clock.sync();
  assert.equal(clock.offsetMs, 700);
  fail = true;
  const snap = await clock.sync();
  assert.equal(snap.clock_offset_ms, 700, 'a failed sync must not discard the last good offset');
  assert.equal(snap.clock_sync_failures, 1);
  assert.deepEqual(errors, ['hub down']);
  assert.equal(clock.lastError, 'hub down');
}

// ---------- marker fallback ----------
{
  const clock = new GroupSessionClock({ now: () => 50_000 });
  await assert.rejects(() => clock.sync(), /no getServerTime/);
  const snap = clock.markSync({ group_ms: 49_200 });
  assert.equal(snap.clock_offset_ms, -800);
  assert.equal(snap.clock_rtt_ms, null);
  assert.equal(snap.clock_source, 'marker');
  assert.throws(() => clock.markSync({ group_ms: 'x' }), TypeError);
}

// ---------- start/stop drive the resync timer ----------
{
  const timers = { set: [], cleared: [] };
  let calls = 0;
  const clock = new GroupSessionClock({
    probes: 1,
    resyncMs: 30_000,
    now: () => 0,
    getServerTime: async () => { calls += 1; return 10; },
    timers: {
      setInterval: (fn, ms) => { timers.set.push({ fn, ms }); return 'h1'; },
      clearInterval: (h) => timers.cleared.push(h),
    },
  });
  await clock.start();
  await clock.start(); // idempotent: no second timer, no extra sync
  assert.equal(calls, 1);
  assert.equal(timers.set.length, 1);
  assert.equal(timers.set[0].ms, 30_000);
  await timers.set[0].fn();
  assert.equal(calls, 2);
  clock.stop();
  assert.deepEqual(timers.cleared, ['h1']);
}

// ---------- httpClockSource ----------
{
  const source = httpClockSource('http://hub/clock', async () => ({ ok: true, json: async () => ({ ts_ms: 123 }) }));
  assert.equal(await source(), 123);
  const bad = httpClockSource('http://hub/clock', async () => ({ ok: true, json: async () => ({}) }));
  await assert.rejects(bad, /no numeric ts_ms/);
  const down = httpClockSource('http://hub/clock', async () => ({ ok: false, status: 503 }));
  await assert.rejects(down, /503/);
  assert.throws(() => httpClockSource(''), TypeError);
}

console.log('group-clock.test.js passed');
