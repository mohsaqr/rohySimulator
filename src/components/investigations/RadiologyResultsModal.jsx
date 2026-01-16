import React, { useEffect, useState } from 'react';
import { X, Printer, ZoomIn, ZoomOut, Maximize2, FileText, Clock, User, Calendar, Building2, Stethoscope } from 'lucide-react';
import { AuthService } from '../../services/authService';
import { apiUrl } from '../../config/api';
import { usePatientRecord } from '../../services/PatientRecord';

const RadiologyResultsModal = ({ result, sessionId, patientInfo, onClose }) => {
  const { elicited } = usePatientRecord();
  const [imageZoom, setImageZoom] = useState(1);
  const [showFullImage, setShowFullImage] = useState(false);

  // Parse result_data for findings
  const resultData = typeof result.result_data === 'string'
    ? JSON.parse(result.result_data || '{}')
    : (result.result_data || {});

  // Generate a fake accession number for realism
  const accessionNumber = `RAD-${result.id?.toString().padStart(6, '0') || '000001'}`;
  const reportDate = new Date(result.available_at || Date.now());
  const orderDate = new Date(result.ordered_at || Date.now());

  // Mark as viewed when opened
  useEffect(() => {
    if (result && !result.viewed_at) {
      markAsViewed();
      const hasFindings = resultData.findings || resultData.interpretation;
      elicited('radiology', `${result.test_name}: ${resultData.interpretation || 'Results available'}`, hasFindings, {
        study_name: result.test_name,
        modality: result.modality,
        findings: resultData.findings,
        interpretation: resultData.interpretation,
        has_image: !!result.image_url
      });
    }
  }, [result]);

  const markAsViewed = async () => {
    try {
      const token = AuthService.getToken();
      await fetch(apiUrl(`/api/orders/${result.id}/view`), {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (error) {
      console.error('Failed to mark as viewed:', error);
    }
  };

  const handlePrint = () => window.print();

  if (!result) return null;

  const hasImage = result.image_url;
  const hasFindings = resultData.findings;
  const hasInterpretation = resultData.interpretation;

  return (
    <>
      {/* Main Modal */}
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[95vh] flex flex-col shadow-2xl overflow-hidden">

          {/* Report Header - Hospital Style */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white p-6 print:bg-slate-800">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white/10 rounded-lg flex items-center justify-center">
                  <Building2 className="w-8 h-8 text-cyan-400" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-wide">RADIOLOGY REPORT</h1>
                  <p className="text-cyan-400 text-sm font-medium mt-1">VipSim Medical Center</p>
                  <p className="text-slate-400 text-xs mt-0.5">Department of Diagnostic Imaging</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-full transition-colors print:hidden"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Patient & Study Info Bar */}
          <div className="bg-slate-100 border-b border-slate-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-500 text-xs uppercase tracking-wide">Patient</div>
              <div className="font-semibold text-slate-800">
                {patientInfo?.name || 'Unknown Patient'}
              </div>
              <div className="text-slate-600 text-xs">
                {patientInfo?.age && `${patientInfo.age} yo`} {patientInfo?.gender}
              </div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase tracking-wide">Accession #</div>
              <div className="font-mono font-semibold text-slate-800">{accessionNumber}</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase tracking-wide">Study Date</div>
              <div className="font-semibold text-slate-800">
                {reportDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div className="text-slate-600 text-xs">
                {reportDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div>
              <div className="text-slate-500 text-xs uppercase tracking-wide">Status</div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                FINAL
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Study Information */}
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-cyan-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText className="w-6 h-6 text-cyan-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-slate-800">{result.test_name}</h2>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                      {result.modality || 'Imaging'}
                    </span>
                    {resultData.body_region && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs">
                        {resultData.body_region}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Image Section */}
            {hasImage && (
              <div className="p-6 bg-black">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white/70 text-sm font-medium">Study Image</span>
                  <div className="flex items-center gap-2 print:hidden">
                    <button
                      onClick={() => setImageZoom(z => Math.max(0.5, z - 0.25))}
                      className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-white/50 text-xs w-12 text-center">{Math.round(imageZoom * 100)}%</span>
                    <button
                      onClick={() => setImageZoom(z => Math.min(3, z + 0.25))}
                      className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setShowFullImage(true)}
                      className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white ml-2"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="overflow-auto max-h-80 rounded-lg bg-black flex items-center justify-center">
                  <img
                    src={result.image_url}
                    alt={result.test_name}
                    className="max-w-full transition-transform cursor-zoom-in"
                    style={{ transform: `scale(${imageZoom})` }}
                    onClick={() => setShowFullImage(true)}
                  />
                </div>
              </div>
            )}

            {/* Report Sections */}
            <div className="p-6 space-y-6">
              {/* Clinical Indication */}
              {resultData.indications && resultData.indications.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                    Clinical Indication
                  </h3>
                  <p className="text-slate-700">
                    {resultData.indications.slice(0, 3).join('; ')}
                  </p>
                </div>
              )}

              {/* Technique */}
              <div>
                <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                  Technique
                </h3>
                <p className="text-slate-700">
                  {result.modality} imaging of the {resultData.body_region || 'specified region'} was performed using standard departmental protocols.
                </p>
              </div>

              {/* Findings */}
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3 flex items-center gap-2">
                  <Stethoscope className="w-4 h-4" />
                  Findings
                </h3>
                {hasFindings ? (
                  <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {resultData.findings}
                  </p>
                ) : (
                  <p className="text-slate-500 italic">
                    No significant abnormality detected. The study demonstrates normal appearance for the examined region.
                  </p>
                )}
              </div>

              {/* Impression */}
              <div className="bg-cyan-50 rounded-lg p-4 border border-cyan-200">
                <h3 className="text-xs uppercase tracking-wider text-cyan-700 font-semibold mb-3">
                  Impression
                </h3>
                {hasInterpretation ? (
                  <p className="text-slate-800 font-medium leading-relaxed whitespace-pre-wrap">
                    {resultData.interpretation}
                  </p>
                ) : (
                  <p className="text-slate-800 font-medium">
                    1. No acute findings.
                    <br />
                    2. Clinical correlation recommended.
                  </p>
                )}
              </div>

              {/* Signature Block */}
              <div className="pt-6 border-t border-slate-200 mt-8">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-slate-800 font-semibold">Electronically Signed</div>
                    <div className="text-slate-600 text-sm">
                      {reportDate.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-serif italic text-xl text-slate-700">Dr. AI Radiologist</div>
                    <div className="text-slate-500 text-sm">MD, FRCR</div>
                    <div className="text-slate-400 text-xs">Board Certified Radiologist</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-slate-100 border-t border-slate-200 p-4 flex items-center justify-between print:hidden">
            <div className="text-xs text-slate-500">
              This report is for educational/simulation purposes only
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Printer className="w-4 h-4" />
                Print Report
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Full Screen Image Viewer */}
      {showFullImage && hasImage && (
        <div
          className="fixed inset-0 bg-black z-[60] flex items-center justify-center"
          onClick={() => setShowFullImage(false)}
        >
          <button
            onClick={() => setShowFullImage(false)}
            className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <img
            src={result.image_url}
            alt={result.test_name}
            className="max-w-[95vw] max-h-[95vh] object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Print Styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .fixed { position: absolute !important; }
          .fixed > div {
            visibility: visible;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            max-height: none !important;
            overflow: visible !important;
          }
          .fixed > div * { visibility: visible; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </>
  );
};

export default RadiologyResultsModal;
