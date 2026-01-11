import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Heart, Activity, Wind, Thermometer, Bell, Settings, Play, Pause, AlertCircle, Menu, X, Monitor, User, FileJson, FastForward, Save, Download, Upload, BellOff, Volume2, VolumeX, Pencil } from 'lucide-react';
import defaultSettings from '../../settings.json';
import { useEventLog } from '../../hooks/useEventLog';
import { useAlarms } from '../../hooks/useAlarms';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { getAudioContext, resumeAudioContext } from '../../utils/alarmAudio';
import LabValueEditor from '../investigations/LabValueEditor';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';

/**
 * ADVANCED ECG GENERATION UTILITIES
 * Based on a simplified McSharry driven cardiovascular system model (Sum of Gaussians)
 */

// Gaussian function: a * exp( - (t - b)^2 / (2 * c^2) )
const gaussian = (t, a, b, c) => a * Math.exp(-Math.pow(t - b, 2) / (2 * Math.pow(c, 2)));

// Skewed Gaussian for T-wave asymmetry (approx)
const skewGaussian = (t, a, b, c, skew) => {
   // Determine effective center shift based on skew
   // This is a rough approximation: skew > 0 stretches the right tail
   const x = (t - b) / c;
   // Standard normal PDF
   const pdf = Math.exp(-0.5 * x * x);
   // Error function approx for CDF
   const cdf = 0.5 * (1 + Math.tanh(skew * x * 0.79788));
   return a * pdf * cdf; // Amplitude scaling might be off, but visually it works
};


// Standard P-QRS-T parameters (approximate) relative to a beat duration of 1.0 at 60 BPM
// [Amplitude, Center (time), Width]
// We will adapt C (Width) based on HR to keep QRS constant duration in ms
const BASE_WAVES = {
   P: { a: 0.15, b: 0.20, c: 0.04 },
   Q: { a: -0.15, b: 0.35, c: 0.02 },
   R: { a: 1.0, b: 0.38, c: 0.03 },
   S: { a: -0.25, b: 0.42, c: 0.03 },
   T: { a: 0.3, b: 0.70, c: 0.08 },
};

const GenerateECGRaw = (phase, options = {}) => {
   let y = 0;
   const {
      stElev = 0,     // ST Elevation/Depression
      tInv = 0,
      wideQRS = 0,
      noise = 0,
      hr = 80         // Current Heart Rate to scale widths
   } = options;

   // Width Scaling:
   // At 60 BPM (1000ms), c=0.03 is ~30ms width in phase space? No.
   // Phase 0..1 = 1000ms. 0.03 * 1000 = 30ms sigma. 
   // QRS duration is ~3*sigma * 2 approx 100ms. Roughly correct.
   // If HR = 120 (500ms), Phase 0..1 = 500ms.
   // If we keep c=0.03, width is 0.03*500 = 15ms. TOO THIN.
   // We need width in ms to be constant.
   // New C = (Old C * 1000) / CurrentDuration
   //       = (Old C * 1000) / (60000 / HR)
   //       = Old C * (HR / 60)

   const widthScale = Math.max(1, hr / 60);

   // 1. P Wave (absent in AFib/VFib)
   if (!options.hideP) {
      y += gaussian(phase, BASE_WAVES.P.a, BASE_WAVES.P.b, BASE_WAVES.P.c * widthScale);
   } else if (options.afibNoise) {
      // F-waves for AFib
      y += Math.sin(phase * 40) * 0.03 + Math.sin(phase * 53) * 0.02;
   }

   // 2. QRS Complex
   const qrsW = (wideQRS > 0 ? 2.5 : 1.0) * widthScale;

   if (options.isPVC) {
      // PVC: Wide chaotic
      y += gaussian(phase, 0.8, 0.4, 0.12 * widthScale);
      y -= gaussian(phase, 0.4, 0.55, 0.15 * widthScale);
   } else if (!options.isVfib) {
      // Normal QRS
      y += gaussian(phase, BASE_WAVES.Q.a, BASE_WAVES.Q.b, BASE_WAVES.Q.c * qrsW);
      y += gaussian(phase, BASE_WAVES.R.a, BASE_WAVES.R.b, BASE_WAVES.R.c * qrsW);
      y += gaussian(phase, BASE_WAVES.S.a, BASE_WAVES.S.b, BASE_WAVES.S.c * qrsW);
   }

   // 3. T Wave & ST Segment
   if (!options.isPVC && !options.isVfib) {
      // ST Elevation/Depression: Realistic scaling (1mm = 0.1mV typically)
      // stElev is in mm, so we scale it subtly
      const stOffset = stElev * 0.08; // More realistic, subtle effect
      let tAmp = BASE_WAVES.T.a * (tInv ? -1 : 1);

      // ST Segment - subtle plateau between QRS and T wave
      if (Math.abs(stElev) > 0.1) {
         // Create a gentle ST segment elevation/depression
         y += gaussian(phase, stOffset, 0.48, 0.06 * widthScale); // J-point
         y += gaussian(phase, stOffset, 0.55, 0.10 * widthScale); // ST segment
         tAmp += stOffset * 0.5; // T-wave slightly affected
      }

      // T Wave - Asymmetric shape
      const tWidth = BASE_WAVES.T.c * widthScale * 1.2;
      y += gaussian(phase, tAmp, BASE_WAVES.T.b, tWidth);
   }

   // 4. V-Fib Chaos
   if (options.isVfib) {
      y = Math.sin(phase * 15) * 0.3 + Math.sin(phase * 19) * 0.2 + (Math.random() - 0.5) * 0.1;
   }

   // 5. Asystole
   if (options.isAsystole) {
      y = (Math.random() - 0.5) * 0.02; // Slight baseline wander line
   }

   // 6. Noise / Baseline Wander
   if (noise > 0) {
      y += (Math.random() - 0.5) * (noise * 0.05);
   }

   // Add consistent respiration wander
   // Passed in options? Or just hardcode a slow sine here?
   // We don't have time context easily here. Let's skip for now.

   return y;
};


// Default Monitor Settings (Factory Defaults)
const FACTORY_DEFAULTS = {
   rhythm: 'NSR',
   conditions: {
      pvc: false,
      stElev: 0,
      tInv: false,
      wideQRS: false,
      noise: 0
   },
   params: {
      hr: 80,
      spo2: 98,
      rr: 16,
      bpSys: 120,
      bpDia: 80,
      temp: 37.0,
      etco2: 38
   }
};

// Load settings from localStorage
const loadSavedSettings = () => {
   try {
      const saved = localStorage.getItem('rohy_monitor_settings');
      if (saved) {
         return JSON.parse(saved);
      }
   } catch (err) {
      console.error('Failed to load saved settings:', err);
   }
   return null;
};

// Save settings to localStorage
const saveSettings = (rhythm, conditions, params) => {
   try {
      const settings = { rhythm, conditions, params, savedAt: new Date().toISOString() };
      localStorage.setItem('rohy_monitor_settings', JSON.stringify(settings));
      return true;
   } catch (err) {
      console.error('Failed to save settings:', err);
      return false;
   }
};

// Clear saved settings
const clearSavedSettings = () => {
   try {
      localStorage.removeItem('rohy_monitor_settings');
      return true;
   } catch (err) {
      console.error('Failed to clear settings:', err);
      return false;
   }
};

// Export settings to JSON file
const exportSettingsToJSON = (rhythm, conditions, params) => {
   const settings = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      rhythm,
      conditions,
      params
   };
   
   const json = JSON.stringify(settings, null, 2);
   const blob = new Blob([json], { type: 'application/json' });
   const url = window.URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = `rohy-settings-${new Date().toISOString().split('T')[0]}.json`;
   document.body.appendChild(a);
   a.click();
   document.body.removeChild(a);
   window.URL.revokeObjectURL(url);
};

// Import settings from JSON file
const importSettingsFromJSON = (file, setRhythm, setConditions, setParams) => {
   return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
         try {
            const settings = JSON.parse(e.target.result);
            
            // Validate structure
            if (!settings.rhythm || !settings.conditions || !settings.params) {
               throw new Error('Invalid settings file format');
            }
            
            // Apply settings
            setRhythm(settings.rhythm);
            setConditions(settings.conditions);
            setParams(settings.params);
            
            resolve(settings);
         } catch (err) {
            reject(err);
         }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
   });
};

export default function PatientMonitor({ caseParams, caseData, sessionId, isAdmin: isAdminProp = false }) {
   const toast = useToast();
   const { isAdmin: isAdminAuth } = useAuth();
   const isAdmin = isAdminProp || isAdminAuth();
   // --- Refs for Canvas & Buffers ---
   const canvasRef = useRef(null);
   const ecgCanvasRef = useRef(null);
   const plethCanvasRef = useRef(null);
   const respCanvasRef = useRef(null);

   // Data Buffers (Circular or simple push/shift)
   // We use simple arrays and shift for this demo as performance is fine for < 2000 points
   const ecgBuffer = useRef(new Array(1000).fill(0));
   const plethBuffer = useRef(new Array(1000).fill(0));
   const respBuffer = useRef(new Array(1000).fill(0));
   
   // Audio context for alarms
   const audioContextRef = useRef(null);
   
   // Initialize audio context on first user interaction
   useEffect(() => {
      const initAudio = async () => {
         try {
            audioContextRef.current = getAudioContext();
            await resumeAudioContext();
         } catch (error) {
            console.error('Failed to initialize audio:', error);
         }
      };
      
      // Wait for user interaction
      const handleInteraction = () => {
         initAudio();
         document.removeEventListener('click', handleInteraction);
      };
      document.addEventListener('click', handleInteraction);
      
      return () => document.removeEventListener('click', handleInteraction);
   }, []);

   // --- Simulation State ---
   const [isPlaying, setIsPlaying] = useState(true);
   const [lastFrameTime, setLastFrameTime] = useState(0);

   // Load saved settings on mount
   const savedSettings = loadSavedSettings();
   const initialRhythm = savedSettings?.rhythm || FACTORY_DEFAULTS.rhythm;
   const initialConditions = savedSettings?.conditions || FACTORY_DEFAULTS.conditions;
   const initialParams = savedSettings?.params || FACTORY_DEFAULTS.params;

   // Rhythm & Conditions (Declared early due to dependency usage) // Moved UP
   const [rhythm, setRhythm] = useState(initialRhythm); // NSR, AFib, VTach, VFib, Asystole
   const [conditions, setConditions] = useState(initialConditions);

   // Patient Parameters (Target/Set values)
   const [params, setParams] = useState(initialParams);

   // Case baseline vitals (loaded from case config)
   const [caseBaseline, setCaseBaseline] = useState(null);
   const [caseBaselineRhythm, setCaseBaselineRhythm] = useState(null);
   const [caseBaselineConditions, setCaseBaselineConditions] = useState(null);

   // Track which vitals have been manually overridden from case defaults
   const [overriddenVitals, setOverriddenVitals] = useState(new Set());
   // Toggle to disable override tracking entirely
   const [trackOverrides, setTrackOverrides] = useState(true);

   // Session timer state
   const [sessionStartTime] = useState(() => Date.now());
   const [elapsedTime, setElapsedTime] = useState(0);

   // Platform settings for monitor visibility
   const [monitorSettings, setMonitorSettings] = useState({
      showTimer: true,
      showECG: true,
      showSpO2: true,
      showBP: true,
      showRR: true,
      showTemp: true,
      showCO2: true
   });

   // Display Vitals (Fluctuating values)
   const [displayVitals, setDisplayVitals] = useState(params);

   // Physics params ref to avoid dependency loops in animation
   const simulationParams = useRef(params);
   
   // Event Logging Hook
   const eventLog = useEventLog(sessionId);
   
   // Alarm System Hook
   const alarmSystem = useAlarms(displayVitals, sessionId, audioContextRef.current);
   
   // Previous vitals for change detection
   const prevVitalsRef = useRef(displayVitals);

   // Sync params changes to simulation ref immediately
   useEffect(() => {
      console.log('[PatientMonitor] Params changed, syncing:', params.hr, 'activeScenario:', activeScenario);
      simulationParams.current = params;
      // Always sync displayVitals when params change (scenario will override via its own loop)
      setDisplayVitals(params);
   }, [params]);
   
   // Log vital changes
   useEffect(() => {
      if (!sessionId || !eventLog.logVitalChange) return;
      
      const prev = prevVitalsRef.current;
      const current = displayVitals;
      
      // Log significant changes
      Object.keys(current).forEach(vital => {
         if (prev[vital] !== current[vital]) {
            eventLog.logVitalChange(vital, prev[vital], current[vital]);
         }
      });
      
      prevVitalsRef.current = displayVitals;
   }, [displayVitals, sessionId, eventLog]);

   // Session timer - update every second
   useEffect(() => {
      const timer = setInterval(() => {
         setElapsedTime(Math.floor((Date.now() - sessionStartTime) / 1000));
      }, 1000);
      return () => clearInterval(timer);
   }, [sessionStartTime]);

   // Load platform settings for monitor visibility
   useEffect(() => {
      const loadPlatformSettings = async () => {
         try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/platform-settings/monitor', {
               headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            if (response.ok) {
               const data = await response.json();
               setMonitorSettings(prev => ({ ...prev, ...data }));
            }
         } catch (err) {
            console.error('[Monitor] Failed to load platform settings:', err);
         }
      };
      loadPlatformSettings();
   }, []);

   // Format elapsed time as MM:SS or HH:MM:SS
   const formatElapsedTime = (seconds) => {
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      if (hrs > 0) {
         return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }
      return `${mins}:${secs.toString().padStart(2, '0')}`;
   };

   // --- Scenario Engine ---
   const [activeScenario, setActiveScenario] = useState(null); // 'mi_progression', etc.
   const [scenarioTime, setScenarioTime] = useState(0); // seconds
   const [scenarioPlaying, setScenarioPlaying] = useState(false);

   // Load Scenarios into State (to allow custom additions)
   const [scenarioList, setScenarioList] = useState(defaultSettings.scenarios);
   
   // Load initial vitals and scenario from case data when case loads
   useEffect(() => {
      if (caseData) {
         // Load initial vitals from case config
         // Priority: initialVitals > scenario first frame > legacy config > factory defaults
         const initialVitals = caseData.config?.initialVitals;
         const legacyConfig = caseData.config;

         // Get scenario's first frame params if available
         const scenarioTimeline = caseData.scenario?.timeline;
         const scenarioFirstFrame = scenarioTimeline && scenarioTimeline.length > 0
            ? scenarioTimeline.sort((a, b) => a.time - b.time)[0]
            : null;
         const scenarioParams = scenarioFirstFrame?.params;

         // Determine if we have any vitals to load
         const hasNewVitals = initialVitals && Object.keys(initialVitals).length > 0;
         const hasScenarioVitals = scenarioParams && Object.keys(scenarioParams).length > 0;
         const hasLegacyVitals = legacyConfig && (legacyConfig.hr || legacyConfig.spo2 || legacyConfig.rr);

         if (hasNewVitals || hasScenarioVitals || hasLegacyVitals) {
            // Set baseline from case (for reset functionality)
            // Priority: initialVitals > scenario first frame > legacy config > factory defaults
            const baselineParams = {
               hr: initialVitals?.hr ?? scenarioParams?.hr ?? legacyConfig?.hr ?? FACTORY_DEFAULTS.params.hr,
               spo2: initialVitals?.spo2 ?? scenarioParams?.spo2 ?? legacyConfig?.spo2 ?? FACTORY_DEFAULTS.params.spo2,
               rr: initialVitals?.rr ?? scenarioParams?.rr ?? legacyConfig?.rr ?? FACTORY_DEFAULTS.params.rr,
               bpSys: initialVitals?.bpSys ?? scenarioParams?.bpSys ?? legacyConfig?.sbp ?? legacyConfig?.bpSys ?? FACTORY_DEFAULTS.params.bpSys,
               bpDia: initialVitals?.bpDia ?? scenarioParams?.bpDia ?? legacyConfig?.dbp ?? legacyConfig?.bpDia ?? FACTORY_DEFAULTS.params.bpDia,
               temp: initialVitals?.temp ?? scenarioParams?.temp ?? legacyConfig?.temp ?? FACTORY_DEFAULTS.params.temp,
               etco2: initialVitals?.etco2 ?? scenarioParams?.etco2 ?? legacyConfig?.etco2 ?? FACTORY_DEFAULTS.params.etco2
            };
            console.log('[PatientMonitor] Loading case vitals:', baselineParams, 'source:', hasNewVitals ? 'initialVitals' : hasScenarioVitals ? 'scenario' : 'legacy');
            setCaseBaseline(baselineParams);
            setParams(baselineParams);

            // Set rhythm from case (priority: initialVitals > scenario > legacy)
            const scenarioRhythm = scenarioFirstFrame?.rhythm;
            const caseRhythm = initialVitals?.rhythm || scenarioRhythm || legacyConfig?.rhythm;
            if (caseRhythm) {
               setCaseBaselineRhythm(caseRhythm);
               setRhythm(caseRhythm);
            }

            // Set ECG conditions from case
            const scenarioConditions = scenarioFirstFrame?.conditions;
            const caseConditions = initialVitals?.conditions || scenarioConditions || legacyConfig?.conditions;
            if (caseConditions) {
               const conditionsToApply = {
                  pvc: caseConditions.pvc ?? false,
                  stElev: caseConditions.stElev ?? 0,
                  tInv: caseConditions.tInv ?? false,
                  wideQRS: caseConditions.wideQRS ?? false,
                  noise: caseConditions.noise ?? 0
               };
               setCaseBaselineConditions(conditionsToApply);
               setConditions(conditionsToApply);
            }

            // Clear overrides when new case loads
            setOverriddenVitals(new Set());
         }

         // Load alarm thresholds from case config
         const caseAlarms = caseData.config?.alarms;
         if (caseAlarms && alarmSystem.setThresholds) {
            const newThresholds = {};
            Object.keys(caseAlarms).forEach(vital => {
               if (caseAlarms[vital]) {
                  newThresholds[vital] = {
                     low: caseAlarms[vital].low,
                     high: caseAlarms[vital].high,
                     enabled: caseAlarms[vital].enabled ?? true
                  };
               }
            });
            if (Object.keys(newThresholds).length > 0) {
               alarmSystem.setThresholds(prev => ({ ...prev, ...newThresholds }));
            }
         }

         // Load scenario if present
         if (caseData.scenario) {
            const caseScenario = {
               id: `case_${caseData.id}`,
               name: `${caseData.name} - Scenario`,
               description: caseData.scenario.description || 'Case scenario',
               timeline: caseData.scenario.timeline || []
            };

            // Add case scenario to list if it has a timeline
            if (caseScenario.timeline.length > 0) {
               setScenarioList(prev => {
                  // Remove any existing case scenario and add new one
                  const filtered = prev.filter(s => !s.id.startsWith('case_'));
                  return [...filtered, caseScenario];
               });

               // Auto-start if configured
               if (caseData.scenario.autoStart) {
                  setActiveScenario(caseScenario.id);
                  setScenarioTime(0);
                  setScenarioPlaying(true);
               }
            }
         }

         // Log case load
         if (eventLog.logCaseLoad) {
            eventLog.logCaseLoad(caseData.name);
         }
      }
   }, [caseData]);

   // Custom Trend Builder State
   const [trendTarget, setTrendTarget] = useState({ hr: 100, spo2: 95, bpSys: 120, bpDia: 80, duration: 300 });
   const [showBuilder, setShowBuilder] = useState(false);

   // Create & Run Custom Trend
   const runCustomTrend = () => {
      const id = `custom_${Date.now()}`;
      const newScenario = {
         id,
         name: `Custom Trend (${(trendTarget.duration / 60).toFixed(1)}m)`,
         description: `Linear trend to HR ${trendTarget.hr}, SpO2 ${trendTarget.spo2}%`,
         timeline: [
            { time: 0, params: { ...params }, conditions: { ...conditions } }, // Start at current
            {
               time: trendTarget.duration,
               params: {
                  hr: trendTarget.hr,
                  spo2: trendTarget.spo2,
                  bpSys: trendTarget.bpSys,
                  bpDia: trendTarget.bpDia,
                  rr: params.rr
               }
            }
         ]
      };

      setScenarioList(prev => [...prev, newScenario]);
      setActiveScenario(id);
      setScenarioTime(0);
      setScenarioPlaying(true);
      setShowBuilder(false);
   };

   // Helper to update a vital and mark as overridden
   const updateVitalWithOverride = (vitalKey, value) => {
      setParams(prev => ({ ...prev, [vitalKey]: value }));
      if (caseBaseline && trackOverrides) {
         setOverriddenVitals(prev => new Set([...prev, vitalKey]));
      }
   };

   // Helper to update rhythm with override tracking
   const updateRhythmWithOverride = (newRhythm) => {
      setRhythm(newRhythm);
      if (caseBaselineRhythm && trackOverrides) {
         setOverriddenVitals(prev => new Set([...prev, 'rhythm']));
      }
   };

   // Helper to update conditions with override tracking
   const updateConditionsWithOverride = (newConditions) => {
      setConditions(newConditions);
      if (caseBaselineConditions && trackOverrides) {
         setOverriddenVitals(prev => new Set([...prev, 'conditions']));
      }
   };

   // Reset all vitals to case baseline
   const resetToCaseDefaults = () => {
      if (caseBaseline) {
         setParams(caseBaseline);
      }
      if (caseBaselineRhythm) {
         setRhythm(caseBaselineRhythm);
      }
      if (caseBaselineConditions) {
         setConditions(caseBaselineConditions);
      }
      setOverriddenVitals(new Set());
   };

   // Check if any vitals are overridden
   const hasOverrides = overriddenVitals.size > 0;

   // Engine Loop
   useEffect(() => {
      if (!activeScenario || !scenarioPlaying) return;

      const interval = setInterval(() => {
         setScenarioTime(t => {
            const nextTime = t + 1;
            const scenario = scenarioList.find(s => s.id === activeScenario);
            if (!scenario) return nextTime;

            // Find current segment
            const timeline = scenario.timeline.sort((a, b) => a.time - b.time);

            // 1. Find keyframes surrounding current time
            // keyframe A <= time < keyframe B
            let idx = timeline.findIndex(k => k.time > nextTime);
            if (idx === -1) idx = timeline.length; // Past last frame

            const toFrame = timeline[idx < timeline.length ? idx : timeline.length - 1];
            const fromFrame = timeline[idx > 0 ? idx - 1 : 0];

            if (toFrame && fromFrame && toFrame !== fromFrame) {
               // Interpolate
               const totalDur = toFrame.time - fromFrame.time;
               const progress = (nextTime - fromFrame.time) / totalDur; // 0 to 1

               const lerp = (start, end, p) => start + (end - start) * p;

               // Interpolate Params
               const newParams = { ...params }; // Start with current or base? 
               // Better: Interpolate between the *values defined in the frames*.
               // If a value is missing in 'from', use current state? No, assume defined or carry over.
               // Simplified: We interpolate everything defined in 'toFrame'.

               const getVal = (obj, key, def) => (obj && obj[key] !== undefined) ? obj[key] : def;

               const pKeys = ['hr', 'spo2', 'rr', 'bpSys', 'bpDia'];
               const interpolatedParams = {};

               pKeys.forEach(key => {
                  const startVal = getVal(fromFrame.params, key, params[key]);
                  const endVal = getVal(toFrame.params, key, startVal);
                  interpolatedParams[key] = Math.round(lerp(startVal, endVal, progress));
               });

               setParams(prev => ({ ...prev, ...interpolatedParams }));

               // Interpolate Conditions (Float values like stElev)
               // Boolean/Enum conditions (rhythm, pvc, wideQRS) usually switch at the Keyframe time
               const cKeys = ['stElev', 'noise'];
               const interpolatedConds = {};
               cKeys.forEach(key => {
                  const startVal = getVal(fromFrame.conditions, key, conditions[key]);
                  const endVal = getVal(toFrame.conditions, key, startVal);
                  interpolatedConds[key] = parseFloat(lerp(startVal, endVal, progress).toFixed(2));
               });

               // Discrete switches happening EXACTLY at frame time
               // We check if we just crossed a frame time
               // Or simplified: Use 'fromFrame' discrete values as the "current state"
               // But better: If we are close to 'fromFrame.time', apply its discrete settings one-shot?
               // Actually, 'fromFrame' is the state we are LEAVING or IN.
               // We should ensure the discrete state matches 'fromFrame'.

               const discKeys = ['pvc', 'wideQRS', 'tInv'];
               discKeys.forEach(key => {
                  if (fromFrame.conditions && fromFrame.conditions[key] !== undefined) {
                     interpolatedConds[key] = fromFrame.conditions[key];
                  }
               });

               if (fromFrame.rhythm) {
                  setRhythm(fromFrame.rhythm);
               }

               setConditions(prev => ({ ...prev, ...interpolatedConds }));
            } else if (toFrame && nextTime >= toFrame.time) {
               // We are sitting at or past the last frame
               // Ensure final state
               if (toFrame.params) setParams(prev => ({ ...prev, ...toFrame.params }));
               if (toFrame.rhythm) setRhythm(toFrame.rhythm);
               if (toFrame.conditions) setConditions(prev => ({ ...prev, ...toFrame.conditions }));
            }

            return nextTime;
         });
      }, 1000); // Update scenario logic every second (interpolation granularity)

      return () => clearInterval(interval);
   }, [activeScenario, scenarioPlaying, params, conditions]); // Params/conditions deps might cause jitter logic loops needed? 
   // Actually, we are calling setParams, which triggers the other useEffect that updates simulationParams.
   // That's fine.

   // Vital Signs Fluctuation Loop (Jitter)
   useEffect(() => {
      // Jitter only if NOT in a critical arrested state (though noise might exist)
      // If scenario is driving, we still want jitter ON TOP of the scenario path?
      // Yes, scenario sets the "Target" params, this loop adds noise to "Display".

      const interval = setInterval(() => {
         const p = simulationParams.current;
         const rhythmType = rhythm; // Closure capture or ref? Rhythm needs to be in ref too if used here

         if (rhythmType === 'Asystole' || rhythmType === 'VFib') {
            // Cardiac arrest state - no perfusion
            setDisplayVitals(prev => ({ 
               ...prev, 
               hr: 0, 
               spo2: "?", 
               bpSys: "?", 
               bpDia: "?",
               etco2: Math.max(0, (prev.etco2 || 38) - 5) // EtCO2 drops without perfusion
               // temp stays at current value (doesn't change immediately)
            }));
            return;
         }

         // Calculate Noise
         const noiseHR = Math.floor(Math.random() * 5) - 2; // -2 to +2
         const noiseSpO2 = Math.random() > 0.8 ? -1 : 0;
         const noiseRR = Math.floor(Math.random() * 3) - 1;
         const noiseSys = Math.floor(Math.random() * 5) - 2;
         const noiseDia = Math.floor(Math.random() * 4) - 2;
         const noiseTemp = (Math.random() - 0.5) * 0.2; // ±0.1°C
         const noiseEtCO2 = Math.floor(Math.random() * 3) - 1; // -1 to +1

         const newVitals = {
            ...p,
            hr: Math.max(0, p.hr + noiseHR),
            spo2: Math.min(100, Math.max(0, p.spo2 + noiseSpO2)),
            rr: Math.max(0, p.rr + noiseRR),
            bpSys: p.bpSys + noiseSys,
            bpDia: p.bpDia + noiseDia,
            temp: Math.max(30, Math.min(42, p.temp + noiseTemp)), // Keep in realistic range
            etco2: Math.max(0, Math.min(100, p.etco2 + noiseEtCO2)),
         };

         setDisplayVitals(newVitals);

         // Update physics ref so wave speed matches display? 
         // Actually, wave speed should probably stay closer to target to avoid jerky waves,
         // but slight match is good. Let's update simulationParams to match display for a second?
         // No, keep simulationParams as SETTINGS, but maybe add a 'current' field.
         // For simplicity, let's just let the physics read the jittered value from a separate ref if we wanted perfect sync.
         // But here we will stick to physics reading 'simulationParams' (target) to keep regular rhythm,
         // and just show jittered numbers. 

      }, 2000);
      return () => clearInterval(interval);
   }, [rhythm]); // Restart if Rhythm changes



   const [controlsOpen, setControlsOpen] = useState(false);
   const [activeTab, setActiveTab] = useState('rhythm'); // rhythm, vitals, display

   // Event logging handlers for controls panel
   const handleControlsOpen = (tab = null) => {
      if (tab) {
         setActiveTab(tab);
         EventLogger.tabSwitched(tab, COMPONENTS.PATIENT_MONITOR);
      }
      setControlsOpen(true);
      EventLogger.componentOpened(COMPONENTS.PATIENT_MONITOR, 'Monitor Controls');
   };

   const handleControlsClose = () => {
      setControlsOpen(false);
      EventLogger.componentClosed(COMPONENTS.PATIENT_MONITOR, 'Monitor Controls');
   };

   const handleTabChange = (tab) => {
      setActiveTab(tab);
      EventLogger.tabSwitched(tab, COMPONENTS.PATIENT_MONITOR);
   };

   // Log alarm acknowledgement
   const handleAcknowledgeAlarm = (alarmKey) => {
      alarmSystem.acknowledgeAlarm(alarmKey);
      EventLogger.alarmAcknowledged(alarmKey, COMPONENTS.PATIENT_MONITOR);
   };

   const handleAcknowledgeAll = () => {
      alarmSystem.acknowledgeAll();
      EventLogger.buttonClicked('Acknowledge All Alarms', COMPONENTS.PATIENT_MONITOR);
   };

   const handleSnoozeAlarm = (alarmKey) => {
      alarmSystem.snoozeAlarm(alarmKey);
      EventLogger.alarmSilenced(alarmKey, COMPONENTS.PATIENT_MONITOR);
   };

   // Internal Physics State
   const physics = useRef({
      phase: 0.0,      // 0.0 to 1.0 (cardiac cycle position)
      respPhase: 0.0,  // 0.0 to 1.0 (respiratory cycle)
      lastBeatTime: 0,
      nextBeatDuration: 750, // ms
      pvcChance: 0.0,  // Dynamic probability
   });

   // --- Animation Loop ---
   useEffect(() => {
      let animationId;
      let lastTime = performance.now();

      const loop = (time) => {
         const dt = time - lastTime;
         lastTime = time;

         if (isPlaying) {
            updateSimulation(dt);
            drawWaveforms();
         }

         animationId = requestAnimationFrame(loop);
      };

      animationId = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(animationId);
   }, [isPlaying, params, rhythm, conditions]);

   // --- Physics Update ---
   const updateSimulation = (dt) => {
      const p = physics.current;

      // 1. Calculate Cardiac Phase
      let currentHR = params.hr;

      // Rhythm Logic Overrides
      if (rhythm === 'VFib') currentHR = 0; // Chaotic phase, HR meaningless
      if (rhythm === 'Asystole') currentHR = 0;

      // Cycle duration in ms
      let targetDuration = currentHR > 0 ? (60000 / currentHR) : 1000;

      // Arrhythmia variability
      if (rhythm === 'AFib') {
         // AFib: Irregularly Irregular. 
         // Base duration on HR but add significant variance per beat
         targetDuration = (60000 / params.hr) + (Math.random() * 400 - 200);
      }

      // Advance Phase
      if (rhythm === 'Asystole') {
         p.phase = 0; // Stuck
      } else if (rhythm === 'VFib') {
         p.phase += dt / 200; // Fast chaos
      } else {
         // Normal beat progression
         p.phase += dt / p.nextBeatDuration;
         if (p.phase >= 1.0) {
            p.phase = 0; // Beat Reset
            p.nextBeatDuration = targetDuration; // New interval for next beat

            // Random PVC trigger
            if (conditions.pvc && Math.random() < 0.15) {
               // Shorten next beat for PVC (early beat)
               p.nextBeatDuration *= 0.6;
               p.isNextPVC = true;
            } else {
               p.isNextPVC = false;
            }
         }
      }

      // 2. Advance Respiratory Phase
      const respDuration = params.rr > 0 ? (60000 / params.rr) : 10000;
      p.respPhase += dt / respDuration;
      if (p.respPhase >= 1.0) p.respPhase = 0;


      // 3. Generate Data Points
      const isPVC = p.isNextPVC;

      // ECG
      const ecgOpts = {
         stElev: conditions.stElev,
         tInv: conditions.tInv,
         wideQRS: conditions.wideQRS ? 1 : 0,
         noise: conditions.noise,
         hideP: rhythm === 'AFib' || rhythm === 'VTach',
         afibNoise: rhythm === 'AFib',
         isPVC: isPVC,
         isVfib: rhythm === 'VFib',
         isAsystole: rhythm === 'Asystole',
         hr: currentHR // Pass HR for width scaling
      };

      const ecgVal = GenerateECGRaw(p.phase, ecgOpts);
      ecgBuffer.current.shift();
      ecgBuffer.current.push(ecgVal);

      // PLETH (SpO2)
      let plethVal = 0;
      if (currentHR > 0) {
         const plethPhase = (p.phase - 0.1 + 1.0) % 1.0; // Delayed
         // High HR attenuates pulse slightly
         const amp = currentHR > 140 ? 0.7 : 1.0;

         if (plethPhase < 0.2) {
            plethVal = Math.sin(plethPhase * 5 * Math.PI / 2) * amp;
         } else {
            const decay = 1 - ((plethPhase - 0.2) / 0.8);
            const notch = Math.exp(-Math.pow(plethPhase - 0.5, 2) / 0.005) * 0.15 * amp;
            plethVal = (decay * 0.8 + notch);
         }
      }
      plethVal *= (1 + 0.1 * Math.sin(p.respPhase * 2 * Math.PI));

      plethBuffer.current.shift();
      plethBuffer.current.push(plethVal);

      // RESP
      const respVal = Math.sin(p.respPhase * 2 * Math.PI);
      respBuffer.current.shift();
      respBuffer.current.push(respVal);
   };

   // Helper to switch rhythm and set appropriate defaults
   const handleRhythmChange = (r) => {
      updateRhythmWithOverride(r);
      const updates = {};

      switch (r) {
         case 'NSR':
            updates.hr = 80;
            updates.spo2 = 98;
            break;
         case 'AFib':
            updates.hr = 110; // Rapid ventricular response
            updates.spo2 = 95;
            break;
         case 'VTach':
            updates.hr = 160;
            updates.spo2 = 88;
            updates.bpSys = 90; // Hypotension
            break;
         case 'VFib':
         case 'Asystole':
            // HR is 0 effectively
            break;
      }

      if (Object.keys(updates).length > 0) {
         setParams(p => ({ ...p, ...updates }));
         // Mark affected vitals as overridden (if tracking is enabled)
         if (caseBaseline && trackOverrides) {
            setOverriddenVitals(prev => new Set([...prev, ...Object.keys(updates)]));
         }
      }
   };

   // --- Drawing ---
   const drawWaveforms = () => {
      drawCanvas(ecgCanvasRef.current, ecgBuffer.current, '#00ff00', 2, 1);
      drawCanvas(plethCanvasRef.current, plethBuffer.current, '#0ea5e9', 1.5, 0.5); // Cyan
      drawCanvas(respCanvasRef.current, respBuffer.current, '#f59e0b', 1.5, 0); // Amber/Yellow
   };

   const drawCanvas = (canvas, data, color, lineWidth, gain) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Grid (faint)
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      // Vertical lines every 50px
      for (let x = 0; x < w; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      ctx.stroke();

      // Signal
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.beginPath();

      const step = w / data.length;
      // Auto-center baseline
      const baseline = h / 2;
      const scale = -(h * 0.4); // Negative to flip Y (up is positive voltage)

      for (let i = 0; i < data.length; i++) {
         const x = i * step;
         const y = baseline + (data[i] * scale * (gain || 1));
         if (i === 0) ctx.moveTo(x, y);
         else ctx.lineTo(x, y);
      }
      ctx.stroke();
   };

   // --- Resize Handler ---
   const containerRef = useRef(null);

   useEffect(() => {
      if (!containerRef.current) return;

      const handleResize = () => {
         [ecgCanvasRef, plethCanvasRef, respCanvasRef].forEach(ref => {
            if (ref.current) {
               const rect = ref.current.getBoundingClientRect();
               // Only update if dimensions differ significantly to avoid loops
               if (ref.current.width !== rect.width * 2 || ref.current.height !== rect.height * 2) {
                  ref.current.width = rect.width * 2;
                  ref.current.height = rect.height * 2;
               }
            }
         });
      };

      const observer = new ResizeObserver(() => {
         window.requestAnimationFrame(handleResize);
      });

      observer.observe(containerRef.current);
      handleResize(); // Initial

      return () => observer.disconnect();
   }, []);

   return (
      <div ref={containerRef} className="flex flex-col h-full bg-black text-gray-100 font-sans overflow-hidden select-none">

         {/* HEADER */}
         <div className="flex items-center justify-between px-4 py-3 bg-neutral-900 border-b border-neutral-800 shrink-0 z-20">
            <div className="flex items-center gap-4">
               <div className="bg-neutral-800 p-2 rounded-md">
                  <Monitor className="w-5 h-5 text-blue-400" />
               </div>
               <div>
                  <h1 className="text-lg font-bold tracking-tight text-white leading-tight">
                     {caseData?.config?.patient_name || caseData?.name || 'ICU MONITOR'}
                  </h1>
                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                     <User className="w-3 h-3" />
                     <span>
                        {caseData?.config?.demographics?.age ? `${caseData.config.demographics.age}y` : ''}
                        {caseData?.config?.demographics?.gender ? ` ${caseData.config.demographics.gender}` : ''}
                        {caseData?.config?.demographics?.weight ? ` • ${caseData.config.demographics.weight}kg` : ''}
                     </span>
                  </div>
               </div>
            </div>

            <div className="flex items-center gap-3">
               {/* Session Timer */}
               {monitorSettings.showTimer && (
                  <div className="text-center mr-2 px-3 py-1 bg-neutral-800 rounded-lg">
                     <div className="text-lg font-mono font-bold text-green-400">{formatElapsedTime(elapsedTime)}</div>
                     <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Session Time</div>
                  </div>
               )}
               <div className="text-right mr-4 hidden md:block">
                  <div className="text-sm font-bold text-neutral-300">{new Date().toLocaleTimeString()}</div>
                  <div className="text-xs text-neutral-500">{new Date().toLocaleDateString()}</div>
               </div>

               <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className={`p-2 rounded-full transition-colors ${isPlaying ? 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700' : 'bg-green-900/40 text-green-400 animate-pulse'}`}
               >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
               </button>

               <button
                  onClick={() => handleControlsOpen('alarms')}
                  className={`p-2 rounded-full transition-colors relative ${alarmSystem.activeAlarms.length > 0 ? 'bg-red-900/40 text-red-500 animate-pulse' : 'bg-neutral-800 text-neutral-400'}`}
                  title="Alarms"
               >
                  <Bell className="w-5 h-5" />
                  {alarmSystem.activeAlarms.length > 0 && (
                     <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                        {alarmSystem.activeAlarms.length}
                     </span>
                  )}
               </button>

               <button
                  onClick={() => handleControlsOpen()}
                  className={`p-2 rounded-md transition-colors shadow-lg relative ${
                     savedSettings
                        ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/20'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20'
                  }`}
                  title={savedSettings ? 'Monitor Settings (Custom settings loaded)' : 'Monitor Settings'}
               >
                  <Settings className="w-5 h-5" />
                  {savedSettings && (
                     <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-neutral-900"></span>
                  )}
               </button>
            </div>
         </div>

         {/* MAIN LAYOUT */}
         <div className="flex flex-1 relative overflow-hidden">

            {/* WAVEFORMS (LEFT) */}
            <div className="flex-1 flex flex-col bg-black relative">

               {/* Channel 1: ECG */}
               <div className="flex-1 min-h-[160px] border-b border-neutral-800/50 relative group">
                  <div className="absolute top-2 left-3 z-10 font-mono text-sm font-bold text-green-500 select-none">
                     II <span className="text-xs font-normal opacity-70 ml-1">1mV</span>
                  </div>
                  <canvas ref={ecgCanvasRef} className="w-full h-full block" />
                  <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-black via-transparent to-transparent pointer-events-none" />
               </div>

               {/* Channel 2: PLETH */}
               <div className="h-32 border-b border-neutral-800/50 relative">
                  <div className="absolute top-2 left-3 z-10 font-mono text-sm font-bold text-sky-500 select-none">
                     PLETH
                  </div>
                  <canvas ref={plethCanvasRef} className="w-full h-full block" />
               </div>

               {/* Channel 3: RESP */}
               <div className="h-32 border-b border-neutral-800/50 relative">
                  <div className="absolute top-2 left-3 z-10 font-mono text-sm font-bold text-amber-500 select-none">
                     RESP <span className="text-xs font-normal opacity-70 ml-1">Imp</span>
                  </div>
                  <canvas ref={respCanvasRef} className="w-full h-full block" />
               </div>

            </div>

            {/* VITALS (RIGHT SIDEBAR) */}
            <div className="w-64 bg-neutral-900/50 backdrop-blur-sm border-l border-neutral-800 flex flex-col shrink-0 overflow-y-auto">

               {/* HR Box */}
               <div className="flex-1 border-b border-neutral-800 p-4 flex flex-col justify-center relative overflow-hidden">
                  <div className="absolute top-2 left-3 text-green-500 font-bold text-sm flex items-center gap-1">
                     <Heart className="w-3 h-3" /> HR
                  </div>
                  <div className="text-right relative z-10">
                     <div className={`text-7xl font-mono font-bold tracking-tighter ${rhythm === 'Asystole' ? 'text-red-500' : 'text-green-500'}`}>
                        {rhythm === 'Asystole' || rhythm === 'VFib' ? '---' : displayVitals.hr}
                     </div>
                     <div className="text-neutral-500 text-xs mt-[-5px]">bpm</div>
                  </div>
               </div>

               {/* SpO2 Box */}
               <div className="h-32 border-b border-neutral-800 p-4 flex flex-col justify-center relative">
                  <div className="absolute top-2 left-3 text-sky-500 font-bold text-sm">SpO2</div>
                  <div className="text-right">
                     <div className="text-5xl font-mono font-bold tracking-tighter text-sky-500">
                        {displayVitals.spo2}<span className="text-2xl opacity-50">%</span>
                     </div>
                  </div>
                  {/* Signal Quality Bar */}
                  <div className="absolute bottom-3 left-4 right-4 h-1 bg-neutral-800 rounded overflow-hidden">
                     <div className="h-full bg-sky-600 w-[90%]" />
                  </div>
               </div>

               {/* NIBP Box */}
               <div className="h-32 border-b border-neutral-800 p-4 flex flex-col justify-center relative">
                  <div className="absolute top-2 left-3 text-red-500 font-bold text-sm">NIBP</div>
                  <div className="text-right mt-2">
                     <div className="text-4xl font-mono font-bold tracking-tighter text-red-100 leading-none">
                        {displayVitals.bpSys}/{displayVitals.bpDia}
                     </div>
                     <div className="text-red-400 text-sm mt-1 font-mono">
                        ({Math.round((displayVitals.bpSys + 2 * displayVitals.bpDia) / 3)})
                     </div>
                  </div>
                  <div className="absolute bottom-2 left-3 text-[10px] text-neutral-500">
                     AUTO 15min • <span className="text-neutral-300">14:02</span>
                  </div>
               </div>

               {/* RESP Box */}
               <div className="h-32 border-b border-neutral-800 p-4 flex flex-col justify-center relative">
                  <div className="absolute top-2 left-3 text-amber-500 font-bold text-sm">RESP</div>
                  <div className="text-right">
                     <div className="text-5xl font-mono font-bold tracking-tighter text-amber-500">
                        {displayVitals.rr}
                     </div>
                     <div className="text-neutral-500 text-xs">rpm</div>
                  </div>
               </div>

               {/* Temperature Box */}
               <div className="h-32 border-b border-neutral-800 p-4 flex flex-col justify-center relative">
                  <div className="absolute top-2 left-3 text-orange-500 font-bold text-sm">TEMP</div>
                  <div className="text-right">
                     <div className="text-4xl font-mono font-bold tracking-tighter text-orange-100">
                        {displayVitals.temp?.toFixed(1) || '37.0'}
                     </div>
                     <div className="text-neutral-500 text-xs">°C</div>
                  </div>
                  <div className="absolute bottom-2 left-3 text-[10px] text-neutral-500">
                     Core • <span className="text-neutral-300">Esophageal</span>
                  </div>
               </div>

               {/* EtCO2 Box */}
               <div className="h-32 border-b border-neutral-800 p-4 flex flex-col justify-center relative">
                  <div className="absolute top-2 left-3 text-yellow-500 font-bold text-sm">EtCO<sub className="text-xs">2</sub></div>
                  <div className="text-right">
                     <div className="text-5xl font-mono font-bold tracking-tighter text-yellow-500">
                        {displayVitals.etco2 || 38}
                     </div>
                     <div className="text-neutral-500 text-xs">mmHg</div>
                  </div>
               </div>

            </div>
         </div>

         {/* CONTROLS OVERLAY (DRAWER) */}
         <div
            className={`fixed inset-y-0 right-0 w-96 bg-neutral-900 border-l border-neutral-700 shadow-2xl transform transition-transform duration-300 ease-out z-50 flex flex-col ${controlsOpen ? 'translate-x-0' : 'translate-x-full'}`}
         >
            <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-800">
               <h2 className="text-white font-bold text-lg flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-500" />
                  Simulator Controls
               </h2>
               <button onClick={handleControlsClose} className="text-neutral-400 hover:text-white">
                  <X className="w-6 h-6" />
               </button>
            </div>

            {/* Tabs - Students only see alarms tab */}
            <div className="flex p-1 bg-neutral-900 border-b border-neutral-800 overflow-x-auto">
               {(isAdmin ? ['rhythm', 'vitals', 'scenarios', 'alarms', 'labs'] : ['alarms']).map(tab => (
                  <button
                     key={tab}
                     onClick={() => handleTabChange(tab)}
                     className={`flex-1 py-2 px-2 text-sm font-bold uppercase tracking-wider rounded-md transition-colors whitespace-nowrap ${activeTab === tab ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                  >
                     {tab}
                  </button>
               ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">

               {activeTab === 'scenarios' && (
                  <div className="space-y-6">
                     <div className="bg-neutral-800/50 p-4 rounded-lg border border-neutral-800">
                        <div className="flex justify-between items-center mb-4">
                           <h3 className="text-white font-bold flex items-center gap-2">
                              <FileJson className="w-5 h-5 text-purple-500" />
                              Scenarios
                           </h3>
                           <div className="text-xs font-mono text-neutral-400">
                              {scenarioTime}s
                           </div>
                        </div>

                        {activeScenario && (
                           <div className="mb-4 space-y-3">
                              <div className="flex items-center gap-2 bg-black/40 p-2 rounded">
                                 <button
                                    onClick={() => setScenarioPlaying(!scenarioPlaying)}
                                    className={`p-2 rounded-full ${scenarioPlaying ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'}`}
                                 >
                                    {scenarioPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                 </button>
                                 <div className="flex-1">
                                    <div className="text-xs text-neutral-400 uppercase">Current</div>
                                    <div className="text-sm font-bold text-white max-w-[150px] truncate">
                                       {scenarioList.find(s => s.id === activeScenario)?.name}
                                    </div>
                                 </div>
                                 <button
                                    onClick={() => {
                                       setScenarioPlaying(false);
                                       setScenarioTime(0);
                                       setActiveScenario(null);
                                    }}
                                    className="text-xs text-neutral-500 hover:text-white underline"
                                 >
                                    Stop/Reset
                                 </button>
                              </div>

                              {/* Manual Step Triggers */}
                              <div className="bg-neutral-900/50 p-3 rounded border border-neutral-700">
                                 <div className="text-xs font-bold text-neutral-400 uppercase mb-2">Manual Controls</div>
                                 <div className="space-y-2">
                                    {(() => {
                                       const scenario = scenarioList.find(s => s.id === activeScenario);
                                       if (!scenario || !scenario.timeline) return null;
                                       
                                       return scenario.timeline.map((step, index) => {
                                          const isCurrentStep = scenarioTime >= step.time && 
                                             (index === scenario.timeline.length - 1 || scenarioTime < scenario.timeline[index + 1]?.time);
                                          
                                          return (
                                             <button
                                                key={index}
                                                onClick={() => {
                                                   setScenarioTime(step.time);
                                                   // Apply step immediately
                                                   if (step.rhythm) setRhythm(step.rhythm);
                                                   if (step.params) {
                                                      setParams(p => ({ ...p, ...step.params }));
                                                   }
                                                   if (step.conditions) {
                                                      setConditions(c => ({ ...c, ...step.conditions }));
                                                   }
                                                   if (eventLog.logScenarioStep) {
                                                      eventLog.logScenarioStep(step.label || `Step ${index + 1}`, scenario.name);
                                                   }
                                                }}
                                                className={`w-full text-left p-2 rounded text-xs transition-colors ${
                                                   isCurrentStep 
                                                      ? 'bg-blue-900/40 border border-blue-500/50 text-blue-300' 
                                                      : 'bg-neutral-800/50 hover:bg-neutral-700 text-neutral-300'
                                                }`}
                                             >
                                                <div className="flex items-center justify-between">
                                                   <span className="font-mono">{Math.floor(step.time / 60)}:{(step.time % 60).toString().padStart(2, '0')}</span>
                                                   {isCurrentStep && <span className="text-[10px] px-2 py-0.5 bg-blue-600 rounded">ACTIVE</span>}
                                                </div>
                                                <div className="text-neutral-400 mt-1">{step.label || `Step ${index + 1}`}</div>
                                             </button>
                                          );
                                       });
                                    })()}
                                 </div>
                              </div>
                           </div>
                        )}

                        {/* Custom Trend Button */}
                        {!showBuilder ? (
                           <button
                              onClick={() => setShowBuilder(true)}
                              className="w-full py-3 mb-4 rounded border-2 border-dashed border-neutral-700 text-neutral-400 font-bold text-sm uppercase hover:bg-neutral-800 hover:border-neutral-500 transition-all flex items-center justify-center gap-2"
                           >
                              <Settings className="w-4 h-4" /> Build Custom Scenario
                           </button>
                        ) : (
                           <div className="mb-4 bg-neutral-900 border border-neutral-700 p-3 rounded-md space-y-3 animate-in fade-in slide-in-from-top-2">
                              <div className="flex justify-between items-center text-xs font-bold text-neutral-400 uppercase">
                                 <span>Target Values</span>
                                 <button onClick={() => setShowBuilder(false)}><X className="w-4 h-4" /></button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                 <div className="space-y-1">
                                    <label className="text-[10px] text-neutral-500">HR (bpm)</label>
                                    <input type="number"
                                       value={trendTarget.hr}
                                       onChange={e => setTrendTarget({ ...trendTarget, hr: parseInt(e.target.value) })}
                                       className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-green-500 font-mono"
                                    />
                                 </div>
                                 <div className="space-y-1">
                                    <label className="text-[10px] text-neutral-500">SpO2 (%)</label>
                                    <input type="number"
                                       value={trendTarget.spo2}
                                       onChange={e => setTrendTarget({ ...trendTarget, spo2: parseInt(e.target.value) })}
                                       className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-sky-500 font-mono"
                                    />
                                 </div>
                                 <div className="space-y-1">
                                    <label className="text-[10px] text-neutral-500">BP Sys</label>
                                    <input type="number"
                                       value={trendTarget.bpSys}
                                       onChange={e => setTrendTarget({ ...trendTarget, bpSys: parseInt(e.target.value) })}
                                       className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-red-400 font-mono"
                                    />
                                 </div>
                                 <div className="space-y-1">
                                    <label className="text-[10px] text-neutral-500">BP Dia</label>
                                    <input type="number"
                                       value={trendTarget.bpDia}
                                       onChange={e => setTrendTarget({ ...trendTarget, bpDia: parseInt(e.target.value) })}
                                       className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-red-500 font-mono"
                                    />
                                 </div>
                              </div>
                              <div className="space-y-1 pt-2 border-t border-neutral-800">
                                 <div className="flex justify-between">
                                    <label className="text-[10px] text-neutral-500">Trend Duration</label>
                                    <span className="text-[10px] text-blue-400 font-mono font-bold">
                                       {(trendTarget.duration / 60).toFixed(1)} min
                                    </span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-neutral-600">1m</span>
                                    <input type="range" min="1" max="60" step="1"
                                       value={trendTarget.duration / 60}
                                       onChange={e => setTrendTarget({ ...trendTarget, duration: parseFloat(e.target.value) * 60 })}
                                       className="flex-1 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />
                                    <span className="text-[10px] text-neutral-600">60m</span>
                                 </div>
                              </div>
                              <button
                                 onClick={runCustomTrend}
                                 className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase rounded shadow-lg shadow-blue-900/20"
                              >
                                 Start Trend
                              </button>
                           </div>
                        )}

                        <div className="space-y-2">
                           {scenarioList.map(s => (
                              <button
                                 key={s.id}
                                 onClick={() => {
                                    if (activeScenario === s.id) return;
                                    setActiveScenario(s.id);
                                    setScenarioTime(0);
                                    setScenarioPlaying(true);
                                 }}
                                 className={`w-full text-left p-3 rounded-md border text-sm transition-all ${activeScenario === s.id ? 'bg-purple-900/30 border-purple-500 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}
                              >
                                 <div className="font-bold">{s.name}</div>
                                 <div className="text-xs opacity-70 mt-1">{s.description}</div>
                              </button>
                           ))}
                        </div>
                     </div>
                  </div>
               )}

               {activeTab === 'rhythm' && (
                  <div className="space-y-6">
                     {/* Override indicator */}
                     {trackOverrides && caseBaselineRhythm && overriddenVitals.has('rhythm') && (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-orange-900/30 border border-orange-700/50">
                           <div className="flex items-center gap-2">
                              <Pencil className="w-4 h-4 text-orange-400" />
                              <span className="text-xs text-orange-300">Rhythm overridden from case</span>
                           </div>
                           <button
                              onClick={() => {
                                 setRhythm(caseBaselineRhythm);
                                 setOverriddenVitals(prev => {
                                    const next = new Set(prev);
                                    next.delete('rhythm');
                                    return next;
                                 });
                              }}
                              className="text-xs px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded font-bold"
                           >
                              Reset Rhythm
                           </button>
                        </div>
                     )}

                     {/* Rhythm Select - Admin Only */}
                     {isAdmin && (
                        <div className="space-y-2">
                           <label className="text-xs font-bold text-neutral-500 uppercase">Primary Rhythm</label>
                           <div className="grid grid-cols-1 gap-2">
                              {['NSR', 'AFib', 'VTach', 'VFib', 'Asystole'].map(r => (
                                 <button
                                    key={r}
                                    onClick={() => handleRhythmChange(r)}
                                    className={`px-4 py-3 rounded-md text-left text-sm font-bold border transition-all ${rhythm === r ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/50' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-600'}`}
                                 >
                                    {r === 'NSR' ? 'Normal Sinus Rhythm' : r}
                                 </button>
                              ))}
                           </div>
                        </div>
                     )}

                     {/* ECG Pattern Presets - Admin Only */}
                     {isAdmin && (
                     <div className="space-y-2">
                        <label className="text-xs font-bold text-neutral-500 uppercase">ECG Pattern Presets</label>
                        <select
                           onChange={(e) => {
                              const pattern = e.target.value;
                              switch(pattern) {
                                 case 'normal':
                                    setConditions({ pvc: false, stElev: 0, tInv: false, wideQRS: false, noise: 0 });
                                    setParams(p => ({ ...p, hr: 75 }));
                                    setRhythm('NSR');
                                    break;
                                 case 'stemi':
                                    setConditions({ pvc: false, stElev: 2, tInv: false, wideQRS: false, noise: 0 });
                                    setParams(p => ({ ...p, hr: 95 }));
                                    setRhythm('NSR');
                                    break;
                                 case 'nstemi':
                                    setConditions({ pvc: false, stElev: -1, tInv: true, wideQRS: false, noise: 0 });
                                    setParams(p => ({ ...p, hr: 88 }));
                                    setRhythm('NSR');
                                    break;
                                 case 'angina':
                                    setConditions({ pvc: false, stElev: -0.5, tInv: false, wideQRS: false, noise: 0 });
                                    setParams(p => ({ ...p, hr: 92 }));
                                    setRhythm('NSR');
                                    break;
                                 case 'hyperkalemia':
                                    setConditions({ pvc: false, stElev: 0, tInv: false, wideQRS: true, noise: 0 });
                                    setParams(p => ({ ...p, hr: 70 }));
                                    setRhythm('NSR');
                                    break;
                                 case 'hypokalemia':
                                    setConditions({ pvc: false, stElev: -0.5, tInv: true, wideQRS: false, noise: 0 });
                                    setParams(p => ({ ...p, hr: 82 }));
                                    setRhythm('NSR');
                                    break;
                                 case 'pericarditis':
                                    setConditions({ pvc: false, stElev: 1, tInv: false, wideQRS: false, noise: 0 });
                                    setParams(p => ({ ...p, hr: 88 }));
                                    setRhythm('NSR');
                                    break;
                                 case 'lbbb':
                                    setConditions({ pvc: false, stElev: 0, tInv: false, wideQRS: true, noise: 0 });
                                    setParams(p => ({ ...p, hr: 78 }));
                                    setRhythm('NSR');
                                    break;
                                 case 'pvcs':
                                    setConditions({ pvc: true, stElev: 0, tInv: false, wideQRS: false, noise: 0 });
                                    setParams(p => ({ ...p, hr: 85 }));
                                    setRhythm('NSR');
                                    break;
                                 case 'vtach':
                                    setConditions({ pvc: false, stElev: 0, tInv: false, wideQRS: true, noise: 0 });
                                    setParams(p => ({ ...p, hr: 160 }));
                                    setRhythm('VTach');
                                    break;
                                 case 'afib':
                                    setConditions({ pvc: false, stElev: 0, tInv: false, wideQRS: false, noise: 0 });
                                    setParams(p => ({ ...p, hr: 110 }));
                                    setRhythm('AFib');
                                    break;
                              }
                              // Reset select
                              e.target.value = '';
                           }}
                           className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2.5 text-sm text-white"
                           defaultValue=""
                        >
                           <option value="" disabled>Select a pattern...</option>
                           <optgroup label="Ischemia / MI">
                              <option value="stemi">STEMI (ST elevation 2mm)</option>
                              <option value="nstemi">NSTEMI (ST depression, T-inv)</option>
                              <option value="angina">Angina (Mild ST depression)</option>
                           </optgroup>
                           <optgroup label="Electrolyte Abnormalities">
                              <option value="hyperkalemia">Hyperkalemia (Wide QRS)</option>
                              <option value="hypokalemia">Hypokalemia (T-wave flat/inv)</option>
                           </optgroup>
                           <optgroup label="Structural / Inflammation">
                              <option value="pericarditis">Pericarditis (Diffuse ST elevation)</option>
                              <option value="lbbb">LBBB (Wide QRS)</option>
                           </optgroup>
                           <optgroup label="Arrhythmias">
                              <option value="pvcs">PVCs (Ectopic beats)</option>
                              <option value="afib">Atrial Fibrillation</option>
                              <option value="vtach">Ventricular Tachycardia</option>
                           </optgroup>
                           <optgroup label="Normal">
                              <option value="normal">Normal Sinus Rhythm</option>
                           </optgroup>
                        </select>
                     </div>
                     )}

                     {/* Ectopics & Noise - Admin Only */}
                     {isAdmin && (
                     <div className="space-y-2">
                        <label className="text-xs font-bold text-neutral-500 uppercase">Modifiers</label>
                        <div className="space-y-3 bg-neutral-800/50 p-3 rounded-lg border border-neutral-800">

                           <div className="flex items-center justify-between">
                              <span className="text-sm text-neutral-300">PVCs (Ectopics)</span>
                              <button
                                 onClick={() => setConditions(c => ({ ...c, pvc: !c.pvc }))}
                                 className={`w-12 h-6 rounded-full relative transition-colors ${conditions.pvc ? 'bg-green-600' : 'bg-neutral-700'}`}
                              >
                                 <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${conditions.pvc ? 'left-7' : 'left-1'}`} />
                              </button>
                           </div>

                           <div className="flex items-center justify-between">
                              <span className="text-sm text-neutral-300">Wide QRS</span>
                              <button
                                 onClick={() => setConditions(c => ({ ...c, wideQRS: !c.wideQRS }))}
                                 className={`w-12 h-6 rounded-full relative transition-colors ${conditions.wideQRS ? 'bg-green-600' : 'bg-neutral-700'}`}
                              >
                                 <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${conditions.wideQRS ? 'left-7' : 'left-1'}`} />
                              </button>
                           </div>

                           <div className="space-y-1">
                              <div className="flex justify-between text-xs">
                                 <span className="text-neutral-400">ST Deviation</span>
                                 <span className={`font-mono ${Math.abs(conditions.stElev) >= 1 ? 'text-red-400' : 'text-blue-400'}`}>
                                    {conditions.stElev > 0 ? '+' : ''}{conditions.stElev} mm
                                    {Math.abs(conditions.stElev) >= 1 && <span className="ml-1">⚠️</span>}
                                 </span>
                              </div>
                              <input
                                 type="range" min="-3" max="3" step="0.25"
                                 value={conditions.stElev}
                                 onChange={(e) => setConditions(c => ({ ...c, stElev: parseFloat(e.target.value) }))}
                                 className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                              />
                              <div className="text-[10px] text-neutral-600">
                                 Normal: 0mm | Significant: ≥1mm elevation or depression
                              </div>
                           </div>

                           <div className="space-y-1">
                              <div className="flex justify-between text-xs">
                                 <span className="text-neutral-400">Signal Noise</span>
                                 <span className="text-blue-400 font-mono">{conditions.noise}/10</span>
                              </div>
                              <input
                                 type="range" min="0" max="10" step="1"
                                 value={conditions.noise}
                                 onChange={(e) => setConditions(c => ({ ...c, noise: parseInt(e.target.value) }))}
                                 className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                              />
                           </div>

                        </div>
                     </div>
                     )}

                  </div>
               )}

               {activeTab === 'vitals' && (
                  <div className="space-y-6">
                     {/* Override tracking toggle */}
                     <div className="flex items-center justify-between p-2 rounded-lg bg-neutral-800/50 border border-neutral-700">
                        <div className="flex items-center gap-2">
                           <span className="text-xs text-neutral-400">Track Overrides</span>
                        </div>
                        <button
                           onClick={() => {
                              setTrackOverrides(!trackOverrides);
                              if (trackOverrides) {
                                 // Turning off - clear existing overrides
                                 setOverriddenVitals(new Set());
                              }
                           }}
                           className={`relative w-10 h-5 rounded-full transition-colors ${trackOverrides ? 'bg-orange-600' : 'bg-neutral-600'}`}
                        >
                           <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${trackOverrides ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                     </div>

                     {/* Override indicator and reset buttons - only show when tracking */}
                     {trackOverrides && (
                        <div className={`flex items-center justify-between p-2 rounded-lg ${hasOverrides ? 'bg-orange-900/30 border border-orange-700/50' : 'bg-green-900/20 border border-green-700/30'}`}>
                           <div className="flex items-center gap-2">
                              {hasOverrides ? (
                                 <>
                                    <Pencil className="w-4 h-4 text-orange-400" />
                                    <span className="text-xs text-orange-300">Override Mode ({overriddenVitals.size} modified)</span>
                                 </>
                              ) : (
                                 <>
                                    <Activity className="w-4 h-4 text-green-400" />
                                    <span className="text-xs text-green-300">{caseBaseline ? 'Using Case Vitals' : 'Default Vitals'}</span>
                                 </>
                              )}
                           </div>
                           <div className="flex gap-2">
                              {hasOverrides && (
                                 <button
                                    onClick={() => setOverriddenVitals(new Set())}
                                    className="text-xs px-2 py-1 bg-neutral-600 hover:bg-neutral-500 text-white rounded"
                                    title="Clear override flags without resetting values"
                                 >
                                    Clear Flags
                                 </button>
                              )}
                              {caseBaseline && (
                                 <button
                                    onClick={resetToCaseDefaults}
                                    className="text-xs px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded font-bold"
                                 >
                                    Reset to Case
                                 </button>
                              )}
                           </div>
                        </div>
                     )}

                     {/* HR */}
                     <div className="space-y-2">
                        <div className="flex justify-between items-end">
                           <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-1">
                              Heart Rate
                              {trackOverrides && overriddenVitals.has('hr') && <Pencil className="w-3 h-3 text-orange-400" />}
                           </label>
                           <span className="text-xl font-mono text-green-500 font-bold">{params.hr}</span>
                        </div>
                        <input
                           type="range" min="20" max="250"
                           value={params.hr}
                           onChange={(e) => updateVitalWithOverride('hr', parseInt(e.target.value))}
                           className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-green-500"
                        />
                     </div>

                     {/* SpO2 */}
                     <div className="space-y-2">
                        <div className="flex justify-between items-end">
                           <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-1">
                              SpO2
                              {trackOverrides && overriddenVitals.has('spo2') && <Pencil className="w-3 h-3 text-orange-400" />}
                           </label>
                           <span className="text-xl font-mono text-sky-500 font-bold">{params.spo2}%</span>
                        </div>
                        <input
                           type="range" min="50" max="100"
                           value={params.spo2}
                           onChange={(e) => updateVitalWithOverride('spo2', parseInt(e.target.value))}
                           className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
                        />
                     </div>

                     {/* RR */}
                     <div className="space-y-2">
                        <div className="flex justify-between items-end">
                           <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-1">
                              Resp Rate
                              {trackOverrides && overriddenVitals.has('rr') && <Pencil className="w-3 h-3 text-orange-400" />}
                           </label>
                           <span className="text-xl font-mono text-amber-500 font-bold">{params.rr}</span>
                        </div>
                        <input
                           type="range" min="0" max="60"
                           value={params.rr}
                           onChange={(e) => updateVitalWithOverride('rr', parseInt(e.target.value))}
                           className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                     </div>

                     {/* BP */}
                     <div className="space-y-4 pt-4 border-t border-neutral-800">
                        <div className="space-y-2">
                           <div className="flex justify-between items-end">
                              <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-1">
                                 Systolic BP
                                 {trackOverrides && overriddenVitals.has('bpSys') && <Pencil className="w-3 h-3 text-orange-400" />}
                              </label>
                              <span className="text-lg font-mono text-red-400 font-bold">{params.bpSys}</span>
                           </div>
                           <input
                              type="range" min="50" max="250"
                              value={params.bpSys}
                              onChange={(e) => updateVitalWithOverride('bpSys', parseInt(e.target.value))}
                              className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-red-500"
                           />
                        </div>
                        <div className="space-y-2">
                           <div className="flex justify-between items-end">
                              <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-1">
                                 Diastolic BP
                                 {trackOverrides && overriddenVitals.has('bpDia') && <Pencil className="w-3 h-3 text-orange-400" />}
                              </label>
                              <span className="text-lg font-mono text-red-500 font-bold">{params.bpDia}</span>
                           </div>
                           <input
                              type="range" min="30" max="150"
                              value={params.bpDia}
                              onChange={(e) => updateVitalWithOverride('bpDia', parseInt(e.target.value))}
                              className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-red-500"
                           />
                        </div>
                     </div>

                     {/* Temp & EtCO2 */}
                     <div className="space-y-4 pt-4 border-t border-neutral-800">
                        <div className="space-y-2">
                           <div className="flex justify-between items-end">
                              <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-1">
                                 Temperature
                                 {trackOverrides && overriddenVitals.has('temp') && <Pencil className="w-3 h-3 text-orange-400" />}
                              </label>
                              <span className="text-lg font-mono text-purple-400 font-bold">{params.temp?.toFixed(1)}°C</span>
                           </div>
                           <input
                              type="range" min="32" max="42" step="0.1"
                              value={params.temp || 37}
                              onChange={(e) => updateVitalWithOverride('temp', parseFloat(e.target.value))}
                              className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                           />
                        </div>
                        <div className="space-y-2">
                           <div className="flex justify-between items-end">
                              <label className="text-xs font-bold text-neutral-500 uppercase flex items-center gap-1">
                                 EtCO2
                                 {trackOverrides && overriddenVitals.has('etco2') && <Pencil className="w-3 h-3 text-orange-400" />}
                              </label>
                              <span className="text-lg font-mono text-yellow-400 font-bold">{params.etco2} mmHg</span>
                           </div>
                           <input
                              type="range" min="0" max="100"
                              value={params.etco2 || 38}
                              onChange={(e) => updateVitalWithOverride('etco2', parseInt(e.target.value))}
                              className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                           />
                        </div>
                     </div>

                  </div>
               )}

               {/* ALARMS TAB */}
               {activeTab === 'alarms' && (
                  <div className="space-y-6">
                     <div className="flex items-center justify-between mb-4">
                        <h3 className="text-white font-bold flex items-center gap-2">
                           <Bell className="w-5 h-5 text-red-500" />
                           Alarm System
                        </h3>
                        <button
                           onClick={() => alarmSystem.setIsMuted(!alarmSystem.isMuted)}
                           className={`p-2 rounded-full ${alarmSystem.isMuted ? 'bg-red-900/40 text-red-500' : 'bg-green-900/40 text-green-500'}`}
                           title={alarmSystem.isMuted ? 'Unmute alarms' : 'Mute alarms'}
                        >
                           {alarmSystem.isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                        </button>
                     </div>

                     {/* Active Alarms */}
                     {alarmSystem.activeAlarms.length > 0 && (
                        <div className="space-y-2 mb-6">
                           <h4 className="text-sm font-semibold text-red-400">Active Alarms ({alarmSystem.activeAlarms.length})</h4>
                           {alarmSystem.activeAlarms.map(alarmKey => (
                              <div key={alarmKey} className="bg-red-900/20 border border-red-700/50 rounded p-3 animate-pulse">
                                 <div className="text-sm text-white font-semibold mb-2">{alarmKey.replace('_', ' ').toUpperCase()}</div>
                                 <div className="flex gap-2">
                                    <button
                                       onClick={() => handleAcknowledgeAlarm(alarmKey)}
                                       className="flex-1 text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded"
                                    >
                                       Acknowledge
                                    </button>
                                    <button
                                       onClick={() => handleSnoozeAlarm(alarmKey)}
                                       className="flex-1 text-xs px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 text-white rounded"
                                    >
                                       Snooze {alarmSystem.snoozeDuration}min
                                    </button>
                                 </div>
                              </div>
                           ))}
                           <div className="flex gap-2">
                              <button
                                 onClick={handleAcknowledgeAll}
                                 className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-bold"
                              >
                                 Acknowledge All
                              </button>
                              <button
                                 onClick={() => {
                                    alarmSystem.snoozeAll();
                                    EventLogger.buttonClicked('Snooze All Alarms', COMPONENTS.PATIENT_MONITOR);
                                 }}
                                 className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm font-bold"
                              >
                                 Snooze All
                              </button>
                           </div>
                        </div>
                     )}

                     {/* Snooze Configuration */}
                     <div className="space-y-3 mb-6 bg-neutral-800/30 p-4 rounded-lg border border-neutral-700">
                        <h4 className="text-sm font-semibold text-yellow-400">Snooze Settings</h4>
                        <div className="flex items-center gap-3">
                           <label className="text-xs text-neutral-400">Duration:</label>
                           <select
                              value={alarmSystem.snoozeDuration}
                              onChange={(e) => alarmSystem.setSnoozeDuration(parseInt(e.target.value))}
                              className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                           >
                              <option value="1">1 minute</option>
                              <option value="2">2 minutes</option>
                              <option value="3">3 minutes</option>
                              <option value="5">5 minutes</option>
                              <option value="10">10 minutes</option>
                              <option value="15">15 minutes</option>
                           </select>
                        </div>
                     </div>

                     {/* Snoozed Alarms */}
                     {alarmSystem.snoozedAlarms && alarmSystem.snoozedAlarms.length > 0 && (
                        <div className="space-y-2 mb-6">
                           <h4 className="text-sm font-semibold text-yellow-400">Snoozed Alarms ({alarmSystem.snoozedAlarms.length})</h4>
                           {alarmSystem.snoozedAlarms.map(({ key, until, remaining }) => (
                              <div key={key} className="bg-yellow-900/20 border border-yellow-700/50 rounded p-3">
                                 <div className="flex items-center justify-between">
                                    <div>
                                       <div className="text-sm text-white font-semibold">{key.replace('_', ' ').toUpperCase()}</div>
                                       <div className="text-xs text-yellow-300 mt-1">
                                          Returns in {remaining} min{remaining !== 1 ? 's' : ''}
                                       </div>
                                    </div>
                                    <div className="text-xs text-yellow-400">💤</div>
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}

                     {/* Alarm Thresholds - Admin Only */}
                     {isAdmin && (
                        <div className="space-y-4">
                           <h4 className="text-sm font-semibold text-neutral-300">Thresholds</h4>
                           {Object.entries(alarmSystem.thresholds).map(([vital, config]) => (
                              <div key={vital} className="bg-neutral-800/50 p-3 rounded-lg border border-neutral-800">
                                 <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-bold text-white uppercase">{vital}</span>
                                    <button
                                       onClick={() => alarmSystem.updateThreshold(vital, config.low, config.high, !config.enabled)}
                                       className={`w-10 h-5 rounded-full relative transition-colors ${config.enabled ? 'bg-green-600' : 'bg-neutral-700'}`}
                                    >
                                       <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${config.enabled ? 'left-5' : 'left-0.5'}`} />
                                    </button>
                                 </div>
                                 {config.enabled && (
                                    <div className="space-y-2 text-xs">
                                       {config.low !== null && (
                                          <div>
                                             <label className="text-neutral-400">Low: </label>
                                             <input
                                                type="number"
                                                value={config.low}
                                                onChange={(e) => alarmSystem.updateThreshold(vital, parseFloat(e.target.value), config.high, config.enabled)}
                                                className="ml-2 w-20 bg-neutral-700 border border-neutral-600 rounded px-2 py-1 text-white"
                                             />
                                          </div>
                                       )}
                                       {config.high !== null && (
                                          <div>
                                             <label className="text-neutral-400">High: </label>
                                             <input
                                                type="number"
                                                value={config.high}
                                                onChange={(e) => alarmSystem.updateThreshold(vital, config.low, parseFloat(e.target.value), config.enabled)}
                                                className="ml-2 w-20 bg-neutral-700 border border-neutral-600 rounded px-2 py-1 text-white"
                                             />
                                          </div>
                                       )}
                                    </div>
                                 )}
                              </div>
                           ))}
                        </div>
                     )}

                     {/* Save/Reset - Admin Only */}
                     {isAdmin && (
                        <div className="space-y-2 pt-4 border-t border-neutral-800">
                           <button
                              onClick={() => alarmSystem.saveConfig()}
                              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
                           >
                              Save Alarm Config
                           </button>
                           <button
                              onClick={alarmSystem.resetToDefaults}
                              className="w-full py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded text-sm"
                           >
                              Reset to Defaults
                           </button>
                        </div>
                     )}
                  </div>
               )}

               {/* LABS TAB */}
               {activeTab === 'labs' && sessionId && (
                  <div>
                     <LabValueEditor 
                        sessionId={sessionId}
                        caseId={caseData?.id}
                        onUpdate={(labId, newValue) => {
                           console.log(`Lab ${labId} updated to ${newValue}`);
                        }}
                     />
                  </div>
               )}

               {activeTab === 'labs' && !sessionId && (
                  <div className="text-center py-8 text-neutral-500">
                     <p>Start a session to edit lab values</p>
                  </div>
               )}

            </div>

            {/* Footer actions - Admin Only */}
            {isAdmin && (
               <div className="p-4 border-t border-neutral-800 bg-black/50 space-y-3">
                  {/* Settings Persistence Info */}
                  {savedSettings && (
                     <div className="text-xs text-neutral-500 bg-blue-900/20 border border-blue-700/30 rounded p-2">
                        <div className="flex items-center gap-2">
                           <Settings className="w-3 h-3" />
                           <span>Saved settings loaded</span>
                        </div>
                        <div className="text-[10px] mt-1 opacity-70">
                           {new Date(savedSettings.savedAt).toLocaleString()}
                        </div>
                     </div>
                  )}

                  {/* Save to Browser (localStorage) */}
                  <button
                     onClick={() => {
                        if (saveSettings(rhythm, conditions, params)) {
                           toast.success('Settings saved to browser!');
                           window.location.reload();
                        } else {
                           toast.error('Failed to save settings');
                        }
                     }}
                     className="w-full py-3 rounded border border-green-700/50 bg-green-900/20 text-green-400 font-bold text-xs uppercase hover:bg-green-900/30 transition-colors flex items-center justify-center gap-2"
                  >
                     <Save className="w-4 h-4" />
                     Save to Browser
                  </button>

                  {/* Export/Import Settings as JSON Files */}
                  <div className="grid grid-cols-2 gap-2">
                     <button
                        onClick={() => {
                           exportSettingsToJSON(rhythm, conditions, params);
                           toast.success('Settings exported to JSON file!');
                        }}
                        className="py-3 rounded border border-blue-700/50 bg-blue-900/20 text-blue-400 font-bold text-xs uppercase hover:bg-blue-900/30 transition-colors flex items-center justify-center gap-2"
                     >
                        <Download className="w-4 h-4" />
                        Export JSON
                     </button>

                     <button
                        onClick={() => {
                           const input = document.createElement('input');
                           input.type = 'file';
                           input.accept = '.json';
                           input.onchange = async (e) => {
                              const file = e.target.files[0];
                              if (file) {
                                 try {
                                    await importSettingsFromJSON(file, setRhythm, setConditions, setParams);
                                    toast.success('Settings imported successfully!');
                                 } catch (err) {
                                    toast.error('Failed to import settings: ' + err.message);
                                 }
                              }
                           };
                           input.click();
                        }}
                        className="py-3 rounded border border-purple-700/50 bg-purple-900/20 text-purple-400 font-bold text-xs uppercase hover:bg-purple-900/30 transition-colors flex items-center justify-center gap-2"
                     >
                        <Upload className="w-4 h-4" />
                        Import JSON
                     </button>
                  </div>

                  {/* Reset to Factory Defaults */}
                  <button
                     onClick={async () => {
                        const confirmed = await toast.confirm('Reset to factory defaults? This will clear saved settings.', { title: 'Reset Settings', type: 'warning' });
                        if (confirmed) {
                           clearSavedSettings();
                           setRhythm(FACTORY_DEFAULTS.rhythm);
                           setParams(FACTORY_DEFAULTS.params);
                           setConditions(FACTORY_DEFAULTS.conditions);
                           toast.success('Reset to factory defaults');
                           window.location.reload();
                        }
                     }}
                     className="w-full py-3 rounded border border-neutral-700 text-neutral-400 font-bold text-xs uppercase hover:bg-neutral-800 transition-colors"
                  >
                     Reset to Defaults
                  </button>

                  {/* Clear Saved Settings (only show if saved) */}
                  {savedSettings && (
                     <button
                        onClick={async () => {
                           const confirmed = await toast.confirm('Clear saved settings? Monitor will use factory defaults on next load.', { title: 'Clear Settings', type: 'warning' });
                           if (confirmed) {
                              clearSavedSettings();
                              toast.success('Saved settings cleared. Using factory defaults.');
                           }
                        }}
                        className="w-full py-2 rounded border border-red-700/50 bg-red-900/20 text-red-400 font-bold text-xs uppercase hover:bg-red-900/30 transition-colors"
                     >
                        Clear Saved Settings
                     </button>
                  )}
               </div>
            )}

         </div>

      </div>
   );
}
