/**
 * PatientRecord Sync Service
 *
 * Handles syncing PatientRecord to the database.
 * - Batch syncs events every 1 minute
 * - Saves full document for persistence
 * - Loads existing record on session resume
 *
 * All endpoints are routed through apiFetch so the bearer token, JSON
 * encoding, and ApiError contract are handled centrally — the missing-auth
 * regression that the 2026-05-06 audit fixed cannot recur here.
 */

import { ApiError, apiDelete, apiFetch, apiPost } from '../apiClient.js';

/**
 * Sync patient record to database
 * - Saves pending events to patient_record_events table
 * - Saves full document to patient_record_documents table
 *
 * @param {PatientRecord} patientRecord - PatientRecord instance
 */
export async function syncPatientRecord(patientRecord) {
  if (!patientRecord) {
    console.warn('PatientRecord sync skipped: No PatientRecord instance provided');
    return { success: false, reason: 'no_instance' };
  }

  const sessionId = patientRecord.getSessionId();
  const recordId = patientRecord.getRecordId();

  if (!sessionId) {
    console.warn('PatientRecord sync skipped: No session ID');
    return { success: false, reason: 'no_session' };
  }

  const payload = {
    session_id: sessionId,
    record_id: recordId,
    events: patientRecord.getPendingSync(),
    document: patientRecord.getRecord(),
    patient_info: patientRecord.getPatientInfo(),
    current_state: patientRecord.getCurrentState(),
    events_count: patientRecord.getEventCount()
  };

  return apiPost('/patient-record/sync', payload);
}

/**
 * Load patient record from database
 *
 * @param {number} sessionId - Session ID to load
 * @returns {object|null} - Record data or null if not found
 */
export async function loadPatientRecord(sessionId) {
  if (!sessionId) return null;

  try {
    const data = await apiFetch(`/patient-record/${sessionId}`);
    return data?.document || null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    console.error('Error loading PatientRecord:', error);
    return null;
  }
}

/**
 * Get all events for a session
 *
 * @param {number} sessionId - Session ID
 * @returns {array} - Array of events
 */
export async function getPatientRecordEvents(sessionId) {
  if (!sessionId) return [];

  try {
    const data = await apiFetch(`/patient-record/${sessionId}/events`);
    return data?.events || [];
  } catch (error) {
    console.error('Error loading PatientRecord events:', error);
    return [];
  }
}

/**
 * Get events filtered by verb
 *
 * @param {number} sessionId - Session ID
 * @param {string} verb - Verb to filter by
 * @returns {array} - Array of events
 */
export async function getPatientRecordEventsByVerb(sessionId, verb) {
  if (!sessionId || !verb) return [];

  try {
    const data = await apiFetch(`/patient-record/${sessionId}/events?verb=${encodeURIComponent(verb)}`);
    return data?.events || [];
  } catch (error) {
    console.error('Error loading PatientRecord events by verb:', error);
    return [];
  }
}

/**
 * Delete patient record (for cleanup/testing)
 *
 * @param {number} sessionId - Session ID
 */
export async function deletePatientRecord(sessionId) {
  if (!sessionId) return false;

  try {
    await apiDelete(`/patient-record/${sessionId}`);
    return true;
  } catch (error) {
    console.error('Error deleting PatientRecord:', error);
    return false;
  }
}

export default {
  syncPatientRecord,
  loadPatientRecord,
  getPatientRecordEvents,
  getPatientRecordEventsByVerb,
  deletePatientRecord
};
