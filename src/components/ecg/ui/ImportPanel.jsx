import { useMemo, useState } from 'react';
import { IMPORT_SOURCES, import_audit } from '../importSources.js';
import { import_ecg_signal, upload_from_import } from '../signalImport.js';
import { create_uploaded_case_document, case_document_issues } from '../caseDocument.js';
import { format_message, identity_t } from '../i18n.js';

/**
 * Bring a tracing in from a published corpus, and say what it costs.
 *
 * This panel never touches the file system. `src/` ships into a plugin host
 * unchanged, so an `<input type="file">` belongs in `app/` — the host hands
 * text in through `on_pick_file`, and a paste box covers every other case. That
 * is also why the source catalogue and its citations render here rather than in
 * a separate help route: an author needs the licence and the published caveat
 * at the moment they choose a corpus, not on a page they would have to go and
 * find.
 *
 * Import is deliberately two steps. The first produces a result and an audit;
 * only an explicit accept builds a case. An import that silently became a case
 * would put a tracing with no rubric, and possibly an unconfirmed licence, into
 * a library that reads as if someone had approved it.
 *
 * @param {object} props component props
 * @param {ReadonlyArray<object>} [props.sources] corpora offered, defaults to the catalogue
 * @param {string} [props.initial_file_name] file name to open with
 * @param {string} [props.initial_text] signal text to open with
 * @param {((source: object) => Promise<{name: string, text: string}>)|null} [props.on_pick_file] host file picker
 * @param {((document: object, imported: object) => void)|null} [props.on_import] accepted-case handler
 * @param {number} [props.cap_bytes] host case-config cap the audit checks against
 * @param {(key: string, fallback?: string, values?: object) => string} [props.t] host translator
 * @returns {JSX.Element} the import and audit screen
 */
export function ImportPanel({
  sources = IMPORT_SOURCES,
  initial_file_name = '',
  initial_text = '',
  on_pick_file = null,
  on_import = null,
  cap_bytes = 64 * 1024,
  t = identity_t,
}) {
  const [source_id, set_source_id] = useState(sources[0]?.id ?? '');
  const [file_name, set_file_name] = useState(initial_file_name);
  const [text, set_text] = useState(initial_text);
  const [error, set_error] = useState('');
  const [accepted, set_accepted] = useState('');

  const source = useMemo(
    () => sources.find((entry) => entry.id === source_id) ?? sources[0] ?? null,
    [sources, source_id],
  );

  // Importing is pure, so the result and its audit are derived rather than held
  // in state: two copies could disagree after an edit to the pasted text.
  const imported = useMemo(() => {
    if (!source || source.layout === null || text.trim() === '' || file_name.trim() === '') return null;
    try {
      return import_ecg_signal({
        text,
        file_name,
        sample_rate_hz: source.sample_rate_hz,
        layout: source.layout,
        units: source.units,
        corpus_id: source.corpus_id,
      });
    } catch {
      return null;
    }
  }, [source, text, file_name]);

  const document_bytes = useMemo(() => {
    if (!imported) return null;
    try {
      return JSON.stringify(create_uploaded_case_document({
        id: imported.case_id,
        title: 'Resting 12-lead ECG',
        upload: upload_from_import(imported, file_name),
      })).length;
    } catch {
      return null;
    }
  }, [imported, file_name]);

  const findings = useMemo(() => (source
    ? import_audit({ source, imported, document_bytes, cap_bytes, has_rubric: false })
    : []), [source, imported, document_bytes, cap_bytes]);

  const run_import = () => {
    if (!source) return;
    set_accepted('');
    try {
      import_ecg_signal({
        text,
        file_name,
        sample_rate_hz: source.sample_rate_hz,
        layout: source.layout,
        units: source.units,
        corpus_id: source.corpus_id,
      });
      set_error('');
    } catch (thrown) {
      set_error(thrown?.message ?? String(thrown));
    }
  };

  const pick_file = async () => {
    if (typeof on_pick_file !== 'function' || !source) return;
    set_accepted('');
    try {
      const picked = await on_pick_file(source);
      if (!picked) return;
      set_file_name(String(picked.name ?? ''));
      set_text(String(picked.text ?? ''));
      set_error('');
    } catch (thrown) {
      set_error(thrown?.message ?? String(thrown));
    }
  };

  const accept = () => {
    if (!imported) return;
    try {
      const document = create_uploaded_case_document({
        id: imported.case_id,
        title: 'Resting 12-lead ECG',
        upload: upload_from_import(imported, file_name),
      });
      const issues = case_document_issues(document);
      if (issues.length > 0) {
        set_error(issues.map((issue) => issue.message).join(' '));
        return;
      }
      set_error('');
      set_accepted(imported.case_id);
      if (typeof on_import === 'function') on_import(document, imported);
    } catch (thrown) {
      set_error(thrown?.message ?? String(thrown));
    }
  };

  const blockers = findings.filter((finding) => finding.severity === 'blocker').length;

  return (
    <section className="ecg-import" aria-label={t('import_ecg', 'Import an ECG')}>
      <header className="ecg-import-head">
        <h2>{t('import_ecg', 'Import an ECG')}</h2>
        <p className="ecg-import-intro">
          {t('import_intro', 'Bring a tracing in from a published corpus. The case id is '
            + 'derived by hash, never from the file name, because corpus file names state the finding.')}
        </p>
      </header>

      <div className="ecg-import-controls">
        <label className="ecg-field">
          <span>{t('import_source_label', 'Source')}</span>
          <select value={source_id} onChange={(event) => set_source_id(event.target.value)}>
            {sources.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
        </label>
        <label className="ecg-field">
          <span>{t('import_file_name_label', 'File name')}</span>
          <input
            type="text"
            value={file_name}
            onChange={(event) => set_file_name(event.target.value)}
            placeholder="S62_LCX_1.0_raw.csv"
          />
        </label>
        {on_pick_file ? (
          <button type="button" className="ecg-button ecg-button-secondary" onClick={pick_file}>
            {t('import_choose_file', 'Choose file')}
          </button>
        ) : null}
      </div>

      <label className="ecg-field">
        <span>{t('import_paste_label', 'Signal data')}</span>
        <textarea
          className="ecg-import-text"
          rows={4}
          value={text}
          onChange={(event) => set_text(event.target.value)}
          placeholder={t('import_paste_hint', 'Paste the contents of one recording file')}
        />
      </label>

      <div className="ecg-import-actions">
        <button type="button" className="ecg-button" onClick={run_import}>
          {t('import_run', 'Check import')}
        </button>
        <button type="button" className="ecg-button ecg-button-secondary" disabled={!imported} onClick={accept}>
          {t('import_accept', 'Create case')}
        </button>
      </div>

      {error ? <p className="ecg-import-error" role="alert">{error}</p> : null}
      {accepted ? (
        <p className="ecg-import-accepted" role="status">
          {format_message(t, 'import_created', 'Created case {id}.', { id: accepted })}
        </p>
      ) : null}

      {imported ? (
        <div className="ecg-import-result">
          <h3>{t('import_result', 'What was read')}</h3>
          <dl className="ecg-import-facts">
            <div>
              <dt>{t('import_case_id', 'Case id')}</dt>
              <dd>{imported.case_id}</dd>
            </div>
            <div>
              <dt>{t('import_signal', 'Signal')}</dt>
              <dd>
                {format_message(t, 'import_signal_summary', '{count} samples at {rate} Hz, {seconds} s',
                  {
                    count: imported.sample_count,
                    rate: imported.sample_rate_hz,
                    seconds: imported.duration_seconds,
                  })}
              </dd>
            </div>
            <div>
              <dt>{t('import_stored_size', 'Stored')}</dt>
              <dd>
                {format_message(t, 'import_stored_kb', '{kb} KB of {cap} KB', {
                  kb: (imported.stored_bytes / 1024).toFixed(1),
                  cap: Math.round(cap_bytes / 1024),
                })}
              </dd>
            </div>
          </dl>

          <h4>{t('import_lead_algebra', 'Limb leads in the source')}</h4>
          <ul className="ecg-import-algebra">
            {imported.lead_algebra.map(({ lead, relation, max_error_uv, holds }) => (
              <li key={lead} data-holds={holds ? 'yes' : 'no'}>
                <code>{relation}</code>
                <span>
                  {format_message(t, 'import_max_error', 'max {uv} uV', { uv: max_error_uv })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ecg-import-audit">
        <h3>
          {format_message(t, 'import_audit_heading', 'Audit — {blockers} to settle', { blockers })}
        </h3>
        {findings.length === 0 ? (
          <p>{t('import_no_findings', 'Nothing outstanding.')}</p>
        ) : (
          <ul>
            {findings.map(({ code, severity, detail }) => (
              <li key={code} data-severity={severity}>
                <strong>
                  {severity === 'blocker'
                    ? t('import_severity_blocker', 'Blocker')
                    : t('import_severity_review', 'Review')}
                </strong>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ecg-import-sources">
        <h3>{t('import_sources_help', 'Where these come from')}</h3>
        <ul>
          {sources.map((entry) => (
            <li key={entry.id}>
              <h4>{entry.name}</h4>
              <p className="ecg-import-citation">{entry.citation}</p>
              <p className="ecg-import-license">
                {entry.license
                  ? format_message(t, 'import_license_is', 'Licence: {license}', { license: entry.license })
                  : t('import_license_unknown', 'Licence not recorded — confirm before redistributing.')}
              </p>
              <p className="ecg-import-caveat">{entry.caveat}</p>
              <a href={entry.url} rel="noreferrer noopener" target="_blank">
                {t('import_open_record', 'Open the record')}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default ImportPanel;
