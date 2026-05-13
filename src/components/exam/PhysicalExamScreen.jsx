import { useEffect, useState } from 'react';
import { ArrowLeft, NotebookPen, Stethoscope } from 'lucide-react';
import ManikinPanel from '../examination/ManikinPanel';
import ExamNotesDrawer from './ExamNotesDrawer';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';

// Full-screen Physical Examination page. Mirrors DiscussionScreen's layout
// shape — topbar (back + title + Notes button), main embedded workspace
// occupying the body. Replaces the old modal mount in App.jsx.
//
// The exam workspace itself (BodyMap, ExamTypeSelector, FindingDisplay,
// ExamLog) is still owned by ManikinPanel; this screen renders it in
// `embedded` mode so the modal chrome (backdrop + close X) drops out and
// the topbar's Back button is the canonical exit.
//
// Notes use the per-session note artifact shared with the discussion
// debrief — see ExamNotesDrawer for the rationale.
export default function PhysicalExamScreen({
    activeCase,
    sessionId,
    physicalExam,
    patientGender,
    onExamPerformed,
    onClose,
    roomNav,
}) {
    const [showNotes, setShowNotes] = useState(false);

    useEffect(() => {
        EventLogger.componentOpened(COMPONENTS.MANIKIN_PANEL, 'PhysicalExamScreen');
        EventLogger.examPanelOpened();
        return () => {
            EventLogger.examPanelClosed();
            EventLogger.componentClosed(COMPONENTS.MANIKIN_PANEL, 'PhysicalExamScreen');
        };
    }, []);

    const caseTitle = activeCase?.name || activeCase?.config?.patient_name || 'Patient';

    return (
        <div className="h-screen w-screen bg-gradient-to-br from-slate-700 to-slate-900 text-slate-100 flex flex-col overflow-hidden">
            {/* Topbar */}
            <header className="flex items-center justify-between px-6 py-3 bg-slate-900/80 backdrop-blur border-b border-slate-700">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <div className="flex items-center gap-2 text-sm">
                        <Stethoscope className="w-5 h-5 text-cyan-400" />
                        <span className="font-semibold text-slate-100">Physical Examination</span>
                        <span className="text-slate-400">· {caseTitle}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowNotes(true)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <NotebookPen className="w-4 h-4" />
                        Notes
                    </button>
                </div>
            </header>

            {/* Body — embedded ManikinPanel fills the remaining height. */}
            <div className="flex-1 min-h-0 p-6">
                <ManikinPanel
                    embedded
                    physicalExam={physicalExam}
                    patientGender={patientGender}
                    onExamPerformed={onExamPerformed}
                />
            </div>

            {/* Bottom RoomNavigator — rendered by App.jsx and passed in
                so the nav stays consistent across rooms while keeping
                this screen's layout self-contained. */}
            {roomNav}

            {/* Side notes drawer */}
            <ExamNotesDrawer
                open={showNotes}
                onClose={() => setShowNotes(false)}
                sessionId={sessionId}
            />
        </div>
    );
}
