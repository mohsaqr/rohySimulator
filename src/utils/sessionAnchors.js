// Wall-clock anchoring for the session clock and the scenario timeline.
//
// PatientMonitor unmounts on every room switch (App.jsx renders it only in
// the chat room), so any state held as a plain counter dies with it. The
// session clock and the scenario timeline are therefore anchored to wall-
// clock timestamps: ticks *recompute* time from the anchor instead of
// incrementing, which makes remounts, page refreshes, and background-tab
// timer throttling all land on the same, correct time.
//
// The scenario anchor is persisted to localStorage keyed by sessionId so a
// refresh resumes the trajectory where it really is, not at t=0.

// SQLite stores DATETIME as 'YYYY-MM-DD HH:MM:SS' in UTC with no zone
// marker; JS would parse that as local time. Force UTC unless the string
// already carries a zone.
export const parseUtcTimestamp = (ts) => {
   if (!ts) return null;
   const s = String(ts);
   const iso = s.includes('T') ? s : s.replace(' ', 'T');
   const zoned = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
   const ms = Date.parse(zoned);
   return Number.isFinite(ms) ? ms : null;
};

export const SCENARIO_ANCHOR_KEY = 'rohy_scenario_anchor';

// Anchor shape: { sessionId, scenarioId, startMs, offsetSec, playing }.
// Returns the saved anchor only when it belongs to the given session.
export const readScenarioAnchor = (sessionId) => {
   try {
      const raw = localStorage.getItem(SCENARIO_ANCHOR_KEY);
      if (!raw) return null;
      const anchor = JSON.parse(raw);
      return anchor && sessionId != null && anchor.sessionId === sessionId ? anchor : null;
   } catch {
      return null;
   }
};

export const writeScenarioAnchor = (anchor) => {
   try {
      if (anchor) localStorage.setItem(SCENARIO_ANCHOR_KEY, JSON.stringify(anchor));
      else localStorage.removeItem(SCENARIO_ANCHOR_KEY);
   } catch { /* storage full/blocked — anchor just won't survive a refresh */ }
};

// Current position (seconds) of an anchored scenario. While playing, time
// flows from startMs; paused, it holds at offsetSec.
export const anchorSeconds = (anchor) =>
   anchor.playing ? anchor.offsetSec + (Date.now() - anchor.startMs) / 1000 : anchor.offsetSec;

export const PAUSE_ANCHOR_KEY = 'rohy_session_pause';

// Anchor shape: { sessionId, pausedAtMs, pausedTotalMs, resumeScenario }.
//
// ISSUE-0021: pause used to be a bare useState inside PatientMonitor, so a
// room switch unmounted it and the case came back running; and it gated only
// the waveform draw, so the case clock kept counting while the learner
// believed the case was frozen. Pause is session state, and it has to
// subtract from the clock, so it gets the same treatment as the scenario
// timeline: a wall-clock anchor persisted per session.
//
// `pausedAtMs` is the wall clock at which the learner paused, or null while
// running. `pausedTotalMs` is the time already spent paused earlier in the
// session. `resumeScenario` records that engaging this pause also froze a
// running scenario, so resuming puts the trajectory back in motion.
export const readPauseAnchor = (sessionId) => {
   try {
      const raw = localStorage.getItem(PAUSE_ANCHOR_KEY);
      if (!raw) return null;
      const anchor = JSON.parse(raw);
      return anchor && sessionId != null && anchor.sessionId === sessionId ? anchor : null;
   } catch {
      return null;
   }
};

export const writePauseAnchor = (anchor) => {
   try {
      if (anchor) localStorage.setItem(PAUSE_ANCHOR_KEY, JSON.stringify(anchor));
      else localStorage.removeItem(PAUSE_ANCHOR_KEY);
   } catch { /* storage full/blocked — pause just won't survive a refresh */ }
};

export const isAnchorPaused = (anchor) => !!anchor && anchor.pausedAtMs != null;

// Milliseconds this session has spent paused, counting the pause in progress.
// Pass the same `nowMs` used for the elapsed calculation so a paused clock
// reads as a constant rather than drifting by a millisecond a tick.
export const pausedMs = (anchor, nowMs = Date.now()) => {
   if (!anchor) return 0;
   const total = Number.isFinite(anchor.pausedTotalMs) ? anchor.pausedTotalMs : 0;
   if (anchor.pausedAtMs == null) return total;
   return total + Math.max(0, nowMs - anchor.pausedAtMs);
};

// The anchor that results from pressing pause/resume at `nowMs`. Resuming
// banks the pause that just ended into pausedTotalMs, so the subtraction is
// cumulative across however many times the learner pauses.
export const togglePauseAnchor = (anchor, sessionId, nowMs = Date.now(), resumeScenario = false) => {
   const base = anchor ?? { sessionId: sessionId ?? null, pausedAtMs: null, pausedTotalMs: 0 };
   if (base.pausedAtMs != null) {
      return { ...base, pausedAtMs: null, pausedTotalMs: pausedMs(base, nowMs), resumeScenario: false };
   }
   return { ...base, sessionId: base.sessionId ?? sessionId ?? null, pausedAtMs: nowMs, resumeScenario };
};
