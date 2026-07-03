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
import { ToastProvider } from './contexts/ToastContext';
import { VoiceProvider } from './contexts/VoiceContext';
import { NotificationProvider } from './notifications/NotificationContext';
import { useNotifications } from './notifications/useNotifications';
import { setExternalApi } from './notifications/externalApi';
import { ToastSurface, BannerSurface, AudioSurface, BackendSurface, ConsoleSurface } from './notifications/surfaces';
import DiagnosticBar from './components/debug/DiagnosticBar';
import { PatientRecordProvider } from './services/PatientRecord';
import EventLogger, { COMPONENTS, registerWindowLifecycleLogging } from './services/eventLogger';
import { ApiError, apiFetch, apiPut } from './services/apiClient';
import { Settings, X, LogOut, User, ChevronDown, Activity, StopCircle, AlertTriangle, HelpCircle } from 'lucide-react';
import BodyMapDebug from './components/examination/BodyMapDebug';
import TnaDashboard from './components/analytics/tna/TnaDashboardV2';
import DiscussionScreen from './components/discussion/DiscussionScreen';
import PhysicalExamScreen from './components/exam/PhysicalExamScreen';
import InvestigationsScreen from './components/investigations/InvestigationsScreen';
import RoomNavigator from './components/common/RoomNavigator';
import AgentPersonaEditor from './components/settings/AgentPersonaEditor';
import OyonCaptureWidget from './components/oyon/OyonCaptureWidget';
import AoiRegion from './components/oyon/AoiRegion';
import { HelpCenter, OnboardingTour } from './help';

// Persistence rule: a session ends ONLY through the Exit or End buttons
// (or an explicit case-switch). Refresh, tab close, idle time — none of
// those count as exits. We restore whatever the user had whenever the app
// boots, and never silently wipe based on time-since-last-activity.
function MainApp() {
   const [showFullPageSettings, setShowFullPageSettings] = useState(false);
   const [showUserProfile, setShowUserProfile] = useState(false);
   const [showUserMenu, setShowUserMenu] = useState(false);
   // Top-bar "Analytics" dropdown. Peer to the Settings menu; surfaces the
   // two analytics destinations (Emotion / Case) as primary top-level
   // routes instead of leaving them buried in Settings tabs.
   const [showAnalyticsMenu, setShowAnalyticsMenu] = useState(false);
   const [showTnaAnalytics, setShowTnaAnalytics] = useState(false);
   // Emotion analytics as a first-class full-page route — the Oyon element's
   // own Analyze dashboards (Emotion dynamics / Engagement / Affect / Gaze),
   // one click from the top bar instead of buried under Settings → Oyon tab.
   const [showOyonAnalytics, setShowOyonAnalytics] = useState(false);
   // Agent persona editor full-page route. null = closed; 'new' = create;
   // <number> = edit by template id. Setting this hides ConfigPanel so the
   // editor gets the entire viewport. On close we reopen ConfigPanel with
   // its activeTab pinned to 'agents' so the user lands back where they were.
   const [personaEditorTarget, setPersonaEditorTarget] = useState(null);
   // Bumped on every successful AgentPersonaEditor save. ChatInterface
   // watches this and re-fetches the patient template + agents list so an
   // admin who edits the persona voice and goes back to chat sees the
   // change immediately, without needing a session restart.
   const [personaRefreshCounter, setPersonaRefreshCounter] = useState(0);
   // Where to send the user when the persona editor closes. Default null =
   // land on the Agent Personas tab. Callers may pass {tab,wizardStep} to
   // round-trip back to a specific surface (eg. case wizard step 11) so
   // the user isn't displaced when they launched from a deeper context.
   const [personaEditorReturn, setPersonaEditorReturn] = useState(null);
   const [settingsInitialTab, setSettingsInitialTab] = useState('cases');
   const [settingsInitialStep, setSettingsInitialStep] = useState(1);
   // Bumped by the Oyon pill's analytics shortcut. ConfigPanel keeps its
   // active tab in local state seeded from `initialTab`, so a tab request
   // made while the panel is ALREADY open needs a remount to take effect —
   // the nonce is ConfigPanel's key.
   const [settingsNavNonce] = useState(0);
   const { user, logout, isAdmin } = useAuth();
   const isAdminUser = isAdmin();
   const canSeeOyonAnalytics = user?.role === 'educator' || user?.role === 'admin';
   const canSeeAnalyticsMenu = canSeeOyonAnalytics || isAdminUser;
   const [sessionValidated, setSessionValidated] = useState(false);
   const lastActivityRef = useRef(Date.now());
   const userMenuRef = useRef(null);

   const closeTopMenus = useCallback(() => {
      setShowUserMenu(false);
      setShowAnalyticsMenu(false);
   }, []);

   // Restore and validate session from localStorage on mount
   const [activeCase, setActiveCase] = useState(null);
   const [sessionId, setSessionId] = useState(null);
   const [selectedResult, setSelectedResult] = useState(null);
   // currentRoom drives the in-session bottom navigator. One of:
   //   'chat'        — main patient-chat UI (default)
   //   'examination' — PhysicalExamScreen
   //   'lab'         — InvestigationsScreen, Laboratory active
   //   'radiology'   — InvestigationsScreen, Radiology active
   //   'consultant'  — DiscussionScreen (debrief room)
   // All five are peers. Visiting the consultant does NOT end the
   // session — that's the End & Debrief button in the patient room.
   // Ending the session also sends the user here (caseEnded=true) but
   // leaving via the nav while the session is live just navigates back.
   const [currentRoom, setCurrentRoom] = useState('chat');
   // caseEnded sticks once the user explicitly ends the session via the
   // End & Debrief button. While true, the patient room chrome treats the
   // case as closed (the End button hides itself) and DiscussionScreen
   // renders its calm post-debrief strip. Cleared when a new case loads.
   const [caseEnded, setCaseEnded] = useState(false);
   const [showEndConfirm, setShowEndConfirm] = useState(false);
   const [showHelpCenter, setShowHelpCenter] = useState(false);
   const showExamination = currentRoom === 'examination';
   const showInvestigations = currentRoom === 'lab' || currentRoom === 'radiology';
   const showDiscussion = currentRoom === 'consultant';

   useEffect(() => {
      if (!showUserMenu && !showAnalyticsMenu) return;

      const onKeydown = (event) => {
         if (event.key === 'Escape') {
            closeTopMenus();
         }
      };

      window.addEventListener('keydown', onKeydown);
      return () => window.removeEventListener('keydown', onKeydown);
   }, [showUserMenu, showAnalyticsMenu, closeTopMenus]);

   // Set user context for EventLogger when user logs in
   useEffect(() => {
      if (user?.id) {
         EventLogger.setContext({ userId: user.id });
      }
   }, [user?.id]);

   // Stamp the active room onto EventLogger whenever the bottom
   // RoomNavigator changes the current room. Every subsequent log()
   // call carries data.room so the analytics layer can answer "what
   // was the learner doing in the Laboratory room?" without joining
   // against navigation events. Also emits one NAVIGATED event for the
   // transition itself so duration-in-room can be computed downstream.
   //
   // Guarded two ways: only fire after a session exists (pre-session
   // room state is meaningless to analytics), and only when the room
   // actually changed. Without the prev-ref the initial mount would emit
   // a spurious NAVIGATED:chat with fromRoom=null before any case loaded.
   const prevRoomRef = useRef(currentRoom);
   useEffect(() => {
      if (sessionId != null && prevRoomRef.current !== currentRoom) {
         EventLogger.roomChanged(currentRoom);
      }
      prevRoomRef.current = currentRoom;
   }, [currentRoom, sessionId]);

   useEffect(() => {
      if (!user?.id) return undefined;
      return registerWindowLifecycleLogging(window);
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
            const data = await apiFetch(`/sessions/${sessionId}`);
            if (cancelled) return;
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
         const data = await apiFetch('/cases');
         const defaultCase = data?.cases?.find(c => c.is_default);
         if (defaultCase) {
            console.log('Auto-loading default case:', defaultCase.name);
            setActiveCase(defaultCase);
            EventLogger.caseLoaded(defaultCase.id, defaultCase.name);
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
         await apiPut(`/sessions/${sid}/end`);
      } catch (err) {
         console.error('[Session] Failed to end session on server:', err);
      }
   };

   // Auto-end on tab close. Uses sendBeacon (queued by the UA past
   // unload) — without this every browser-close left a session "active"
   // forever. The server's PUT /sessions/:id/end is idempotent so a
   // duplicate call from an explicit End click is harmless.
   useEffect(() => {
      const handler = () => {
         if (!sessionId) return;
         try {
            const url = `/api/sessions/${sessionId}/end`;
            // sendBeacon doesn't carry custom headers; the route accepts
            // unauthenticated end calls for unload paths to avoid losing
            // sessions when the JWT cookie is cleared first.
            navigator.sendBeacon?.(url, new Blob(['{}'], { type: 'application/json' }));
         } catch { /* best-effort */ }
      };
      window.addEventListener('pagehide', handler);
      return () => window.removeEventListener('pagehide', handler);
   }, [sessionId]);

   // View persistence ("breadcrumbs"). Same rule as session state: only
   // Exit/End/case-switch clears it. On refresh we land back on whatever
   // surface the user last had open — Settings tab + wizard step,
   // analytics, debrief, or the persona editor. Stored as one
   // serialisable blob so we don't end up with N localStorage keys to
   // keep in sync.
   const VIEW_STORAGE_KEY = 'rohy_view';
   const ROOM_KEYS = ['chat', 'examination', 'lab', 'radiology', 'consultant'];
   const captureView = useCallback(() => {
      let view = 'home';
      if (personaEditorTarget !== null) view = 'persona-editor';
      else if (showFullPageSettings)    view = 'settings';
      else if (showTnaAnalytics)        view = 'tna';
      else if (showOyonAnalytics)       view = 'oyon';
      // 'view' tracks full-page surfaces above the in-session UI; the
      // bottom-nav room is orthogonal and persisted separately so hard
      // refresh inside Exam/Lab/Rad lands back in the same room, not chat.
      return {
         view,
         currentRoom,
         settingsTab:  settingsInitialTab,
         settingsStep: settingsInitialStep,
         personaEditorTarget,
         personaEditorReturn,
         showUserProfile,
      };
   }, [
      personaEditorTarget, personaEditorReturn,
      showFullPageSettings, showTnaAnalytics, showOyonAnalytics, currentRoom, showUserProfile,
      settingsInitialTab, settingsInitialStep,
   ]);
   const applyView = (saved) => {
      if (!saved || typeof saved !== 'object') return;
      // Apply leaf state first; the boolean view selector is set last so
      // the conditional renders pick up the right tab/step on first paint.
      if (typeof saved.settingsTab  === 'string') setSettingsInitialTab(saved.settingsTab);
      if (Number.isFinite(saved.settingsStep))    setSettingsInitialStep(saved.settingsStep);
      if (saved.personaEditorTarget !== undefined) setPersonaEditorTarget(saved.personaEditorTarget);
      if (saved.personaEditorReturn !== undefined) setPersonaEditorReturn(saved.personaEditorReturn);
      if (typeof saved.showUserProfile === 'boolean') setShowUserProfile(saved.showUserProfile);
      // Room is a first-class field — restore it before the view switch so
      // a refresh inside Exam/Lab/Rad/Consultant returns to the same room.
      // Older blobs (pre-room-persistence) used view='discussion' to mean
      // consultant; honour that for backward compat.
      if (typeof saved.currentRoom === 'string' && ROOM_KEYS.includes(saved.currentRoom)) {
         setCurrentRoom(saved.currentRoom);
      } else if (saved.view === 'discussion') {
         setCurrentRoom('consultant');
      }
      switch (saved.view) {
         case 'persona-editor':
            // personaEditorTarget already applied above; that's the trigger
            // for the persona-editor route in the conditional render.
            break;
         case 'settings':    setShowFullPageSettings(true); break;
         case 'tna':         setShowTnaAnalytics(true); break;
         case 'oyon':        setShowOyonAnalytics(true); break;
         case 'home':
         case 'discussion':  // handled by the currentRoom restore above
         default: /* no-op — case view */ break;
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
                     const data = await apiFetch(`/sessions/${savedSessionId}`);
                     if (data?.session?.end_time) {
                        console.log('[Session] restored a server-ended session; user will exit through End');
                     } else {
                        EventLogger.sessionResumed(savedSessionId, savedCase?.id, savedCase?.name);
                     }
                  } catch (err) {
                     if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
                        console.warn('[Session] backend non-OK validating saved session; keeping local state');
                     } else {
                        console.warn('[Session] validation network error; keeping local state:', err.message);
                     }
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
         // Rehydrate the breadcrumb view state. Done after the session
         // restore so the conditional renders see the right activeCase
         // when they mount (settings/tna don't need it, but discussion +
         // persona-editor read it during render).
         try {
            const savedView = localStorage.getItem(VIEW_STORAGE_KEY);
            if (savedView) applyView(JSON.parse(savedView));
         } catch (e) {
            console.warn('[View] saved view blob unparseable, dropping:', e.message);
            localStorage.removeItem(VIEW_STORAGE_KEY);
         }
         setSessionValidated(true);
      };

      validateAndRestoreSession();
   }, []);

   // Persist the current view whenever it changes. Gated on
   // sessionValidated so the rehydrate path can finish before we start
   // writing — otherwise the React initial state ('home', settings tab
   // 'cases', step 1) would clobber the saved value on first render.
   useEffect(() => {
      if (!sessionValidated) return;
      try {
         localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(captureView()));
      } catch (e) {
         console.warn('[View] failed to persist view:', e.message);
      }
   }, [sessionValidated, captureView]);

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

   // Single entry point for every room transition (bottom RoomNavigator
   // on each screen + DiscussionScreen's "Back to Cases" topbar button)
   // so room transitions go through one path — keeps logging + future
   // hooks in one place.
   const navigateToRoom = (target) => {
      if (target === currentRoom) return;
      setCurrentRoom(target);
   };

   // Explicit "End & Debrief": stops the server-side session, sets the
   // sticky caseEnded flag so the patient-room chrome reflects it, and
   // routes the user straight into the debrief room. Idempotent on the
   // server (see sessions-routes.js:211), so a stray double-click is safe.
   const handleEndSession = () => {
      if (!sessionId) return;
      EventLogger.log('CLICKED', 'button', {
         objectId: 'end-session',
         objectName: 'End & Debrief',
         component: COMPONENTS.APP,
      });
      endSessionOnServer(sessionId);
      // Bug 7 (16.5.2026): clinical alarms latch until acked, and the
      // AudioSurface keeps beeping any active alarm. Ending the case is an
      // explicit "I'm done with the patient" — acknowledge outstanding
      // alarms so the ICU tone doesn't keep sounding through the debrief.
      // (Done here, not on consultant-room entry: the consultant is a peer
      // room that does NOT end the session, so visiting it mid-case must
      // not silence live alarms.)
      notifications.ackAll?.();
      setShowEndConfirm(false);
      setCaseEnded(true);
      navigateToRoom('consultant');
   };

   const handleLoadCase = (caseData) => {
      // If a session is already running, end it server-side before loading
      // the new case. Without this the prior session is orphaned with
      // end_time = NULL and learners can rack up zombie rows by switching
      // cases without explicitly ending.
      if (sessionId) {
         endSessionOnServer(sessionId);
      }
      // Clear previous session data when loading new case. Also drops the
      // view breadcrumb so the new case lands on the case view, not on
      // whatever surface the previous case was last looking at.
      localStorage.removeItem('rohy_chat_history');
      localStorage.removeItem(VIEW_STORAGE_KEY);
      if (sessionId) {
         localStorage.removeItem(`rohy_discussion_history_${sessionId}`);
      }
      setActiveCase(caseData);
      setSessionId(null); // Will be set by ChatInterface when session starts
      setCaseEnded(false);
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

   // Oyon pill → the top-level Emotion Analytics page (the Oyon element's own
   // Analyze dashboards). A first-class route, not a Settings deep-link.
   const handleOpenOyonAnalytics = () => {
      if (personaEditorTarget !== null) return; // editor owns the viewport
      setShowOyonAnalytics(true);
      EventLogger.componentOpened(COMPONENTS.CONFIG_PANEL, 'OyonAnalytics');
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
   // Oyon capture pill — mounted ONCE at App level and kept in the SAME
   // fragment slot across every top-level screen (rooms, settings, TNA,
   // persona editor), so screen switches never remount the <oyon-app>
   // element: the camera keeps running for the whole session (the
   // chatoyon-plus persistent-pill lesson). `room` stamps each captured
   // window with the active simulator room / app surface.
   const oyonRoom = personaEditorTarget !== null ? 'persona-editor'
      : showFullPageSettings ? 'settings'
      : showTnaAnalytics ? 'tna'
      : currentRoom;
   // Mirror ConfigPanel's canSeeOyonAnalytics gate: the pill's analytics
   // shortcut only renders for users who can actually see that tab.
   const oyonPill = user ? (
      // Top-center — the spot the pill has always lived in (the monitor
      // header renders nothing there anymore). Rendered whenever a user is
      // signed in, session or not: without a session the pill still captures
      // locally; persistence starts once consent + a session exist.
      <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[80]">
         <OyonCaptureWidget
            sessionId={sessionId}
            caseId={activeCase?.id}
            room={oyonRoom}
            onOpenAnalytics={canSeeOyonAnalytics ? handleOpenOyonAnalytics : undefined}
         />
      </div>
   ) : null;

   // Mounted at the App.jsx level so it owns the entire viewport (the
   // user's "not a toy" feedback was specifically about cramped chrome).
   if (personaEditorTarget !== null) {
      return (
         <>
         {oyonPill}
         <AgentPersonaEditor
            templateId={personaEditorTarget}
            onClose={handleClosePersonaEditor}
            onSaved={() => setPersonaRefreshCounter(c => c + 1)}
         />
         </>
      );
   }

   // Show full-page settings
   if (showFullPageSettings) {
      return (
         <>
         {oyonPill}
         <div className="h-screen w-screen rohy-offwhite-bg overflow-hidden">
            <ConfigPanel
               key={settingsNavNonce}
               onClose={handleCloseSettings}
               onLoadCase={handleLoadCase}
               fullPage={true}
               initialTab={settingsInitialTab}
               initialWizardStep={settingsInitialStep}
               onOpenPersonaEditor={handleOpenPersonaEditor}
               onCaseSaved={(savedCase) => {
                  // If the admin just saved the case that the chat tab has
                  // open, refresh the in-memory `activeCase` so edits (most
                  // importantly the patient's `config.voice.case_voice`)
                  // take effect on the next message without forcing the
                  // user to "Open case" again from the case list.
                  if (savedCase && activeCase && savedCase.id === activeCase.id) {
                     setActiveCase(savedCase);
                  }
               }}
            />
         </div>
         </>
      );
   }

   // Show full-page TNA analytics
   if (showTnaAnalytics) {
      return (
         <>
         {oyonPill}
         <div className="h-screen w-screen overflow-hidden">
            <TnaDashboard onClose={() => setShowTnaAnalytics(false)} />
         </div>
         </>
      );
   }

   // Show full-page Emotion analytics — the V2 TNA dashboard as a first-class
   // top-level route, pre-set to the Oyon emotion source. Its own filter bar
   // (Case / Student / Start / End / Source / Group by), network/centralities/
   // patterns/process/clusters tabs, and the aggregate Attention tab render
   // inside; nothing rohy-extra stacked on top.
   if (showOyonAnalytics) {
      return (
         <>
         {oyonPill}
         <div className="h-screen w-screen overflow-hidden">
            <TnaDashboard onClose={() => setShowOyonAnalytics(false)} defaultSource="emotions" defaultEmotionDimension="raw" />
         </div>
         </>
      );
   }

   // The consultant room (DiscussionScreen) is rendered inside the
   // PatientRecordProvider conditional tree below so it gets the same
   // bottom RoomNavigator as the other rooms. Leaving the consultant
   // via the nav routes back to the chat without ending the session;
   // ending the session uses the patient room's End & Debrief button.

   // Prepare patient info for PatientRecord. Must live above the
   // showExamination branch below: PhysicalExamScreen embeds ManikinPanel,
   // which calls usePatientRecord() to log exam findings. Outside the
   // provider the hook returns no-op stubs and findings silently vanish —
   // hoisting the provider keeps exam state captured regardless of which
   // top-level surface is showing.
   const patientInfo = activeCase ? {
      name: activeCase.config?.patient_name || activeCase.name || 'Unknown Patient',
      age: activeCase.config?.demographics?.age || null,
      gender: activeCase.config?.demographics?.gender || null,
      mrn: activeCase.config?.demographics?.mrn || null,
      chief_complaint: activeCase.config?.structuredHistory?.chiefComplaint || activeCase.chief_complaint || null
   } : null;

   return (
      <>
      {oyonPill}
      <PatientRecordProvider
         sessionId={sessionId}
         caseId={activeCase?.id}
         patientInfo={patientInfo}
      >
         <>
         {showExamination ? (
            <PhysicalExamScreen
               activeCase={activeCase}
               sessionId={sessionId}
               physicalExam={caseSnapshot?.config?.physical_exam ?? activeCase?.config?.physical_exam ?? null}
               patientGender={(caseSnapshot?.config?.demographics?.gender ?? activeCase?.config?.demographics?.gender)?.toLowerCase() || 'male'}
               onExamPerformed={(exam) => {
                  EventLogger.physicalExamPerformed(
                     exam.regionId,
                     exam.examType,
                     exam.finding,
                     { gender: activeCase?.config?.demographics?.gender, abnormal: exam.abnormal }
                  );
               }}
               roomNav={
                  <RoomNavigator
                     currentRoom={currentRoom}
                     onSelectRoom={navigateToRoom}
                     sessionId={sessionId}
                  />
               }
            />
         ) : showInvestigations ? (
            <InvestigationsScreen
               activeCase={activeCase}
               sessionId={sessionId}
               patientInfo={patientInfo}
               activeKind={currentRoom === 'radiology' ? 'radiology' : 'lab'}
               roomNav={
                  <RoomNavigator
                     currentRoom={currentRoom}
                     onSelectRoom={navigateToRoom}
                     sessionId={sessionId}
                  />
               }
            />
         ) : showDiscussion ? (
            <DiscussionScreen
               sessionId={sessionId}
               activeCase={activeCase}
               caseEnded={caseEnded}
               onClose={() => navigateToRoom('chat')}
               roomNav={
                  <RoomNavigator
                     currentRoom={currentRoom}
                     onSelectRoom={navigateToRoom}
                     sessionId={sessionId}
                  />
               }
            />
         ) : (
         /* h-[calc(100vh-72px)] reserves the bottom 72px for the
            always-visible RoomNavigator. PhysicalExamScreen and
            InvestigationsScreen do this implicitly by rendering the nav
            as their last flex-col child. */
         <div className="flex h-[calc(100vh-72px)] w-screen bg-neutral-950 text-white overflow-hidden">

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
               <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                  <div className="relative" ref={userMenuRef}>
                     <button
                        type="button"
                        onClick={() => {
                           setShowUserMenu(v => !v);
                           setShowAnalyticsMenu(false);
                        }}
                        aria-expanded={showUserMenu}
                        aria-controls="app-user-menu"
                        aria-label="Settings and profile menu"
                        className={`rohy-topbar-menu-trigger text-sm ${showUserMenu ? 'rohy-topbar-menu-trigger-open' : ''}`}
                     >
                        <Settings className="w-4 h-4 text-[var(--rohy-accent)]" />
                        <span>Settings</span>
                        <ChevronDown className={`w-4 h-4 text-[var(--rohy-muted)] transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                     </button>

                     {/* Dropdown */}
                     {showUserMenu && (
                        <>
                           <div className="fixed inset-0 z-40" onClick={closeTopMenus} />
                           <div
                              id="app-user-menu"
                              role="menu"
                              className="absolute left-0 top-full mt-2 z-50 rohy-menu rohy-topbar-menu-panel"
                           >
                              <button
                                 type="button"
                                 onClick={() => { setShowUserProfile(true); setShowUserMenu(false); }}
                                 role="menuitem"
                                 className="rohy-topbar-menu-item"
                              >
                                 <User className="w-4 h-4" />
                                 My Profile
                              </button>
                              <button
                                 type="button"
                                 onClick={() => { handleOpenSettings(); setShowUserMenu(false); }}
                                 role="menuitem"
                                 className="rohy-topbar-menu-item"
                              >
                                 <Settings className="w-4 h-4" />
                                 Open Settings
                              </button>
                              <button
                                 type="button"
                                 onClick={() => { setShowHelpCenter(true); setShowUserMenu(false); }}
                                 role="menuitem"
                                 className="rohy-topbar-menu-item"
                              >
                                 <HelpCircle className="w-4 h-4" />
                                 Help &amp; Support
                              </button>
                              {isAdminUser && (
                                 <button
                                    type="button"
                                    onClick={() => { setShowTnaAnalytics(true); setShowUserMenu(false); }}
                                    role="menuitem"
                                    className="rohy-topbar-menu-item"
                                 >
                                    <Activity className="w-4 h-4" />
                                    Analytics
                                 </button>
                              )}
                              <div className="rohy-menu-divider" />
                              <button
                                 type="button"
                                 onClick={() => {
                                    EventLogger.log('CLICKED', 'button', { objectId: 'logout', objectName: 'Logout', component: COMPONENTS.APP });
                                    logout();
                                    closeTopMenus();
                                 }}
                                 role="menuitem"
                                 className="rohy-topbar-menu-item rohy-topbar-menu-item-danger"
                              >
                                 <LogOut className="w-4 h-4" />
                                 Logout
                              </button>
                           </div>
                        </>
                     )}
                  </div>

                  {/* Analytics dropdown — a peer of the Settings menu that
                      promotes the two analytics surfaces to primary top-bar
                      destinations. Emotion deep-links into the Oyon Learning
                      Analytics settings tab (educator+/admin, matching the
                      Oyon pill's canSeeOyonAnalytics gate); Case Analytics
                      opens the full-page TNA dashboard (admin, matching the
                      user-menu Analytics entry). Hidden entirely when the
                      user can reach neither. */}
                  {canSeeAnalyticsMenu && (
                     <div className="relative">
                        <button
                           type="button"
                           onClick={() => {
                              setShowAnalyticsMenu(v => !v);
                              setShowUserMenu(false);
                           }}
                           aria-expanded={showAnalyticsMenu}
                           aria-controls="app-analytics-menu"
                           aria-label="Analytics menu"
                           className={`rohy-topbar-menu-trigger text-sm ${showAnalyticsMenu ? 'rohy-topbar-menu-trigger-open' : ''}`}
                           title="Analytics"
                        >
                           <Activity className="w-4 h-4 text-[var(--rohy-accent)]" />
                           <span>Analytics</span>
                           <ChevronDown className={`w-4 h-4 text-[var(--rohy-muted)] transition-transform ${showAnalyticsMenu ? 'rotate-180' : ''}`} />
                        </button>

                        {showAnalyticsMenu && (
                           <>
                              <div className="fixed inset-0 z-40" onClick={closeTopMenus} />
                              <div
                                 id="app-analytics-menu"
                                 role="menu"
                                 className="absolute left-0 top-full mt-2 z-50 rohy-menu rohy-topbar-menu-panel"
                              >
                                 {canSeeOyonAnalytics && (
                                    <button
                                       type="button"
                                       onClick={() => { setShowOyonAnalytics(true); setShowAnalyticsMenu(false); }}
                                       role="menuitem"
                                       className="rohy-topbar-menu-item"
                                    >
                                       <Activity className="w-4 h-4" />
                                       Emotion
                                    </button>
                                 )}
                                 {isAdminUser && (
                                    <button
                                       type="button"
                                       onClick={() => { setShowTnaAnalytics(true); setShowAnalyticsMenu(false); }}
                                       role="menuitem"
                                       className="rohy-topbar-menu-item"
                                    >
                                       <Activity className="w-4 h-4" />
                                       Case Analytics
                                    </button>
                                 )}
                              </div>
                           </>
                        )}
                     </div>
                  )}
               </div>

               {/* End & Debrief — the explicit way for the learner to close
                   the case. Tab-close + case-switch still call the same
                   endpoint as fallbacks, but this is the canonical path:
                   one click, one confirmation, lands you in the debrief. */}
               {sessionId && !caseEnded && (
                  <div className="absolute top-4 right-4 z-10">
                     <button
                        onClick={() => setShowEndConfirm(true)}
                        className="px-3 py-2 bg-red-900/70 hover:bg-red-800/80 backdrop-blur-md rounded-full flex items-center gap-2 text-sm text-red-50 border border-red-700/60 transition-colors"
                        title="End the current session and open the debrief"
                     >
                        <StopCircle className="w-4 h-4" />
                        <span>End &amp; Debrief</span>
                     </button>
                  </div>
               )}
            </div>

            {/* Bottom Left: Chat Interface — a gaze attention target
                (AoiRegion): dwell on the conversation lands in
                aoi_dwell_ms.chat_panel. Same div, same layout; mounting /
                unmounting with this chat surface publishes and retracts the
                AOI automatically. */}
            <AoiRegion id="chat_panel" className="flex-1 min-h-0 relative">
               {sessionValidated && (
                  <ChatInterface
                     activeCase={activeCase}
                     onSessionStart={setSessionId}
                     restoredSessionId={sessionId}
                     personaRefreshCounter={personaRefreshCounter}
                  />
               )}
            </AoiRegion>

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

         {/* OrdersDrawer mounted at App level so its resting pills can
             perch on the seam between the chat column and the vitals
             monitor — anchored to the column boundary, vertically
             middle, overlapping just slightly into the vitals panel.
             The drawer's slide-out + backdrop are `fixed` regardless. */}
         {activeCase && sessionId && (
            <OrdersDrawer
               caseId={activeCase.id}
               sessionId={sessionId}
               onViewResult={handleViewResult}
               caseData={activeCase}
            />
         )}

         {/* In-app Help & Support (Stage 4). The drawer is always mounted
             and self-hides on !open. The first-run onboarding tour shows
             once per role per TOUR_VERSION (persisted in localStorage). */}
         <HelpCenter open={showHelpCenter} onClose={() => setShowHelpCenter(false)} />
         {user?.role && <OnboardingTour role={user.role} />}

         {/* Bottom RoomNavigator on the main chat surface. Same
             component renders inside PhysicalExamScreen and
             InvestigationsScreen so the bar is consistent across every
             in-session view. */}
         {activeCase && sessionId && (
            <div className="fixed bottom-0 left-0 right-0 z-40">
               <RoomNavigator
                  currentRoom={currentRoom}
                  onSelectRoom={navigateToRoom}
                  sessionId={sessionId}
               />
            </div>
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

         {/* Physical Examination is now a full-page screen — see the
             `if (showExamination)` branch above the main return. The
             previous ManikinPanel modal mount was removed 2026-05-13 as
             part of the exam-as-screen refactor. The same case-snapshot
             precedence (caseSnapshot.config.physical_exam → activeCase)
             is preserved in the screen's prop wiring above so admin edits
             mid-session still don't bleed into the running session. */}

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
         )}

         {showEndConfirm && (
            <EndSessionConfirm
               onCancel={() => setShowEndConfirm(false)}
               onConfirm={handleEndSession}
            />
         )}
         </>
      </PatientRecordProvider>
      </>
   );
}

function EndSessionConfirm({ onCancel, onConfirm }) {
   return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
         <div className="bg-neutral-900 border border-red-800/70 rounded-lg shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-neutral-800 flex items-center gap-3">
               <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
               <h2 className="text-base font-semibold text-white">End this session?</h2>
            </div>
            <div className="px-6 py-5 text-sm text-neutral-300 space-y-2">
               <p>This closes the case for debrief. Once ended:</p>
               <ul className="list-disc list-inside text-neutral-400 space-y-1 ml-1">
                  <li>The patient timeline stops advancing.</li>
                  <li>Orders, exams, and chat are locked.</li>
                  <li>You can review the transcript in the debrief room but cannot reopen the case.</li>
               </ul>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-800">
               <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm rounded border border-neutral-700 text-neutral-300 hover:text-white"
               >
                  Cancel
               </button>
               <button
                  onClick={onConfirm}
                  className="px-4 py-2 text-sm rounded text-white font-semibold bg-red-700 hover:bg-red-600 flex items-center gap-2"
               >
                  <StopCircle className="w-4 h-4" />
                  End &amp; Debrief
               </button>
            </div>
         </div>
      </div>
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
