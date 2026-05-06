import React, { useState, useEffect, useCallback, useRef } from 'react';
import PatientMonitor from './components/monitor/PatientMonitor';
import PatientVisual from './components/patient/PatientVisual';
import ChatInterface from './components/chat/ChatInterface';
import ConfigPanel from './components/settings/ConfigPanel';
import LoginPage from './components/auth/LoginPage';
import RegisterPage from './components/auth/RegisterPage';
import OrdersDrawer from './components/orders/OrdersDrawer';
import LabResultsModal from './components/investigations/LabResultsModal';
import RadiologyResultsModal from './components/investigations/RadiologyResultsModal';
import UserProfilePanel from './components/settings/UserProfilePanel';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { VoiceProvider } from './contexts/VoiceContext';
import { NotificationProvider } from './notifications/NotificationContext';
import { useNotifications } from './notifications/useNotifications';
import { setExternalApi } from './notifications/externalApi';
import { ToastSurface, BannerSurface, AudioSurface, BackendSurface, ConsoleSurface } from './notifications/surfaces';
import DiagnosticBar from './components/debug/DiagnosticBar';
import { PatientRecordProvider, usePatientRecord } from './services/PatientRecord';
import { AuthService } from './services/authService';
import EventLogger, { COMPONENTS } from './services/eventLogger';
import { apiUrl } from './config/api';
import { Settings, X, LogOut, User, RotateCcw, ChevronDown, Activity } from 'lucide-react';
import ManikinPanel from './components/examination/ManikinPanel';
import BodyMapDebug from './components/examination/BodyMapDebug';
import TnaDashboard from './components/analytics/tna/TnaDashboardV2';
import DiscussionScreen from './components/discussion/DiscussionScreen';
import AgentPersonaEditor from './components/settings/AgentPersonaEditor';

// Persistence rule: a session ends ONLY through the Exit or End buttons
// (or an explicit case-switch). Refresh, tab close, idle time — none of
// those count as exits. We restore whatever the user had whenever the app
// boots, and never silently wipe based on time-since-last-activity.
function MainApp() {
   const [showConfig, setShowConfig] = useState(false);
   const [showFullPageSettings, setShowFullPageSettings] = useState(false);
   const [showUserProfile, setShowUserProfile] = useState(false);
   const [showUserMenu, setShowUserMenu] = useState(false);
   const [showTnaAnalytics, setShowTnaAnalytics] = useState(false);
   const [showDiscussion, setShowDiscussion] = useState(false);
   // Agent persona editor full-page route. null = closed; 'new' = create;
   // <number> = edit by template id. Setting this hides ConfigPanel so the
   // editor gets the entire viewport. On close we reopen ConfigPanel with
   // its activeTab pinned to 'agents' so the user lands back where they were.
   const [personaEditorTarget, setPersonaEditorTarget] = useState(null);
   // Where to send the user when the persona editor closes. Default null =
   // land on the Agent Personas tab. Callers may pass {tab,wizardStep} to
   // round-trip back to a specific surface (eg. case wizard step 11) so
   // the user isn't displaced when they launched from a deeper context.
   const [personaEditorReturn, setPersonaEditorReturn] = useState(null);
   const [settingsInitialTab, setSettingsInitialTab] = useState('cases');
   const [settingsInitialStep, setSettingsInitialStep] = useState(1);
   const [caseEnded, setCaseEnded] = useState(false);
   const { user, logout, isAdmin } = useAuth();
   const toast = useToast();
   const [sessionValidated, setSessionValidated] = useState(false);
   const lastActivityRef = useRef(Date.now());

   // Restore and validate session from localStorage on mount
   const [activeCase, setActiveCase] = useState(null);
   const [sessionId, setSessionId] = useState(null);
   const [selectedResult, setSelectedResult] = useState(null);
   const [showExamination, setShowExamination] = useState(false);
   const [showEndConfirm, setShowEndConfirm] = useState(false);

   // Set user context for EventLogger when user logs in
   useEffect(() => {
      if (user?.id) {
         EventLogger.setContext({ userId: user.id });
      }
   }, [user?.id]);

   // Stage-3 audit: clear notification transient state (active map, acked
   // set, snoozed map) on every session change. Acks/snoozes describe
   // "I've handled this in *this* case" — pre-fix they leaked across cases
   // within the same user, silently silencing brand-new alarms in case B
   // because case A's `alarm:hr_high` ack was still in localStorage.
   const notifications = useNotifications();
   const lastNotificationSessionRef = useRef(null);
   useEffect(() => {
      const prev = lastNotificationSessionRef.current;
      lastNotificationSessionRef.current = sessionId;
      // Restore-from-localStorage looks like a session change to this
      // effect (in-memory ref starts null, becomes the saved sessionId).
      // Gate on sessionValidated so refresh keeps the user's alarm acks /
      // snoozes intact; only a *real* subsequent session change clears them.
      if (!sessionValidated) return;
      if (prev === sessionId) return;
      if (prev === null && sessionId === null) return;
      notifications.clearTransient?.('session-change');
   }, [sessionId, sessionValidated, notifications]);

   // Stage-6 audit: app-level case snapshot (fetched once on session start).
   // Mirrors the pattern in ChatInterface (Stage 4) and PatientMonitor
   // (Stage 5). Owned at App level here because ManikinPanel and any other
   // panels that should be snapshot-bound mount as siblings under App. Falls
   // back to live activeCase if the fetch hasn't completed.
   const [caseSnapshot, setCaseSnapshot] = useState(null);
   useEffect(() => {
      if (!sessionId) { setCaseSnapshot(null); return; }
      let cancelled = false;
      (async () => {
         try {
            const token = AuthService.getToken();
            const res = await fetch(apiUrl(`/sessions/${sessionId}`), {
               headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            if (!res.ok || cancelled) return;
            const data = await res.json();
            const raw = data?.session?.case_snapshot;
            if (!raw) return;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!cancelled) setCaseSnapshot(parsed);
         } catch (e) {
            console.warn('[App] case snapshot fetch failed:', e.message);
         }
      })();
      return () => { cancelled = true; };
   }, [sessionId]);

   // Fetch and load default case if no session exists
   const loadDefaultCase = async () => {
      try {
         const token = AuthService.getToken();
         const res = await fetch(apiUrl('/cases'), {
            headers: { 'Authorization': `Bearer ${token}` }
         });
         if (res.ok) {
            const data = await res.json();
            const defaultCase = data.cases?.find(c => c.is_default);
            if (defaultCase) {
               console.log('Auto-loading default case:', defaultCase.name);
               setActiveCase(defaultCase);
               EventLogger.caseLoaded(defaultCase.id, defaultCase.name);
            }
         }
      } catch (err) {
         console.error('Failed to load default case:', err);
      }
   };

   // Fire-and-forget POST to /sessions/:id/end. Used both for explicit end
   // (user clicks End) and orphan cleanup (case reload, expiry detection)
   // so server rows don't accumulate with end_time = NULL. Server-side this
   // endpoint is idempotent — calling it twice is safe. Declared early so
   // the validate-on-mount effect can call it during expiry cleanup.
   const endSessionOnServer = async (sid) => {
      if (!sid) return;
      try {
         const token = AuthService.getToken();
         await fetch(apiUrl(`/sessions/${sid}/end`), {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
         });
      } catch (err) {
         console.error('[Session] Failed to end session on server:', err);
      }
   };

   // Restore session on mount. Per the persistence rule, refresh NEVER
   // wipes — we always reinstate whatever we last saved. Server validation
   // is best-effort and informational only: a server that says "ended" or
   // an unreachable backend doesn't trigger a clear, because the user
   // didn't click Exit/End. They can do that themselves; the app stays
   // showing the case until they do.
   useEffect(() => {
      const validateAndRestoreSession = async () => {
         let restored = false;
         try {
            const saved = localStorage.getItem('rohy_active_session');
            if (saved) {
               const { activeCase: savedCase, sessionId: savedSessionId } = JSON.parse(saved);
               if (savedCase) {
                  setActiveCase(savedCase);
                  restored = true;
               }
               if (savedSessionId) {
                  setSessionId(savedSessionId);
                  lastActivityRef.current = Date.now();
                  // Best-effort server check — purely diagnostic. Never
                  // mutates state on mismatch; that's what Exit/End is for.
                  try {
                     const token = AuthService.getToken();
                     const res = await fetch(apiUrl(`/sessions/${savedSessionId}`), {
                        headers: { 'Authorization': `Bearer ${token}` }
                     });
                     if (res.ok) {
                        const data = await res.json();
                        if (data?.session?.end_time) {
                           console.log('[Session] restored a server-ended session; user will exit through End');
                        } else {
                           EventLogger.sessionResumed(savedSessionId, savedCase?.id, savedCase?.name);
                        }
                     } else {
                        console.warn('[Session] backend non-OK validating saved session; keeping local state');
                     }
                  } catch (err) {
                     console.warn('[Session] validation network error; keeping local state:', err.message);
                  }
               }
            }
         } catch (e) {
            // Saved blob is corrupt and cannot be parsed at all — there's
            // nothing to restore. Drop the unparseable key so the next
            // session can write fresh; this is the one case where clearing
            // is unavoidable (storage is broken, not a user-driven exit).
            console.warn('[Session] saved session blob unparseable, dropping:', e.message);
            localStorage.removeItem('rohy_active_session');
         }
         if (!restored) {
            // No saved case at all → fall back to the default case. Same as
            // pre-refactor behaviour, just no longer reachable through the
            // expiry/wipe paths.
            await loadDefaultCase();
         }
         setSessionValidated(true);
      };

      validateAndRestoreSession();
   }, []);

   // Track user activity for the End-of-session duration metric only.
   // The localStorage timestamp churn that lived here previously existed
   // solely to extend the inactivity-expiry window, which is now gone —
   // the session lives until the user clicks Exit/End regardless of how
   // long the tab has been idle.
   const updateActivity = useCallback(() => {
      lastActivityRef.current = Date.now();
   }, []);

   useEffect(() => {
      const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
      events.forEach(event => window.addEventListener(event, updateActivity, { passive: true }));
      return () => events.forEach(event => window.removeEventListener(event, updateActivity));
   }, [updateActivity]);

   // Multi-tab detection. The `storage` event fires only in OTHER tabs of
   // the same origin when localStorage changes — never in the tab that
   // wrote the change. So if a second tab opens the same session and
   // writes its own rohy_active_session, this tab sees the change here
   // and warns the learner. We don't hard-block (per Q2 = "detect+warn"),
   // just surface a banner so they know last-write-wins is in effect.
   const [multiTabWarning, setMultiTabWarning] = useState(false);
   useEffect(() => {
      const onStorage = (e) => {
         if (e.key !== 'rohy_active_session' || !sessionId) return;
         try {
            const next = e.newValue ? JSON.parse(e.newValue) : null;
            // Same session id touched from another tab — they're sharing
            // the session. Different id with our session still mounted —
            // the other tab just took over. Either way, warn.
            if (next && next.sessionId && next.sessionId !== sessionId) {
               setMultiTabWarning(true);
            } else if (next && next.sessionId === sessionId) {
               // Co-occupancy on the same session — also worth flagging
               // because chat history writes from either tab will overwrite.
               setMultiTabWarning(true);
            } else if (e.newValue === null) {
               // Another tab cleared the session entirely.
               setMultiTabWarning(true);
            }
         } catch {
            // ignore parse failures; not actionable
         }
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
   }, [sessionId]);

   // Save session to localStorage whenever it changes
   useEffect(() => {
      if (activeCase && sessionValidated) {
         localStorage.setItem('rohy_active_session', JSON.stringify({
            activeCase,
            sessionId,
            timestamp: Date.now()
         }));
      }
   }, [activeCase, sessionId, sessionValidated]);

   // End session properly (call backend)
   const handleEndSession = () => {
      setShowEndConfirm(true);
   };

   const handleEndConfirmed = async () => {
      setShowEndConfirm(false);

      const sessionStartTime = lastActivityRef.current;
      const duration = Date.now() - sessionStartTime;
      EventLogger.sessionEnded(duration);

      await endSessionOnServer(sessionId);
      // Don't wipe the session yet — flip into "ended" mode and open the
      // debrief discussion screen. handleCloseDiscussion does the actual
      // cleanup once the learner is done with the debrief.
      setCaseEnded(true);
      setShowDiscussion(true);
   };

   const handleCloseDiscussion = () => {
      setShowDiscussion(false);
      // If the user only opened the discussion mid-case (unlock_trigger='always')
      // and didn't end the case, leave the session intact.
      if (caseEnded) {
         localStorage.removeItem('rohy_active_session');
         localStorage.removeItem('rohy_chat_history');
         // The debrief transcript is keyed per-session and stored separately;
         // clear it on full session end so the next session on the same case
         // doesn't show last session's debrief on first open.
         if (sessionId) {
            localStorage.removeItem(`rohy_discussion_history_${sessionId}`);
         }
         setActiveCase(null);
         setSessionId(null);
         setCaseEnded(false);
      }
   };

   const handleEndConfirmCancel = () => {
      setShowEndConfirm(false);
   };


   const handleLoadCase = (caseData) => {
      // If a session is already running, end it server-side before loading
      // the new case. Without this the prior session is orphaned with
      // end_time = NULL and learners can rack up zombie rows by switching
      // cases without explicitly ending.
      if (sessionId) {
         endSessionOnServer(sessionId);
      }
      // Clear previous session data when loading new case
      localStorage.removeItem('rohy_chat_history');
      if (sessionId) {
         localStorage.removeItem(`rohy_discussion_history_${sessionId}`);
      }
      setActiveCase(caseData);
      setSessionId(null); // Will be set by ChatInterface when session starts
      setShowConfig(false);
      setShowFullPageSettings(false);
      // Log case loaded event
      EventLogger.caseLoaded(caseData?.id, caseData?.name);
   };

   // Handle settings panel open/close with logging
   const handleOpenSettings = () => {
      setShowFullPageSettings(true);
      EventLogger.componentOpened(COMPONENTS.CONFIG_PANEL, 'Settings');
   };

   const handleCloseSettings = () => {
      setShowFullPageSettings(false);
      // Reset the next-open defaults so the simulator's settings button
      // always lands somewhere predictable; the persona-editor flow
      // re-pins these just before reopening.
      setSettingsInitialTab('cases');
      setSettingsInitialStep(1);
      EventLogger.componentClosed(COMPONENTS.CONFIG_PANEL, 'Settings');
   };

   const handleOpenPersonaEditor = (target, returnContext = null) => {
      // target: 'new' or numeric template id.
      // returnContext (optional): { tab, wizardStep } — where to land on close.
      // Defaults to the Agent Personas tab when null.
      setPersonaEditorTarget(target);
      setPersonaEditorReturn(returnContext);
      setShowFullPageSettings(false);
   };

   const handleClosePersonaEditor = () => {
      const ret = personaEditorReturn;
      setPersonaEditorTarget(null);
      setPersonaEditorReturn(null);
      // Resolve return surface: explicit return context wins; otherwise
      // land on Agent Personas which is the default entry point.
      setSettingsInitialTab(ret?.tab || 'agents');
      setSettingsInitialStep(ret?.wizardStep || 1);
      setShowFullPageSettings(true);
   };

   // Handle lab results modal with logging
   const handleViewResult = (result) => {
      setSelectedResult(result);
      EventLogger.labResultViewed(result?.id, result?.test_name, result?.current_value, COMPONENTS.LAB_RESULTS_MODAL);
   };

   const handleCloseLabResults = () => {
      setSelectedResult(null);
      EventLogger.modalClosed('LabResults', COMPONENTS.LAB_RESULTS_MODAL);
   };

   // Persona editor takes priority — when open, hide every other surface.
   // Mounted at the App.jsx level so it owns the entire viewport (the
   // user's "not a toy" feedback was specifically about cramped chrome).
   if (personaEditorTarget !== null) {
      return (
         <AgentPersonaEditor
            templateId={personaEditorTarget}
            onClose={handleClosePersonaEditor}
         />
      );
   }

   // Show full-page settings
   if (showFullPageSettings) {
      return (
         <div className="h-screen w-screen bg-neutral-950 text-white overflow-hidden">
            <ConfigPanel
               onClose={handleCloseSettings}
               onLoadCase={handleLoadCase}
               fullPage={true}
               initialTab={settingsInitialTab}
               initialWizardStep={settingsInitialStep}
               onOpenPersonaEditor={handleOpenPersonaEditor}
            />
         </div>
      );
   }

   // Show full-page TNA analytics
   if (showTnaAnalytics) {
      return (
         <div className="h-screen w-screen overflow-hidden">
            <TnaDashboard onClose={() => setShowTnaAnalytics(false)} />
         </div>
      );
   }

   // Show full-page discussion screen
   if (showDiscussion) {
      return (
         <DiscussionScreen
            sessionId={sessionId}
            activeCase={activeCase}
            onClose={handleCloseDiscussion}
         />
      );
   }

   // Prepare patient info for PatientRecord
   const patientInfo = activeCase ? {
      name: activeCase.config?.patient_name || activeCase.name || 'Unknown Patient',
      age: activeCase.config?.demographics?.age || null,
      gender: activeCase.config?.demographics?.gender || null,
      mrn: activeCase.config?.demographics?.mrn || null,
      chief_complaint: activeCase.config?.structuredHistory?.chiefComplaint || activeCase.description || null
   } : null;

   return (
      <PatientRecordProvider
         sessionId={sessionId}
         caseId={activeCase?.id}
         patientInfo={patientInfo}
      >
         <div className="flex h-screen w-screen bg-neutral-950 text-white overflow-hidden">

         {/* Multi-tab warning banner. Shown when another tab on this origin
             writes to rohy_active_session. last-write-wins applies.
             Fixed overlay so we don't disturb the existing flex layout. */}
         {multiTabWarning && (
            <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-2 bg-amber-600/95 text-amber-50 text-sm rounded-lg shadow-xl border border-amber-700 max-w-2xl">
               <span>
                  <strong>Heads up:</strong> this session is open in another browser tab. Last-write-wins applies.
               </span>
               <button
                  onClick={() => setMultiTabWarning(false)}
                  className="px-2 py-0.5 rounded bg-amber-700 hover:bg-amber-800 text-xs"
               >
                  Dismiss
               </button>
            </div>
         )}

         {/* Left Column (Visual + Chat) - 35% width on large screens */}
         <div className="w-[35%] min-w-[350px] flex flex-col border-r border-neutral-800 bg-neutral-900">

            {/* Top Left: Patient Visual */}
            <div className="h-[45%] border-b border-neutral-800 relative">
               <PatientVisual caseData={activeCase} />

               {/* Settings menu — far-left top corner. Replaces the old
                   admin/username pill. The dropdown still contains Profile /
                   TNA Analytics / Logout for the admin role. The case-name
                   banner that used to sit here was hidden per the operator
                   request — students don't need the diagnosis spoiled in
                   the header. */}
               <div className="absolute top-4 left-4 z-10">
                  <div className="relative">
                     <button
                        onClick={() => setShowUserMenu(!showUserMenu)}
                        className="px-3 py-2 bg-black/50 backdrop-blur-md rounded-full flex items-center gap-2 text-sm hover:bg-black/70 transition-colors"
                        title="Settings & profile"
                     >
                        <Settings className="w-4 h-4 text-neutral-300" />
                        <span className="text-neutral-200">Settings</span>
                        <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                     </button>

                     {/* Dropdown */}
                     {showUserMenu && (
                        <>
                           <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                           <div className="absolute left-0 top-full mt-2 w-48 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl z-50 overflow-hidden">
                              <button
                                 onClick={() => { setShowUserProfile(true); setShowUserMenu(false); }}
                                 className="w-full px-4 py-3 text-left text-sm text-neutral-300 hover:bg-neutral-800 flex items-center gap-3"
                              >
                                 <User className="w-4 h-4 text-blue-400" />
                                 My Profile
                              </button>
                              <button
                                 onClick={() => { handleOpenSettings(); setShowUserMenu(false); }}
                                 className="w-full px-4 py-3 text-left text-sm text-neutral-300 hover:bg-neutral-800 flex items-center gap-3"
                              >
                                 <Settings className="w-4 h-4 text-neutral-400" />
                                 Open Settings
                              </button>
                              {isAdmin() && (
                                 <button
                                    onClick={() => { setShowTnaAnalytics(true); setShowUserMenu(false); }}
                                    className="w-full px-4 py-3 text-left text-sm text-neutral-300 hover:bg-neutral-800 flex items-center gap-3"
                                 >
                                    <Activity className="w-4 h-4 text-purple-400" />
                                    Analytics
                                 </button>
                              )}
                              <div className="border-t border-neutral-700" />
                              <button
                                 onClick={() => { logout(); setShowUserMenu(false); }}
                                 className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-red-900/30 flex items-center gap-3"
                              >
                                 <LogOut className="w-4 h-4" />
                                 Logout
                              </button>
                           </div>
                        </>
                     )}
                  </div>
               </div>

               {/* End & Debrief — bottom-left of the avatar tile, out of the
                   way of the head/face render but easy to reach. Was at the
                   top by the case banner; moved here per operator request. */}
               {activeCase && (
                  <button
                     onClick={handleEndSession}
                     className="absolute bottom-4 left-4 z-10 px-3 py-1.5 bg-red-900/80 hover:bg-red-800 backdrop-blur border border-red-500/30 rounded text-xs font-bold text-red-100 flex items-center gap-1 transition-colors"
                     title="End simulation session"
                  >
                     <X className="w-3 h-3" />
                     End & Debrief
                  </button>
               )}
            </div>

            {/* Bottom Left: Chat Interface */}
            <div className="flex-1 min-h-0 relative">
               {sessionValidated && (
                  <ChatInterface
                     activeCase={activeCase}
                     onSessionStart={setSessionId}
                     restoredSessionId={sessionId}
                  />
               )}
            </div>

         </div>

         {/* Right Column (Monitor) - Remaining width */}
         <div className="flex-1 h-full min-w-[600px] bg-black relative">
            <PatientMonitor
               caseParams={activeCase?.config}
               caseData={activeCase}
               sessionId={sessionId}
               isAdmin={isAdmin()}
            />
         </div>

         {/* Orders Drawer (Bottom) */}
         {activeCase && sessionId && (
            <OrdersDrawer
               caseId={activeCase.id}
               sessionId={sessionId}
               onViewResult={handleViewResult}
               caseData={activeCase}
               onOpenExamination={() => {
                  setShowExamination(true);
                  EventLogger.examPanelOpened();
               }}
            />
         )}

         {/* Lab/Radiology Results Modal - renders based on result type */}
         {selectedResult && (
            selectedResult.modality ? (
               <RadiologyResultsModal
                  result={selectedResult}
                  sessionId={sessionId}
                  patientInfo={{
                     name: activeCase?.config?.patient_name || 'Unknown',
                     age: activeCase?.config?.demographics?.age || 'Unknown',
                     gender: activeCase?.config?.demographics?.gender || 'Unknown'
                  }}
                  onClose={handleCloseLabResults}
               />
            ) : (
               <LabResultsModal
                  result={selectedResult}
                  sessionId={sessionId}
                  patientInfo={{
                     name: activeCase?.config?.patient_name || 'Unknown',
                     age: activeCase?.config?.demographics?.age || 'Unknown',
                     gender: activeCase?.config?.demographics?.gender || 'Unknown'
                  }}
                  onClose={handleCloseLabResults}
               />
            )
         )}

         {/* Physical Examination Panel
             Stage-6 audit: physicalExam now reads from caseSnapshot.config first
             (frozen at session start), falling back to live activeCase only if
             the snapshot fetch hasn't landed. Pre-fix this read live state, so
             admin edits to physical_exam mid-session bled into the running
             session — same pattern as Stage-4 chat and Stage-5 scenario fixes. */}
         <ManikinPanel
            isOpen={showExamination}
            onClose={() => {
               setShowExamination(false);
               EventLogger.examPanelClosed();
            }}
            physicalExam={caseSnapshot?.config?.physical_exam ?? activeCase?.config?.physical_exam ?? null}
            patientGender={(caseSnapshot?.config?.demographics?.gender ?? activeCase?.config?.demographics?.gender)?.toLowerCase() || 'male'}
            onExamPerformed={(exam) => {
               // Log exam to system
               EventLogger.physicalExamPerformed(
                  exam.regionId,
                  exam.examType,
                  exam.finding,
                  { gender: activeCase?.config?.demographics?.gender, abnormal: exam.abnormal }
               );
            }}
         />

         {/* End Session — Confirmation Dialog */}
         {showEndConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
               <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-full max-w-md flex flex-col">
                  <div className="px-6 py-5 border-b border-neutral-700">
                     <h2 className="text-base font-semibold text-white">End Simulation Session?</h2>
                  </div>
                  <div className="px-6 py-5 space-y-3">
                     <p className="text-sm text-neutral-300">
                        Are you sure you want to end this session?
                     </p>
                     <p className="text-sm text-amber-400 font-medium">
                        Once you proceed, you will not be able to return to or resume this simulation.
                     </p>
                     <p className="text-sm text-neutral-400">
                        You will be asked to complete a short reflection questionnaire before the session is closed.
                     </p>
                  </div>
                  <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-700">
                     <button
                        type="button"
                        onClick={handleEndConfirmCancel}
                        className="px-4 py-2 text-sm rounded border border-neutral-600 text-neutral-300 hover:text-white hover:border-neutral-500 transition-colors"
                     >
                        Go Back
                     </button>
                     <button
                        type="button"
                        onClick={handleEndConfirmed}
                        className="px-4 py-2 text-sm rounded bg-red-700 hover:bg-red-600 text-white font-semibold transition-colors"
                     >
                        Yes, End Session
                     </button>
                  </div>
               </div>
            </div>
         )}

         {/* User Profile Modal */}
         {showUserProfile && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
               <div className="relative w-full max-w-2xl h-[80vh] bg-neutral-900 rounded-xl shadow-2xl overflow-hidden border border-neutral-700">
                  {/* Close Button */}
                  <button
                     onClick={() => setShowUserProfile(false)}
                     className="absolute top-4 right-4 z-10 p-2 bg-neutral-800 hover:bg-neutral-700 rounded-full transition-colors"
                  >
                     <X className="w-5 h-5 text-neutral-400" />
                  </button>
                  <UserProfilePanel onClose={() => setShowUserProfile(false)} />
               </div>
            </div>
         )}

         </div>
      </PatientRecordProvider>
   );
}

// Check for debug mode via URL parameter. Gated on import.meta.env.DEV
// because this branch bypasses AuthProvider entirely — we never want a
// production deploy to expose body-map editing by URL flag.
const isBodyMapDebug = import.meta.env.DEV
   && new URLSearchParams(window.location.search).get('debug') === 'bodymap';

// Keep the bodymap-debug branch in its own component so its useState calls
// don't run conditionally inside <App> (which would violate Rules of Hooks
// even though the flag is module-stable).
function BodyMapDebugApp() {
   const [gender, setGender] = useState('male');
   const [view, setView] = useState('anterior');
   return (
      <div className="bg-slate-900 min-h-screen">
         <div className="p-4 flex gap-4">
            <select value={gender} onChange={(e) => setGender(e.target.value)} className="bg-slate-800 text-white p-2 rounded">
               <option value="male">Male</option>
               <option value="female">Female</option>
            </select>
            <select value={view} onChange={(e) => setView(e.target.value)} className="bg-slate-800 text-white p-2 rounded">
               <option value="anterior">Front (Anterior)</option>
               <option value="posterior">Back (Posterior)</option>
            </select>
         </div>
         <BodyMapDebug gender={gender} view={view} />
      </div>
   );
}

export default function App() {
   // showRegister must be declared before any conditional return so its
   // hook ordering stays stable across renders (Rules of Hooks).
   const [showRegister, setShowRegister] = useState(false);

   if (isBodyMapDebug) {
      return <BodyMapDebugApp />;
   }

   return (
      <AuthProvider>
         <ScopedNotificationProvider>
            {/* Bridge so non-React producers (EventLogger singleton) can call notify() */}
            <NotificationApiBridge />
            <ToastProvider>
               <VoiceProvider>
                  <AuthenticatedApp
                     showRegister={showRegister}
                     setShowRegister={setShowRegister}
                  />
                  {/* Surfaces. They render fixed-position UI / side effects, so they
                      can sit at the root regardless of which page is active. */}
                  <ToastSurface />
                  <BannerSurface />
                  <AudioSurface />
                  <ConsoleSurface />
                  <BackendSurfaceBridge />
                  {/* Diagnostic bar — runtime context (LLM, voice, speaker,
                      session, tenant). Default off; toggle from the floating
                      pill in the bottom-right or via Settings → General. */}
                  <DiagnosticBar />
               </VoiceProvider>
            </ToastProvider>
         </ScopedNotificationProvider>
      </AuthProvider>
   );
}

// NotificationProvider's storage (acked/snoozed/prefs) is per-user. Keying on
// user.id triggers a remount on login/logout/user-switch so the new instance
// loads from the new user's bucket — preventing user A's silenced alarms from
// carrying over to user B on a shared workstation.
function ScopedNotificationProvider({ children }) {
   const { user } = useAuth();
   return (
      <NotificationProvider key={user?.id ?? 'anon'}>
         {children}
      </NotificationProvider>
   );
}

// Pulls sessionId/userId/caseId from EventLogger's singleton and passes them
// to BackendSurface so per-event POSTs include the right session context.
function BackendSurfaceBridge() {
   const { user } = useAuth();
   // EventLogger.setContext is called from various places; re-reading on every
   // render is fine — the surface only uses these on flush boundaries.
   const status = EventLogger.getStatus ? EventLogger.getStatus() : {};
   return (
      <BackendSurface
         sessionId={status.sessionId || null}
         userId={user?.id || status.userId || null}
         caseId={status.caseId || null}
      />
   );
}

// Registers a module-level reference to the center's notify/resolve so the
// EventLogger singleton (and any other non-component producer) can dispatch
// without going through useNotifications().
function NotificationApiBridge() {
   const api = useNotifications();
   useEffect(() => {
      setExternalApi(api);
      return () => setExternalApi(null);
   }, [api]);
   return null;
}

function AuthenticatedApp({ showRegister, setShowRegister }) {
   const { user, loading } = useAuth();

   // Show loading spinner while checking authentication
   if (loading) {
      return (
         <div className="flex items-center justify-center h-screen bg-neutral-950">
            <div className="text-center">
               <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
               <p className="text-neutral-400">Loading...</p>
            </div>
         </div>
      );
   }

   // Show login/register if not authenticated
   if (!user) {
      if (showRegister) {
         return <RegisterPage onSwitchToLogin={() => setShowRegister(false)} />;
      }
      return <LoginPage onSwitchToRegister={() => setShowRegister(true)} />;
   }

   // Show main app if authenticated
   return <MainApp />;
}
