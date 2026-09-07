import { useMemo, useState } from 'react';
import {
  CASE_ISSUE_KEYS,
  case_document_bytes,
  case_document_issues,
  create_case_document,
  learner_case,
  read_case_document,
} from '../caseDocument.js';
import {
  DIFFICULTY_KEYS,
  DIFFICULTY_LABELS,
  PRESET_CATALOG,
  PRESET_CATEGORY_KEYS,
  PRESET_CATEGORY_LABELS,
  PRESET_LABEL_KEYS,
} from '../presets.js';
import { generate_twelve_lead_ecg } from '../waveform.js';
import { ECGPaper } from './ECGPaper.jsx';
import { format_message, identity_t } from '../i18n.js';

const starter_document = () => create_case_document({
  id: 'new-ecg-case',
  title: 'New ECG teaching case',
  preset_id: 'normal_sinus',
});

const fields_from_document = (stored) => {
  const document = read_case_document(stored) ?? starter_document();
  const { manifest, rubric } = document;
  const recording = manifest.recordings[0];
  const activity = manifest.activities[0];
  return {
    id: manifest.id,
    title: manifest.title,
    preset_id: rubric?.authoring_source?.preset_id ?? 'normal_sinus',
    purpose: manifest.purpose,
    prompt: activity?.prompt ?? '',
    age_years: manifest.patient?.age_years ?? 54,
    sex: manifest.patient?.sex ?? 'unspecified',
    presentation: manifest.patient?.presentation ?? '',
    history: manifest.patient?.history ?? '',
    blood_pressure: manifest.patient?.vitals?.blood_pressure ?? '',
    respiratory_rate: manifest.patient?.vitals?.respiratory_rate ?? '',
    oxygen_saturation_percent: manifest.patient?.vitals?.oxygen_saturation_percent ?? '',
    seed: recording?.render_spec?.seed ?? 12031987,
  };
};

/**
 * Curated one-recording ECG case authoring surface.
 *
 * @param {object} props component props
 * @param {object|null} [props.initial_document] case document to edit
 * @param {((document: object) => void)|null} [props.on_change] change handler
 * @param {import('react').ReactNode} [props.top_bar_controls] host-supplied top-bar content
 * @param {boolean} [props.hide_clinical_frame] hide demographics the host case owns
 * @param {(key: string, fallback?: string, values?: object) => string} [props.t] host translator
 * @returns {JSX.Element} the studio
 */
export function CaseAuthor({
  initial_document = null,
  on_change = null,
  top_bar_controls = null,
  hide_clinical_frame = false,
  t = identity_t,
}) {
  const [fields, set_fields] = useState(() => fields_from_document(initial_document));
  const [document, set_document] = useState(() => read_case_document(initial_document) ?? starter_document());
  const [preview, set_preview] = useState(false);
  const [author_error, set_author_error] = useState('');
  const issues = useMemo(() => case_document_issues(document), [document]);
  const recording = useMemo(
    () => generate_twelve_lead_ecg(document.manifest.recordings[0].render_spec),
    [document],
  );

  const rebuild = (next_fields) => {
    set_fields(next_fields);
    try {
      const next = create_case_document({
        id: next_fields.id,
        title: next_fields.title,
        preset_id: next_fields.preset_id,
        purpose: next_fields.purpose,
        prompt: next_fields.prompt,
        seed: Number(next_fields.seed),
        patient: {
          age_years: Number(next_fields.age_years),
          sex: next_fields.sex,
          presentation: next_fields.presentation,
          history: next_fields.history,
          vitals: {
            blood_pressure: next_fields.blood_pressure,
            respiratory_rate: Number(next_fields.respiratory_rate),
            oxygen_saturation_percent: Number(next_fields.oxygen_saturation_percent),
          },
        },
      });
      set_document(next);
      set_author_error('');
      if (typeof on_change === 'function') on_change(next);
    } catch (error) {
      set_author_error(error?.message ?? String(error));
    }
  };
  const change = (field) => (event) => rebuild({ ...fields, [field]: event.target.value });

  if (preview) {
    const learner = learner_case(document);
    return (
      <div className="ecg-author-preview">
        <header className="ecg-author-topbar">
          <div>
            <p className="ecg-eyebrow">{t('exact_learner_signal', 'Exact learner signal')}</p>
            <h1>{document.manifest.title}</h1>
          </div>
          <button type="button" className="ecg-button ecg-button-secondary" onClick={() => set_preview(false)}>
            {t('back_to_editor', 'Back to editor')}
          </button>
        </header>
        <ECGPaper recording={recording} t={t} />
        <section className="ecg-preview-context">
          <strong>{learner.patient.presentation}</strong>
          <p>{learner.activities[0].prompt}</p>
        </section>
      </div>
    );
  }

  return (
    <main className="ecg-author">
      <header className="ecg-author-topbar">
        <div>
          <p className="ecg-eyebrow">{t('educator_studio', 'Educator studio')}</p>
          <h1>{t('author_a_case', 'Author a 12-lead ECG case')}</h1>
          <p>{t('author_intro', 'Choose a curated signal pattern and shape what the learner is asked to do.')}</p>
        </div>
        <div className="ecg-author-actions">
          {top_bar_controls}
          <button type="button" className="ecg-button ecg-button-primary" onClick={() => set_preview(true)}>
            {t('preview_learner_ecg', 'Preview learner ECG')}
          </button>
        </div>
      </header>

      <div className="ecg-author-layout">
        <section className="ecg-author-main">
          <div className="ecg-author-section">
            <div className="ecg-section-number">01</div>
            <div>
              <h2>{t('case_identity', 'Case identity')}</h2>
              <p>{t('case_identity_note', 'Machine ids remain stable; titles may evolve.')}</p>
            </div>
          </div>
          <div className="ecg-form-grid ecg-form-grid-two">
            <label>{t('case_title', 'Case title')}<input value={fields.title} onChange={change('title')} /></label>
            <label>{t('case_id', 'Case id')}<input value={fields.id} onChange={change('id')} pattern="[a-z0-9_-]+" /></label>
          </div>
          <label>{t('learning_purpose', 'Learning purpose')}<input value={fields.purpose} onChange={change('purpose')} /></label>

          <div className="ecg-author-section">
            <div className="ecg-section-number">02</div>
            <div>
              <h2>{t('signal_pattern', 'Signal pattern')}</h2>
              <p>{t('signal_pattern_note',
                'Curated patterns prevent incoherent combinations of unrelated abnormalities.')}</p>
            </div>
          </div>
          <div className="ecg-preset-grid">
            {PRESET_CATALOG.map((preset) => (
              <button type="button" key={preset.id} className={fields.preset_id === preset.id ? 'is-selected' : ''}
                onClick={() => rebuild({ ...fields, preset_id: preset.id })}>
                <span>{t(PRESET_CATEGORY_KEYS[preset.category], PRESET_CATEGORY_LABELS[preset.category])}</span>
                <strong>{t(PRESET_LABEL_KEYS[preset.id], preset.label)}</strong>
                <small>{t(DIFFICULTY_KEYS[preset.difficulty], DIFFICULTY_LABELS[preset.difficulty])}</small>
              </button>
            ))}
          </div>
          <label>{t('deterministic_seed', 'Deterministic seed')}<input type="number" value={fields.seed} onChange={change('seed')} /></label>

          {/* Hidden when the studio is embedded in a host whose CASE already
              owns the patient — demographics, vitals and history belong to the
              case there, not to one investigation. Standalone keeps it: with
              no case around it, this is all the context a tracing has. */}
          {!hide_clinical_frame && (<>
          <div className="ecg-author-section">
            <div className="ecg-section-number">03</div>
            <div>
              <h2>{t('clinical_frame', 'Clinical frame')}</h2>
              <p>{t('clinical_frame_note',
                'Findings are interpreted in context; the trace is never the whole case.')}</p>
            </div>
          </div>
          <div className="ecg-form-grid ecg-form-grid-three">
            <label>{t('age', 'Age')}<input type="number" min="16" max="110" value={fields.age_years} onChange={change('age_years')} /></label>
            <label>
              {t('sex', 'Sex')}
              {/* The VALUE stored is the option's own text, so each option keeps
                  its stored word and shows the translated one beside it. */}
              <select value={fields.sex} onChange={change('sex')}>
                <option value="unspecified">{t('sex_unspecified', 'unspecified')}</option>
                <option value="female">{t('sex_female', 'female')}</option>
                <option value="male">{t('sex_male', 'male')}</option>
                <option value="intersex">{t('sex_intersex', 'intersex')}</option>
              </select>
            </label>
            <label>{t('blood_pressure', 'Blood pressure')}<input value={fields.blood_pressure} onChange={change('blood_pressure')} /></label>
            <label>{t('respiratory_rate', 'Respiratory rate')}<input type="number" min="4" max="60" value={fields.respiratory_rate} onChange={change('respiratory_rate')} /></label>
            <label>{t('oxygen_saturation', 'SpO₂ (%)')}<input type="number" min="50" max="100" value={fields.oxygen_saturation_percent} onChange={change('oxygen_saturation_percent')} /></label>
          </div>
          <label>{t('presentation', 'Presentation')}<textarea rows="3" value={fields.presentation} onChange={change('presentation')} /></label>
          <label>{t('relevant_history', 'Relevant history')}<textarea rows="3" value={fields.history} onChange={change('history')} /></label>
          </>)}
          <label>{t('learner_prompt', 'Learner prompt')}<textarea rows="3" value={fields.prompt} onChange={change('prompt')} /></label>
        </section>

        <aside className="ecg-author-summary">
          <p className="ecg-eyebrow">{t('publication_readiness', 'Publication readiness')}</p>
          {/* The count sits beside the heading rather than inside it. Building
              "3 issues" in code meant choosing a plural form by `n === 1`, which
              is wrong in Finnish and Swedish and meaningless in Kazakh. */}
          <h2>
            {issues.length === 0
              ? t('ready_for_publication', 'Ready for host publication')
              : t('issues_to_resolve', 'To resolve')}
            {issues.length > 0 && <span className="ecg-legend-count">{issues.length}</span>}
          </h2>
          <ul>
            {issues.length === 0
              ? <li className="is-good">{t('document_valid', 'Valid signal, rubric, and clinical review')}</li>
              : issues.map((issue) => (
                <li key={`${issue.code}-${issue.path}`}>
                  {/* An issue whose sentence names a value carries it in
                      `values`, so the value survives translation instead of
                      being dropped to make the message one flat string. */}
                  {format_message(
                    t,
                    CASE_ISSUE_KEYS[issue.code] ?? issue.code,
                    issue.message,
                    issue.values ?? {},
                  )}
                </li>
              ))}
          </ul>
          {author_error && <p className="ecg-author-error" role="alert">{author_error}</p>}
          <dl>
            <div><dt>{t('document_size', 'Document size')}</dt><dd>{(case_document_bytes(document) / 1024).toFixed(1)} KB</dd></div>
            <div><dt>{t('signals_stored', 'Signals stored')}</dt><dd>0 {t('samples', 'samples')}</dd></div>
            <div><dt>{t('generated_at_runtime', 'Generated at runtime')}</dt><dd>60,000 {t('samples', 'samples')}</dd></div>
            <div><dt>{t('rubric', 'Rubric')}</dt><dd>{t('protected', 'Protected')}</dd></div>
          </dl>
          <div className="ecg-safety-card">
            <strong>{t('publication_rule', 'Publication rule')}</strong>
            <p>{t('publication_rule_note', 'Drafts always remain saveable. Approval gates publication only.')}</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
