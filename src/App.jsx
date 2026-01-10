import React, { useState, useEffect, useCallback, useRef } from 'react';
import PatientMonitor from './components/monitor/PatientMonitor';
import PatientVisual from './components/patient/PatientVisual';
import ChatInterface from './components/chat/ChatInterface';
import ConfigPanel from './components/settings/ConfigPanel';
import LoginPage from './components/auth/LoginPage';
import RegisterPage from './components/auth/RegisterPage';
import OrdersDrawer from './components/orders/OrdersDrawer';
import LabResultsModal from './components/investigations/LabResultsModal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { AuthService } from './services/authService';
import EventLogger, { COMPONENTS } from './services/eventLogger';
import { Settings, X, LogOut, User, RotateCcw, Stethoscope } from 'lucide-react';
import ManikinPanel from './components/examination/ManikinPanel';

// Session expiry time in milliseconds (default 30 minutes)
const SESSION_EXPIRY_MS = parseInt(localStorage.getItem('rohy_session_expiry_minutes') || '30') * 60 * 1000;

function MainApp() {
   const [showConfig, setShowConfig] = useState(false);
   const [showFullPageSettings, setShowFullPageSettings] = useState(false);
   const { user, logout, isAdmin } = useAuth();
   const [sessionValidated, setSessionValidated] = useState(false);
   const lastActivityRef = useRef(Date.now());

   // Restore and validate session from localStorage on mount
   const [activeCase, setActiveCase] = useState(null);
   const [sessionId, setSessionId] = useState(null);
   const [selectedResult, setSelectedResult] = useState(null);
   const [showExamination, setShowExamination] = useState(false);

   // Set user context for EventLogger when user logs in
   useEffect(() => {
      if (user?.id) {
         EventLogger.setContext({ userId: user.id });
      }
   }, [user?.id]);

   // Validate session on mount
   useEffect(() => {
      const validateAndRestoreSession = async () => {
         try {
            const saved = localStorage.getItem('rohy_active_session');
            if (!saved) {
               setSessionValidated(true);
               return;
            }

            const { activeCase: savedCase, sessionId: savedSessionId, timestamp } = JSON.parse(saved);

            // Check if session has expired due to inactivity
            const timeSinceActivity = Date.now() - (timestamp || 0);
            if (timeSinceActivity > SESSION_EXPIRY_MS) {
               console.log('Session expired due to inactivity');
               localStorage.removeItem('rohy_active_session');
               localStorage.removeItem('rohy_chat_history');
               setSessionValidated(true);
               return;
            }

            // Validate session exists in backend
            if (savedSessionId) {
               try {
                  const token = AuthService.getToken();
                  const res = await fetch(`/api/sessions/${savedSessionId}`, {
                     headers: { 'Authorization': `Bearer ${token}` }
                  });

                  if (res.ok) {
                     const data = await res.json();
                     // Session is valid and not ended
                     if (!data.session.end_time) {
                        console.log('Session validated:', savedSessionId);
                        setActiveCase(savedCase);
                        setSessionId(savedSessionId);
                        lastActivityRef.current = Date.now();
                        // Log session resume
                        EventLogger.sessionResumed(savedSessionId, savedCase?.id, savedCase?.name);
                     } else {
                        console.log('Session already ended, clearing');
                        localStorage.removeItem('rohy_active_session');
                        localStorage.removeItem('rohy_chat_history');
                     }
                  } else {
                     console.log('Session not found in backend, clearing');
                     localStorage.removeItem('rohy_active_session');
                     localStorage.removeItem('rohy_chat_history');
                  }
               } catch (err) {
                  console.error('Failed to validate session:', err);
                  // Keep local session if backend unavailable
                  setActiveCase(savedCase);
                  setSessionId(savedSessionId);
               }
            } else if (savedCase) {
               // Case but no session - allow
               setActiveCase(savedCase);
            }
         } catch (e) {
            console.warn('Failed to restore session:', e);
            localStorage.removeItem('rohy_active_session');
         }
         setSessionValidated(true);
      };

      validateAndRestoreSession();
   }, []);

   // Update activity timestamp on user interactions
   const updateActivity = useCallback(() => {
      lastActivityRef.current = Date.now();
      // Update localStorage timestamp to extend session
      if (activeCase && sessionId) {
         localStorage.setItem('rohy_active_session', JSON.stringify({
            activeCase,
            sessionId,
            timestamp: Date.now()
         }));
      }
   }, [activeCase, sessionId]);

   // Track user activity
   useEffect(() => {
      const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
      events.forEach(event => window.addEventListener(event, updateActivity, { passive: true }));
      return () => events.forEach(event => window.removeEventListener(event, updateActivity));
   }, [updateActivity]);

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
   const handleEndSession = async () => {
      if (confirm('End this simulation session? Chat history will be preserved in your session history.')) {
         // Log session end before clearing
         const sessionStartTime = lastActivityRef.current;
         const duration = Date.now() - sessionStartTime;
         EventLogger.sessionEnded(duration);

         // Call backend to end session
         if (sessionId) {
            try {
               const token = AuthService.getToken();
               await fetch(`/api/sessions/${sessionId}/end`, {
                  method: 'PUT',
                  headers: { 'Authorization': `Bearer ${token}` }
               });
            } catch (err) {
               console.error('Failed to end session in backend:', err);
            }
         }
         localStorage.removeItem('rohy_active_session');
         localStorage.removeItem('rohy_chat_history');
         setActiveCase(null);
         setSessionId(null);
      }
   };

   const handleLoadCase = (caseData) => {
      // Clear previous session data when loading new case
      localStorage.removeItem('rohy_chat_history');
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
      EventLogger.componentClosed(COMPONENTS.CONFIG_PANEL, 'Settings');
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

   // Show full-page settings
   if (showFullPageSettings) {
      return (
         <div className="h-screen w-screen bg-neutral-950 text-white overflow-hidden">
            <ConfigPanel
               onClose={handleCloseSettings}
               onLoadCase={handleLoadCase}
               fullPage={true}
            />
         </div>
      );
   }

   return (
      <div className="flex h-screen w-screen bg-neutral-950 text-white overflow-hidden">

         {/* Left Column (Visual + Chat) - 35% width on large screens */}
         <div className="w-[35%] min-w-[350px] flex flex-col border-r border-neutral-800 bg-neutral-900">

            {/* Top Left: Patient Visual */}
            <div className="h-[45%] border-b border-neutral-800 relative">
               <PatientVisual
                  image={activeCase?.image_url || "/patient_avatar.png"}
                  context={activeCase?.description}
                  caseData={activeCase}
               />

               {/* Top Right Controls */}
               <div className="absolute top-4 right-4 flex gap-2 z-10">
                  {/* User Menu */}
                  <div className="px-3 py-2 bg-black/50 backdrop-blur-md rounded-full flex items-center gap-2 text-sm">
                     <User className="w-4 h-4 text-neutral-400" />
                     <span className="text-neutral-300">{user?.username}</span>
                     {isAdmin() && (
                        <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded">Admin</span>
                     )}
                  </div>

                  {/* Settings Button - Full Page */}
                  <button
                     onClick={handleOpenSettings}
                     className="p-2 bg-black/50 hover:bg-black/80 text-neutral-400 hover:text-white rounded-full transition-all backdrop-blur-md"
                     title="Settings (Full Page)"
                  >
                     <Settings className="w-5 h-5" />
                  </button>

                  {/* Logout Button */}
                  <button
                     onClick={logout}
                     className="p-2 bg-black/50 hover:bg-red-900/80 text-neutral-400 hover:text-red-300 rounded-full transition-all backdrop-blur-md"
                  >
                     <LogOut className="w-5 h-5" />
                  </button>
               </div>

               {/* Case Banner with End Session */}
               {activeCase && (
                  <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
                     <div className="px-3 py-1 bg-blue-900/80 backdrop-blur border border-blue-500/30 rounded text-xs font-bold text-blue-100">
                        Case: {activeCase.name}
                     </div>
                     <button
                        onClick={handleEndSession}
                        className="px-2 py-1 bg-red-900/80 hover:bg-red-800 backdrop-blur border border-red-500/30 rounded text-xs font-bold text-red-100 flex items-center gap-1 transition-colors"
                        title="End simulation session"
                     >
                        <X className="w-3 h-3" />
                        End
                     </button>
                  </div>
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
            />
         )}

         {/* Lab Results Modal */}
         {selectedResult && (
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
         )}

         {/* Physical Examination Button - Floating */}
         {activeCase && sessionId && (
            <button
               onClick={() => setShowExamination(true)}
               className="fixed bottom-24 right-6 z-40 p-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-full shadow-lg transition-all hover:scale-105 flex items-center gap-2"
               title="Physical Examination"
            >
               <Stethoscope className="w-6 h-6" />
            </button>
         )}

         {/* Physical Examination Panel */}
         <ManikinPanel
            isOpen={showExamination}
            onClose={() => setShowExamination(false)}
            physicalExam={activeCase?.config?.physicalExam || null}
            onExamPerformed={(exam) => {
               // Log exam to session (optional - can integrate later)
               console.log('Exam performed:', exam);
            }}
         />

      </div>
   );
}

export default function App() {
   const [showRegister, setShowRegister] = useState(false);

   return (
      <AuthProvider>
         <ToastProvider>
            <AuthenticatedApp
               showRegister={showRegister}
               setShowRegister={setShowRegister}
            />
         </ToastProvider>
      </AuthProvider>
   );
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
