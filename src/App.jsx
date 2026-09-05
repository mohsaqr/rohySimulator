import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import PatientMonitor from './components/monitor/PatientMonitor';
import PatientVisual from './components/patient/PatientVisual';
import ChatInterface from './components/chat/ChatInterface';
import ConfigPanel from './components/settings/ConfigPanel';
import AuthGate from './components/auth/AuthGate';
import OrdersDrawer from './components/orders/OrdersDrawer';
import UserProfilePanel from './components/settings/UserProfilePanel';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { useCaseLanguageSync } from './hooks/useCaseLanguageSync';
import TopBarControls from './components/common/TopBarControls';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
// Lazy so the TipTap/react-query lessons bundle stays out of the main chunk,
// loading only when a user opens the lessons room.
const LessonsRoomContainer = lazy(() => import('./components/lessons/LessonsRoomContainer'));
import { VoiceProvider } from './contexts/VoiceContext';
import { NotificationProvider } from './notifications/NotificationContext';
import { useNotifications } from './notifications/useNotifications';
import { setExternalApi } from './notifications/externalApi';
import { ToastSurface, BannerSurface, AudioSurface, BackendSurface, ConsoleSurface } from './notifications/surfaces';
import DiagnosticBar from './components/debug/DiagnosticBar';
import { PatientRecordProvider } from './services/PatientRecord';
import EventLogger, { COMPONENTS, registerWindowLifecycleLogging } from './services/eventLogger';
import { ApiError, apiFetch, apiPut } from './services/apiClient';
import { pickLandingCase } from './services/landingCase';
import { X, StopCircle, AlertTriangle } from 'lucide-react';
import BodyMapDebug from './components/examination/BodyMapDebug';
import TnaDashboard from './components/analytics/tna/TnaDashboardV2';
import OyonDashboardRoom from './components/oyon/OyonDashboardRoom';
import OyonConsentUpdate from './components/oyon/OyonConsentUpdate';
import DiscussionScreen from './components/discussion/DiscussionScreen';
import PhysicalExamScreen from './components/exam/PhysicalExamScreen';
import InvestigationsScreen from './components/investigations/InvestigationsScreen';
import { registry as pluginRegistry, PluginRoom, useHostOrders } from './plugins/index.js';
import { PatientConversationProvider, usePatientConversation, narrowConversation } from './contexts/PatientConversationContext';
import RoomNavigator from './components/common/RoomNavigator';
import AgentPersonaEditor from './components/settings/AgentPersonaEditor';
import OyonCaptureWidget from './components/oyon/OyonCaptureWidget';
import { useSignalCapture } from './components/oyon/useSignalCapture';
import { useOyonSignalGate } from './components/oyon/useOyonSignalGate';
import AoiRegion from './components/oyon/AoiRegion';
import { HelpCenter, OnboardingTour } from './help';
import FirstRunGate, { useSetup } from './components/setup/FirstRunGate';

// Persistence rule: a session ends ONLY through the Exit or End buttons
// (or an explicit case-switch). Refresh, tab close, idle time — none of
// those count as exits. We restore whatever the user had whenever the app
// boots, and never silently wipe based on time-since-last-activity.
function MainApp() {
   const { t } = useTranslation('app');
   const [showFullPageSettings, setShowFullPageSettings] = useState(false);
   const [showLessonsRoom, setShowLessonsRoom] = useState(false);
   // The course tied to the active case, resolved when the Course card opens.
   // { cohortId, cohortName } — one case, one course (no picker).
   const [courseCohortId, setCourseCohortId] = useState({ cohortId: null, cohortName: null });
   const [showUserProfile, setShowUserProfile] = useState(false);
   const [showUserMenu, setShowUserMenu] = useState(false);
   const [showTnaAnalytics, setShowTnaAnalytics] = useState(false);
   // Emotion analytics as a first-class full-page route — the Oyon element's
   // own Analyze dashboards (Emotion dynamics / Engagement / Affect / Gaze),
   // one click from the top bar instead of buried under Settings → Oyon tab.
   const [showOyonAnalytics, setShowOyonAnalytics] = useState(false);
   // The named Oyon dashboard — OYON's own Analyze dashboards over server data
   // (<oyon-app chrome="none">), as opposed to showOyonAnalytics above which is
   // Rohy's own TnaDashboard preset to the emotion source. Deliberately a
   // SEPARATE surface: new modalities surface here without touching any
   // existing Rohy tab.
   const [showOyonDashboard, setShowOyonDashboard] = useState(false);
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
   const [settingsInitialTab, setSettingsInitialTab] = useState('overview');
   const [settingsInitialStep, setSettingsInitialStep] = useState(1);
   // Bumped by the Oyon pill's analytics shortcut. ConfigPanel keeps its
   // active tab in local state seeded from `initialTab`, so a tab request
   // made while the panel is ALREADY open needs a remount to take effect —
   // the nonce is ConfigPanel's key.
   const [settingsNavNonce] = useState(0);
   const { user, logout, isAdmin } = useAuth();
   const { uiLanguage, setUiLanguage } = useLanguage();
   // Recall path for the first-run wizard ("Platform setup" menu item).
   const { openSetupWizard } = useSetup();
   const isAdminUser = isAdmin();
   const canSeeOyonAnalytics = user?.role === 'educator' || user?.role === 'admin';
   const [sessionValidated, setSessionValidated] = useState(false);
   const lastActivityRef = useRef(Date.now());

   const closeTopMenus = useCallback(() => {
      setShowUserMenu(false);
   }, []);

   // Restore and validate session from localStorage on mount
   const [activeCase, setActiveCase] = useState(null);
   const [sessionId, setSessionId] = useState(null);
   // A case with config.case_language overrides the session dialogue
   // language (LLM directive, STT locale, fallback voice) while active.
   useCaseLanguageSync(activeCase);
   // currentRoom drives the in-session bottom navigator. One of:
   //   'chat'        — main patient-chat UI (default)
   //   'examination' — PhysicalExamScreen
   //   'lab'         — InvestigationsScreen, Laboratory active
   //   'radiology'   — InvestigationsScreen, Radiology active
   //   'pathology'   — PathologyScreen (whole-slide review)
   //   'consultant'  — DiscussionScreen (debrief room)
   // All six are peers. Visiting the consultant does NOT end the
   // session — that's the End & Debrief button in the patient room.
   // Ending the session also sends the user here (caseEnded=true) but
   // leaving via the nav while the session is live just navigates back.
   const [currentRoom, setCurrentRoom] = useState('chat');
   // caseEnded sticks once the user explicitly ends the session via the
   // End & Debrief button. While true, the patient room chrome treats the
   // case as closed (the End button hides itself) and DiscussionScreen
   // renders its calm post-debrief strip. Cleared when a new case loads.
   const [caseEnded, setCaseEnded] = useState(false);
   // Wall-clock instant the case was ended (ms). PatientMonitor freezes its
   // session clock at this value instead of Date.now(), so "Back to patient"
   // from the debrief shows the elapsed time AT the end, not end + debrief.
   const [caseEndedAt, setCaseEndedAt] = useState(null);
   // When THIS browser started (or resumed) the current session — the
   // duration ENDED_SESSION reports. The server owns the authoritative
   // start_time; this is the client's view of the run it is ending.
   const sessionStartedAtRef = useRef(null);
   useEffect(() => { sessionStartedAtRef.current = sessionId ? Date.now() : null; }, [sessionId]);
   const [showEndConfirm, setShowEndConfirm] = useState(false);
   const [showHelpCenter, setShowHelpCenter] = useState(false);
   const showExamination = currentRoom === 'examination';
   const showInvestigations = currentRoom === 'lab' || currentRoom === 'radiology';
   const showDiscussion = currentRoom === 'consultant';

   useEffect(() => {
      if (!showUserMenu) return;

      const onKeydown = (event) => {
         if (event.key === 'Escape') {
            closeTopMenus();
         }
      };

      window.addEventListener('keydown', onKeydown);
      return () => window.removeEventListener('keydown', onKeydown);
   }, [showUserMenu, closeTopMenus]);

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
   //
   // This effect is now only a BACKSTOP. navigateToRoom() — the single
   // entry point for learner-driven transitions — stamps the room
   // synchronously and advances prevRoomRef itself, because child mount
   // effects run before this one and would otherwise log their arrival
   // events against the room the learner just left. What is left for the
   // effect are the few setCurrentRoom() paths that bypass the navigator
   // (the disabled-plugin fallback, the saved-view restore).
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

   // Fetch and load the landing case if no session exists. A student lands on
   // the case that speaks THEIR interface language — the demo course carries one
   // case per language (EN/DE/ES/IT), so a German UI opens the German patient,
   // a Spanish UI the Spanish one, etc. When no case matches the UI language
   // (e.g. a Finnish UI with no Finnish case yet), fall back to the tenant
   // default (the English STEMI), which is always present and always visible.
   const loadDefaultCase = async () => {
      try {
         const data = await apiFetch('/cases');
         const landingCase = pickLandingCase(data?.cases || [], uiLanguage);
         if (landingCase) {
            console.log('Auto-loading landing case:', landingCase.name, `(ui=${uiLanguage})`);
            setActiveCase(landingCase);
            EventLogger.caseLoaded(landingCase.id, landingCase.name);
         }
      } catch (err) {
         console.error('Failed to load landing case:', err);
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
   // --- Plugin plumbing (RPS-1) -------------------------------------------
   // A plugin's case material rides on the case config under its own id, so
   // the manifest id is also the config key — one identity, nothing to keep
   // in sync. The snapshot wins over the live case for the same reason every
   // other room prefers it: a running session must not shift under the learner.
   const pluginCaseConfig = caseSnapshot?.config ?? activeCase?.config ?? null;
   const pluginSession = useMemo(() => ({
      id: sessionId,
      caseId: activeCase?.id ?? null,
      userId: user?.id ?? null,
      role: user?.role ?? 'guest',
      language: uiLanguage,
      examMode: false,
   }), [sessionId, activeCase?.id, user?.id, user?.role, uiLanguage]);

   // The 'orders' capability (RPS-1): what this learner has ordered in the core
   // rooms, narrowed by the host. Fetched only when an installed plugin asks
   // for it, so a deployment whose plugins do not makes no request at all.
   //
   // It reaches availability as well as the room because it can be the ONLY
   // reason a room has anything to show: PACS shows the images for a study
   // ordered in Radiology, and a case whose author authored no imaging still
   // owes the learner the normal study they ordered.
   const pluginOrders = useHostOrders(sessionId);
   // The 'conversation' grant: the session's one patient conversation, as
   // published by ChatInterface through PatientConversationContext and
   // narrowed to send + read. Null until the chat room has mounted.
   const conversationBus = usePatientConversation();
   const pluginConversation = useMemo(() => narrowConversation(conversationBus), [conversationBus]);
   // The 'drawer' grant: open the orders drawer on a tab. `at` makes a repeat
   // request for the same tab a fresh one.
   const [drawerRequest, setDrawerRequest] = useState(null);
   const openDrawer = useCallback((tab) => setDrawerRequest({ tab, at: Date.now() }), []);
   // The 'case' grant: the frozen snapshot, whole and read-only.
   const pluginCase = caseSnapshot ?? activeCase ?? null;
   const pluginGrants = useMemo(() => ({
      orders: pluginOrders,
      conversation: pluginConversation,
      openDrawer,
      patientCase: pluginCase,
      // Live physiology, as a getter the context freezes per read: a plugin
      // room that mirrors the monitor reads this instead of the EventLogger
      // singleton's field (RPS-1 §6 — no host singleton crosses the seam).
      vitals: () => EventLogger.currentVitals,
   }), [pluginOrders, pluginConversation, openDrawer, pluginCase]);

   // Which plugin rooms this case actually offers. A plugin gates itself —
   // pathology declines a case with no slides — so the navigator shows no tab
   // rather than a tab onto an empty state.
   const enabledPlugins = useMemo(
      () => pluginRegistry
         .resolve((m) => ({
            data: pluginCaseConfig?.[m.id] ?? null,
            session: pluginSession,
            // Gated on the manifest, exactly as the room context is: a plugin
            // that never requested orders cannot read a learner's order history
            // by reaching for a field the host happened to set.
            orders: (m.capabilities ?? []).includes('orders') ? pluginOrders : null,
         }))
         .map((p) => p.manifest.id),
      [pluginCaseConfig, pluginSession, pluginOrders],
   );

   // Any room key owned by a plugin resolves to the generic PluginRoom mount —
   // but only if the plugin actually accepted this case. Without the
   // availability check here, a plugin that declined would still mount and
   // render its own empty state, which is the thing available() exists to
   // prevent.
   const activePlugin = enabledPlugins.includes(currentRoom)
      ? pluginRegistry.get(currentRoom)
      : null;
   // A plugin room whose manifest says `presentation: 'overlay'` is drawn
   // OVER the chat layout rather than in place of it. The chat layout stays
   // mounted underneath — inert, so nothing in it can be reached — because
   // it is where the session lives: PatientMonitor is the physiology engine
   // and ChatInterface owns the patient conversation. The 3D bedside is a
   // second view of that same patient, not a second patient.
   const overlayPlugin = activePlugin?.manifest?.room?.presentation === 'overlay' ? activePlugin : null;

   // A room can become unavailable underneath the learner (case switch, or a
   // restored `rohy_view` blob naming a plugin room this case does not offer).
   // Leaving currentRoom pointing at a room nothing renders would strand the
   // user on the patient screen with no tab highlighted.
   useEffect(() => {
      if (pluginRegistry.get(currentRoom) && !enabledPlugins.includes(currentRoom)) {
         setCurrentRoom('chat');
      }
   }, [currentRoom, enabledPlugins]);

   // Core rooms plus whatever plugins are installed (RPS-1). This list used to
   // name 'pathology' literally; a plugin now contributes its room key through
   // its manifest, so installing the next one touches no file in src/ outside
   // its own directory.
   const ROOM_KEYS = ['chat', 'examination', 'lab', 'radiology', 'consultant']
      .concat(pluginRegistry.manifests().map((m) => m.room.key));
   const captureView = useCallback(() => {
      let view = 'home';
      if (personaEditorTarget !== null) view = 'persona-editor';
      else if (showFullPageSettings)    view = 'settings';
      else if (showLessonsRoom)         view = 'lessons';
      else if (showTnaAnalytics)        view = 'tna';
      else if (showOyonAnalytics)       view = 'oyon';
      else if (showOyonDashboard)       view = 'oyon-dashboard';
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
      showFullPageSettings, showLessonsRoom, showTnaAnalytics, showOyonAnalytics, showOyonDashboard,
      currentRoom, showUserProfile,
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
         case 'oyon-dashboard': setShowOyonDashboard(true); break;
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
      // Stamp the room BEFORE React re-renders. React runs child mount
      // effects before the parent's, so an effect-based stamp let the new
      // room's components log their first events while EventLogger.room
      // still held the room the learner just left — every arrival event was
      // attributed to the previous room. Doing it here also covers
      // lab ↔ radiology, where the panel component is shared and never
      // remounts. prevRoomRef is advanced in the same breath so the
      // backstop effect below sees no change and does not double-log.
      if (sessionId != null) {
         EventLogger.roomChanged(target);
      }
      prevRoomRef.current = target;
      setCurrentRoom(target);
   };

   // Open the lessons room for the ACTIVE case's course. Resolves the case →
   // its cohort server-side; the room shows that course's content, or the
   // "no course content" empty state if the course is empty. Falls back to the
   // course picker when the case maps to no accessible course.
   const openCourseForCase = useCallback(async () => {
      let course = { cohortId: null, cohortName: null };
      try {
         if (activeCase?.id != null) {
            const r = await apiFetch(`/courses/for-case/${activeCase.id}`);
            course = { cohortId: r?.data?.cohortId ?? null, cohortName: r?.data?.cohortName ?? null };
         }
      } catch { /* show the empty state */ }
      setCourseCohortId(course);
      setShowLessonsRoom(true);
      // Stamp telemetry + gaze windows with the lessons surface, mirroring
      // the currentRoom effect — the lessons view is an early return, so the
      // room effect never sees it and events would misattribute to the
      // underlying simulator room.
      EventLogger.roomChanged('lessons');
   }, [activeCase]);

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
      // The session ENDING is its own row — ENDED_SESSION had no producer at
      // all until here, so BackendSurface's flush-on-end branch was dead code
      // and no analytics could see where a session stopped.
      EventLogger.sessionEnded(sessionStartedAtRef.current ? Date.now() - sessionStartedAtRef.current : null, 'explicit');
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
      setCaseEndedAt(Date.now());
      navigateToRoom('consultant');
   };

   const handleLoadCase = (caseData) => {
      // If a session is already running, end it server-side before loading
      // the new case. Without this the prior session is orphaned with
      // end_time = NULL and learners can rack up zombie rows by switching
      // cases without explicitly ending.
      if (sessionId) {
         EventLogger.sessionEnded(sessionStartedAtRef.current ? Date.now() - sessionStartedAtRef.current : null, 'case_reload');
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
      setCaseEndedAt(null);
      setShowFullPageSettings(false);
      // Log case loaded event
      EventLogger.caseLoaded(caseData?.id, caseData?.name);
   };

   // Handle settings panel open/close with logging
   const handleOpenSettings = () => {
      setShowFullPageSettings(true);
      EventLogger.componentOpened(COMPONENTS.CONFIG_PANEL, 'Settings');
   };

   // Cases shortcut from the top-bar menu — open Settings straight onto the
   // case list (the "Select Case" tab students use), not the default tab.
   const handleOpenCases = () => {
      setSettingsInitialTab('cases');
      setShowFullPageSettings(true);
      EventLogger.componentOpened(COMPONENTS.CONFIG_PANEL, 'Cases');
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
      : showLessonsRoom ? 'lessons'
      : currentRoom;

   // Host-driven signal capture (typing today; interaction/discourse next).
   // Mounted here for the same reason the pill is: App outlives every screen
   // switch, so a typing episode is not abandoned when the learner moves
   // between rooms. `room`/`caseId` are read at flush time by the transport,
   // so changing them does not restart capture.
   const signalGate = useOyonSignalGate(sessionId);
   const { capture: signalCapture } = useSignalCapture({
      enabled: signalGate.enabled,
      persist: signalGate.persist,
      runtimeConfig: signalGate.runtimeConfig,
      sessionId,
      caseId: activeCase?.id,
      room: oyonRoom,
   });

   // Publish the pill's live width as --oyon-pill-w on <html> so headers it
   // floats over (PatientMonitor's) can reserve a real layout slot for it
   // instead of letting their content slide underneath. The width is dynamic
   // (recording state, consent badge, analytics shortcut), hence a
   // ResizeObserver rather than a constant.
   const oyonPillRef = useRef(null);
   useEffect(() => {
      const el = oyonPillRef.current;
      const root = document.documentElement;
      if (!el) {
         root.style.removeProperty('--oyon-pill-w');
         return undefined;
      }
      const publish = () => {
         root.style.setProperty('--oyon-pill-w', `${Math.ceil(el.getBoundingClientRect().width)}px`);
      };
      const observer = new ResizeObserver(publish);
      observer.observe(el);
      publish();
      return () => {
         observer.disconnect();
         root.style.removeProperty('--oyon-pill-w');
      };
   }, [user]);
   // Mirror ConfigPanel's canSeeOyonAnalytics gate: the pill's analytics
   // shortcut only renders for users who can actually see that tab.
   //
   // Positioning: on the chat+monitor screen the pill docks over the CENTER
   // of the monitor column (left column is w-[35%] min-w-[350px], so the
   // column seam is max(35vw, 350px)), where PatientMonitor's header grid
   // reserves a matching slot via --oyon-pill-w. Everywhere else it keeps
   // the historical viewport top-center spot.
   const oyonDockedOverMonitor = oyonRoom === 'chat';
   // Re-consent prompt for a widened Oyon contract. Rendered beside the capture
   // pill so it reaches every surface, and self-suppressing — it returns null
   // unless this learner previously accepted an older contract.
   const oyonConsentUpdate = user ? <OyonConsentUpdate /> : null;

   const oyonPill = user ? (
      // Rendered whenever a user is signed in, session or not: without a
      // session the pill still captures locally; persistence starts once
      // consent + a session exist.
      <div
         ref={oyonPillRef}
         className="fixed top-2 -translate-x-1/2 z-[80]"
         style={{
            left: oyonDockedOverMonitor
               ? 'calc(max(35vw, 350px) + (100vw - max(35vw, 350px)) / 2)'
               : '50vw',
         }}
      >
         <OyonCaptureWidget
            sessionId={sessionId}
            caseId={activeCase?.id}
            room={oyonRoom}
            onOpenAnalytics={canSeeOyonAnalytics ? handleOpenOyonAnalytics : undefined}
         />
      </div>
   ) : null;

   // Persistent settings/account menu + language switcher. Built once here
   // and rendered in every screen's header (via the same `roomNav`-style
   // prop the room screens already accept) so the gear + language switch
   // no longer vanish when the user leaves the chat room.
   const topBarControls = user ? (
      <TopBarControls
         isAdminUser={isAdminUser}
         canSeeOyonAnalytics={canSeeOyonAnalytics}
         onOpenCases={handleOpenCases}
         onOpenProfile={() => setShowUserProfile(true)}
         onOpenSettings={handleOpenSettings}
         onOpenHelp={() => setShowHelpCenter(true)}
         onOpenEmotionAnalytics={() => setShowOyonAnalytics(true)}
         onOpenOyonDashboard={() => setShowOyonDashboard(true)}
         onOpenCaseAnalytics={() => setShowTnaAnalytics(true)}
         onOpenSetup={isAdminUser ? openSetupWizard : undefined}
         onLogout={() => {
            EventLogger.log('CLICKED', 'button', { objectId: 'logout', objectName: 'Logout', component: COMPONENTS.APP });
            logout();
         }}
         uiLanguage={uiLanguage}
         onSetLanguage={setUiLanguage}
      />
   ) : null;

   // Mounted at the App.jsx level so it owns the entire viewport (the
   // user's "not a toy" feedback was specifically about cramped chrome).
   if (personaEditorTarget !== null) {
      return (
         <>
         {oyonPill}
         {oyonConsentUpdate}
         <AgentPersonaEditor
            templateId={personaEditorTarget}
            onClose={handleClosePersonaEditor}
            onSaved={() => setPersonaRefreshCounter(c => c + 1)}
         />
         </>
      );
   }

   // Show full-page settings
   if (showLessonsRoom) {
      return (
         <>
         {oyonPill}
         {oyonConsentUpdate}
         <div className="h-screen w-screen rohy-offwhite-bg overflow-hidden">
            <Suspense fallback={<div className="p-8 text-sm text-neutral-500">Loading…</div>}>
               <LessonsRoomContainer
                  cohortId={courseCohortId.cohortId}
                  cohortName={courseCohortId.cohortName}
                  onBackToSimulation={() => {
                     setShowLessonsRoom(false);
                     EventLogger.roomChanged(currentRoom);
                  }}
               />
            </Suspense>
         </div>
         </>
      );
   }

   if (showFullPageSettings) {
      return (
         <>
         {oyonPill}
         {oyonConsentUpdate}
         <div className="h-screen w-screen rohy-offwhite-bg overflow-hidden">
            <ConfigPanel
               key={settingsNavNonce}
               onClose={handleCloseSettings}
               onLoadCase={handleLoadCase}
               fullPage={true}
               initialTab={settingsInitialTab}
               initialWizardStep={settingsInitialStep}
               onOpenPersonaEditor={handleOpenPersonaEditor}
               onLogout={() => {
                  EventLogger.log('CLICKED', 'button', { objectId: 'logout', objectName: 'Logout', component: COMPONENTS.APP });
                  logout();
               }}
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
         {oyonConsentUpdate}
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
         {oyonConsentUpdate}
         <div className="h-screen w-screen overflow-hidden">
            <TnaDashboard onClose={() => setShowOyonAnalytics(false)} defaultSource="emotions" defaultEmotionDimension="raw" />
         </div>
         </>
      );
   }

   // The named Oyon dashboard — OYON's own Analyze dashboards over server rows.
   // A sibling of the surface above, never a replacement: both routes coexist,
   // and the element mounted here is a chrome="none" viewer, so it owns no
   // camera and coexists with the capture pill.
   if (showOyonDashboard) {
      return (
         <>
         {oyonPill}
         {oyonConsentUpdate}
         <OyonDashboardRoom onClose={() => setShowOyonDashboard(false)} />
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
   // A fresh literal each render is fine here: PatientRecordContext keeps
   // patientInfo in a ref and keys its init effect on sessionId/caseId only,
   // so a new-but-equal object cannot re-run init (the ~180 req/min
   // GET /api/patient-record 404 loop this once caused).
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
               topBarControls={topBarControls}
               activeCase={activeCase}
               sessionId={sessionId}
               physicalExam={caseSnapshot?.config?.physical_exam ?? activeCase?.config?.physical_exam ?? null}
               patientGender={caseSnapshot?.config?.demographics?.gender ?? activeCase?.config?.demographics?.gender}
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
                     enabledPlugins={enabledPlugins}
                     onOpenCourse={openCourseForCase}
                     sessionId={sessionId}
                  />
               }
            />
         ) : showInvestigations ? (
            <InvestigationsScreen
               topBarControls={topBarControls}
               activeCase={activeCase}
               sessionId={sessionId}
               patientInfo={patientInfo}
               activeKind={currentRoom === 'radiology' ? 'radiology' : 'lab'}
               enabledPlugins={enabledPlugins}
               onSelectRoom={navigateToRoom}
               roomNav={
                  <RoomNavigator
                     currentRoom={currentRoom}
                     onSelectRoom={navigateToRoom}
                     enabledPlugins={enabledPlugins}
                     onOpenCourse={openCourseForCase}
                     sessionId={sessionId}
                  />
               }
            />
         ) : activePlugin && !overlayPlugin ? (
            // Generic plugin mount. App knows the room key and the case
            // config; everything plugin-specific — which prop is called
            // `pathologyCase`, how annotations persist — lives in the
            // plugin's own descriptor under src/plugins/<id>/.
            //
            // No LLM capability is granted here. rohy's LLMService exposes
            // sendMessage/streamMessage bound to the PATIENT conversation, so
            // granting it would write a plugin's prompts into the case
            // transcript. A plugin requesting `llm` gets nothing until a
            // narrowed {complete({system, prompt})} adapter exists, and is
            // expected to degrade — pathology leaves a grade "undecided" and
            // surfaces it for tutor review.
            <PluginRoom
               pluginId={currentRoom}
               topBarControls={topBarControls}
               caseTitle={activeCase?.name ?? null}
               session={pluginSession}
               caseConfig={pluginCaseConfig}
               eventLogger={EventLogger}
               grants={pluginGrants}
               navigate={navigateToRoom}
               roomNav={
                  <RoomNavigator
                     currentRoom={currentRoom}
                     onSelectRoom={navigateToRoom}
                     onOpenCourse={openCourseForCase}
                     sessionId={sessionId}
                     enabledPlugins={enabledPlugins}
                  />
               }
            />
         ) : showDiscussion ? (
            <DiscussionScreen
               topBarControls={topBarControls}
               sessionId={sessionId}
               activeCase={activeCase}
               caseEnded={caseEnded}
               onClose={() => navigateToRoom('chat')}
               roomNav={
                  <RoomNavigator
                     currentRoom={currentRoom}
                     onSelectRoom={navigateToRoom}
                     enabledPlugins={enabledPlugins}
                     onOpenCourse={openCourseForCase}
                     sessionId={sessionId}
                  />
               }
            />
         ) : (
         /* h-[calc(100vh-72px)] reserves the bottom 72px for the
            always-visible RoomNavigator. PhysicalExamScreen and
            InvestigationsScreen do this implicitly by rendering the nav
            as their last flex-col child. */
         <div className="flex max-lg:flex-col h-[calc(100vh-72px)] w-screen bg-neutral-950 text-white overflow-hidden">

         {/* Multi-tab warning banner. Shown when another tab on this origin
             writes to rohy_active_session. last-write-wins applies.
             Fixed overlay so we don't disturb the existing flex layout. */}
         {multiTabWarning && (
            <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-2 bg-amber-600/95 text-amber-50 text-sm rounded-lg shadow-xl border border-amber-700 max-w-2xl">
               <span>
                  <strong>{t('multi_tab_heads_up')}</strong> {t('multi_tab_warning')}
               </span>
               <button
                  onClick={() => setMultiTabWarning(false)}
                  className="px-2 py-0.5 rounded bg-amber-700 hover:bg-amber-800 text-xs"
               >
                  {t('dismiss')}
               </button>
            </div>
         )}

         {/* Left Column (Visual + Chat) - 35% width on large screens.
             Side-by-side, this column's 350px floor and the monitor's 600px
             floor add up to a 950px minimum inside an `overflow-hidden`
             viewport — wider than an iPad in portrait (820px), which silently
             clipped the right edge of the monitor with no way to scroll to
             it. Below `lg` the two stack instead: conversation on top (it's
             what the learner drives), vitals underneath. Desktop is
             untouched. */}
         <div className="lg:w-[35%] lg:min-w-[350px] max-lg:h-[52%] flex flex-col border-b lg:border-b-0 lg:border-r border-neutral-800 bg-neutral-900" inert={overlayPlugin ? true : undefined}>

            {/* Top Left: Patient Visual — a smaller slice when stacked, so
                the chat below it keeps a usable number of lines. */}
            <div className="h-[30%] lg:h-[45%] border-b border-neutral-800 relative">
               <PatientVisual caseData={activeCase} />

               {/* Settings menu + language switcher — far-left top corner.
                   Now the shared TopBarControls, identical to the one rendered
                   in every other screen's header, so the gear and language
                   switch are consistent app-wide. */}
               <div className="absolute top-4 left-4 z-10">
                  {topBarControls}
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
                        title={t('end_debrief_title')}
                     >
                        <StopCircle className="w-4 h-4" />
                        {/* Label hidden below `lg`: this button, the top-left
                            controls and the centred Oyon pill all share one
                            narrow band, and the three collided on a tablet.
                            `title` + aria-label keep it identifiable. */}
                        <span className="max-lg:sr-only">{t('end_debrief')}</span>
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
                     caseEnded={caseEnded}
                     personaRefreshCounter={personaRefreshCounter}
                     signalCapture={signalCapture}
                  />
               )}
            </AoiRegion>

         </div>

         {/* Right Column (Monitor) - Remaining width (remaining height when
             stacked; the 600px floor is a side-by-side constraint only). */}
         <div className="flex-1 min-h-0 lg:h-full lg:min-w-[600px] bg-black relative" inert={overlayPlugin ? true : undefined}>
            {/* ISSUE-0015: the monitor must know the case is over — "Back to
                patient" from the debrief lands here, and a still-ticking clock
                and drifting vitals read as a case that never ended. */}
            <PatientMonitor
               caseParams={activeCase?.config}
               caseData={activeCase}
               sessionId={sessionId}
               isAdmin={isAdmin()}
               caseEnded={caseEnded}
               caseEndedAt={caseEndedAt}
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
               caseData={activeCase}
               isAdmin={isAdmin()}
               openRequest={drawerRequest}
               onOpenRequestConsumed={() => setDrawerRequest(null)}
               fabAlign={overlayPlugin ? 'left' : 'seam'}
            />
         )}

         {/* Overlay plugin room (manifest `presentation: 'overlay'`). The
             room's own surface is fixed and full-bleed at z-30; the bottom
             RoomNavigator (z-40) and OrdersDrawer (z-50) stay above it, and
             the chat layout underneath keeps simulating and conversing. */}
         {overlayPlugin && activeCase && sessionId && (
            <PluginRoom
               pluginId={currentRoom}
               session={pluginSession}
               caseConfig={pluginCaseConfig}
               eventLogger={EventLogger}
               grants={pluginGrants}
               navigate={navigateToRoom}
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
                  enabledPlugins={enabledPlugins}
                  onOpenCourse={openCourseForCase}
                  sessionId={sessionId}
               />
            </div>
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
   const { t } = useTranslation('app');
   return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
         <div className="bg-neutral-900 border border-red-800/70 rounded-lg shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-neutral-800 flex items-center gap-3">
               <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
               <h2 className="text-base font-semibold text-white">{t('end_session_confirm_title')}</h2>
            </div>
            <div className="px-6 py-5 text-sm text-neutral-300 space-y-2">
               <p>{t('end_session_confirm_intro')}</p>
               <ul className="list-disc list-inside text-neutral-400 space-y-1 ml-1">
                  <li>{t('end_session_confirm_timeline')}</li>
                  <li>{t('end_session_confirm_locked')}</li>
                  <li>{t('end_session_confirm_transcript')}</li>
               </ul>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-800">
               <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm rounded border border-neutral-700 text-neutral-300 hover:text-white"
               >
                  {t('cancel')}
               </button>
               <button
                  onClick={onConfirm}
                  className="px-4 py-2 text-sm rounded text-white font-semibold bg-red-700 hover:bg-red-600 flex items-center gap-2"
               >
                  <StopCircle className="w-4 h-4" />
                  {t('end_debrief')}
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
   if (isBodyMapDebug) {
      return <BodyMapDebugApp />;
   }

   return (
      <AuthProvider>
         <ScopedNotificationProvider>
            {/* Bridge so non-React producers (EventLogger singleton) can call notify() */}
            <NotificationApiBridge />
            <ToastProvider>
               {/* Language sits above VoiceProvider so speech (STT locale,
                   TTS mismatch warnings) can key off caseLanguage. */}
               <LanguageProvider>
                  <VoiceProvider>
                     {/* The one patient conversation, shared between the chat
                         room (its owner) and any plugin room granted it. */}
                     <PatientConversationProvider>
                     {/* App-wide containment: a render throw anywhere below
                         shows a recoverable panel instead of a white screen.
                         PluginRoom carries its own narrower boundary so a
                         plugin crash costs only its room. */}
                     <ErrorBoundary scope="app">
                        <AuthenticatedApp />
                     </ErrorBoundary>
                     </PatientConversationProvider>
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
               </LanguageProvider>
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

function AuthenticatedApp() {
   const { t } = useTranslation('app');
   const { user, loading } = useAuth();

   // Show loading spinner while checking authentication
   if (loading) {
      return (
         <div className="flex items-center justify-center h-screen bg-neutral-950">
            <div className="text-center">
               <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
               <p className="text-neutral-400">{t('loading')}</p>
            </div>
         </div>
      );
   }

   // Show login/register if not authenticated. AuthGate owns the login↔register
   // toggle and the registration-policy probe that decides whether registering is
   // even on offer.
   if (!user) {
      return <AuthGate />;
   }

   // Show main app if authenticated — behind the first-run gate (admin
   // setup wizard / student first-run screen, each shown until completed).
   return (
      <FirstRunGate>
         <MainApp />
      </FirstRunGate>
   );
}
