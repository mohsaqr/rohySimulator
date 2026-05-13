import RadiologyReportView from './RadiologyReportView';

// Thin modal wrapper around RadiologyReportView. Same rationale as
// LabResultsModal — keeps call sites that mount the report as a popup
// working while the view itself can be embedded directly into the
// InvestigationsScreen's viewer pane.
const RadiologyResultsModal = ({ result, _sessionId, patientInfo, onClose }) => {
    if (!result) return null;
    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
            <div className="max-w-4xl w-full max-h-[95vh] flex">
                <RadiologyReportView result={result} patientInfo={patientInfo} onClose={onClose} />
            </div>
        </div>
    );
};

export default RadiologyResultsModal;
