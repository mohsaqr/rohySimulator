/**
 * Where an imported tracing may come from, and what each corpus costs you.
 *
 * A published corpus is not a drop-in case library. Every entry here records
 * four things an author has to know before importing from it, because none of
 * them are visible in the files:
 *
 *   `layout`/`units`/`sample_rate_hz` — the files do not describe themselves.
 *   `license` — what redistribution requires, or `null` when nobody has
 *       confirmed it. Null is deliberate: `import_audit()` reports an unrecorded
 *       licence as a finding, which is safer than shipping a guessed one.
 *   `id_leaks` — whether the corpus's own file names state the finding.
 *       MedalCare-XL's `S62_LCX_1.0_raw.csv` names the occluded artery and the
 *       transmural extent, and a case id is searchable prose in this package.
 *   `caveat` — the published limitation. A corpus being peer reviewed does not
 *       make its tracings good teaching material, and the honest number belongs
 *       next to the download link rather than in a paper nobody reopens.
 *
 * Nothing here is translated. A dataset name, an author, a journal, a DOI and a
 * licence identifier are proper nouns — the same rule that keeps lead names,
 * `Bazett` and an authored case's title out of the message catalogue. Only the
 * surrounding UI chrome is translated, by the component that renders it.
 */

/**
 * Corpora and generators an author can bring a tracing in from.
 *
 * @type {ReadonlyArray<Readonly<object>>}
 */
export const IMPORT_SOURCES = Object.freeze([
  Object.freeze({
    id: 'medalcare-xl',
    corpus_id: 'mcxl',
    name: 'MedalCare-XL',
    kind: 'corpus',
    citation: 'Gillette K, et al. Scientific Data 10:531 (2023)',
    doi: '10.1038/s41597-023-02416-4',
    url: 'https://zenodo.org/records/8068944',
    license: 'CC BY 4.0',
    attribution_required: true,
    layout: 'lead-major',
    units: 'mV',
    sample_rate_hz: 500,
    duration_seconds: 10,
    id_leaks: true,
    covers: ['normal_sinus', 'left_bundle_branch_block', 'right_bundle_branch_block',
      'first_degree_av_block', 'anterior_injury_pattern', 'inferior_injury_pattern'],
    caveat: 'Cardiologists named the intended pathology in 50.5% of this corpus’s '
      + 'pathological tracings, and the authors report that synthetic features cover only a '
      + 'subset of clinically observed ranges. Strong as a comparison corpus; weaker as '
      + 'teaching material than a curated tracing.',
  }),
  Object.freeze({
    id: 'ptb-xl',
    corpus_id: 'ptbxl',
    name: 'PTB-XL',
    kind: 'corpus',
    citation: 'PTB-XL, a large publicly available electrocardiography dataset (PhysioNet)',
    doi: null,
    url: 'https://physionet.org/content/ptb-xl/1.0.3/',
    // Not confirmed in this repository. `import_audit()` reports it rather than
    // this module asserting terms nobody checked.
    license: null,
    attribution_required: true,
    layout: null,
    units: null,
    sample_rate_hz: 500,
    duration_seconds: 10,
    id_leaks: false,
    covers: [],
    caveat: 'Real clinical recordings, so the realism question does not arise — but real '
      + 'patient data carries governance this package does not handle. Confirm the record’s '
      + 'terms before importing.',
  }),
  Object.freeze({
    id: 'ecgsyn',
    corpus_id: 'syn',
    name: 'ECGSYN',
    kind: 'generator',
    citation: 'McSharry PE, Clifford GD, Tarassenko L, Smith L. IEEE Trans Biomed Eng 50(3):289–294 (2003)',
    doi: '10.1109/TBME.2003.808805',
    url: 'https://archive.physionet.org/physiotools/ecgsyn/',
    license: null,
    attribution_required: true,
    layout: null,
    units: null,
    sample_rate_hz: null,
    duration_seconds: null,
    id_leaks: false,
    covers: [],
    caveat: 'A parametric generator rather than a corpus, and single-lead as published — '
      + 'the 12-lead extension is Sameni’s dipole projection. Its sum-of-Gaussians PQRST is '
      + 'the published form of what this package’s own engine already computes.',
  }),
]);

/** Source ids, in catalogue order. */
export const IMPORT_SOURCE_IDS = Object.freeze(IMPORT_SOURCES.map(({ id }) => id));

/**
 * Look a source up by id.
 *
 * @param {string} id one of `IMPORT_SOURCE_IDS`
 * @returns {Readonly<object>} the catalogue entry
 * @throws {RangeError} when the id is not in the catalogue
 */
export function import_source(id) {
  const found = IMPORT_SOURCES.find((source) => source.id === id);
  if (!found) throw new RangeError(`Unknown ECG import source '${id}'`);
  return found;
}

/**
 * What an author must still settle before an imported case can be used.
 *
 * Returned as one row per finding rather than a boolean, because "can I import
 * this" is never one question: the licence, the leak and the size are separate
 * decisions with separate owners. Severity is `blocker` for anything that makes
 * the case unusable, `review` for anything a person must decide.
 *
 * @param {object} options what is being audited
 * @param {object} options.source catalogue entry the import came from
 * @param {object} [options.imported] result of `import_ecg_signal`
 * @param {number} [options.document_bytes] serialized case size, when known
 * @param {number} [options.cap_bytes] host case-config cap to check against
 * @param {boolean} [options.has_rubric] whether an author has written the rubric
 * @returns {Array<{code:string, severity:string, detail:string}>} one row per finding
 * @throws {TypeError} when `source` is not a catalogue entry
 */
export function import_audit({
  source, imported = null, document_bytes = null, cap_bytes = 64 * 1024, has_rubric = false,
}) {
  if (source === null || typeof source !== 'object') {
    throw new TypeError('import_audit(): source must be an import catalogue entry');
  }
  const findings = [];
  if (!source.license) {
    findings.push({
      code: 'license_unrecorded',
      severity: 'blocker',
      detail: `No licence is recorded for ${source.name}. Confirm the terms at ${source.url} before redistributing a case built from it.`,
    });
  } else if (source.attribution_required) {
    findings.push({
      code: 'attribution_required',
      severity: 'review',
      detail: `${source.name} is ${source.license} and requires attribution. Record ${source.citation} in the case provenance; learner screens carry no chrome.`,
    });
  }
  if (source.id_leaks) {
    findings.push({
      code: 'source_names_leak',
      severity: 'review',
      detail: `${source.name} file names state the finding. The case id is hashed on import, but check any title or note an author adds by hand.`,
    });
  }
  if (!has_rubric) {
    findings.push({
      code: 'rubric_missing',
      severity: 'blocker',
      detail: 'An imported signal carries no expected findings, accepted diagnoses, or measurement bands. Author the rubric from the tracing as measured.',
    });
  }
  const failed_algebra = (imported?.lead_algebra ?? []).filter(({ holds }) => !holds);
  if (failed_algebra.length > 0) {
    findings.push({
      code: 'lead_algebra_disagrees',
      severity: 'review',
      detail: `The source's own ${failed_algebra.map(({ lead }) => lead).join(', ')} disagree with the limb-lead identities `
        + `by up to ${Math.max(...failed_algebra.map(({ max_error_uv }) => max_error_uv))} uV. Only the eight independent `
        + 'channels are stored, so those leads are recomputed — check the lead order before accepting.',
    });
  }
  if (Number.isFinite(document_bytes) && Number.isFinite(cap_bytes)) {
    const share = document_bytes / cap_bytes;
    if (share > 1) {
      findings.push({
        code: 'over_host_cap',
        severity: 'blocker',
        detail: `The case document is ${(document_bytes / 1024).toFixed(1)} KB, over the ${(cap_bytes / 1024).toFixed(0)} KB host cap. It will load standalone but not in a plugin host.`,
      });
    } else if (share > 0.8) {
      findings.push({
        code: 'near_host_cap',
        severity: 'review',
        detail: `The case document is ${(document_bytes / 1024).toFixed(1)} KB, ${Math.round(share * 100)}% of the ${(cap_bytes / 1024).toFixed(0)} KB host cap. Little room for a longer rubric.`,
      });
    }
  }
  return findings;
}
