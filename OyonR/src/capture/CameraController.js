export class CameraController {
  constructor(options = {}) {
    this.options = {
      constraints: { video: { facingMode: 'user' }, audio: false },
      attachToDom: false,
      ...options,
    };
    this.stream = null;
    this.video = null;
  }

  async start() {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Camera capture is not available in this browser.');
    }
    // First attempt: the configured constraints (default `facingMode: user`).
    // On macOS with Continuity Camera the OS may route to a paired iPhone
    // that's not actually available, returning NotReadableError ("Could not
    // start video source"). When that happens we enumerate the real device
    // list, skip iPhone/iPad/Continuity entries, and retry with an explicit
    // deviceId until one works. Permission to call enumerateDevices() with
    // labels populated is granted by the time the first getUserMedia call
    // returned an error other than NotAllowedError, so this fallback is
    // labelled-aware on the second attempt.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(this.options.constraints);
    } catch (err) {
      if (err?.name !== 'NotReadableError') throw err;
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const cameras = devices.filter(d =>
        d.kind === 'videoinput' &&
        !/iphone|ipad|continuity/i.test(d.label || '')
      );
      let lastErr = err;
      for (const cam of cameras) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            ...this.options.constraints,
            video: {
              ...(typeof this.options.constraints?.video === 'object' ? this.options.constraints.video : {}),
              deviceId: { exact: cam.deviceId },
            },
          });
          lastErr = null;
          break;
        } catch (retryErr) {
          lastErr = retryErr;
        }
      }
      if (lastErr) throw lastErr;
    }
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.srcObject = this.stream;

    if (this.options.attachToDom) {
      this.video.style.position = 'fixed';
      this.video.style.width = '1px';
      this.video.style.height = '1px';
      this.video.style.opacity = '0';
      this.video.style.pointerEvents = 'none';
      document.body.appendChild(this.video);
    }

    await this.video.play();
    return this.video;
  }

  stop() {
    for (const track of this.stream?.getTracks?.() || []) {
      track.stop();
    }
    if (this.video?.parentNode) this.video.parentNode.removeChild(this.video);
    if (this.video) this.video.srcObject = null;
    this.stream = null;
    this.video = null;
  }
}

