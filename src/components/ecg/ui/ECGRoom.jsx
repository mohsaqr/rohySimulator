import { useEffect, useMemo, useRef, useState } from 'react';
import { create_empty_interpretation, normalize_interpretation } from '../assessment.js';
import { create_ecg_logger } from '../ecgEvents.js';
import { apply_filter_chain, filter_chain } from '../filters.js';
import {
  add_measurement,
  label_measurement,
  normalize_measurements,
  remove_measurement,
} from '../measurements.js';
import { add_note, normalize_notes, note_counts_by_lead, remove_note, update_note } from '../notes.js';
import { recording_from_document, recording_source_kind } from '../recordingSource.js';
import { DisplayControls } from './DisplayControls.jsx';
import { ECGPaper } from './ECGPaper.jsx';
import { MeasurementsPanel } from './MeasurementsPanel.jsx';
import { InterpretationPanel } from './InterpretationPanel.jsx';
import { LeadSelector } from './LeadSelector.jsx';
import { NotesPanel } from './NotesPanel.jsx';
import { UploadedECGViewer } from './UploadedECGViewer.jsx';

const create_noop_logger = () => ({ log: () => null });

/** Idle delay before a run of edits is logged as one recorded read. */
const READ_LOG_DELAY_MS = 1200;

/** A caliper mode states what the span is, so the record can start out named. */
const CALIPER_LABEL = Object.freeze({ rate: 'rr', amplitude: 'amplitude' });

/** How the cart is set up when a recording is first opened. */
const DEFAULT_DISPLAY = Object.freeze({
  gain_mm_per_mv: 10,
  paper_speed_mm_per_second: 25,
  filter_preset_id: 'diagnostic',
  caliper_mode: 'interval',
  show_grid: true,
  snap_mm: 0,
  zoom: 1,
  lens_power: 0,
  spotlight: false,
  march: false,
});


/**
 * The ECG reading room.
 *
 * One investigation inside a larger case. The room shows a tracing, gives the
 * reader the tools to interrogate it — lead focus by anatomy, calipers, notes —
 * and records what they observed. It does not mark that record, and it does not
 * ask for a diagnosis: this is a piece of the case, and the case is where the
 * pieces are put together.
 *
 * It also shows NO clinical context. The virtual-patient system owns the
 * patient — the reader already has the history, the vitals and the story from
 * the case around this room, and repeating a curated version of it here does
 * two bad things: it duplicates state this package does not own, and a framing
 * like "syncope with profound bradycardia" beside the tracing hands over the
 * reading before it is made. A real ECG arrives as a tracing on calibrated
 * paper, not as a titled teaching card.
 *
 * @param {object} props component props
 * @param {object} props.ecg_case learner case manifest, never the full document
 * @param {object|null} [props.event_logger] host logger; a no-op logger is used when absent
 * @param {boolean} [props.exam_mode] host exam flag. Accepted so the Rohy
 *   adapter's prop shape is unchanged, and deliberately unused: with no score
 *   and no answer key in the room, there is nothing here for it to hide.
 * @param {object|null} [props.initial_work] previously persisted work
 * @param {(work: object) => void|null} [props.on_work_change] persistence handler
 * @returns {JSX.Element} the room
 */
export function ECGRoom({ ecg_case, event_logger = null, exam_mode: _exam_mode = false,
  initial_work = null, on_work_change = null }) {
  if (!ecg_case || typeof ecg_case !== 'object') throw new TypeError('ECGRoom requires a learner ECG case');
  const recording_document = ecg_case.recordings?.[0];
  const recording = useMemo(() => recording_from_document(recording_document), [recording_document]);
  const source_kind = recording_source_kind(recording_document);
  const is_signal = source_kind === 'generated' || source_kind === 'samples';
  const logger = useMemo(() => create_ecg_logger(event_logger ?? create_noop_logger()), [event_logger]);

  const [view_mode, set_view_mode] = useState('standard');
  const [focused_lead, set_focused_lead] = useState('II');
  const [lead_map_open, set_lead_map_open] = useState(false);
  const [rail_tab, set_rail_tab] = useState('read');
  const [interpretation, set_interpretation] = useState(
    () => initial_work?.interpretation ?? create_empty_interpretation(),
  );
  const [notes, set_notes] = useState(() => normalize_notes(initial_work?.notes));
  const [measurements, set_measurements] = useState(
    () => normalize_measurements(initial_work?.measurements),
  );
  const [display, set_display] = useState(DEFAULT_DISPLAY);

  /**
   * The recording as it is currently being displayed.
   *
   * Filtering happens once per chain change, not per render: running four
   * biquad passes over twelve 5,000-sample leads on every keystroke in the
   * worksheet would make typing stutter.
   */
  const filtered_recording = useMemo(
    () => (is_signal ? apply_filter_chain(recording, filter_chain(display.filter_preset_id)) : recording),
    [display.filter_preset_id, is_signal, recording],
  );
  const displayed_recording = useMemo(() => ({
    ...filtered_recording,
    gain_mm_per_mv: display.gain_mm_per_mv,
    paper_speed_mm_per_second: display.paper_speed_mm_per_second,
  }), [display.gain_mm_per_mv, display.paper_speed_mm_per_second, filtered_recording]);

  const logged_read = useRef(null);

  useEffect(() => { logger.recording_opened(recording_document); }, [logger, recording_document]);

  const persist = (next_interpretation, next_notes, next_measurements = measurements) => {
    if (typeof on_work_change === 'function') {
      on_work_change({
        interpretation: next_interpretation,
        notes: next_notes,
        measurements: next_measurements,
      });
    }
  };

  /**
   * A run of keystrokes is one act of recording, not thirty.
   *
   * Logging every edit would bury the trail in noise and make an ECG read look
   * like frantic activity; logging none would lose the fact that it happened.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      let normalized;
      try {
        normalized = normalize_interpretation(interpretation);
      } catch {
        // A partially typed field is not yet a read worth logging. It is still
        // persisted above; only the event trail waits for something coherent.
        return;
      }
      const snapshot = JSON.stringify(normalized);
      if (snapshot === logged_read.current) return;
      const first = logged_read.current === null;
      logged_read.current = snapshot;
      if (first && snapshot === JSON.stringify(create_empty_interpretation())) return;
      if (first) logger.interpretation_saved(normalized);
      else logger.interpretation_revised(normalized);
    }, READ_LOG_DELAY_MS);
    return () => clearTimeout(timer);
  }, [interpretation, logger]);

  const change_view = (next_mode) => {
    set_view_mode(next_mode);
    logger.layout_changed(next_mode);
  };
  const focus_lead = (lead) => {
    set_focused_lead(lead);
    set_view_mode('focus');
    logger.lead_focused(lead);
  };
  const edit_interpretation = (next) => {
    set_interpretation(next);
    persist(next, notes);
  };
  const measure = (measurement) => {
    logger.measurement_made(measurement, display.caliper_mode);
    // A caliper span is kept, not just shown. A reading that vanishes when the
    // next one is taken cannot be compared, named, or corrected for rate.
    const next = add_measurement(measurements, {
      label_id: CALIPER_LABEL[display.caliper_mode] ?? 'other',
      duration_ms: measurement.duration_ms,
      amplitude_mv: measurement.amplitude_mv,
      delta_x_mm: measurement.delta_x_mm,
      delta_y_mm: measurement.delta_y_mm,
      lead: measurement.lead ?? focused_lead,
      // What a span means depends on how the cart was set when it was taken.
      recorded_through: {
        filter_preset_id: display.filter_preset_id,
        gain_mm_per_mv: display.gain_mm_per_mv,
        paper_speed_mm_per_second: display.paper_speed_mm_per_second,
      },
      created_at: new Date().toISOString(),
    });
    set_measurements(next);
    persist(interpretation, notes, next);
  };
  const commit_measurements = (next) => {
    set_measurements(next);
    persist(interpretation, notes, next);
  };
  const commit_notes = (next_notes) => {
    set_notes(next_notes);
    persist(interpretation, next_notes);
    return next_notes;
  };
  const create_note = (draft) => {
    const next_notes = commit_notes(add_note(notes, draft));
    logger.note_recorded(next_notes[next_notes.length - 1]);
  };

  const note_counts = useMemo(() => note_counts_by_lead(notes), [notes]);
  // One fact, one source: the toolbar readout and the note composer both mean
  // "the span just taken", and a discarded span must stop being offered.
  const last_measurement = measurements.at(-1) ?? null;

  const rail_tabs = [
    {
      id: 'read',
      label: 'Systematic read',
      count: 0,
      render: () => <InterpretationPanel value={interpretation} on_change={edit_interpretation} />,
    },
    {
      id: 'measurements',
      label: 'Measure',
      count: measurements.length,
      render: () => (
        <MeasurementsPanel
          measurements={measurements}
          on_label={(id, label_id) => commit_measurements(label_measurement(measurements, id, label_id))}
          on_remove={(id) => commit_measurements(remove_measurement(measurements, id))}
        />
      ),
    },
    {
      id: 'notes',
      label: 'Notes',
      count: notes.length,
      render: () => (
        <NotesPanel
          notes={notes}
          current_lead={focused_lead}
          last_measurement={last_measurement}
          on_add={create_note}
          on_edit={(id, text) => commit_notes(update_note(notes, id, text))}
          on_remove={(id) => commit_notes(remove_note(notes, id))}
        />
      ),
    },
  ];

  return (
    <main className="ecg-room">
      <section className="ecg-workspace">
        {is_signal ? (
          <>
            <div className="ecg-view-toolbar" aria-label="ECG display controls">
              <div className="ecg-segmented-control">
                <button type="button" aria-pressed={view_mode === 'standard'} onClick={() => change_view('standard')}>12-lead</button>
                <button type="button" aria-pressed={view_mode === 'focus'} onClick={() => change_view('focus')}>Lead focus</button>
              </div>
              <button
                type="button"
                className={`ecg-toolbar-toggle${lead_map_open ? ' is-active' : ''}`}
                aria-pressed={lead_map_open}
                onClick={() => set_lead_map_open((open) => !open)}
              >
                Lead map · {focused_lead}
              </button>
              <DisplayControls
                gain_mm_per_mv={display.gain_mm_per_mv}
                paper_speed_mm_per_second={display.paper_speed_mm_per_second}
                filter_preset_id={display.filter_preset_id}
                caliper_mode={display.caliper_mode}
                show_grid={display.show_grid}
                snap_mm={display.snap_mm}
                zoom={display.zoom}
                lens_power={display.lens_power}
                spotlight={display.spotlight}
                march={display.march}
                on_change={(patch) => set_display((current) => ({ ...current, ...patch }))}
              />
              {last_measurement && (
                <output className="ecg-measurement-readout">
                  Δ {Math.round(last_measurement.duration_ms)} ms · {last_measurement.amplitude_mv.toFixed(2)} mV
                </output>
              )}
            </div>
            <div className={`ecg-workspace-body${lead_map_open ? ' has-lead-map' : ''}`}>
              <ECGPaper
                recording={displayed_recording}
                mode={view_mode}
                focused_lead={focused_lead}
                on_measurement={measure}
                show_grid={display.show_grid}
                caliper_mode={display.caliper_mode}
                zoom={display.zoom}
                lens_power={display.lens_power}
                snap_mm={display.snap_mm}
                march={display.march}
                spotlight={display.spotlight}
              />
              {lead_map_open && (
                <LeadSelector value={focused_lead} on_change={focus_lead} note_counts={note_counts} />
              )}
            </div>
          </>
        ) : (
          <UploadedECGViewer
            asset={recording_document.asset}
            title={recording_document.title || '12-lead ECG'}
          />
        )}
      </section>

      <aside className="ecg-side-rail" aria-label="ECG record">
        <div className="ecg-rail-tabs" role="tablist" aria-label="Record views">
          {rail_tabs.map(({ id, label, count }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={rail_tab === id}
              onClick={() => set_rail_tab(id)}
            >
              {label}
              {count > 0 && <span className="ecg-tab-count">{count}</span>}
            </button>
          ))}
        </div>
        <div className="ecg-rail-body">
          {(rail_tabs.find(({ id }) => id === rail_tab) ?? rail_tabs[0]).render()}
        </div>
        <p className="ecg-rail-footer" role="status">
          Recorded to the case as you work. This ECG is one part of the picture.
        </p>
      </aside>
    </main>
  );
}
