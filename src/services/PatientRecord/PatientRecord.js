/**
 * PatientRecord - Core class for tracking patient encounter events
 *
 * Pure JavaScript class with no React or database dependencies.
 * Maintains a running record of all clinically relevant events during a session.
 *
 * 8 Verbs: OBTAINED, EXAMINED, ELICITED, NOTED, ORDERED, ADMINISTERED, CHANGED, EXPRESSED
 */

// UUID generator
const generateId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

class PatientRecord {
  constructor(sessionId, caseId, patientInfo) {
    this.record = {
      record_id: generateId(),
      session_id: sessionId,
      case_id: caseId,
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),

      patient: {
        name: patientInfo?.name || 'Unknown Patient',
        age: patientInfo?.age || null,
        gender: patientInfo?.gender || null,
        mrn: patientInfo?.mrn || null,
        chief_complaint: patientInfo?.chief_complaint || null
      },

      events: [],

      current_state: {
        vitals: {
          hr: null,
          bp_sys: null,
          bp_dia: null,
          rr: null,
          spo2: null,
          temp: null,
          pain: null
        },
        elapsed_minutes: 0
      }
    };

    this.startTime = Date.now();
    this.pendingSync = []; // Events not yet synced to database
  }

  // ==================== HELPER METHODS ====================

  _getElapsedMinutes() {
    return Math.floor((Date.now() - this.startTime) / 60000);
  }

  _createEvent(verb, data) {
    const event = {
      id: generateId(),
      verb,
      time: this._getElapsedMinutes(),
      ...data
    };

    this.record.events.push(event);
    this.record.last_updated = new Date().toISOString();
    this.record.current_state.elapsed_minutes = this._getElapsedMinutes();
    this.pendingSync.push(event);

    return event;
  }

  // ==================== VERB METHODS ====================

  /**
   * OBTAINED - History/information gathered from patient
   * @param {string} category - hpi | pmh | medication | allergy | family_hx | social_hx | ros
   * @param {string} content - What was obtained
   * @param {string} [source] - patient | family | records
   */
  obtained(category, content, source = 'patient') {
    return this._createEvent('OBTAINED', {
      category,
      content,
      source
    });
  }

  /**
   * EXAMINED - Physical exam action performed
   * @param {string} region - cardiac | respiratory | abdominal | neurological | heent | extremities | skin | general
   * @param {string} technique - auscultation | palpation | inspection | percussion | special_test
   * @param {string} [detail] - Additional technique detail
   */
  examined(region, technique, detail = null) {
    return this._createEvent('EXAMINED', {
      region,
      technique,
      technique_detail: detail
    });
  }

  /**
   * ELICITED - Discovered a significant finding
   * @param {string} source - exam | lab | imaging | procedure
   * @param {string} finding - What was found
   * @param {boolean} abnormal - Is this abnormal?
   * @param {object} [options] - Additional options
   * @param {string} [options.category] - Body region or test category
   * @param {string} [options.test_name] - Name of lab test
   * @param {string} [options.value] - Numeric or text value
   * @param {string} [options.unit] - Unit of measurement
   * @param {string} [options.reference_range] - Normal range
   * @param {string} [options.significance] - Clinical interpretation
   */
  elicited(source, finding, abnormal, options = {}) {
    return this._createEvent('ELICITED', {
      source,
      finding,
      abnormal,
      category: options.category || null,
      test_name: options.test_name || null,
      value: options.value || null,
      unit: options.unit || null,
      reference_range: options.reference_range || null,
      significance: options.significance || null
    });
  }

  /**
   * NOTED - Acknowledged something visible/present
   * @param {string} source - monitor | alarm | ecg | display | patient
   * @param {string} item - What was noted
   * @param {string} [trigger] - alarm_fired | visual_observation | prompted
   * @param {string} [action] - acknowledged | silenced | addressed | dismissed
   */
  noted(source, item, trigger = null, action = null) {
    return this._createEvent('NOTED', {
      source,
      item,
      trigger,
      action
    });
  }

  /**
   * ORDERED - Requested test or treatment
   * @param {string} category - lab | imaging | medication | consult | procedure
   * @param {string} item - What was ordered
   * @param {object} [details] - Order details (dose, route, urgency, etc.)
   * @param {string} [status] - pending | resulted | cancelled
   */
  ordered(category, item, details = null, status = 'pending') {
    return this._createEvent('ORDERED', {
      category,
      item,
      details,
      status
    });
  }

  /**
   * ADMINISTERED - Gave treatment to patient
   * @param {string} category - medication | fluid | oxygen | procedure
   * @param {string} item - What was administered
   * @param {string} dose - Dose amount
   * @param {string} route - IV | PO | SL | IM | SC | topical | inhaled
   * @param {string} [response] - Patient response
   */
  administered(category, item, dose, route, response = null) {
    return this._createEvent('ADMINISTERED', {
      category,
      item,
      dose,
      route,
      response
    });
  }

  /**
   * CHANGED - Vital sign or status change occurred
   * @param {string} category - vital | status | symptom | condition
   * @param {string} parameter - hr | bp | rr | spo2 | temp | pain | consciousness | appearance
   * @param {string|number} from - Previous value
   * @param {string|number} to - New value
   * @param {string} [trigger] - spontaneous | treatment_response | scenario_progression | intervention
   * @param {string} [unit] - Unit of measurement
   */
  changed(category, parameter, from, to, trigger = null, unit = null) {
    const event = this._createEvent('CHANGED', {
      category,
      parameter,
      from: String(from),
      to: String(to),
      trigger,
      unit,
      direction: this._determineDirection(from, to)
    });

    // Update current state for vitals
    if (category === 'vital' && this.record.current_state.vitals.hasOwnProperty(parameter)) {
      this.record.current_state.vitals[parameter] = to;
    }

    return event;
  }

  /**
   * EXPRESSED - Patient communicated something
   * @param {string} type - concern | question | statement | request | emotion
   * @param {string} content - What was expressed
   * @param {string} [context] - What prompted it
   * @param {boolean} [addressed] - Was it addressed?
   */
  expressed(type, content, context = null, addressed = false) {
    return this._createEvent('EXPRESSED', {
      type,
      content,
      context,
      addressed
    });
  }

  // ==================== UTILITY METHODS ====================

  _determineDirection(from, to) {
    const fromNum = parseFloat(from);
    const toNum = parseFloat(to);

    if (isNaN(fromNum) || isNaN(toNum)) {
      return null;
    }

    if (toNum > fromNum) return 'increased';
    if (toNum < fromNum) return 'decreased';
    return 'unchanged';
  }

  /**
   * Update current vitals state
   * @param {object} vitals - Vitals object
   */
  updateVitals(vitals) {
    this.record.current_state.vitals = {
      ...this.record.current_state.vitals,
      ...vitals
    };
    this.record.last_updated = new Date().toISOString();
  }

  /**
   * Set initial vitals (at session start)
   * @param {object} vitals - Initial vitals
   */
  setInitialVitals(vitals) {
    this.updateVitals(vitals);
    this.changed('vital', 'initial', 'N/A', JSON.stringify(vitals), 'session_start');
  }

  // ==================== EXPORT METHODS ====================

  /**
   * Get the full record object
   */
  getRecord() {
    return { ...this.record };
  }

  /**
   * Get events array only
   */
  getEvents() {
    return [...this.record.events];
  }

  /**
   * Get events filtered by verb
   * @param {string} verb - Verb to filter by
   */
  getEventsByVerb(verb) {
    return this.record.events.filter(e => e.verb === verb);
  }

  /**
   * Get current state
   */
  getCurrentState() {
    return { ...this.record.current_state };
  }

  /**
   * Get patient info
   */
  getPatientInfo() {
    return { ...this.record.patient };
  }

  /**
   * Get pending sync events (not yet saved to database)
   */
  getPendingSync() {
    return [...this.pendingSync];
  }

  /**
   * Clear pending sync (after successful sync)
   */
  clearPendingSync() {
    this.pendingSync = [];
  }

  /**
   * Get record ID
   */
  getRecordId() {
    return this.record.record_id;
  }

  /**
   * Get session ID
   */
  getSessionId() {
    return this.record.session_id;
  }

  /**
   * Export to JSON string
   */
  toJSON() {
    return JSON.stringify(this.record, null, 2);
  }

  /**
   * Get event count
   */
  getEventCount() {
    return this.record.events.length;
  }

  /**
   * Load events from database (for session resume)
   * @param {array} events - Events from database
   */
  loadEvents(events) {
    this.record.events = events || [];
    this.record.last_updated = new Date().toISOString();
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const verbCounts = {};
    this.record.events.forEach(e => {
      verbCounts[e.verb] = (verbCounts[e.verb] || 0) + 1;
    });

    return {
      record_id: this.record.record_id,
      session_id: this.record.session_id,
      patient_name: this.record.patient.name,
      elapsed_minutes: this._getElapsedMinutes(),
      total_events: this.record.events.length,
      events_by_verb: verbCounts,
      current_vitals: this.record.current_state.vitals
    };
  }

  /**
   * Convert event stream to plain language narrative
   * @param {string} style - 'timeline' | 'summary' | 'context'
   * @returns {string} Plain language narrative
   */
  toNarrative(style = 'context') {
    const patient = this.record.patient;
    const events = this.record.events;
    const vitals = this.record.current_state.vitals;

    if (style === 'timeline') {
      return this._toTimelineNarrative(events);
    } else if (style === 'summary') {
      return this._toSummaryNarrative(events, patient, vitals);
    } else {
      return this._toContextNarrative(events, patient, vitals);
    }
  }

  /**
   * Timeline style: chronological list of events
   */
  _toTimelineNarrative(events) {
    if (events.length === 0) return 'No events recorded yet.';

    const lines = events.map(e => {
      const time = `${e.time} min`;
      const text = this._eventToText(e);
      return `${time} - ${text}`;
    });

    return lines.join('\n');
  }

  /**
   * Summary style: grouped by category
   */
  _toSummaryNarrative(events, patient, vitals) {
    const sections = [];

    // Patient header
    const age = patient.age ? `${patient.age}yo` : '';
    const gender = patient.gender ? (patient.gender.toLowerCase() === 'male' ? 'M' : 'F') : '';
    const demo = [age, gender].filter(Boolean).join(' ');
    if (patient.name || demo) {
      sections.push(`PATIENT: ${patient.name || 'Unknown'}${demo ? ` (${demo})` : ''}`);
    }
    if (patient.chief_complaint) {
      sections.push(`CHIEF COMPLAINT: ${patient.chief_complaint}`);
    }

    // History obtained
    const history = events.filter(e => e.verb === 'OBTAINED');
    if (history.length > 0) {
      const historyLines = history.map(e => `- ${e.content}${e.source ? `: ${this._truncate(e.source, 100)}` : ''}`);
      sections.push(`\nHISTORY:\n${historyLines.join('\n')}`);
    }

    // Exam findings
    const exams = events.filter(e => e.verb === 'EXAMINED');
    const findings = events.filter(e => e.verb === 'ELICITED' && e.source === 'exam');
    if (exams.length > 0 || findings.length > 0) {
      const examLines = [];
      exams.forEach(e => {
        examLines.push(`- ${e.region}: ${e.technique}${e.detail ? ` - ${e.detail}` : ''}`);
      });
      findings.forEach(e => {
        const prefix = e.abnormal ? '[ABNORMAL] ' : '';
        examLines.push(`- ${prefix}${e.finding}`);
      });
      sections.push(`\nEXAMINATION:\n${examLines.join('\n')}`);
    }

    // Labs/Studies
    const orders = events.filter(e => e.verb === 'ORDERED');
    const labResults = events.filter(e => e.verb === 'ELICITED' && e.source === 'lab');
    if (orders.length > 0 || labResults.length > 0) {
      const labLines = [];
      if (orders.length > 0) {
        labLines.push(`Ordered: ${orders.map(e => e.item).join(', ')}`);
      }
      labResults.forEach(e => {
        const prefix = e.abnormal ? '[ABNORMAL] ' : '';
        labLines.push(`${prefix}${e.finding}`);
      });
      sections.push(`\nLABS/STUDIES:\n${labLines.join('\n')}`);
    }

    // Interventions
    const meds = events.filter(e => e.verb === 'ADMINISTERED');
    const changes = events.filter(e => e.verb === 'CHANGED');
    if (meds.length > 0 || changes.length > 0) {
      const intLines = [];
      meds.forEach(e => {
        intLines.push(`- Gave ${e.item}${e.dose ? ` ${e.dose}` : ''}${e.route ? ` ${e.route}` : ''}`);
      });
      changes.forEach(e => {
        intLines.push(`- ${e.parameter}: ${e.from} → ${e.to}${e.unit ? ` ${e.unit}` : ''}`);
      });
      sections.push(`\nINTERVENTIONS:\n${intLines.join('\n')}`);
    }

    // Notes/Alerts
    const notes = events.filter(e => e.verb === 'NOTED');
    if (notes.length > 0) {
      const noteLines = notes.map(e => `- ${e.item}: ${e.action || 'noted'}`);
      sections.push(`\nALERTS/NOTES:\n${noteLines.join('\n')}`);
    }

    // Current vitals
    const vitalParts = [];
    if (vitals.hr) vitalParts.push(`HR ${vitals.hr}`);
    if (vitals.bp_sys && vitals.bp_dia) vitalParts.push(`BP ${vitals.bp_sys}/${vitals.bp_dia}`);
    if (vitals.spo2) vitalParts.push(`SpO2 ${vitals.spo2}%`);
    if (vitals.rr) vitalParts.push(`RR ${vitals.rr}`);
    if (vitals.temp) vitalParts.push(`Temp ${vitals.temp}°C`);
    if (vitalParts.length > 0) {
      sections.push(`\nCURRENT VITALS: ${vitalParts.join(', ')}`);
    }

    return sections.join('\n');
  }

  /**
   * Context style: concise block optimized for LLM context
   */
  _toContextNarrative(events, patient, vitals) {
    const parts = [];

    // One-liner patient summary
    const age = patient.age ? `${patient.age}yo` : '';
    const gender = patient.gender ? (patient.gender.toLowerCase() === 'male' ? 'M' : 'F') : '';
    const demo = [age, gender].filter(Boolean).join(' ');
    const cc = patient.chief_complaint ? ` presenting with ${patient.chief_complaint}` : '';
    parts.push(`Patient: ${patient.name || 'Unknown'}${demo ? ` (${demo})` : ''}${cc}.`);

    // Key history points (combine OBTAINED events)
    const history = events.filter(e => e.verb === 'OBTAINED');
    if (history.length > 0) {
      const historyBits = history.slice(0, 5).map(e => {
        if (e.source && e.source.length > 10) {
          return this._truncate(e.source, 80);
        }
        return e.content;
      });
      parts.push(`History: ${historyBits.join('. ')}.`);
    }

    // Exam findings (focus on abnormals)
    const examFindings = events.filter(e => e.verb === 'ELICITED' && e.source === 'exam');
    const abnormalExam = examFindings.filter(e => e.abnormal);
    const normalExam = examFindings.filter(e => !e.abnormal);
    if (abnormalExam.length > 0) {
      parts.push(`Abnormal exam: ${abnormalExam.map(e => e.finding).join('; ')}.`);
    }
    if (normalExam.length > 0 && abnormalExam.length === 0) {
      parts.push(`Exam: ${normalExam.slice(0, 3).map(e => e.finding).join('; ')}.`);
    }

    // Lab results (focus on abnormals)
    const labResults = events.filter(e => e.verb === 'ELICITED' && e.source === 'lab');
    const abnormalLabs = labResults.filter(e => e.abnormal);
    const normalLabs = labResults.filter(e => !e.abnormal);
    if (abnormalLabs.length > 0) {
      parts.push(`Abnormal labs: ${abnormalLabs.map(e => e.finding).join('; ')}.`);
    }
    if (normalLabs.length > 0) {
      parts.push(`Normal labs: ${normalLabs.map(e => e.details?.test_name || e.finding.split(':')[0]).join(', ')}.`);
    }

    // Pending orders
    const orders = events.filter(e => e.verb === 'ORDERED');
    if (orders.length > 0) {
      parts.push(`Ordered: ${orders.map(e => e.item).join(', ')}.`);
    }

    // Medications given
    const meds = events.filter(e => e.verb === 'ADMINISTERED');
    if (meds.length > 0) {
      const medList = meds.map(e => `${e.item}${e.dose ? ` ${e.dose}` : ''}`);
      parts.push(`Given: ${medList.join(', ')}.`);
    }

    // Significant changes
    const changes = events.filter(e => e.verb === 'CHANGED');
    if (changes.length > 0) {
      const changeList = changes.slice(-3).map(e => `${e.parameter} ${e.from}→${e.to}`);
      parts.push(`Changes: ${changeList.join(', ')}.`);
    }

    // Current vitals (one line)
    const vitalParts = [];
    if (vitals.hr) vitalParts.push(`HR ${vitals.hr}`);
    if (vitals.bp_sys && vitals.bp_dia) vitalParts.push(`BP ${vitals.bp_sys}/${vitals.bp_dia}`);
    if (vitals.spo2) vitalParts.push(`SpO2 ${vitals.spo2}%`);
    if (vitals.rr) vitalParts.push(`RR ${vitals.rr}`);
    if (vitalParts.length > 0) {
      parts.push(`Vitals: ${vitalParts.join(', ')}.`);
    }

    // Elapsed time
    parts.push(`Encounter time: ${this._getElapsedMinutes()} minutes.`);

    return parts.join('\n');
  }

  /**
   * Convert single event to plain text
   */
  _eventToText(event) {
    const e = event;
    switch (e.verb) {
      case 'OBTAINED':
        return `Asked about ${e.category}. ${e.source ? `Response: ${this._truncate(e.source, 100)}` : e.content}`;
      case 'EXAMINED':
        return `Examined ${e.region} (${e.technique}).${e.detail ? ` ${e.detail}` : ''}`;
      case 'ELICITED':
        const prefix = e.abnormal ? 'ABNORMAL: ' : '';
        return `${prefix}${e.finding}`;
      case 'NOTED':
        return `Noted ${e.item} - ${e.action || 'acknowledged'}`;
      case 'ORDERED':
        return `Ordered ${e.item}${e.details?.urgency ? ` (${e.details.urgency})` : ''}`;
      case 'ADMINISTERED':
        return `Administered ${e.item}${e.dose ? ` ${e.dose}` : ''}${e.route ? ` ${e.route}` : ''}`;
      case 'CHANGED':
        return `${e.parameter} changed: ${e.from} → ${e.to}${e.unit ? ` ${e.unit}` : ''}`;
      case 'EXPRESSED':
        return `Patient ${e.type}: "${this._truncate(e.content, 80)}"`;
      default:
        return JSON.stringify(e);
    }
  }

  /**
   * Truncate text to max length
   */
  _truncate(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 3) + '...';
  }
}

export default PatientRecord;
