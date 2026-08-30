import { useMemo } from 'react';
import { recording_from_document, recording_source_kind } from '../recordingSource.js';

const PREVIEW_WIDTH = 360;
const PREVIEW_HEIGHT = 104;
const PREVIEW_BASELINE = 53;
const PREVIEW_MAX_POINTS = 420;
const preview_cache = new WeakMap();

/**
 * Reduce a long ECG signal while retaining each bucket's local extrema.
 *
 * @param {ArrayLike<number>} samples ECG samples in microvolts
 * @param {number} max_points maximum returned points
 * @returns {Array<{index:number,value:number}>} ordered source indexes and values
 */
export function decimate_preview_samples(samples, max_points = PREVIEW_MAX_POINTS) {
  if (!samples || !Number.isInteger(samples.length) || samples.length < 1) {
    throw new TypeError('decimate_preview_samples(): samples must be a non-empty array-like value');
  }
  if (!Number.isInteger(max_points) || max_points < 4) {
    throw new RangeError('decimate_preview_samples(): max_points must be an integer of at least 4');
  }
  if (samples.length <= max_points) {
    return Array.from(samples, (value, index) => ({ index, value: Number(value) }));
  }

  const bucket_count = Math.max(1, Math.floor(max_points / 2));
  const bucket_width = samples.length / bucket_count;
  const points = Array.from({ length: bucket_count }, (_unused, bucket_index) => {
    const start = Math.floor(bucket_index * bucket_width);
    const end = Math.max(start + 1, Math.min(samples.length, Math.floor((bucket_index + 1) * bucket_width)));
    const indexes = Array.from({ length: end - start }, (_empty, offset) => start + offset);
    const extrema = indexes.reduce((result, index) => ({
      minimum: samples[index] < samples[result.minimum] ? index : result.minimum,
      maximum: samples[index] > samples[result.maximum] ? index : result.maximum,
    }), { minimum: start, maximum: start });
    return Array.from(new Set([extrema.minimum, extrema.maximum])).sort((left, right) => left - right);
  }).flat();

  return points.map((index) => ({ index, value: Number(samples[index]) }));
}

const recording_preview = (recording_document) => {
  if (!recording_document || typeof recording_document !== 'object') return null;
  if (preview_cache.has(recording_document)) return preview_cache.get(recording_document);
  let preview = null;
  try {
    const source_kind = recording_source_kind(recording_document);
    const recording = recording_from_document(recording_document);
    preview = { source_kind, recording };
  } catch {
    preview = null;
  }
  preview_cache.set(recording_document, preview);
  return preview;
};

const signal_path = (samples) => {
  const points = decimate_preview_samples(samples);
  const denominator = Math.max(1, samples.length - 1);
  return points.map(({ index, value }, point_index) => {
    const x = (index / denominator) * PREVIEW_WIDTH;
    const unclamped_y = PREVIEW_BASELINE - (value / 1000) * 29;
    const y = Math.max(5, Math.min(PREVIEW_HEIGHT - 5, unclamped_y));
    return `${point_index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
};

const grid_lines = (spacing, class_name, axis) => Array.from(
  { length: Math.floor((axis === 'x' ? PREVIEW_WIDTH : PREVIEW_HEIGHT) / spacing) + 1 },
  (_unused, index) => index * spacing,
).map((position) => axis === 'x'
  ? <line key={`${class_name}-x-${position}`} className={class_name} x1={position} y1="0" x2={position} y2={PREVIEW_HEIGHT} />
  : <line key={`${class_name}-y-${position}`} className={class_name} x1="0" y1={position} x2={PREVIEW_WIDTH} y2={position} />);

/** Compact preview for generated, sampled, image, and PDF ECG material. */
export function ECGCasePreview({ recording_document, title = 'ECG preview' }) {
  const preview = useMemo(() => recording_preview(recording_document), [recording_document]);

  if (preview?.source_kind === 'image') {
    return (
      <div className="ecg-case-preview ecg-case-preview-asset">
        <img src={preview.recording.asset.data_url} alt={`${title} thumbnail`} draggable={false} />
      </div>
    );
  }

  if (preview?.source_kind === 'pdf') {
    return (
      <div className="ecg-case-preview ecg-case-preview-pdf" role="img" aria-label={`${title}, PDF document`}>
        <span className="ecg-case-preview-file-mark" aria-hidden="true">PDF</span>
        <span>ECG document</span>
      </div>
    );
  }

  const lead_ii = preview?.recording?.leads?.II;
  if ((preview?.source_kind === 'generated' || preview?.source_kind === 'samples') && lead_ii?.length > 0) {
    const path = signal_path(lead_ii);
    return (
      <div className="ecg-case-preview ecg-case-preview-signal">
        <svg viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`} role="img" aria-label={`${title}, Lead II preview`}>
          <title>{`${title}, Lead II`}</title>
          <rect className="ecg-case-preview-paper" width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} />
          <g aria-hidden="true">
            {grid_lines(10, 'ecg-case-preview-grid-minor', 'x')}
            {grid_lines(10, 'ecg-case-preview-grid-minor', 'y')}
            {grid_lines(50, 'ecg-case-preview-grid-major', 'x')}
            {grid_lines(50, 'ecg-case-preview-grid-major', 'y')}
          </g>
          <path className="ecg-case-preview-trace" d={path} />
          <text className="ecg-case-preview-lead" x="9" y="18">II</text>
        </svg>
      </div>
    );
  }

  return (
    <div className="ecg-case-preview ecg-case-preview-empty" role="img" aria-label={`${title}, preview unavailable`}>
      <span aria-hidden="true">ECG</span>
      <small>Preview unavailable</small>
    </div>
  );
}

export default ECGCasePreview;
