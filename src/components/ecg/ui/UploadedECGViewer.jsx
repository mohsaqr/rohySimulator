import { useState } from 'react';
import { identity_t } from '../i18n.js';

const clamp_zoom = (value) => Math.min(220, Math.max(50, value));

/**
 * Read an uploaded ECG sheet with simple radiology-style viewport controls.
 *
 * @param {object} props component properties
 * @param {{data_url:string,mime_type:string,file_name:string}} props.asset uploaded ECG asset
 * @param {string} [props.title] accessible display title
 * @param {(key: string, fallback?: string, values?: object) => string} [props.t] host translator
 * @returns {import('react').ReactElement}
 */
export function UploadedECGViewer({
  asset,
  title = 'Uploaded 12-lead ECG',
  t = identity_t,
}) {
  if (!asset || typeof asset.data_url !== 'string' || typeof asset.mime_type !== 'string') {
    throw new TypeError('UploadedECGViewer requires an ECG asset with data_url and mime_type');
  }
  const [zoom_percent, set_zoom_percent] = useState(100);
  const [rotation_degrees, set_rotation_degrees] = useState(0);
  const is_pdf = asset.mime_type === 'application/pdf';
  const zoom = (delta) => set_zoom_percent((current) => clamp_zoom(current + delta));
  const fit = () => { set_zoom_percent(100); set_rotation_degrees(0); };
  const rotate = () => set_rotation_degrees((current) => (current + 90) % 360);

  return (
    <section className="ecg-uploaded-viewer" aria-label={title}>
      <div className="ecg-uploaded-toolbar" aria-label={t('uploaded_controls', 'Uploaded ECG controls')}>
        <div>
          <strong>{asset.file_name || title}</strong>
          <span>{is_pdf ? t('uploaded_pdf_document', 'PDF document') : t('uploaded_image', 'ECG image')}</span>
        </div>
        {!is_pdf && (
          <div className="ecg-uploaded-tools">
            <button type="button" onClick={() => zoom(-25)} aria-label={t('zoom_out', 'Zoom out')}>−</button>
            <output aria-label={t('zoom_level', 'Zoom level')}>{zoom_percent}%</output>
            <button type="button" onClick={() => zoom(25)} aria-label={t('zoom_in', 'Zoom in')}>+</button>
            <button type="button" onClick={rotate}>{t('rotate', 'Rotate')}</button>
            <button type="button" onClick={fit}>{t('fit', 'Fit')}</button>
          </div>
        )}
      </div>
      <div className="ecg-uploaded-canvas">
        {is_pdf ? (
          <object data={asset.data_url} type="application/pdf" aria-label={title}>
            <a href={asset.data_url}>{t('open_uploaded_pdf', 'Open the uploaded ECG PDF')}</a>
          </object>
        ) : (
          <img
            src={asset.data_url}
            alt={title}
            draggable={false}
            style={{ width: `${zoom_percent}%`, transform: `rotate(${rotation_degrees}deg)` }}
          />
        )}
      </div>
    </section>
  );
}
