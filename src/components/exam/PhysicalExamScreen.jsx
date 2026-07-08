import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NotebookPen, Stethoscope } from 'lucide-react';
import ManikinPanel from '../examination/ManikinPanel';
import ExamNotesDrawer from './ExamNotesDrawer';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import { useAuth } from '../../contexts/AuthContext';
import { caseDisplayLabel } from '../../utils/caseDisplayLabel';

// Full-screen Physical Examination page. Mirrors DiscussionScreen's layout
// shape — topbar (title + Notes button), main embedded workspace occupying
// the body. Replaces the old modal mount in App.jsx.
//
// The exam workspace itself (BodyMap, ExamTypeSelector, FindingDisplay,
// ExamLog) is still owned by ManikinPanel; this screen renders it in
// `embedded` mode so the modal chrome (backdrop + close X) drops out.
// Exit is via the bottom RoomNavigator — there is no topbar Back here
// because the always-visible nav makes a second exit affordance redundant.
//
// Notes use the per-session note artifact shared with the discussion
// debrief — see ExamNotesDrawer for the rationale.
export default function PhysicalExamScreen({
    activeCase,
    sessionId,
    physicalExam,
    patientGender,
    onExamPerformed,
    roomNav,
}) {
    const { t } = useTranslation('examination');
    const [showNotes, setShowNotes] = useState(false);
    const { user } = useAuth();

    useEffect(() => {
        EventLogger.componentOpened(COMPONENTS.MANIKIN_PANEL, 'PhysicalExamScreen');
        EventLogger.examPanelOpened();
        return () => {
            EventLogger.examPanelClosed();
            EventLogger.componentClosed(COMPONENTS.MANIKIN_PANEL, 'PhysicalExamScreen');
        };
    }, []);

    // Students must not see the authoring title (it names the diagnosis).
    const caseTitle = caseDisplayLabel(activeCase, user);

    return (
        <div className="h-screen w-screen bg-gradient-to-br from-slate-700 to-slate-900 text-slate-100 flex flex-col overflow-hidden">
            {/* Topbar */}
            <header className="flex items-center justify-between px-6 py-3 bg-slate-900/80 backdrop-blur border-b border-slate-700">
                <div className="flex items-center gap-2 text-sm">
                    <Stethoscope className="w-5 h-5 text-cyan-400" />
                    <span className="font-semibold text-slate-100">{t('physical_examination')}</span>
                    <span className="text-slate-400">· {caseTitle}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setShowNotes(true)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5 transition-colors border border-slate-700"
                    >
                        <NotebookPen className="w-4 h-4" />
                        {t('notes')}
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
