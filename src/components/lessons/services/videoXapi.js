/**
 * Video activity tracking modelled on the xAPI Video Profile, with NO external
 * dependency. Both lesson video kinds are tracked over their native event
 * surface and funnelled into our own `activityLogger` (the same batch pipeline
 * the rest of the app uses):
 *
 *   - {@link trackYouTubeEmbed}  — embedded YouTube videos, via the YouTube
 *     IFrame API (`YT.Player` state/rate events + a light poll for seeks).
 *   - {@link trackUploadedVideo} — uploaded HTML5 `<video>` files, via native
 *     media events.
 *
 * Both emit the same Video-Profile verb vocabulary (initialized / played /
 * paused / seeked / playback-rate-changed / completed / terminated / abandoned)
 * plus a coarse `progressed` heartbeat every 30s of real playback — preserving
 * the exact `activityLogger.log({ verb, … })` shape the analytics / TNA
 * pipeline already consumes.
 *
 * (Previously this wrapped the unmaintained `xapi-youtube` GitHub package, which
 * bundled ADL's 2016 xAPIWrapper. That dependency has been removed in favour of
 * driving the YouTube IFrame API directly.)
 */
import { activityLogger } from './activityLogger';

/** YouTube IFrame API player states (YT.PlayerState.*). */
const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2 };

// ---------------------------------------------------------------------------
// Context + verb vocabulary
// ---------------------------------------------------------------------------

/** Canonical xAPI Video-Profile verb IRIs (kept on the log row for provenance). */
const VERB_IRI = {
  initialized: 'http://adlnet.gov/expapi/verbs/initialized',
  played: 'https://w3id.org/xapi/video/verbs/played',
  paused: 'https://w3id.org/xapi/video/verbs/paused',
  seeked: 'https://w3id.org/xapi/video/verbs/seeked',
  playback_rate_changed: 'http://adlnet.gov/expapi/verbs/interacted',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  terminated: 'http://adlnet.gov/expapi/verbs/terminated',
  abandoned: 'https://w3id.org/xapi/adl/verbs/abandoned',
};

// The `verb` here is the xAPI Video Profile verb itself — surfaced directly in
// the activity log's Verb column. `progressed` is reserved for the periodic
// watch heartbeat (see emitTick), which is the "how far did they get" signal.
const VERB_META = {
  initialized:           { display: 'initialized',            actionSubtype: 'video.initialized',           verb: 'initialized' },
  played:                { display: 'played',                 actionSubtype: 'video.played',                verb: 'played' },
  paused:                { display: 'paused',                 actionSubtype: 'video.paused',                verb: 'paused' },
  seeked:                { display: 'seeked',                 actionSubtype: 'video.seeked',                verb: 'seeked' },
  playback_rate_changed: { display: 'playback-rate-changed',  actionSubtype: 'video.playback_rate_changed', verb: 'playback-rate-changed' },
  completed:             { display: 'completed',              actionSubtype: 'video.completed',             verb: 'completed' },
  abandoned:             { display: 'abandoned',              actionSubtype: 'video.abandoned',             verb: 'abandoned' },
  terminated:            { display: 'terminated',             actionSubtype: 'video.terminated',            verb: 'terminated' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emit = (key, ctx, data = {}) => {
  const meta = VERB_META[key];
  activityLogger.log({
    verb: meta.verb,
    objectType: 'video',
    objectId: ctx.sectionId,
    objectTitle: ctx.title,
    courseId: ctx.courseId,
    lectureId: ctx.lectureId,
    sectionId: ctx.sectionId,
    duration: data.duration,
    progress: data.progress,
    success: key === 'completed' ? true : undefined,
    actionSubtype: meta.actionSubtype,
    extensions: {
      xapiVerb: VERB_IRI[key],
      xapiVerbDisplay: meta.display,
      mode: ctx.mode,
      src: ctx.src,
      position: data.position,
      videoLength: data.videoLength,
      playbackRate: data.speed,
      completion: data.completion,
    },
  });
};

/** Coarse progress heartbeat — preserves the original `video.watch_tick`. */
const emitTick = (ctx, data) => {
  activityLogger.log({
    verb: 'progressed',
    objectType: 'video',
    objectId: ctx.sectionId,
    objectTitle: ctx.title,
    courseId: ctx.courseId,
    lectureId: ctx.lectureId,
    sectionId: ctx.sectionId,
    duration: data.duration,
    progress: data.progress,
    actionSubtype: 'video.watch_tick',
    extensions: { mode: ctx.mode, src: ctx.src, position: data.position, videoLength: data.videoLength },
  });
};

/** True when this embed URL is a YouTube embed the IFrame API can drive. */
export const isYouTubeEmbed = (src) =>
  /(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//.test(src);

/** Ensure a YouTube embed URL carries `enablejsapi=1` so the IFrame API can
 *  attach to the already-rendered iframe. */
export const withJsApi = (src) => {
  if (!isYouTubeEmbed(src) || /[?&]enablejsapi=1\b/.test(src)) return src;
  return src + (src.includes('?') ? '&' : '?') + 'enablejsapi=1';
};

const WATCH_TICK_MS = 30000;
/** YouTube has no native "seeked" event; a poll flags a playhead jump larger
 *  than playback could account for between samples as a seek. */
const SEEK_POLL_MS = 500;
const SEEK_THRESHOLD_S = 2;

// ---------------------------------------------------------------------------
// YouTube IFrame API loader (shared, loaded at most once)
// ---------------------------------------------------------------------------

let ytApiPromise = null;
const loadYouTubeApi = () => {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise(resolve => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT ?? null);
    };
    if (!document.querySelector('script[data-yt-iframe-api]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.dataset.ytIframeApi = '1';
      document.head.appendChild(s);
    }
  });
  return ytApiPromise;
};

// ---------------------------------------------------------------------------
// Shared watch-time accounting (wall-clock seconds actually spent playing).
// ---------------------------------------------------------------------------

const makeWatchClock = () => {
  let watchedMs = 0;
  let lastPlayStart = null;
  return {
    /** Mark playback as started/resumed now. */
    start() {
      if (lastPlayStart == null) lastPlayStart = Date.now();
    },
    /** Fold the in-flight interval into the total and stop the clock. */
    accrue() {
      if (lastPlayStart != null) {
        watchedMs += Date.now() - lastPlayStart;
        lastPlayStart = null;
      }
    },
    /** Total watched seconds, including any in-flight interval. */
    seconds() {
      return Math.round((watchedMs + (lastPlayStart != null ? Date.now() - lastPlayStart : 0)) / 1000);
    },
  };
};

// ---------------------------------------------------------------------------
// Public: embedded YouTube videos (YouTube IFrame API, no external deps)
// ---------------------------------------------------------------------------

export function trackYouTubeEmbed(iframe, ctx) {
  let disposed = false;
  let player = null;
  let started = false;
  let completed = false;
  let poll = null;

  const clock = makeWatchClock();

  // Seek detection / heartbeat bookkeeping, advanced by the poll.
  let expectedPos = 0;      // where the playhead should be if no one seeked
  let lastSampleWall = Date.now();
  let sincePlayTickMs = 0;  // real playing time accumulated toward a watch tick

  const currentPosition = () =>
    player ? Math.round(player.getCurrentTime()) : undefined;
  const totalLength = () => {
    const d = player?.getDuration();
    return d && Number.isFinite(d) ? Math.round(d) : undefined;
  };
  const progressPct = (pos) => {
    const d = player?.getDuration();
    if (!d || pos == null) return undefined;
    return Math.min(100, Math.round((pos / d) * 100));
  };
  const playbackRate = () => {
    const r = player?.getPlaybackRate();
    return typeof r === 'number' && Number.isFinite(r) ? r : undefined;
  };

  const fire = (key, extra = {}) => {
    const position = extra.position ?? currentPosition();
    emit(key, ctx, {
      position,
      duration: clock.seconds(),
      videoLength: totalLength(),
      progress: key === 'completed' ? 100 : progressPct(position),
      ...extra,
    });
  };

  const syncBaseline = () => {
    expectedPos = player ? player.getCurrentTime() : 0;
    lastSampleWall = Date.now();
  };

  const onState = (state) => {
    if (state === YT_STATE.PLAYING) {
      started = true;
      clock.start();
      syncBaseline();
      fire('played');
    } else if (state === YT_STATE.PAUSED) {
      if (completed) return;
      clock.accrue();
      fire('paused');
    } else if (state === YT_STATE.ENDED) {
      clock.accrue();
      completed = true;
      fire('completed', { progress: 100, completion: true });
    }
  };

  const onExit = () => {
    if (!started) return;
    clock.accrue();
    fire(completed ? 'terminated' : 'abandoned');
  };
  window.addEventListener('beforeunload', onExit);

  loadYouTubeApi().then(YT => {
    if (disposed || !YT) return;
    player = new YT.Player(iframe, {
      events: {
        onReady: () => {
          fire('initialized', { position: 0, duration: 0 });
          poll = setInterval(() => {
            if (!player || player.getPlayerState() !== YT_STATE.PLAYING) return;
            const now = Date.now();
            const cur = player.getCurrentTime();
            const rate = player.getPlaybackRate?.() || 1;
            const expected = expectedPos + ((now - lastSampleWall) / 1000) * rate;
            if (Math.abs(cur - expected) > SEEK_THRESHOLD_S) {
              fire('seeked', { position: Math.round(cur) });
            }
            // Watch-tick heartbeat: ~30s of real playing time.
            sincePlayTickMs += now - lastSampleWall;
            if (sincePlayTickMs >= WATCH_TICK_MS) {
              sincePlayTickMs = 0;
              emitTick(ctx, {
                position: Math.round(cur),
                duration: clock.seconds(),
                videoLength: totalLength(),
                progress: progressPct(Math.round(cur)),
              });
            }
            expectedPos = cur;
            lastSampleWall = now;
          }, SEEK_POLL_MS);
        },
        onStateChange: event => onState(event.data),
        onPlaybackRateChange: event => {
          // YouTube passes the new rate as `data`; fall back to a getter.
          const speed = typeof event.data === 'number' ? event.data : playbackRate();
          fire('playback_rate_changed', { speed, progress: undefined });
        },
      },
    });
  });

  return () => {
    disposed = true;
    if (poll) clearInterval(poll);
    window.removeEventListener('beforeunload', onExit);
    onExit(); // SPA navigation away counts as abandoned/terminated too.
    try {
      player?.destroy();
    } catch {
      /* iframe may already be gone */
    }
  };
}

// ---------------------------------------------------------------------------
// Public: uploaded HTML5 <video> (Video Profile reproduced over native events)
// ---------------------------------------------------------------------------

export function trackUploadedVideo(el, ctx) {
  let started = false;
  let completed = false;
  let initialized = false;

  const clock = makeWatchClock();

  const videoLength = () =>
    Number.isFinite(el.duration) ? Math.round(el.duration) : undefined;
  const position = () => Math.round(el.currentTime);
  const progress = () =>
    el.duration ? Math.min(100, Math.round((el.currentTime / el.duration) * 100)) : undefined;

  const onLoadedMetadata = () => {
    if (initialized) return;
    initialized = true;
    emit('initialized', ctx, { duration: 0, videoLength: videoLength() });
  };
  const onPlay = () => {
    started = true;
    clock.start();
    emit('played', ctx, { position: position(), duration: clock.seconds(), videoLength: videoLength(), progress: progress() });
  };
  const onPause = () => {
    // Native `pause` also fires while seeking and right before `ended`; the
    // Video Profile treats those separately, so suppress them here.
    if (el.ended || el.seeking) return;
    clock.accrue();
    emit('paused', ctx, { position: position(), duration: clock.seconds(), videoLength: videoLength(), progress: progress() });
  };
  const onSeeked = () => {
    emit('seeked', ctx, { position: position(), duration: clock.seconds(), videoLength: videoLength(), progress: progress() });
  };
  const onRateChange = () => {
    emit('playback_rate_changed', ctx, { position: position(), duration: clock.seconds(), speed: el.playbackRate });
  };
  const onEnded = () => {
    clock.accrue();
    completed = true;
    emit('completed', ctx, { position: position(), duration: clock.seconds(), videoLength: videoLength(), progress: 100, completion: true });
  };
  const onExit = () => {
    if (!started) return;
    clock.accrue();
    emit(completed ? 'terminated' : 'abandoned', ctx, {
      position: position(),
      duration: clock.seconds(),
      videoLength: videoLength(),
      progress: progress(),
    });
  };

  const tick = setInterval(() => {
    if (!el.paused && !el.ended) {
      emitTick(ctx, { position: position(), duration: clock.seconds(), videoLength: videoLength(), progress: progress() });
    }
  }, WATCH_TICK_MS);

  el.addEventListener('loadedmetadata', onLoadedMetadata);
  el.addEventListener('play', onPlay);
  el.addEventListener('pause', onPause);
  el.addEventListener('seeked', onSeeked);
  el.addEventListener('ratechange', onRateChange);
  el.addEventListener('ended', onEnded);
  window.addEventListener('beforeunload', onExit);

  // If metadata is already available (fast cache), fire initialized now.
  if (el.readyState >= 1) onLoadedMetadata();

  return () => {
    clearInterval(tick);
    el.removeEventListener('loadedmetadata', onLoadedMetadata);
    el.removeEventListener('play', onPlay);
    el.removeEventListener('pause', onPause);
    el.removeEventListener('seeked', onSeeked);
    el.removeEventListener('ratechange', onRateChange);
    el.removeEventListener('ended', onEnded);
    window.removeEventListener('beforeunload', onExit);
    onExit(); // SPA navigation away counts as abandoned/terminated too.
  };
}
