// macOS with Continuity Camera enabled lists a paired iPhone as a videoinput
// alongside the MacBook camera. A default {facingMode:'user'} or {video:true}
// constraint can route to the iPhone even when it isn't actually available,
// surfacing NotReadableError ("Could not start video source"). The classic
// enumerate-and-skip fallback only works on RETRY because enumerateDevices()
// returns empty labels until camera permission has been granted at least once
// in this origin (browser privacy guard). So we need a permission-prime first,
// THEN enumerate, THEN try ranked deviceIds with an explicit `deviceId:{exact}`
// so the OS can't re-route. We also remember the last working deviceId in
// localStorage so the next start tries it first and skips the prime.

const PREFERRED_DEVICE_KEY = 'oyon.preferred-camera-id';
const CONTINUITY_RX = /iphone|ipad|continuity/i;

const RETRYABLE_GUM_ERRORS = new Set([
   'NotReadableError',     // device in use, OS routing failed (Continuity), driver crash
   'OverconstrainedError', // requested constraints can't be satisfied on this device
   'AbortError',           // OS aborted mid-acquire
   'TrackStartError',      // older Chromium variant
]);

const HARD_FAIL_GUM_ERRORS = new Set([
   'NotAllowedError', // user denied permission — no point retrying other devices
   'SecurityError',   // origin not allowed (insecure context, iframe perms-policy)
]);

function readPreferredDeviceId() {
   try { return localStorage.getItem(PREFERRED_DEVICE_KEY) || null; }
   catch { return null; }
}

function writePreferredDeviceId(id) {
   try { localStorage.setItem(PREFERRED_DEVICE_KEY, id); }
   catch { /* private mode etc. — non-fatal */ }
}

function clearPreferredDeviceId() {
   try { localStorage.removeItem(PREFERRED_DEVICE_KEY); }
   catch { /* non-fatal */ }
}

function stopStream(stream) {
   if (!stream) return;
   for (const track of stream.getTracks?.() || []) {
      try { track.stop(); } catch { /* ignore */ }
   }
}

async function enumerateCameras() {
   const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
   return devices.filter(d => d.kind === 'videoinput' && d.deviceId);
}

// Order: non-Continuity first, Continuity last (still tried as a last resort
// so a setup with ONLY a paired iPhone available still works rather than
// refusing). Devices with empty labels are treated as "unknown safe" — we
// haven't yet been granted label visibility, so we can't decide whether they
// are Continuity. They go in the safe bucket; in the worst case we try a few.
function rankCameras(cameras, preferredId) {
   const safe = [];
   const continuity = [];
   for (const cam of cameras) {
      if (CONTINUITY_RX.test(cam.label || '')) continuity.push(cam);
      else safe.push(cam);
   }
   const ordered = [...safe, ...continuity];
   if (!preferredId) return ordered;
   const preferred = ordered.find(d => d.deviceId === preferredId);
   if (!preferred) return ordered;
   return [preferred, ...ordered.filter(d => d.deviceId !== preferredId)];
}

// Permission-prime: a minimal getUserMedia call whose only purpose is to
// trigger the browser's permission grant so subsequent enumerateDevices()
// calls return populated labels. We immediately stop the stream. If the prime
// itself fails with a retryable error (e.g. Continuity routing), that's OK —
// we'll still try enumerated devices below; we just won't have labels, so the
// Continuity-vs-safe ranking degrades to "try everything in OS order".
async function primePermission() {
   let stream = null;
   try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      return true;
   } catch (err) {
      if (HARD_FAIL_GUM_ERRORS.has(err?.name)) throw err;
      return false;
   } finally {
      stopStream(stream);
   }
}

// Sentinel thrown when stop() runs while a start() is still pending. Caller
// (OyonCaptureWidget) treats this the same as any acquisition failure — it
// surfaces "Camera start aborted" rather than the cryptic "stream undefined".
class CameraStartAbortedError extends Error {
   constructor() {
      super('Camera start aborted by stop() before acquisition completed.');
      this.name = 'CameraStartAbortedError';
   }
}

export class CameraController {
   constructor(options = {}) {
      this.options = {
         constraints: { video: { facingMode: 'user' }, audio: false },
         attachToDom: false,
         ...options,
      };
      this.stream = null;
      this.video = null;
      // Generation counter: incremented by stop() (and a guarded re-start).
      // Each in-flight start() captures a generation at entry; if it changes
      // mid-flight, we know stop() was called and we must clean up whatever
      // we acquired locally rather than installing it. Without this, a
      // stop-during-start race silently leaves a live MediaStream attached
      // to the page even after the user requested teardown.
      this._generation = 0;
      this._inFlight = false;
   }

   async start() {
      if (!navigator?.mediaDevices?.getUserMedia) {
         throw new Error('Camera capture is not available in this browser.');
      }
      // Disallow concurrent or double-start. Caller (OyonCaptureWidget)
      // already gates on `running` state, so this is belt-and-braces.
      if (this._inFlight || this.stream) {
         throw new Error('CameraController is already starting or started; call stop() first.');
      }
      this._inFlight = true;
      const gen = this._generation;

      const baseVideo =
         typeof this.options.constraints?.video === 'object' ? this.options.constraints.video : {};
      // Local-only acquisition refs. We do NOT touch this.stream / this.video
      // until the very end (commit point), so a stop-during-start race cleans
      // up here in the catch/finally instead of leaving partial state on the
      // controller.
      let acquiredStream = null;
      let acquiredVideo = null;

      const checkAborted = () => {
         if (gen !== this._generation) throw new CameraStartAbortedError();
      };

      try {
         // Enumerate first. If labels are already populated (permission was
         // granted in a prior session and the browser remembered it), we skip
         // the prime entirely — saves a getUserMedia round-trip.
         let cameras = await enumerateCameras();
         checkAborted();
         const haveLabels = cameras.some(c => c.label);
         if (!haveLabels && cameras.length > 0) {
            await primePermission();
            checkAborted();
            cameras = await enumerateCameras();
            checkAborted();
         }

         const ranked = rankCameras(cameras, readPreferredDeviceId());

         // Try each ranked device with `deviceId:{exact}` so macOS can't re-route
         // us to the Continuity Camera. Hard-fail errors abort the whole attempt.
         let lastErr = null;
         for (const cam of ranked) {
            try {
               acquiredStream = await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: { ...baseVideo, deviceId: { exact: cam.deviceId } },
               });
               // If stop() raced us between request and resolution, throw the
               // sentinel so the catch below stops the stream we just got.
               checkAborted();
               writePreferredDeviceId(cam.deviceId);
               lastErr = null;
               break;
            } catch (err) {
               lastErr = err;
               if (err instanceof CameraStartAbortedError) throw err;
               if (HARD_FAIL_GUM_ERRORS.has(err?.name)) {
                  // Cached preferred device is irrelevant on a permission
                  // denial, but a stale id from a different browser profile
                  // could still pre-bias future attempts pointlessly. Cheap
                  // to clear; harmless if not stale.
                  clearPreferredDeviceId();
                  throw err;
               }
               if (!RETRYABLE_GUM_ERRORS.has(err?.name)) throw err;
            }
         }

         // Fallback: if enumeration returned nothing usable (browser refused
         // enumerateDevices, or all enumerated devices failed), try the original
         // configured constraint.
         if (!acquiredStream) {
            try {
               acquiredStream = await navigator.mediaDevices.getUserMedia(this.options.constraints);
               checkAborted();
            } catch (err) {
               if (err instanceof CameraStartAbortedError) throw err;
               lastErr = err;
            }
         }

         if (!acquiredStream) {
            // Cached preferred device may no longer exist (USB cam unplugged,
            // OS reassigned ids). Forget it so the next attempt starts fresh.
            clearPreferredDeviceId();
            const err = lastErr || new Error('No usable camera found.');
            // Attach the device list so a future picker UX (or DevTools console
            // inspection) can show the operator what's available.
            err.cameras = ranked.map(d => ({ deviceId: d.deviceId, label: d.label }));
            throw err;
         }

         // Build the video element and play(). Any throw here also lands in
         // the outer catch which stops `acquiredStream`, so the camera isn't
         // held by a half-built controller.
         acquiredVideo = document.createElement('video');
         acquiredVideo.playsInline = true;
         acquiredVideo.muted = true;
         acquiredVideo.autoplay = true;
         acquiredVideo.srcObject = acquiredStream;

         if (this.options.attachToDom) {
            acquiredVideo.style.position = 'fixed';
            acquiredVideo.style.width = '1px';
            acquiredVideo.style.height = '1px';
            acquiredVideo.style.opacity = '0';
            acquiredVideo.style.pointerEvents = 'none';
            document.body.appendChild(acquiredVideo);
         }

         await acquiredVideo.play();
         checkAborted();

         // Commit point: only NOW do we install the stream/video on `this`.
         // Before this line, stop() can find no installed state to tear down
         // (which is correct — there isn't any), and our local cleanup in the
         // catch handles the in-flight refs.
         this.stream = acquiredStream;
         this.video = acquiredVideo;
         return acquiredVideo;
      } catch (err) {
         stopStream(acquiredStream);
         if (acquiredVideo?.parentNode) acquiredVideo.parentNode.removeChild(acquiredVideo);
         throw err;
      } finally {
         this._inFlight = false;
      }
   }

   stop() {
      // Bump generation BEFORE tearing down so any in-flight start() sees the
      // mismatch on its next checkAborted() and cleans up its local refs.
      this._generation += 1;
      stopStream(this.stream);
      if (this.video?.parentNode) this.video.parentNode.removeChild(this.video);
      if (this.video) this.video.srcObject = null;
      this.stream = null;
      this.video = null;
   }
}
