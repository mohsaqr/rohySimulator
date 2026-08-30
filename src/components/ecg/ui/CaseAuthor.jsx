import { useMemo, useState } from 'react';
import {
  case_document_bytes,
  case_document_issues,
  create_case_document,
  learner_case,
  read_case_document,
} from '../caseDocument.js';
import { PRESET_CATALOG } from '../presets.js';
import { generate_twelve_lead_ecg } from '../waveform.js';
import { ECGPaper } from './ECGPaper.jsx';

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
    review_status: manifest.provenance?.clinical_review?.status ?? 'pending',
    reviewed_by: manifest.provenance?.clinical_review?.reviewed_by ?? '',
    reviewed_at: manifest.provenance?.clinical_review?.reviewed_at ?? '',
    review_notes: manifest.provenance?.clinical_review?.notes ?? '',
  };
};

/** Curated one-recording ECG case authoring surface. */
export function CaseAuthor({ initial_document = null, on_change = null, top_bar_controls = null }) {
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
        review: {
          status: next_fields.review_status,
          reviewed_by: next_fields.reviewed_by || null,
          reviewed_at: next_fields.reviewed_at || null,
          notes: next_fields.review_notes,
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
          <div><p className="ecg-eyebrow">Exact learner signal</p><h1>{document.manifest.title}</h1></div>
          <button type="button" className="ecg-button ecg-button-secondary" onClick={() => set_preview(false)}>Back to editor</button>
        </header>
        <ECGPaper recording={recording} />
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
          <p className="ecg-eyebrow">Educator studio</p>
          <h1>Author a 12-lead ECG case</h1>
          <p>Choose a curated signal pattern, add clinical context, then record independent review.</p>
        </div>
        <div className="ecg-author-actions">
          {top_bar_controls}
          <button type="button" className="ecg-button ecg-button-primary" onClick={() => set_preview(true)}>Preview learner ECG</button>
        </div>
      </header>

      <div className="ecg-author-layout">
        <section className="ecg-author-main">
          <div className="ecg-author-section">
            <div className="ecg-section-number">01</div>
            <div><h2>Case identity</h2><p>Machine ids remain stable; titles may evolve.</p></div>
          </div>
          <div className="ecg-form-grid ecg-form-grid-two">
            <label>Case title<input value={fields.title} onChange={change('title')} /></label>
            <label>Case id<input value={fields.id} onChange={change('id')} pattern="[a-z0-9_-]+" /></label>
          </div>
          <label>Learning purpose<input value={fields.purpose} onChange={change('purpose')} /></label>

          <div className="ecg-author-section">
            <div className="ecg-section-number">02</div>
            <div><h2>Signal pattern</h2><p>Curated patterns prevent incoherent combinations of unrelated abnormalities.</p></div>
          </div>
          <div className="ecg-preset-grid">
            {PRESET_CATALOG.map((preset) => (
              <button type="button" key={preset.id} className={fields.preset_id === preset.id ? 'is-selected' : ''}
                onClick={() => rebuild({ ...fields, preset_id: preset.id })}>
                <span>{preset.category}</span><strong>{preset.label}</strong><small>{preset.difficulty}</small>
              </button>
            ))}
          </div>
          <label>Deterministic seed<input type="number" value={fields.seed} onChange={change('seed')} /></label>

          <div className="ecg-author-section">
            <div className="ecg-section-number">03</div>
            <div><h2>Clinical frame</h2><p>Findings are interpreted in context; the trace is never the whole case.</p></div>
          </div>
          <div className="ecg-form-grid ecg-form-grid-three">
            <label>Age<input type="number" min="16" max="110" value={fields.age_years} onChange={change('age_years')} /></label>
            <label>Sex<select value={fields.sex} onChange={change('sex')}><option>unspecified</option><option>female</option><option>male</option><option>intersex</option></select></label>
            <label>Blood pressure<input value={fields.blood_pressure} onChange={change('blood_pressure')} /></label>
            <label>Respiratory rate<input type="number" min="4" max="60" value={fields.respiratory_rate} onChange={change('respiratory_rate')} /></label>
            <label>SpO₂ (%)<input type="number" min="50" max="100" value={fields.oxygen_saturation_percent} onChange={change('oxygen_saturation_percent')} /></label>
          </div>
          <label>Presentation<textarea rows="3" value={fields.presentation} onChange={change('presentation')} /></label>
          <label>Relevant history<textarea rows="3" value={fields.history} onChange={change('history')} /></label>
          <label>Learner prompt<textarea rows="3" value={fields.prompt} onChange={change('prompt')} /></label>

          <div className="ecg-author-section">
            <div className="ecg-section-number">04</div>
            <div><h2>Clinical review</h2><p>Automated invariants establish consistency, not medical correctness.</p></div>
          </div>
          <div className="ecg-form-grid ecg-form-grid-three">
            <label>Status<select value={fields.review_status} onChange={change('review_status')}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Needs revision</option></select></label>
            <label>Reviewed by<input value={fields.reviewed_by} onChange={change('reviewed_by')} /></label>
            <label>Reviewed at<input type="date" value={fields.reviewed_at?.slice(0, 10)} onChange={change('reviewed_at')} /></label>
          </div>
          <label>Review notes<textarea rows="3" value={fields.review_notes} onChange={change('review_notes')} /></label>
        </section>

        <aside className="ecg-author-summary">
          <p className="ecg-eyebrow">Publication readiness</p>
          <h2>{issues.length === 0 ? 'Ready for host publication' : `${issues.length} issue${issues.length === 1 ? '' : 's'} to resolve`}</h2>
          <ul>
            {issues.length === 0
              ? <li className="is-good">Valid signal, rubric, and clinical review</li>
              : issues.map((issue) => <li key={`${issue.code}-${issue.path}`}>{issue.message}</li>)}
          </ul>
          {author_error && <p className="ecg-author-error" role="alert">{author_error}</p>}
          <dl>
            <div><dt>Document size</dt><dd>{(case_document_bytes(document) / 1024).toFixed(1)} KB</dd></div>
            <div><dt>Signals stored</dt><dd>0 samples</dd></div>
            <div><dt>Generated at runtime</dt><dd>60,000 samples</dd></div>
            <div><dt>Rubric</dt><dd>Protected</dd></div>
          </dl>
          <div className="ecg-safety-card">
            <strong>Publication rule</strong>
            <p>Drafts always remain saveable. Approval gates publication only.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
