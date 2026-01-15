import { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl } from '../config/api';

// Default alarm thresholds
const DEFAULT_THRESHOLDS = {
  hr: { low: 50, high: 120, enabled: true },
  spo2: { low: 90, high: null, enabled: true },
  bpSys: { low: 90, high: 180, enabled: true },
  bpDia: { low: 50, high: 110, enabled: true },
  rr: { low: 8, high: 30, enabled: true },
  temp: { low: 36, high: 38.5, enabled: true },
  etco2: { low: 30, high: 50, enabled: true }
};

export const useAlarms = (vitals, sessionId, audioContext) => {
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [activeAlarms, setActiveAlarms] = useState(new Set());
  const [alarmHistory, setAlarmHistory] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [snoozeDuration, setSnoozeDuration] = useState(5); // minutes
  
  const alarmDebounce = useRef(new Map()); // vital -> last alarm time
  const snoozedAlarms = useRef(new Map()); // alarmKey -> snooze end time
  const acknowledgedAlarms = useRef(new Set()); // alarmKey -> acknowledged (until vital normalizes)
  const oscillatorRef = useRef(null);

  // Load user's alarm config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(apiUrl('/api/alarms/config/'), {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.config && data.config.length > 0) {
            const userThresholds = { ...DEFAULT_THRESHOLDS };
            data.config.forEach(cfg => {
              userThresholds[cfg.vital_sign] = {
                low: cfg.low_threshold,
                high: cfg.high_threshold,
                enabled: Boolean(cfg.enabled)
              };
            });
            setThresholds(userThresholds);
          }
        }
      } catch (error) {
        console.error('Failed to load alarm config:', error);
      }
    };
    
    loadConfig();
  }, []);

  // Check vitals against thresholds
  const checkVitals = useCallback(() => {
    if (!vitals) {
      console.log('[Alarms] No vitals to check');
      return;
    }
    // Note: Alarms work even without a session, but won't be logged to database

    const now = Date.now();
    const newActiveAlarms = new Set();

    // Check for expired snoozes and remove them
    for (const [alarmKey, snoozeEndTime] of snoozedAlarms.current.entries()) {
      if (now >= snoozeEndTime) {
        snoozedAlarms.current.delete(alarmKey);
        // console.log(`Snooze expired for ${alarmKey}, alarm will re-activate if condition persists`);
      }
    }

    Object.entries(vitals).forEach(([vital, value]) => {
      const threshold = thresholds[vital];
      if (!threshold || !threshold.enabled) return;

      const numValue = parseFloat(value);
      if (isNaN(numValue)) return;

      let alarmTriggered = false;
      let thresholdType = '';
      let thresholdValue = 0;

      // Check low threshold
      if (threshold.low !== null && numValue < threshold.low) {
        alarmTriggered = true;
        thresholdType = 'low';
        thresholdValue = threshold.low;
      }

      // Check high threshold
      if (threshold.high !== null && numValue > threshold.high) {
        alarmTriggered = true;
        thresholdType = 'high';
        thresholdValue = threshold.high;
      }

      const alarmKey = `${vital}_${thresholdType || 'normal'}`;

      if (alarmTriggered) {
        // console.log(`[Alarms] Threshold breach: ${vital}=${numValue} (${thresholdType} threshold: ${thresholdValue})`);

        // Skip if alarm is snoozed
        if (snoozedAlarms.current.has(alarmKey)) {
          // console.log(`[Alarms] ${alarmKey} is snoozed, skipping`);
          return;
        }

        // Skip if alarm is acknowledged (until vital normalizes)
        if (acknowledgedAlarms.current.has(alarmKey)) {
          // console.log(`[Alarms] ${alarmKey} is acknowledged, skipping until normalized`);
          return;
        }

        const lastAlarmTime = alarmDebounce.current.get(alarmKey) || 0;

        // Debounce: only trigger if 5 seconds have passed
        if (now - lastAlarmTime > 5000) {
          console.log(`[Alarms] FIRING alarm: ${alarmKey}`);
          newActiveAlarms.add(alarmKey);
          alarmDebounce.current.set(alarmKey, now);

          // Log alarm to backend
          logAlarm(vital, thresholdType, thresholdValue, numValue);

          // Add to history
          setAlarmHistory(prev => [...prev, {
            id: Date.now() + Math.random(),
            vital,
            thresholdType,
            thresholdValue,
            actualValue: numValue,
            timestamp: new Date().toISOString(),
            acknowledged: false,
            snoozed: false
          }]);
        } else {
          // Keep existing alarm active
          newActiveAlarms.add(alarmKey);
        }
      } else {
        // Vital is normal - clear any acknowledged state for this vital
        // This allows alarm to re-trigger if vital goes out of range again
        const lowKey = `${vital}_low`;
        const highKey = `${vital}_high`;
        if (acknowledgedAlarms.current.has(lowKey)) {
          acknowledgedAlarms.current.delete(lowKey);
          // console.log(`[Alarms] Cleared acknowledged state for ${lowKey} (vital normalized)`);
        }
        if (acknowledgedAlarms.current.has(highKey)) {
          acknowledgedAlarms.current.delete(highKey);
          // console.log(`[Alarms] Cleared acknowledged state for ${highKey} (vital normalized)`);
        }
      }
    });

    setActiveAlarms(newActiveAlarms);
  }, [vitals, thresholds, sessionId]);

  // Log alarm to backend
  const logAlarm = async (vital, thresholdType, thresholdValue, actualValue) => {
    // Skip logging if no active session
    if (!sessionId) return;
    
    try {
      const token = localStorage.getItem('token');
      await fetch(apiUrl('/api/alarms/log'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          vital_sign: vital,
          threshold_type: thresholdType,
          threshold_value: thresholdValue,
          actual_value: actualValue
        })
      });
    } catch (error) {
      console.error('Failed to log alarm:', error);
    }
  };

  // Play alarm sound
  useEffect(() => {
    if (!audioContext || isMuted || activeAlarms.size === 0) {
      // Stop any existing alarm sound
      if (oscillatorRef.current) {
        try {
          oscillatorRef.current.stop();
        } catch (e) {
          // Ignore if already stopped
        }
        oscillatorRef.current = null;
      }
      return;
    }

    // Create alarm tone
    if (!oscillatorRef.current) {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // 800 Hz beep
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime); // Low volume

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Create beeping pattern (0.2s on, 0.8s off)
      const beepPattern = () => {
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0, audioContext.currentTime + 0.2);
      };

      oscillator.start();
      oscillatorRef.current = oscillator;

      // Repeat beep pattern
      const beepInterval = setInterval(beepPattern, 1000);
      
      return () => {
        clearInterval(beepInterval);
        if (oscillatorRef.current) {
          try {
            oscillatorRef.current.stop();
          } catch (e) {
            // Ignore
          }
          oscillatorRef.current = null;
        }
      };
    }
  }, [audioContext, isMuted, activeAlarms.size]);

  // Check vitals every 2 seconds
  useEffect(() => {
    // Check immediately when vitals change
    checkVitals();
    const interval = setInterval(checkVitals, 2000);
    return () => clearInterval(interval);
  }, [checkVitals]);

  // Debug: Log when thresholds change
  useEffect(() => {
    console.log('[Alarms] Thresholds updated:', thresholds);
  }, [thresholds]);

  // Acknowledge alarm - prevents re-triggering until vital normalizes
  const acknowledgeAlarm = useCallback((alarmKey) => {
    // Add to acknowledged set (prevents re-triggering until vital normalizes)
    acknowledgedAlarms.current.add(alarmKey);

    // Remove from active alarms
    setActiveAlarms(prev => {
      const newSet = new Set(prev);
      newSet.delete(alarmKey);
      return newSet;
    });

    // Update history
    setAlarmHistory(prev =>
      prev.map(alarm => {
        const key = `${alarm.vital}_${alarm.thresholdType}`;
        if (key === alarmKey && !alarm.acknowledged) {
          return { ...alarm, acknowledged: true, acknowledgedAt: new Date().toISOString() };
        }
        return alarm;
      })
    );
  }, []);

  // Acknowledge all alarms - prevents re-triggering until vitals normalize
  const acknowledgeAll = useCallback(() => {
    // Add all active alarms to acknowledged set
    activeAlarms.forEach(alarmKey => {
      acknowledgedAlarms.current.add(alarmKey);
    });

    // Clear active alarms
    setActiveAlarms(new Set());

    // Update history
    setAlarmHistory(prev =>
      prev.map(alarm => ({
        ...alarm,
        acknowledged: true,
        acknowledgedAt: new Date().toISOString()
      }))
    );
  }, [activeAlarms]);

  // Snooze alarm
  const snoozeAlarm = useCallback((alarmKey, durationMinutes = null) => {
    const duration = durationMinutes || snoozeDuration;
    const snoozeEndTime = Date.now() + (duration * 60 * 1000);
    
    // Add to snoozed alarms map
    snoozedAlarms.current.set(alarmKey, snoozeEndTime);
    
    // Remove from active alarms
    setActiveAlarms(prev => {
      const newSet = new Set(prev);
      newSet.delete(alarmKey);
      return newSet;
    });

    // Update history
    setAlarmHistory(prev =>
      prev.map(alarm => {
        const key = `${alarm.vital}_${alarm.thresholdType}`;
        if (key === alarmKey && !alarm.snoozed) {
          return {
            ...alarm,
            snoozed: true,
            snoozedAt: new Date().toISOString(),
            snoozeUntil: new Date(snoozeEndTime).toISOString(),
            snoozeDuration: duration
          };
        }
        return alarm;
      })
    );
  }, [snoozeDuration]);

  // Snooze all alarms
  const snoozeAll = useCallback((durationMinutes = null) => {
    const duration = durationMinutes || snoozeDuration;
    const snoozeEndTime = Date.now() + (duration * 60 * 1000);
    
    activeAlarms.forEach(alarmKey => {
      snoozedAlarms.current.set(alarmKey, snoozeEndTime);
    });
    
    setActiveAlarms(new Set());
    
    setAlarmHistory(prev =>
      prev.map(alarm => {
        const key = `${alarm.vital}_${alarm.thresholdType}`;
        if (activeAlarms.has(key) && !alarm.snoozed) {
          return {
            ...alarm,
            snoozed: true,
            snoozedAt: new Date().toISOString(),
            snoozeUntil: new Date(snoozeEndTime).toISOString(),
            snoozeDuration: duration
          };
        }
        return alarm;
      })
    );
  }, [activeAlarms, snoozeDuration]);

  // Update thresholds
  const updateThreshold = useCallback((vital, low, high, enabled) => {
    setThresholds(prev => ({
      ...prev,
      [vital]: { low, high, enabled }
    }));
  }, []);

  // Save config to backend
  const saveConfig = useCallback(async (userId = null) => {
    try {
      const token = localStorage.getItem('token');
      
      for (const [vital, config] of Object.entries(thresholds)) {
        await fetch(apiUrl('/api/alarms/config'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            user_id: userId,
            vital_sign: vital,
            high_threshold: config.high,
            low_threshold: config.low,
            enabled: config.enabled
          })
        });
      }
    } catch (error) {
      console.error('Failed to save alarm config:', error);
    }
  }, [thresholds]);

  return {
    thresholds,
    setThresholds,
    activeAlarms: Array.from(activeAlarms),
    alarmHistory,
    isMuted,
    setIsMuted,
    snoozeDuration,
    setSnoozeDuration,
    snoozedAlarms: Array.from(snoozedAlarms.current.entries()).map(([key, time]) => ({
      key,
      until: new Date(time).toISOString(),
      remaining: Math.max(0, Math.ceil((time - Date.now()) / 1000 / 60)) // minutes
    })),
    acknowledgeAlarm,
    acknowledgeAll,
    snoozeAlarm,
    snoozeAll,
    updateThreshold,
    saveConfig,
    resetToDefaults: () => setThresholds(DEFAULT_THRESHOLDS)
  };
};
