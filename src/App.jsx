import React, { useState } from 'react';
import PatientMonitor from './components/monitor/PatientMonitor';
import PatientVisual from './components/patient/PatientVisual';
import ChatInterface from './components/chat/ChatInterface';
import ConfigPanel from './components/settings/ConfigPanel';
import LoginPage from './components/auth/LoginPage';
import RegisterPage from './components/auth/RegisterPage';
import InvestigationPanel from './components/investigations/InvestigationPanel';
import LabResultsModal from './components/investigations/LabResultsModal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Settings, X, LogOut, User } from 'lucide-react';

function MainApp() {
   const [showConfig, setShowConfig] = useState(false);
   const [showFullPageSettings, setShowFullPageSettings] = useState(false);
   const [activeCase, setActiveCase] = useState(null);
   const [sessionId, setSessionId] = useState(null);
   const [selectedResult, setSelectedResult] = useState(null);
   const { user, logout, isAdmin } = useAuth();

   const handleLoadCase = (caseData) => {
      setActiveCase(caseData);
      setShowConfig(false);
      setShowFullPageSettings(false);
   };

   // Show full-page settings
   if (showFullPageSettings) {
      return (
         <div className="h-screen w-screen bg-neutral-950 text-white overflow-hidden">
            <ConfigPanel 
               onClose={() => setShowFullPageSettings(false)} 
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

                  {/* Investigation Panel */}
                  {activeCase && sessionId && (
                     <InvestigationPanel
                        caseId={activeCase.id}
                        sessionId={sessionId}
                        onViewResult={setSelectedResult}
                     />
                  )}

                  {/* Settings Button - Full Page */}
                  <button
                     onClick={() => setShowFullPageSettings(true)}
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

               {/* Case Banner */}
               {activeCase && (
                  <div className="absolute top-4 left-4 px-3 py-1 bg-blue-900/80 backdrop-blur border border-blue-500/30 rounded text-xs font-bold text-blue-100 z-10">
                     Case: {activeCase.name}
                  </div>
               )}
            </div>

            {/* Bottom Left: Chat Interface */}
            <div className="flex-1 min-h-0 relative">
               <ChatInterface 
                  activeCase={activeCase} 
                  onSessionStart={setSessionId}
               />
            </div>

         </div>

         {/* Right Column (Monitor) - Remaining width */}
         <div className="flex-1 h-full min-w-[600px] bg-black relative">
            <PatientMonitor 
               caseParams={activeCase?.config}
               caseData={activeCase}
               sessionId={sessionId}
            />
         </div>

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
               onClose={() => setSelectedResult(null)}
            />
         )}

      </div>
   );
}

export default function App() {
   const [showRegister, setShowRegister] = useState(false);

   return (
      <AuthProvider>
         <AuthenticatedApp 
            showRegister={showRegister} 
            setShowRegister={setShowRegister} 
         />
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
