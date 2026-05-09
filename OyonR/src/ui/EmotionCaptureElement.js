import { createRohyFerAttachment } from '../adapters/rohyAttach.js';

export function defineEmotionCaptureElement(name = 'rohy-emotion-capture') {
  if (customElements.get(name)) return;

  customElements.define(name, class EmotionCaptureElement extends HTMLElement {
    connectedCallback() {
      this.render('idle');
    }

    configure(options) {
      this.attachment = createRohyFerAttachment({
        ...options,
        mount: runtime => {
          runtime.on('status', status => this.render(status.state));
          runtime.on('error', error => this.render('error', error.message));
        },
      });
    }

    async start() {
      if (!this.attachment) throw new Error('EmotionCaptureElement.configure() must run first.');
      await this.attachment.attach();
    }

    async stop() {
      await this.attachment?.detach();
      this.render('stopped');
    }

    render(state, detail = '') {
      this.innerHTML = `
        <button type="button" data-fer-stop hidden>Stop</button>
        <span data-fer-state></span>
      `;
      const stop = this.querySelector('[data-fer-stop]');
      const label = this.querySelector('[data-fer-state]');
      label.textContent = `FER: ${state}${detail ? ` (${detail})` : ''}`;
      stop.hidden = state !== 'running' && state !== 'paused';
      stop.onclick = () => this.stop();
    }
  });
}

