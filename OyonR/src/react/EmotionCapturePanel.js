import React from 'react';
import { useRohyFer } from './useRohyFer.js';

/**
 * EmotionCapturePanel — minimal default UI over `useRohyFer`.
 *
 * Renders start/pause/resume/stop controls. When the runtime emits windows
 * with engagement or gaze blocks, two compact subpanels surface the headline
 * numbers (focus score, gaze centroid + 3x3 zone histogram). The subpanels
 * render only when the corresponding block is present, so consumers that
 * don't opt into engagement / gaze see the same compact panel as before.
 *
 * For richer visualizations (heatmap tiles, calibration overlay button,
 * live gaze indicator), see `standalone/preview.html` — this React panel
 * is the API-stable surface; the preview is the showcase.
 */
export function EmotionCapturePanel(props) {
  const fer = useRohyFer(props);
  const running = fer.status === 'running';
  const paused = fer.status === 'paused';
  const lastWindow = fer.lastWindow;
  const engagement = lastWindow?.engagement || null;
  const gaze = lastWindow?.gaze || null;

  const children = [
    React.createElement('span', { className: 'rohy-fer-status', key: 'status' }, `FER: ${fer.status}`),
    fer.error
      ? React.createElement('span', { className: 'rohy-fer-error', key: 'err' }, fer.error.message || String(fer.error))
      : null,
    !running && !paused
      ? React.createElement('button', { type: 'button', onClick: fer.start, key: 'start' }, 'Start')
      : null,
    running
      ? React.createElement('button', { type: 'button', onClick: fer.pause, key: 'pause' }, 'Pause')
      : null,
    paused
      ? React.createElement('button', { type: 'button', onClick: fer.resume, key: 'resume' }, 'Resume')
      : null,
    running || paused
      ? React.createElement('button', { type: 'button', onClick: fer.stop, key: 'stop' }, 'Stop')
      : null,
    engagement ? engagementSubpanel(engagement) : null,
    gaze ? gazeSubpanel(gaze) : null,
  ];

  return React.createElement(
    'div',
    {
      className: props.className || 'rohy-fer-panel',
      'data-fer-status': fer.status,
    },
    ...children,
  );
}

function fmt(v, d = 2) {
  return v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d);
}

function pct(v) {
  return v == null || Number.isNaN(v) ? '—' : `${Math.round(Number(v) * 100)}%`;
}

function engagementSubpanel(e) {
  return React.createElement(
    'div',
    { className: 'rohy-fer-engagement', key: 'engagement', 'data-fer-engagement': true },
    React.createElement('span', { className: 'rohy-fer-engagement-label' }, 'focus '),
    React.createElement('strong', null, fmt(e.focus_score)),
    React.createElement('span', { className: 'rohy-fer-engagement-sep' }, ' · entropy '),
    React.createElement('strong', null, fmt(e.gaze_entropy)),
    React.createElement('span', { className: 'rohy-fer-engagement-sep' }, ' · blink '),
    React.createElement('strong', null, fmt(e.blink_rate_hz, 2)),
    React.createElement('span', null, ' Hz'),
  );
}

function gazeSubpanel(g) {
  const zones = g.zone_proportions || {};
  const centroidText = g.centroid
    ? `${fmt(g.centroid.x)}, ${fmt(g.centroid.y)}`
    : '—';
  const histogram = React.createElement(
    'div',
    {
      className: 'rohy-fer-gaze-histogram',
      'data-fer-zone-grid': true,
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 2,
        marginTop: 6,
      },
    },
    ['top_left', 'top_center', 'top_right',
     'middle_left', 'middle_center', 'middle_right',
     'bottom_left', 'bottom_center', 'bottom_right'].map((zone) => {
      const v = Number(zones[zone]) || 0;
      const alpha = Math.min(1, Math.sqrt(v));
      return React.createElement('span', {
        key: zone,
        className: 'rohy-fer-gaze-cell',
        'data-zone': zone,
        title: `${zone}: ${(v * 100).toFixed(0)}%`,
        style: {
          height: 14,
          background: `rgba(78, 167, 255, ${0.08 + 0.7 * alpha})`,
          borderRadius: 2,
        },
      });
    }),
  );

  return React.createElement(
    'div',
    { className: 'rohy-fer-gaze', key: 'gaze', 'data-fer-gaze': true },
    React.createElement('span', { className: 'rohy-fer-gaze-label' }, 'gaze n='),
    React.createElement('strong', null, g.n_points ?? 0),
    React.createElement('span', { className: 'rohy-fer-gaze-sep' }, ' · centroid '),
    React.createElement('strong', null, centroidText),
    React.createElement('span', { className: 'rohy-fer-gaze-sep' }, ' · off '),
    React.createElement('strong', null, pct(g.off_screen_ratio)),
    histogram,
  );
}
