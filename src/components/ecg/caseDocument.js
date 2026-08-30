import { FINDING_IDS } from './constants.js';
import { compile_preset, PRESET_IDS, preset_metadata } from './presets.js';
import { recording_document_is_renderable } from './recordingSource.js';

export const CASE_SCHEMA_VERSION = '1.0.0';

const EXPECTATIONS = Object.freeze({
  normal_sinus: {
    rhythm: 'sinus', axis: 'normal', findings: ['sinus_rhythm'], critical: [],
    diagnoses: ['normal sinus rhythm', 'normal ecg'],
    rationale: 'Regular sinus activation with normal axis and intervals and no acute ST-T abnormality.',
  },
  atrial_fibrillation: {
    rhythm: 'atrial_fibrillation', axis: 'normal', findings: ['atrial_fibrillation'], critical: ['atrial_fibrillation'],
    diagnoses: ['atrial fibrillation', 'atrial fibrillation with rapid ventricular response'],
    rationale: 'No consistent P waves and an irregular ventricular response.',
  },
  atrial_flutter: {
    rhythm: 'atrial_flutter', axis: 'normal', findings: ['atrial_flutter'], critical: ['atrial_flutter'],
    diagnoses: ['atrial flutter', 'atrial flutter with 2:1 conduction'],
    rationale: 'Regular flutter activity near 300 per minute with a ventricular response near 150 per minute.',
  },
  frequent_pvcs: {
    rhythm: 'sinus', axis: 'normal', findings: ['sinus_rhythm', 'premature_ventricular_complexes'], critical: ['premature_ventricular_complexes'],
    diagnoses: ['sinus rhythm with frequent premature ventricular complexes', 'frequent pvcs'],
    rationale: 'Premature broad ventricular complexes appear without a preceding P wave and with discordant repolarization.',
  },
  first_degree_av_block: {
    rhythm: 'sinus', axis: 'normal', findings: ['sinus_rhythm', 'first_degree_av_block'], critical: ['first_degree_av_block'],
    diagnoses: ['first-degree av block', 'sinus rhythm with first-degree av block'],
    rationale: 'Every P wave conducts, but the PR interval is prolonged.',
  },
  complete_heart_block: {
    rhythm: 'complete_heart_block', axis: 'normal', findings: ['wide_qrs'], critical: ['wide_qrs'],
    diagnoses: ['complete heart block', 'third-degree av block', 'complete av block'],
    rationale: 'Atrial and ventricular activity proceed independently, with a slow escape rhythm.',
  },
  right_bundle_branch_block: {
    rhythm: 'sinus', axis: 'normal', findings: ['sinus_rhythm', 'right_bundle_branch_block', 'wide_qrs'], critical: ['right_bundle_branch_block'],
    diagnoses: ['right bundle branch block', 'rbbb'],
    rationale: 'A widened QRS with a terminal right-precordial R′ and broad terminal S in lateral leads.',
  },
  left_bundle_branch_block: {
    rhythm: 'sinus', axis: 'normal', findings: ['sinus_rhythm', 'left_bundle_branch_block', 'wide_qrs'], critical: ['left_bundle_branch_block'],
    diagnoses: ['left bundle branch block', 'lbbb'],
    rationale: 'A widened QRS with dominant lateral R waves, deep right-precordial S waves, and secondary ST-T discordance.',
  },
  anterior_injury_pattern: {
    rhythm: 'sinus', axis: 'normal', findings: ['sinus_rhythm', 'st_elevation_anterior', 'pathological_q_waves'], critical: ['st_elevation_anterior'],
    diagnoses: ['anterior acute injury pattern', 'anterior stemi pattern', 'anterior st-elevation myocardial infarction pattern'],
    rationale: 'Contiguous anterior precordial ST elevation with poor early R-wave progression and developing Q waves.',
  },
  inferior_injury_pattern: {
    rhythm: 'sinus', axis: 'normal', findings: ['sinus_rhythm', 'st_elevation_inferior', 'st_depression'], critical: ['st_elevation_inferior'],
    diagnoses: ['inferior acute injury pattern', 'inferior stemi pattern', 'inferior st-elevation myocardial infarction pattern'],
    rationale: 'Inferior-lead ST elevation with reciprocal high-lateral/anterior ST depression.',
  },
  acute_pericarditis_pattern: {
    rhythm: 'sinus', axis: 'normal', findings: ['sinus_tachycardia', 'diffuse_st_elevation', 'pr_depression'], critical: ['diffuse_st_elevation'],
    diagnoses: ['acute pericarditis pattern', 'acute pericarditis'],
    rationale: 'Diffuse ST elevation and PR depression rather than a single coronary territory.',
  },
  hyperkalemia_pattern: {
    rhythm: 'sinus', axis: 'normal', findings: ['wide_qrs', 'peaked_t_waves'], critical: ['peaked_t_waves'],
    diagnoses: ['hyperkalemia pattern', 'ecg pattern concerning for hyperkalemia'],
    rationale: 'Attenuated atrial activity, broadening depolarization, and narrow-based tall T waves form a simplified hyperkalemia exemplar.',
  },
});

const DEFAULT_PATIENT = Object.freeze({
  age_years: 54,
  sex: 'unspecified',
  presentation: 'Interpret the resting 12-lead ECG in the clinical context provided.',
  history: '',
  // Absent, not invented. A default blood pressure is indistinguishable from a
  // measured one once it reaches a host, and the same fabricated 124/76 was
  // appearing on every case — including a patient in complete heart block. The
  // virtual-patient system owns the patient's observations; a case document
  // carries a vital only when an author actually supplied it.
  vitals: { heart_rate_bpm: null, blood_pressure: '', respiratory_rate: null, oxygen_saturation_percent: null },
});

const is_plain_object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const deep_clone = (value) => JSON.parse(JSON.stringify(value));

/** Deterministically order JSON object keys for hashing and byte measurement. */
export function canonical_json_stringify(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (!is_plain_object(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
  };
  return JSON.stringify(normalize(value));
}

/**
 * Create a canonical author document from a curated preset.
 *
 * @param {object} options author inputs
 * @returns {{manifest: object, rubric: object}}
 */
export function create_case_document(options) {
  if (!is_plain_object(options)) throw new TypeError('create_case_document(options): options must be an object');
  const {
    id,
    title,
    preset_id = 'normal_sinus',
    purpose = 'Interpret rate, rhythm, axis, intervals, and important morphology.',
    prompt = 'Read this tracing systematically — rate, rhythm, axis, intervals, '
    + 'morphology — and record what it adds to the case.',
    patient = {},
    seed = 12031987,
    render_overrides = {},
    review = {},
  } = options;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(id)) {
    throw new TypeError('Case id must be 3–64 lower-case letters, numbers, underscores, or hyphens');
  }
  if (typeof title !== 'string' || title.trim().length < 3) throw new TypeError('Case title must contain at least 3 characters');
  if (!PRESET_IDS.includes(preset_id)) throw new RangeError(`Unknown preset '${preset_id}'`);
  if (!is_plain_object(patient) || !is_plain_object(render_overrides) || !is_plain_object(review)) {
    throw new TypeError('patient, render_overrides, and review must be objects');
  }

  const render_spec = compile_preset(preset_id, { ...render_overrides, seed });
  const metadata = preset_metadata(preset_id);
  const expected = EXPECTATIONS[preset_id];
  const recording_id = `${id}-recording-1`;
  const activity_id = `${id}-activity-1`;
  const merged_patient = {
    ...deep_clone(DEFAULT_PATIENT),
    ...deep_clone(patient),
    vitals: { ...DEFAULT_PATIENT.vitals, ...(patient.vitals ?? {}), heart_rate_bpm: render_spec.rhythm.ventricular_rate_bpm },
  };

  return {
    manifest: {
      schema_version: CASE_SCHEMA_VERSION,
      id,
      title: title.trim(),
      purpose: String(purpose).trim(),
      difficulty: metadata.difficulty,
      patient: merged_patient,
      recordings: [{
        id: recording_id,
        title: 'Resting 12-lead ECG',
        synthetic: true,
        render_spec,
      }],
      activities: [{
        id: activity_id,
        recording_id,
        prompt: String(prompt).trim(),
        response_fields: ['rate', 'rhythm', 'axis', 'intervals', 'findings', 'impression'],
      }],
      provenance: {
        synthetic: true,
        source_kind: 'library',
        clinical_review: {
          status: review.status ?? 'pending',
          reviewed_by: review.reviewed_by ?? null,
          reviewed_at: review.reviewed_at ?? null,
          notes: review.notes ?? '',
        },
      },
    },
    rubric: {
      schema_version: CASE_SCHEMA_VERSION,
      case_id: id,
      activities: [{
        activity_id,
        expected: {
          rate_range_bpm: [render_spec.rhythm.ventricular_rate_bpm - 5, render_spec.rhythm.ventricular_rate_bpm + 5],
          rhythm: expected.rhythm,
          axis: expected.axis,
          interval_ranges_ms: {
            pr: render_spec.rhythm.mode === 'complete_heart_block' ? null : [render_spec.intervals_ms.pr - 20, render_spec.intervals_ms.pr + 20],
            qrs: [render_spec.intervals_ms.qrs - 15, render_spec.intervals_ms.qrs + 15],
            qt: [render_spec.intervals_ms.qt - 30, render_spec.intervals_ms.qt + 30],
          },
          finding_ids: [...expected.findings],
          critical_finding_ids: [...expected.critical],
          accepted_diagnoses: [...expected.diagnoses],
        },
        hints: [],
        rationale: expected.rationale,
      }],
      authoring_source: {
        preset_id,
        preset_version: CASE_SCHEMA_VERSION,
      },
    },
  };
}

/**
 * Create a learner-readable case around an uploaded ECG sheet or signal file.
 * Uploaded cases intentionally carry no answer key until an educator authors one.
 *
 * @param {object} options case identity, patient context, and inspected upload
 * @returns {{manifest: object, rubric: null}}
 */
export function create_uploaded_case_document(options) {
  if (!is_plain_object(options)) throw new TypeError('create_uploaded_case_document(options): options must be an object');
  const {
    id,
    title,
    upload,
    purpose = 'Interpret rate, rhythm, axis, intervals, and important morphology.',
    prompt = 'Read this tracing systematically — rate, rhythm, axis, intervals, '
    + 'morphology — and record what it adds to the case.',
    difficulty = 'intermediate',
    patient = {},
  } = options;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(id)) {
    throw new TypeError('Case id must be 3–64 lower-case letters, numbers, underscores, or hyphens');
  }
  if (typeof title !== 'string' || title.trim().length < 3) throw new TypeError('Case title must contain at least 3 characters');
  if (!is_plain_object(upload) || !['image', 'samples'].includes(upload.kind)) {
    throw new TypeError('create_uploaded_case_document(): upload must be an inspected ECG image, PDF, or signal file');
  }
  if (!['foundation', 'intermediate', 'advanced'].includes(difficulty)) {
    throw new RangeError('difficulty must be foundation, intermediate, or advanced');
  }
  if (!is_plain_object(patient)) throw new TypeError('patient must be an object');
  if (patient.age_years !== null && patient.age_years !== undefined
      && (!Number.isInteger(patient.age_years) || patient.age_years < 0 || patient.age_years > 120)) {
    throw new RangeError('patient age must be an integer from 0 to 120 or left unknown');
  }
  if (patient.sex !== undefined && !['unspecified', 'female', 'male', 'intersex'].includes(patient.sex)) {
    throw new RangeError('patient sex must be unspecified, female, male, or intersex');
  }

  const recording_id = `${id}-recording-1`;
  const activity_id = `${id}-activity-1`;
  const recording = upload.kind === 'samples'
    ? {
      id: recording_id,
      title: 'Uploaded 12-lead ECG signal',
      synthetic: false,
      source_kind: 'uploaded',
      sample_source: deep_clone(upload.sample_source),
    }
    : {
      id: recording_id,
      title: 'Uploaded 12-lead ECG',
      synthetic: false,
      source_kind: 'uploaded',
      asset: deep_clone(upload.asset),
    };
  if (!recording_document_is_renderable(recording)) {
    throw new TypeError('The inspected upload does not contain a renderable ECG recording');
  }

  return {
    manifest: {
      schema_version: CASE_SCHEMA_VERSION,
      id,
      title: title.trim(),
      purpose: String(purpose).trim(),
      difficulty,
      patient: {
        age_years: patient.age_years ?? null,
        sex: patient.sex ?? 'unspecified',
        presentation: patient.presentation ?? 'Interpret the uploaded 12-lead ECG in the clinical context provided.',
        history: patient.history ?? '',
        vitals: {
          heart_rate_bpm: patient.vitals?.heart_rate_bpm ?? null,
          blood_pressure: patient.vitals?.blood_pressure ?? '',
          respiratory_rate: patient.vitals?.respiratory_rate ?? null,
          oxygen_saturation_percent: patient.vitals?.oxygen_saturation_percent ?? null,
        },
      },
      recordings: [recording],
      activities: [{
        id: activity_id,
        recording_id,
        prompt: String(prompt).trim(),
        response_fields: ['rate', 'rhythm', 'axis', 'intervals', 'findings', 'impression'],
      }],
      provenance: {
        synthetic: false,
        source_kind: 'uploaded',
        source_file: {
          name: upload.file_name,
          mime_type: upload.mime_type,
          byte_length: upload.byte_length,
        },
        clinical_review: { status: 'pending', reviewed_by: null, reviewed_at: null, notes: '' },
      },
    },
    rubric: null,
  };
}

/** Total normalizer for stored host documents. */
export function read_case_document(stored) {
  if (!is_plain_object(stored) || Object.keys(stored).length === 0) return null;
  if (is_plain_object(stored.manifest) && Object.keys(stored.manifest).length > 0) {
    return { manifest: deep_clone(stored.manifest), rubric: is_plain_object(stored.rubric) ? deep_clone(stored.rubric) : null };
  }
  if (stored.schema_version === CASE_SCHEMA_VERSION && Array.isArray(stored.recordings)) {
    return { manifest: deep_clone(stored), rubric: null };
  }
  return null;
}

/** Learner-safe case projection. The protected rubric is absent. */
export function learner_case(stored) {
  const document = read_case_document(stored);
  return document ? deep_clone(document.manifest) : null;
}

/** Is there a valid recording that the viewer can render? */
export function case_document_is_servable(stored) {
  const manifest = learner_case(stored);
  if (!manifest || !Array.isArray(manifest.recordings) || manifest.recordings.length === 0) return false;
  return manifest.recordings.some(recording_document_is_renderable);
}

/**
 * Return actionable authoring/publication issues without throwing on bad data.
 *
 * @param {*} stored host document
 * @param {{for_publication?: boolean}} options validation mode
 * @returns {Array<{level:string,code:string,path:string,message:string}>}
 */
export function case_document_issues(stored, { for_publication = true } = {}) {
  if (stored === null || stored === undefined) return [];
  const document = read_case_document(stored);
  if (!document) return [{ level: 'error', code: 'unreadable_document', path: '$', message: 'The ECG case document could not be read.' }];
  const { manifest, rubric } = document;
  const issues = [
    ...(manifest.schema_version !== CASE_SCHEMA_VERSION
      ? [{ level: 'error', code: 'schema_version', path: '$.manifest.schema_version', message: `Expected ECG case schema ${CASE_SCHEMA_VERSION}.` }]
      : []),
    ...(typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(manifest.id)
      ? [{ level: 'error', code: 'case_id', path: '$.manifest.id', message: 'Add a stable lower-case case id.' }]
      : []),
    ...(typeof manifest.title !== 'string' || manifest.title.trim().length < 3
      ? [{ level: 'error', code: 'title', path: '$.manifest.title', message: 'Add a case title of at least 3 characters.' }]
      : []),
    ...(!Array.isArray(manifest.activities) || manifest.activities.length === 0
      ? [{ level: 'error', code: 'activity', path: '$.manifest.activities', message: 'Add at least one interpretation activity.' }]
      : []),
  ];
  const recording_issues = (manifest.recordings ?? []).flatMap((recording, index) => {
    if (recording_document_is_renderable(recording)) return [];
    return [{
      level: 'error',
      code: 'recording',
      path: `$.manifest.recordings[${index}]`,
      message: 'The recording must contain a valid generated signal, uploaded 12-lead signal, ECG image, or ECG PDF.',
    }];
  });
  const material_issue = case_document_is_servable(stored) ? [] : [{
    level: 'error', code: 'no_recording', path: '$.manifest.recordings',
    message: 'This case has no valid ECG recording for a learner to inspect.',
  }];
  // No publication sign-off gate. This is a teaching simulator: a host case
  // carries the clinical governance, and no other room gates publication on
  // an approval field. `rubric` and `provenance.clinical_review` remain
  // stored metadata for hosts that want to record a review — they are never
  // required. (`for_publication` is kept in the signature for callers.)
  return [...issues, ...recording_issues, ...material_issue];
}

/** Compact host-card summary. */
export function case_document_summary(stored) {
  const manifest = learner_case(stored);
  const recordings = Array.isArray(manifest?.recordings) ? manifest.recordings.length : 0;
  const activities = Array.isArray(manifest?.activities) ? manifest.activities.length : 0;
  return {
    count: recordings,
    recordings,
    activities,
    label_key: recordings === 1 ? 'ecg_summary_recording' : recordings > 1 ? 'ecg_summary_recordings' : 'ecg_summary_empty',
  };
}

/** Canonical UTF-8 document size. */
export function case_document_bytes(stored) {
  if (stored === null || stored === undefined) return 0;
  try {
    return new TextEncoder().encode(canonical_json_stringify(stored)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Validate rubric finding ids independently of the learner projection. */
export function rubric_finding_ids_are_known(stored) {
  const rubric = read_case_document(stored)?.rubric;
  if (!rubric) return false;
  return (rubric.activities ?? []).every((activity) => {
    const expected = activity.expected ?? {};
    return [...(expected.finding_ids ?? []), ...(expected.critical_finding_ids ?? [])]
      .every((finding_id) => FINDING_IDS.includes(finding_id));
  });
}
