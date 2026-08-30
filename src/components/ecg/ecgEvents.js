export const ECG_ROOM = 'ecg';

export const ECG_VERBS = Object.freeze({
  OPENED_ECG_RECORDING: 'OPENED_ECG_RECORDING',
  FOCUSED_ECG_LEAD: 'FOCUSED_ECG_LEAD',
  CHANGED_ECG_LAYOUT: 'CHANGED_ECG_LAYOUT',
  MEASURED_ECG_INTERVAL: 'MEASURED_ECG_INTERVAL',
  MEASURED_ECG_AMPLITUDE: 'MEASURED_ECG_AMPLITUDE',
  RECORDED_ECG_NOTE: 'RECORDED_ECG_NOTE',
  SAVED_ECG_INTERPRETATION: 'SAVED_ECG_INTERPRETATION',
  SUBMITTED_ECG_INTERPRETATION: 'SUBMITTED_ECG_INTERPRETATION',
  REVISED_ECG_INTERPRETATION: 'REVISED_ECG_INTERPRETATION',
  REQUESTED_ECG_HINT: 'REQUESTED_ECG_HINT',
  REVEALED_ECG_EXPLANATION: 'REVEALED_ECG_EXPLANATION',
});

export const ECG_OBJECT_TYPES = Object.freeze({
  ECG_RECORDING: 'ecg_recording',
  ECG_LEAD: 'ecg_lead',
  ECG_MEASUREMENT: 'ecg_measurement',
  ECG_NOTE: 'ecg_note',
  ECG_INTERPRETATION: 'ecg_interpretation',
  ECG_TEACHING_POINT: 'ecg_teaching_point',
});

export const ECG_COMPONENTS = Object.freeze({
  ECG_ROOM: 'ECGRoom',
  ECG_PAPER: 'ECGPaper',
  INTERPRETATION_PANEL: 'ECGInterpretationPanel',
  NOTES_PANEL: 'ECGNotesPanel',
  LEAD_SELECTOR: 'ECGLeadSelector',
  CASE_AUTHOR: 'ECGCaseAuthor',
});

export const ECG_VERB_METADATA = Object.freeze({
  OPENED_ECG_RECORDING: { severity: 'IMPORTANT', category: 'CLINICAL' },
  FOCUSED_ECG_LEAD: { severity: 'INFO', category: 'CLINICAL' },
  CHANGED_ECG_LAYOUT: { severity: 'INFO', category: 'NAVIGATION' },
  MEASURED_ECG_INTERVAL: { severity: 'ACTION', category: 'ASSESSMENT' },
  MEASURED_ECG_AMPLITUDE: { severity: 'ACTION', category: 'ASSESSMENT' },
  RECORDED_ECG_NOTE: { severity: 'ACTION', category: 'ASSESSMENT' },
  SAVED_ECG_INTERPRETATION: { severity: 'ACTION', category: 'ASSESSMENT' },
  SUBMITTED_ECG_INTERPRETATION: { severity: 'CRITICAL', category: 'ASSESSMENT' },
  REVISED_ECG_INTERPRETATION: { severity: 'IMPORTANT', category: 'ASSESSMENT' },
  REQUESTED_ECG_HINT: { severity: 'ACTION', category: 'ASSESSMENT' },
  REVEALED_ECG_EXPLANATION: { severity: 'IMPORTANT', category: 'ASSESSMENT' },
});

/** Bind ECG-native events to Rohy's injected logger. */
export function create_ecg_logger(logger) {
  if (!logger || typeof logger.log !== 'function') {
    throw new TypeError('create_ecg_logger(logger): expected an injected logger with a .log() method');
  }
  const emit = (verb, object_type, fields = {}) => {
    const metadata = ECG_VERB_METADATA[verb];
    if (!metadata) throw new RangeError(`Unknown ECG verb '${verb}'`);
    return logger.log(verb, object_type, {
      objectId: fields.object_id ?? null,
      objectName: fields.object_name ?? null,
      component: fields.component ?? ECG_COMPONENTS.ECG_ROOM,
      parentComponent: ECG_COMPONENTS.ECG_ROOM,
      result: fields.result ?? null,
      durationMs: fields.duration_ms ?? null,
      context: fields.context ?? null,
      severity: metadata.severity,
      category: metadata.category,
    });
  };

  return {
    emit,
    recording_opened: (recording) => emit(ECG_VERBS.OPENED_ECG_RECORDING, ECG_OBJECT_TYPES.ECG_RECORDING, {
      object_id: recording.id,
      object_name: recording.title,
      component: ECG_COMPONENTS.ECG_PAPER,
      context: {
        sourceKind: recording.render_spec ? 'generated'
          : recording.sample_source ? 'samples'
            : recording.asset?.mime_type === 'application/pdf' ? 'pdf' : recording.asset ? 'image' : 'unknown',
        generated: recording.synthetic === true || Boolean(recording.render_spec),
        engineVersion: recording.render_spec?.engine_version ?? null,
      },
    }),
    lead_focused: (lead) => emit(ECG_VERBS.FOCUSED_ECG_LEAD, ECG_OBJECT_TYPES.ECG_LEAD, {
      object_id: lead,
      object_name: `Lead ${lead}`,
      component: ECG_COMPONENTS.ECG_PAPER,
    }),
    layout_changed: (layout) => emit(ECG_VERBS.CHANGED_ECG_LAYOUT, ECG_OBJECT_TYPES.ECG_RECORDING, {
      object_id: layout,
      object_name: layout,
      component: ECG_COMPONENTS.ECG_PAPER,
    }),
    /**
     * Log a caliper reading as what the reader said they were measuring.
     *
     * This used to infer amplitude-versus-interval from the numbers
     * (`amplitude_mv > 0 && duration_ms < 20`). The caliper mode is the reader's
     * own statement of intent, so the guess was a second, weaker classifier for
     * a fact already known — and it mis-tagged any genuinely short interval.
     */
    measurement_made: (measurement, caliper_mode = null) => {
      const amplitude_dominant = caliper_mode === 'amplitude';
      return emit(
        amplitude_dominant ? ECG_VERBS.MEASURED_ECG_AMPLITUDE : ECG_VERBS.MEASURED_ECG_INTERVAL,
        ECG_OBJECT_TYPES.ECG_MEASUREMENT,
        {
          object_id: measurement.lead ?? null,
          object_name: amplitude_dominant ? 'ECG amplitude' : 'ECG interval',
          component: ECG_COMPONENTS.ECG_PAPER,
          result: amplitude_dominant
            ? `${measurement.amplitude_mv.toFixed(2)} mV`
            : `${Math.round(measurement.duration_ms)} ms`,
          context: { durationMs: measurement.duration_ms, amplitudeMv: measurement.amplitude_mv },
        },
      );
    },
    note_recorded: (note) => emit(ECG_VERBS.RECORDED_ECG_NOTE, ECG_OBJECT_TYPES.ECG_NOTE, {
      object_id: note.id,
      object_name: note.lead ? `Note on lead ${note.lead}` : 'ECG note',
      component: ECG_COMPONENTS.NOTES_PANEL,
      context: note_shape(note),
    }),
    interpretation_saved: (response) => emit(ECG_VERBS.SAVED_ECG_INTERPRETATION, ECG_OBJECT_TYPES.ECG_INTERPRETATION, {
      object_name: 'ECG interpretation draft',
      component: ECG_COMPONENTS.INTERPRETATION_PANEL,
      context: interpretation_shape(response),
    }),
    interpretation_submitted: (response, result = null) => emit(ECG_VERBS.SUBMITTED_ECG_INTERPRETATION, ECG_OBJECT_TYPES.ECG_INTERPRETATION, {
      object_name: 'ECG interpretation',
      component: ECG_COMPONENTS.INTERPRETATION_PANEL,
      result,
      context: interpretation_shape(response),
    }),
    interpretation_revised: (response) => emit(ECG_VERBS.REVISED_ECG_INTERPRETATION, ECG_OBJECT_TYPES.ECG_INTERPRETATION, {
      object_name: 'ECG interpretation',
      component: ECG_COMPONENTS.INTERPRETATION_PANEL,
      context: interpretation_shape(response),
    }),
    explanation_revealed: (activity_id) => emit(ECG_VERBS.REVEALED_ECG_EXPLANATION, ECG_OBJECT_TYPES.ECG_TEACHING_POINT, {
      object_id: activity_id,
      object_name: 'ECG explanation',
      component: ECG_COMPONENTS.INTERPRETATION_PANEL,
    }),
  };
}

/**
 * Log only what a note WAS, never what it said.
 *
 * The same rule as `interpretation_shape`: an event trail that copies learner
 * prose becomes a second, unmanaged store of it. Where the note was anchored
 * and whether it carried a measurement is what analysis needs.
 *
 * @param {object} note a normalized note
 * @returns {{lead:string|null,hasMeasurement:boolean,wordCount:number}} loggable shape
 */
export function note_shape(note) {
  if (!note || typeof note !== 'object') {
    throw new TypeError('note_shape(note): note must be an object');
  }
  return {
    lead: note.lead ?? null,
    hasMeasurement: Boolean(note.measurement),
    wordCount: String(note.text ?? '').trim().split(/\s+/).filter(Boolean).length,
  };
}

/** Log only response shape, never a second copy of learner prose. */
export function interpretation_shape(response) {
  if (!response || typeof response !== 'object') {
    throw new TypeError('interpretation_shape(response): response must be an object');
  }
  return {
    hasRate: response.rate_bpm !== '' && response.rate_bpm !== null
      && response.rate_bpm !== undefined && Number.isFinite(Number(response.rate_bpm)),
    hasRhythm: Boolean(response.rhythm),
    hasAxis: Boolean(response.axis),
    intervalCount: Object.values(response.intervals_ms ?? {}).filter((value) =>
      value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value))).length,
    findingCount: Array.isArray(response.finding_ids) ? response.finding_ids.length : 0,
    impressionWords: String(response.impression ?? '').trim().split(/\s+/).filter(Boolean).length,
  };
}
