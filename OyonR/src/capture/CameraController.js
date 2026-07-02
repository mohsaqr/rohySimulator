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
    this.stream = await navigator.mediaDevices.getUserMedia(this.options.constraints);
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

  getStream() {
    return this.stream;
  }
}
