import LabReportView from './LabReportView';

// Thin modal wrapper around LabReportView. Kept so existing call sites
// (App.jsx, anywhere else that opens a lab report as a popup) work
// unchanged. The actual report markup + side effects live in the view —
// new full-page surfaces (InvestigationsScreen) embed the view directly.
const LabResultsModal = ({ result, _sessionId, patientInfo, onClose }) => {
    if (!result) return null;
    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
            <div className="max-w-3xl w-full max-h-[95vh] flex">
                <LabReportView result={result} patientInfo={patientInfo} onClose={onClose} />
            </div>
        </div>
    );
};

export default LabResultsModal;
