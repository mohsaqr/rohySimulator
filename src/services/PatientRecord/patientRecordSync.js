/**
 * PatientRecord Sync Service
 *
 * Handles syncing PatientRecord to the database.
 * - Batch syncs events every 1 minute
 * - Saves full document for persistence
 * - Loads existing record on session resume
 */

import { apiUrl } from '../../config/api';

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

  // Skip sync if no valid session
  if (!sessionId) {
    console.warn('PatientRecord sync skipped: No session ID');
    return { success: false, reason: 'no_session' };
  }

  const pendingEvents = patientRecord.getPendingSync();
  const fullRecord = patientRecord.getRecord();

  const payload = {
    session_id: sessionId,
    record_id: recordId,
    events: pendingEvents,
    document: fullRecord,
    patient_info: patientRecord.getPatientInfo(),
    current_state: patientRecord.getCurrentState(),
    events_count: patientRecord.getEventCount()
  };

  const response = await fetch(apiUrl('/api/patient-record/sync'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sync failed: ${error}`);
  }

  return await response.json();
}

/**
 * Load patient record from database
 *
 * @param {number} sessionId - Session ID to load
 * @returns {object|null} - Record data or null if not found
 */
export async function loadPatientRecord(sessionId) {
  if (!sessionId) {
    return null;
  }

  try {
    const response = await fetch(apiUrl(`/api/patient-record/${sessionId}`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Load failed: ${error}`);
    }

    const data = await response.json();
    return data.document || null;
  } catch (error) {
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
  if (!sessionId) {
    return [];
  }

  try {
    const response = await fetch(apiUrl(`/api/patient-record/${sessionId}/events`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.events || [];
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
  if (!sessionId || !verb) {
    return [];
  }

  try {
    const response = await fetch(apiUrl(`/api/patient-record/${sessionId}/events?verb=${verb}`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.events || [];
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
  if (!sessionId) {
    return false;
  }

  try {
    const response = await fetch(apiUrl(`/api/patient-record/${sessionId}`), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return response.ok;
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
