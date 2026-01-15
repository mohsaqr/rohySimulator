/**
 * PatientRecord Module
 *
 * A standalone module for tracking patient encounter events.
 * Maintains a running record of all clinically relevant events during a session.
 *
 * 8 Verbs: OBTAINED, EXAMINED, ELICITED, NOTED, ORDERED, ADMINISTERED, CHANGED, EXPRESSED
 *
 * Usage:
 *
 * 1. Wrap your app with PatientRecordProvider:
 *    <PatientRecordProvider sessionId={123} caseId={1} patientInfo={patientData}>
 *      <App />
 *    </PatientRecordProvider>
 *
 * 2. Use the hook in components:
 *    const { obtained, examined, elicited, getEvents } = usePatientRecord();
 *
 *    // Record events
 *    obtained('hpi', 'Chest pain 9/10, crushing');
 *    examined('cardiac', 'auscultation');
 *    elicited('exam', 'Tachycardia', true, { category: 'cardiac' });
 *
 *    // Get data
 *    const events = getEvents();
 *    const summary = getSummary();
 */

// Core class (for direct usage without React)
export { default as PatientRecord } from './PatientRecord';

// React context and hook
export {
  PatientRecordProvider,
  usePatientRecord,
  default as PatientRecordContext
} from './PatientRecordContext';

// Sync utilities
export {
  syncPatientRecord,
  loadPatientRecord,
  getPatientRecordEvents,
  getPatientRecordEventsByVerb,
  deletePatientRecord
} from './patientRecordSync';

// Verb constants for reference
export const VERBS = {
  OBTAINED: 'OBTAINED',
  EXAMINED: 'EXAMINED',
  ELICITED: 'ELICITED',
  NOTED: 'NOTED',
  ORDERED: 'ORDERED',
  ADMINISTERED: 'ADMINISTERED',
  CHANGED: 'CHANGED',
  EXPRESSED: 'EXPRESSED'
};

// Category constants
export const CATEGORIES = {
  // OBTAINED categories
  HISTORY: {
    HPI: 'hpi',
    PMH: 'pmh',
    MEDICATION: 'medication',
    ALLERGY: 'allergy',
    FAMILY_HX: 'family_hx',
    SOCIAL_HX: 'social_hx',
    ROS: 'ros'
  },
  // EXAMINED regions
  EXAM_REGION: {
    CARDIAC: 'cardiac',
    RESPIRATORY: 'respiratory',
    ABDOMINAL: 'abdominal',
    NEUROLOGICAL: 'neurological',
    HEENT: 'heent',
    EXTREMITIES: 'extremities',
    SKIN: 'skin',
    GENERAL: 'general'
  },
  // EXAMINED techniques
  EXAM_TECHNIQUE: {
    AUSCULTATION: 'auscultation',
    PALPATION: 'palpation',
    INSPECTION: 'inspection',
    PERCUSSION: 'percussion',
    SPECIAL_TEST: 'special_test'
  },
  // ELICITED sources
  FINDING_SOURCE: {
    EXAM: 'exam',
    LAB: 'lab',
    IMAGING: 'imaging',
    PROCEDURE: 'procedure'
  },
  // NOTED sources
  NOTED_SOURCE: {
    MONITOR: 'monitor',
    ALARM: 'alarm',
    ECG: 'ecg',
    DISPLAY: 'display',
    PATIENT: 'patient'
  },
  // ORDERED categories
  ORDER: {
    LAB: 'lab',
    IMAGING: 'imaging',
    MEDICATION: 'medication',
    CONSULT: 'consult',
    PROCEDURE: 'procedure'
  },
  // ADMINISTERED categories
  TREATMENT: {
    MEDICATION: 'medication',
    FLUID: 'fluid',
    OXYGEN: 'oxygen',
    PROCEDURE: 'procedure'
  },
  // CHANGED categories
  CHANGE: {
    VITAL: 'vital',
    STATUS: 'status',
    SYMPTOM: 'symptom',
    CONDITION: 'condition'
  },
  // EXPRESSED types
  EXPRESSION: {
    CONCERN: 'concern',
    QUESTION: 'question',
    STATEMENT: 'statement',
    REQUEST: 'request',
    EMOTION: 'emotion'
  }
};

// Route constants
export const ROUTES = {
  PO: 'PO',
  IV: 'IV',
  SL: 'SL',
  IM: 'IM',
  SC: 'SC',
  TOPICAL: 'topical',
  INHALED: 'inhaled'
};
