import { useRef, useCallback, useEffect } from 'react';
import { apiUrl } from '../config/api';

/**
 * Event Logger Hook
 * Centralized logging for all monitor events with batch sending
 */
export const useEventLog = (sessionId) => {
  const eventQueue = useRef([]);
  const batchTimer = useRef(null);

  // Send batched events to backend
  const sendBatch = useCallback(async () => {
    if (!sessionId || eventQueue.current.length === 0) return;

    const events = [...eventQueue.current];
    eventQueue.current = [];

    try {
      const token = localStorage.getItem('token');
      await fetch(apiUrl('/api/events/batch'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          events
        })
      });
    } catch (error) {
      console.error('Failed to send event batch:', error);
      // Re-queue failed events
      eventQueue.current = [...events, ...eventQueue.current];
    }
  }, [sessionId]);

  // Schedule batch send
  const scheduleBatch = useCallback(() => {
    if (batchTimer.current) {
      clearTimeout(batchTimer.current);
    }
    batchTimer.current = setTimeout(sendBatch, 10000); // 10 seconds
  }, [sendBatch]);

  // Add event to queue
  const addEvent = useCallback((event) => {
    eventQueue.current.push({
      ...event,
      timestamp: new Date().toISOString()
    });
    scheduleBatch();
  }, [scheduleBatch]);

  // Specific logging functions
  const logVitalChange = useCallback((vital, oldValue, newValue) => {
    // Only log significant changes (>10% for most vitals)
    const threshold = vital === 'hr' ? 10 : vital === 'spo2' ? 5 : vital === 'bpSys' ? 10 : vital === 'bpDia' ? 10 : vital === 'rr' ? 3 : vital === 'temp' ? 0.5 : 5;
    const change = Math.abs(parseFloat(newValue) - parseFloat(oldValue));
    
    if (change >= threshold) {
      addEvent({
        event_type: 'vital_change',
        vital_sign: vital,
        old_value: String(oldValue),
        new_value: String(newValue),
        description: `${vital.toUpperCase()} changed from ${oldValue} to ${newValue}`
      });
    }
  }, [addEvent]);

  const logAlarm = useCallback((vital, thresholdType, thresholdValue, actualValue) => {
    addEvent({
      event_type: 'alarm',
      vital_sign: vital,
      old_value: String(thresholdValue),
      new_value: String(actualValue),
      description: `Alarm: ${vital.toUpperCase()} ${thresholdType} threshold (${thresholdValue}) - actual: ${actualValue}`
    });
  }, [addEvent]);

  const logScenarioStep = useCallback((label, scenarioName) => {
    addEvent({
      event_type: 'scenario_step',
      description: `Scenario "${scenarioName}": ${label}`
    });
  }, [addEvent]);

  const logCaseLoad = useCallback((caseName) => {
    addEvent({
      event_type: 'case_load',
      description: `Case loaded: ${caseName}`
    });
  }, [addEvent]);

  const logECGChange = useCallback((oldPattern, newPattern) => {
    addEvent({
      event_type: 'ecg_change',
      old_value: oldPattern,
      new_value: newPattern,
      description: `ECG pattern changed: ${oldPattern} → ${newPattern}`
    });
  }, [addEvent]);

  const logSettingsChange = useCallback((settingName, oldValue, newValue) => {
    addEvent({
      event_type: 'settings_change',
      old_value: String(oldValue),
      new_value: String(newValue),
      description: `Setting changed: ${settingName} = ${newValue}`
    });
  }, [addEvent]);

  const logUserAction = useCallback((action, details) => {
    addEvent({
      event_type: 'user_action',
      description: `${action}: ${details}`
    });
  }, [addEvent]);

  // Send any remaining events on unmount
  useEffect(() => {
    return () => {
      if (batchTimer.current) {
        clearTimeout(batchTimer.current);
      }
      if (eventQueue.current.length > 0) {
        sendBatch();
      }
    };
  }, [sendBatch]);

  return {
    logVitalChange,
    logAlarm,
    logScenarioStep,
    logCaseLoad,
    logECGChange,
    logSettingsChange,
    logUserAction
  };
};
