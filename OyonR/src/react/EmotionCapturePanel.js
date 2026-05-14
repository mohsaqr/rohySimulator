import React from 'react';
import { useRohyFer } from './useRohyFer.js';

export function EmotionCapturePanel(props) {
  const fer = useRohyFer(props);
  const running = fer.status === 'running';
  const paused = fer.status === 'paused';

  return React.createElement(
    'div',
    {
      className: props.className || 'rohy-fer-panel',
      'data-fer-status': fer.status,
    },
    React.createElement('span', { className: 'rohy-fer-status' }, `FER: ${fer.status}`),
    fer.error
      ? React.createElement('span', { className: 'rohy-fer-error' }, fer.error.message || String(fer.error))
      : null,
    !running && !paused
      ? React.createElement('button', { type: 'button', onClick: fer.start }, 'Start')
      : null,
    running
      ? React.createElement('button', { type: 'button', onClick: fer.pause }, 'Pause')
      : null,
    paused
      ? React.createElement('button', { type: 'button', onClick: fer.resume }, 'Resume')
      : null,
    running || paused
      ? React.createElement('button', { type: 'button', onClick: fer.stop }, 'Stop')
      : null,
  );
}
