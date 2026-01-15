/**
 * PatientRecordContext - React Context and Hook for PatientRecord
 *
 * Provides PatientRecord instance to all components and handles
 * automatic syncing to the database every 1 minute.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import PatientRecord from './PatientRecord';
import { syncPatientRecord, loadPatientRecord } from './patientRecordSync';

const PatientRecordContext = createContext(null);

// Sync interval in milliseconds (1 minute)
const SYNC_INTERVAL = 60000;

/**
 * PatientRecordProvider - Wraps app to provide PatientRecord context
 */
export function PatientRecordProvider({ children, sessionId, caseId, patientInfo }) {
  const [record, setRecord] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const syncIntervalRef = useRef(null);
  const recordRef = useRef(null);

  // Initialize or load existing record
  useEffect(() => {
    const initRecord = async () => {
      if (!sessionId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        // Try to load existing record from database
        const existingRecord = await loadPatientRecord(sessionId);

        if (existingRecord) {
          // Resume existing record
          const patientRecord = new PatientRecord(sessionId, caseId, existingRecord.patient);
          patientRecord.record.record_id = existingRecord.record_id;
          patientRecord.loadEvents(existingRecord.events);
          if (existingRecord.current_state) {
            patientRecord.record.current_state = existingRecord.current_state;
          }
          recordRef.current = patientRecord;
          setRecord(patientRecord);
        } else {
          // Create new record
          const patientRecord = new PatientRecord(sessionId, caseId, patientInfo);
          recordRef.current = patientRecord;
          setRecord(patientRecord);
        }
      } catch (error) {
        console.error('Error initializing PatientRecord:', error);
        // Create new record on error
        const patientRecord = new PatientRecord(sessionId, caseId, patientInfo);
        recordRef.current = patientRecord;
        setRecord(patientRecord);
      }

      setIsLoading(false);
    };

    initRecord();
  }, [sessionId, caseId, patientInfo]);

  // Setup sync interval
  useEffect(() => {
    // Don't sync if no record or no valid sessionId
    if (!record || !sessionId) {
      setSyncError(null); // Clear any previous error
      return;
    }

    const performSync = async () => {
      // Double-check session ID before syncing
      const actualSessionId = recordRef.current?.getSessionId();
      if (!actualSessionId) {
        console.warn('PatientRecord sync skipped: No session ID in record');
        return;
      }

      try {
        const pendingEvents = recordRef.current?.getPendingSync() || [];

        if (pendingEvents.length > 0 || recordRef.current) {
          const result = await syncPatientRecord(recordRef.current);
          // Only clear pending if sync was successful
          if (result && result.success !== false) {
            recordRef.current?.clearPendingSync();
            setLastSyncTime(new Date());
            setSyncError(null);
          }
        }
      } catch (error) {
        console.error('PatientRecord sync error:', error);
        setSyncError(error.message);
      }
    };

    // Initial sync
    performSync();

    // Setup interval
    syncIntervalRef.current = setInterval(performSync, SYNC_INTERVAL);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
      // Final sync on unmount
      performSync();
    };
  }, [record, sessionId]);

  // Force sync (can be called manually)
  const forceSync = useCallback(async () => {
    if (!recordRef.current) return;

    try {
      await syncPatientRecord(recordRef.current);
      recordRef.current.clearPendingSync();
      setLastSyncTime(new Date());
      setSyncError(null);
    } catch (error) {
      console.error('PatientRecord force sync error:', error);
      setSyncError(error.message);
      throw error;
    }
  }, []);

  // Wrapper functions that trigger re-render
  const obtained = useCallback((category, content, source) => {
    if (!recordRef.current) return null;
    const event = recordRef.current.obtained(category, content, source);
    setRecord({ ...recordRef.current });
    return event;
  }, []);

  const examined = useCallback((region, technique, detail) => {
    if (!recordRef.current) return null;
    const event = recordRef.current.examined(region, technique, detail);
    setRecord({ ...recordRef.current });
    return event;
  }, []);

  const elicited = useCallback((source, finding, abnormal, options) => {
    if (!recordRef.current) return null;
    const event = recordRef.current.elicited(source, finding, abnormal, options);
    setRecord({ ...recordRef.current });
    return event;
  }, []);

  const noted = useCallback((source, item, trigger, action) => {
    if (!recordRef.current) return null;
    const event = recordRef.current.noted(source, item, trigger, action);
    setRecord({ ...recordRef.current });
    return event;
  }, []);

  const ordered = useCallback((category, item, details, status) => {
    if (!recordRef.current) return null;
    const event = recordRef.current.ordered(category, item, details, status);
    setRecord({ ...recordRef.current });
    return event;
  }, []);

  const administered = useCallback((category, item, dose, route, response) => {
    if (!recordRef.current) return null;
    const event = recordRef.current.administered(category, item, dose, route, response);
    setRecord({ ...recordRef.current });
    return event;
  }, []);

  const changed = useCallback((category, parameter, from, to, trigger, unit) => {
    if (!recordRef.current) return null;
    const event = recordRef.current.changed(category, parameter, from, to, trigger, unit);
    setRecord({ ...recordRef.current });
    return event;
  }, []);

  const expressed = useCallback((type, content, context, addressed) => {
    if (!recordRef.current) return null;
    const event = recordRef.current.expressed(type, content, context, addressed);
    setRecord({ ...recordRef.current });
    return event;
  }, []);

  const updateVitals = useCallback((vitals) => {
    if (!recordRef.current) return;
    recordRef.current.updateVitals(vitals);
    setRecord({ ...recordRef.current });
  }, []);

  const setInitialVitals = useCallback((vitals) => {
    if (!recordRef.current) return;
    recordRef.current.setInitialVitals(vitals);
    setRecord({ ...recordRef.current });
  }, []);

  const value = {
    // Record instance access
    record: recordRef.current,
    isLoading,

    // Verb methods
    obtained,
    examined,
    elicited,
    noted,
    ordered,
    administered,
    changed,
    expressed,

    // Utility methods
    updateVitals,
    setInitialVitals,
    forceSync,

    // Getters
    getRecord: () => recordRef.current?.getRecord() || null,
    getEvents: () => recordRef.current?.getEvents() || [],
    getEventsByVerb: (verb) => recordRef.current?.getEventsByVerb(verb) || [],
    getCurrentState: () => recordRef.current?.getCurrentState() || null,
    getSummary: () => recordRef.current?.getSummary() || null,
    getEventCount: () => recordRef.current?.getEventCount() || 0,
    toJSON: () => recordRef.current?.toJSON() || '{}',
    toNarrative: (style) => recordRef.current?.toNarrative(style) || '',

    // Sync status
    lastSyncTime,
    syncError
  };

  return (
    <PatientRecordContext.Provider value={value}>
      {children}
    </PatientRecordContext.Provider>
  );
}

/**
 * usePatientRecord - Hook to access PatientRecord context
 */
export function usePatientRecord() {
  const context = useContext(PatientRecordContext);

  if (!context) {
    // Return no-op functions if used outside provider
    return {
      record: null,
      isLoading: false,
      obtained: () => null,
      examined: () => null,
      elicited: () => null,
      noted: () => null,
      ordered: () => null,
      administered: () => null,
      changed: () => null,
      expressed: () => null,
      updateVitals: () => {},
      setInitialVitals: () => {},
      forceSync: () => Promise.resolve(),
      getRecord: () => null,
      getEvents: () => [],
      getEventsByVerb: () => [],
      getCurrentState: () => null,
      getSummary: () => null,
      getEventCount: () => 0,
      toNarrative: () => '',
      toJSON: () => '{}',
      lastSyncTime: null,
      syncError: null
    };
  }

  return context;
}

export default PatientRecordContext;
