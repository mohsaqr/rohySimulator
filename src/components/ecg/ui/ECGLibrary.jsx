import { useMemo, useState } from 'react';
import { recording_source_kind } from '../recordingSource.js';
import { ECGCasePreview } from './ECGCasePreview.jsx';

const SOURCE_FILTERS = Object.freeze([
  ['all', 'All'],
  ['library', 'Library'],
  ['uploaded', 'Uploaded'],
]);

const case_manifest = (ecg_case) => ecg_case?.manifest ?? ecg_case ?? {};
const first_recording = (ecg_case) => case_manifest(ecg_case)?.recordings?.[0] ?? null;
const case_id = (ecg_case) => String(case_manifest(ecg_case)?.id ?? '');
const title_case = (value) => String(value ?? '').replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase());

/**
 * Classify case origin independently from its recording media type.
 *
 * @param {object} ecg_case case document or learner manifest
 * @returns {'library'|'uploaded'} source-filter group
 */
export function ecg_case_source_group(ecg_case) {
  const manifest = case_manifest(ecg_case);
  const declared = String(manifest?.provenance?.source_kind ?? '').toLowerCase();
  if (['upload', 'uploaded'].includes(declared)) return 'uploaded';
  if (declared === 'library') return 'library';
  const recording = first_recording(ecg_case);
  if (recording?.sample_source || recording?.asset) return 'uploaded';
  const source_kind = recording_source_kind(recording);
  return ['samples', 'image', 'pdf'].includes(source_kind) ? 'uploaded' : 'library';
}

const searchable_case_text = (ecg_case, search_clinical) => {
  const manifest = case_manifest(ecg_case);
  const recording = first_recording(ecg_case);
  // With titles hidden, searching them would leak the same information a
  // keystroke at a time: type "flutter", get one row back.
  // The id leaks as badly as the title — `syncope-bradycardia` is searchable
  // prose. With titles hidden the row is addressable by its accession instead.
  const clinical = search_clinical
    ? [manifest.id, manifest.title, manifest.purpose,
      manifest.patient?.presentation, manifest.patient?.history]
    : [case_accession(ecg_case)];
  return [
    manifest.difficulty,
    ...clinical,
    recording?.title,
    recording?.asset?.file_name,
  ].filter(Boolean).join(' ').toLowerCase();
};

/**
 * Search and filter ECG documents without mutating their host collection.
 *
 * @param {Array<object>} cases case documents or learner manifests
 * @param {{query?:string,source?:string,difficulty?:string,search_clinical?:boolean}} filters active filters
 * @returns {Array<object>} matching cases in original order
 */
export function filter_ecg_cases(cases, {
  query = '', source = 'all', difficulty = 'all', search_clinical = true,
} = {}) {
  if (!Array.isArray(cases)) throw new TypeError('filter_ecg_cases(): cases must be an array');
  if (!SOURCE_FILTERS.some(([id]) => id === source)) throw new RangeError(`Unknown ECG source filter '${source}'`);
  const normalized_query = String(query).trim().toLowerCase();
  return cases.filter((ecg_case) => {
    const manifest = case_manifest(ecg_case);
    if (!case_id(ecg_case)) return false;
    if (source !== 'all' && ecg_case_source_group(ecg_case) !== source) return false;
    if (difficulty !== 'all' && String(manifest.difficulty ?? '').toLowerCase() !== difficulty) return false;
    return !normalized_query || searchable_case_text(ecg_case, search_clinical).includes(normalized_query);
  });
}

/**
 * A stable accession number for a case.
 *
 * The case id cannot be shown when titles are hidden — `syncope-bradycardia`
 * gives the reading away as completely as the title does. But every row reading
 * "Resting 12-lead ECG" is useless for choosing between twelve of them, so a
 * neutral identifier has to come from somewhere.
 *
 * FNV-1a over the id: deterministic, so the same case keeps the same accession
 * across sessions and can be discussed, and carrying none of the id's meaning.
 *
 * @param {object} ecg_case case document or learner manifest
 * @returns {string} accession of the form ECG-XXXXXX
 */
export function case_accession(ecg_case) {
  const id = case_id(ecg_case);
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ECG-${hash.toString(36).toUpperCase().padStart(6, '0').slice(-6)}`;
}

/**
 * What a tracing is called when its authored title would give the reading away.
 *
 * A worklist identifies a recording by accession and acquisition, never by what
 * it shows.
 */
/**
 * How a case presents itself in the browser.
 *
 * The identifying text was previously chosen inline at four places — the row
 * name, its accessible name, the thumbnail's label and the search index — each
 * of which had to remember to branch. Deciding once means the answer cannot
 * disagree with itself, which is how the accessible name kept the title after
 * the visible one had dropped it.
 *
 * @param {object} ecg_case case document or learner manifest
 * @param {boolean} reveal whether authored titles may be shown
 * @returns {{name:string, line:string, history:string|null}} display text
 */
export function case_display(ecg_case, reveal) {
  const manifest = case_manifest(ecg_case);
  const recording = first_recording(ecg_case);
  if (!reveal) {
    return { name: case_accession(ecg_case), line: neutral_line(ecg_case), history: null };
  }
  return {
    name: manifest.title || case_id(ecg_case),
    line: manifest.patient?.presentation || manifest.purpose
      || recording?.title || '12-lead ECG',
    history: manifest.patient?.history ?? null,
  };
}

function neutral_line(ecg_case) {
  const recording = first_recording(ecg_case);
  const seconds = Number(recording?.render_spec?.acquisition?.duration_seconds
    ?? recording?.sample_source?.duration_seconds);
  const rate = Number(recording?.render_spec?.acquisition?.sample_rate_hz
    ?? recording?.sample_source?.sample_rate_hz);
  return [
    recording?.title || 'Resting 12-lead ECG',
    Number.isFinite(seconds) ? `${seconds} s` : null,
    Number.isFinite(rate) ? `${rate} Hz` : null,
  ].filter(Boolean).join(' · ');
}

function Facet({ active, count = null, label, on_click }) {
  return (
    <button
      type="button"
      className={`ecg-library-facet${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={on_click}
    >
      <span>{label}</span>
      {Number.isInteger(count) && <span className="ecg-library-facet-count">{count}</span>}
    </button>
  );
}

function CaseRow({ ecg_case, active, on_select, on_open, reveal }) {
  const manifest = case_manifest(ecg_case);
  const recording = first_recording(ecg_case);
  const source = ecg_case_source_group(ecg_case);
  const id = case_id(ecg_case);
  // One decision, used for the visible name, the accessible name and the
  // thumbnail alike — announcing a title a screen reader can hear but the page
  // does not show would hide the giveaway from sighted readers only.
  const { name, line } = case_display(ecg_case, reveal);
  return (
    <li>
      <button
        type="button"
        className={`ecg-library-row${active ? ' is-active' : ''}`}
        aria-pressed={active}
        aria-label={`Inspect ${name}`}
        onClick={() => on_select(id, ecg_case)}
        onDoubleClick={() => on_open(ecg_case)}
      >
        <span className="ecg-library-row-thumb">
          <ECGCasePreview recording_document={recording} title={name} />
        </span>
        <span className="ecg-library-row-body">
          <strong>{name}</strong>
          <span className="ecg-library-row-line">{line}</span>
        </span>
        <span className="ecg-library-row-meta">
          {manifest.difficulty && (
            <span className={`ecg-tag ecg-tag-${String(manifest.difficulty).toLowerCase()}`}>
              {title_case(manifest.difficulty)}
            </span>
          )}
          <span className={`ecg-tag ecg-tag-source-${source}`}>
            {source === 'uploaded' ? 'Uploaded' : 'Library'}
          </span>
        </span>
      </button>
    </li>
  );
}

function CaseDetail({ ecg_case, choose_label, on_choose, on_remove, reveal }) {
  const [remove_pending, set_remove_pending] = useState(false);
  const manifest = case_manifest(ecg_case);
  const recording = first_recording(ecg_case);
  const source = ecg_case_source_group(ecg_case);
  const source_kind = recording_source_kind(recording);
  const duration = Number(recording?.render_spec?.acquisition?.duration_seconds
    ?? recording?.sample_source?.duration_seconds);
  const sample_rate = Number(recording?.render_spec?.acquisition?.sample_rate_hz
    ?? recording?.sample_source?.sample_rate_hz);
  const { name, line, history } = case_display(ecg_case, reveal);
  const details = [
    ['Source', source === 'uploaded' ? 'Uploaded' : 'ECG library'],
    ['Format', source_kind === 'generated' ? 'Interactive waveform' : title_case(source_kind)],
    ['Duration', Number.isFinite(duration) ? `${duration} s` : null],
    ['Sampling', Number.isFinite(sample_rate) ? `${sample_rate} Hz` : null],
    ['Level', manifest.difficulty ? title_case(manifest.difficulty) : null],
  ].filter(([, value]) => value);

  return (
    <aside className="ecg-library-detail" aria-label={`Selected ECG: ${name}`}>
      <div className="ecg-library-detail-preview">
        <ECGCasePreview recording_document={recording} title={name} />
      </div>
      <div className="ecg-library-detail-content">
        <p className="ecg-eyebrow">Selected ECG</p>
        <h3>{name}</h3>
        <p>{line}</p>
        {history && (
          <p className="ecg-library-detail-history"><strong>History</strong> {history}</p>
        )}
        <dl className="ecg-library-detail-facts">
          {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </div>
      <div className="ecg-library-detail-actions">
        <button type="button" className="ecg-button ecg-button-primary" onClick={() => on_choose(ecg_case)}>
          {choose_label}
        </button>
        {source === 'uploaded' && typeof on_remove === 'function' && (
          <button
            type="button"
            className={`ecg-button ecg-button-danger${remove_pending ? ' is-confirming' : ''}`}
            onBlur={() => set_remove_pending(false)}
            onClick={() => {
              if (!remove_pending) set_remove_pending(true);
              else {
                on_remove(ecg_case);
                set_remove_pending(false);
              }
            }}
          >
            {remove_pending ? 'Confirm removal' : 'Remove upload'}
          </button>
        )}
        {remove_pending && (
          <p className="ecg-library-remove-note" role="status">Select “Confirm removal” to remove this upload.</p>
        )}
      </div>
    </aside>
  );
}

/**
 * The ECG library: browse, inspect one, then open it.
 *
 * Laid out as a worklist rather than a wall of cards. A reader choosing among
 * a dozen tracings is comparing them, and comparison wants one scannable
 * column, not a grid that reflows every time a filter changes. Selecting is
 * still separate from opening — a stray click should never swap the tracing
 * out from under someone.
 *
 * @param {object} props component props
 * @param {Array<object>} props.cases case documents or learner manifests
 * @param {string|null} [props.selected_id] currently inspected case id
 * @param {(id: string, ecg_case: object) => void} props.on_select inspection handler
 * @param {(ecg_case: object) => void} props.on_choose open handler
 * @param {((ecg_case: object) => void)|null} [props.on_remove] removal handler for uploads
 * @param {string} [props.choose_label] label of the open action
 * @param {boolean} [props.reveal_titles] show authored titles and presentations.
 *   Defaults to FALSE — a title like "Syncope with profound bradycardia" beside
 *   a complete-heart-block strip states the reading before it is made, so an
 *   authoring surface opts in rather than a learner surface having to remember
 *   to opt out. A host that forgets this prop gets the safe behaviour.
 * @returns {JSX.Element} the browser
 */
export function ECGLibrary({
  cases,
  selected_id = null,
  on_select,
  on_choose,
  on_remove = null,
  choose_label = 'Open ECG',
  reveal_titles = false,
}) {
  if (!Array.isArray(cases)) throw new TypeError('ECGLibrary: cases must be an array');
  if (typeof on_select !== 'function') throw new TypeError('ECGLibrary: on_select must be a function');
  if (typeof on_choose !== 'function') throw new TypeError('ECGLibrary: on_choose must be a function');
  if (on_remove !== null && typeof on_remove !== 'function') throw new TypeError('ECGLibrary: on_remove must be a function or null');

  const [query, set_query] = useState('');
  const [source, set_source] = useState('all');
  const [difficulty, set_difficulty] = useState('all');

  const counts = useMemo(() => cases.reduce((tally, ecg_case) => {
    if (!case_id(ecg_case)) return tally;
    tally.all += 1;
    tally[ecg_case_source_group(ecg_case)] += 1;
    return tally;
  }, { all: 0, library: 0, uploaded: 0 }), [cases]);
  const difficulties = useMemo(() => Array.from(new Set(cases
    .map((ecg_case) => String(case_manifest(ecg_case).difficulty ?? '').toLowerCase())
    .filter(Boolean))).sort(), [cases]);
  const difficulty_counts = useMemo(() => Object.fromEntries(difficulties.map((value) => [
    value,
    cases.filter((ecg_case) => String(case_manifest(ecg_case).difficulty ?? '').toLowerCase() === value).length,
  ])), [cases, difficulties]);
  const filtered_cases = useMemo(
    () => filter_ecg_cases(cases, { query, source, difficulty, search_clinical: reveal_titles }),
    [cases, difficulty, query, reveal_titles, source],
  );
  const selected_case = cases.find((ecg_case) => case_id(ecg_case) === String(selected_id ?? '')) ?? null;
  const filtered = query !== '' || source !== 'all' || difficulty !== 'all';

  return (
    <section className="ecg-library-browser" aria-label="ECG library">
      <header className="ecg-library-bar">
        <div className="ecg-library-bar-title">
          <h2>Choose an ECG</h2>
          <p>{filtered_cases.length} of {counts.all} tracings{filtered ? ' match' : ''}</p>
        </div>
        <label className="ecg-library-search">
          <span className="ecg-visually-hidden">Search ECGs</span>
          <input
            type="search"
            value={query}
            onChange={(event) => set_query(event.target.value)}
            placeholder={reveal_titles
              ? 'Search cases, presentation, or files…'
              : 'Search by accession…'}
          />
        </label>
        {filtered && (
          <button
            type="button"
            className="ecg-library-clear"
            onClick={() => { set_query(''); set_source('all'); set_difficulty('all'); }}
          >
            Clear filters
          </button>
        )}
      </header>

      <div className="ecg-library-frame">
        <nav className="ecg-library-facets" aria-label="Library filters">
          <p className="ecg-library-facet-title">Source</p>
          {SOURCE_FILTERS.map(([id, label]) => (
            <Facet key={id} active={source === id} count={counts[id]} label={label} on_click={() => set_source(id)} />
          ))}
          <p className="ecg-library-facet-title">Level</p>
          <Facet active={difficulty === 'all'} count={counts.all} label="All levels" on_click={() => set_difficulty('all')} />
          {difficulties.map((value) => (
            <Facet
              key={value}
              active={difficulty === value}
              count={difficulty_counts[value]}
              label={title_case(value)}
              on_click={() => set_difficulty(value)}
            />
          ))}
        </nav>

        {filtered_cases.length === 0 ? (
          <div className="ecg-library-empty">
            <strong>No ECGs match</strong>
            <span>Try a different search, or clear the filters.</span>
          </div>
        ) : (
          <ul className="ecg-library-list" aria-label="ECG tracings">
            {filtered_cases.map((ecg_case) => (
              <CaseRow
                key={case_id(ecg_case)}
                ecg_case={ecg_case}
                active={case_id(ecg_case) === String(selected_id ?? '')}
                on_select={on_select}
                on_open={on_choose}
                reveal={reveal_titles}
              />
            ))}
          </ul>
        )}

        {selected_case ? (
          <CaseDetail
            key={case_id(selected_case)}
            ecg_case={selected_case}
            choose_label={choose_label}
            on_choose={on_choose}
            on_remove={on_remove}
            reveal={reveal_titles}
          />
        ) : (
          <aside className="ecg-library-detail ecg-library-detail-empty">
            <span className="ecg-library-detail-empty-mark" aria-hidden="true">ECG</span>
            <h3>Select a tracing</h3>
            <p>Choose a row to inspect the ECG and its case details.</p>
          </aside>
        )}
      </div>
    </section>
  );
}

export default ECGLibrary;
