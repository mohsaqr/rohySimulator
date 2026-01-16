import React, { useState, useEffect } from 'react';
import { X, FileText, AlertTriangle, TrendingUp, TrendingDown, Minus, Printer, Building2, FlaskConical } from 'lucide-react';
import { AuthService } from '../../services/authService';
import { apiUrl } from '../../config/api';
import { usePatientRecord } from '../../services/PatientRecord';

const LabResultsModal = ({ result, sessionId, patientInfo, onClose }) => {
  const { elicited } = usePatientRecord();
  const [showRanges, setShowRanges] = useState(() => {
    const saved = localStorage.getItem('rohy_show_lab_ranges');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [showFlags, setShowFlags] = useState(() => {
    const saved = localStorage.getItem('rohy_show_lab_flags');
    return saved !== null ? JSON.parse(saved) : true;
  });

  // Generate accession number
  const accessionNumber = `LAB-${result?.order_id?.toString().padStart(6, '0') || '000001'}`;
  const reportDate = new Date(result?.available_at || Date.now());

  // Mark as viewed when opened
  useEffect(() => {
    if (result && !result.viewed_at) {
      markAsViewed();
      const isAbnormal = result.current_value < result.min_value || result.current_value > result.max_value;
      elicited('lab', `${result.test_name}: ${result.current_value} ${result.unit || ''}`, isAbnormal, {
        test_name: result.test_name,
        value: String(result.current_value),
        unit: result.unit,
        reference_range: `${result.min_value}-${result.max_value}`,
        significance: isAbnormal ? 'Abnormal result' : 'Normal result'
      });
    }
  }, [result]);

  const markAsViewed = async () => {
    try {
      const token = AuthService.getToken();
      await fetch(apiUrl(`/api/orders/${result.order_id}/view`), {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (error) {
      console.error('Failed to mark as viewed:', error);
    }
  };

  const evaluateValue = (value, minValue, maxValue) => {
    if (value === null || value === undefined) return 'unknown';
    if (value < minValue) return 'low';
    if (value > maxValue) return 'high';
    return 'normal';
  };

  const getFlag = (status) => {
    const flags = {
      'low': { icon: TrendingDown, symbol: '↓', text: 'LOW', color: 'blue' },
      'high': { icon: TrendingUp, symbol: '↑', text: 'HIGH', color: 'orange' },
      'normal': { icon: Minus, symbol: '', text: 'NORMAL', color: 'green' },
      'unknown': { icon: AlertTriangle, symbol: '?', text: 'UNKNOWN', color: 'gray' }
    };
    return flags[status] || flags['unknown'];
  };

  const toggleRanges = () => {
    const newValue = !showRanges;
    setShowRanges(newValue);
    localStorage.setItem('rohy_show_lab_ranges', JSON.stringify(newValue));
  };

  const toggleFlags = () => {
    const newValue = !showFlags;
    setShowFlags(newValue);
    localStorage.setItem('rohy_show_lab_flags', JSON.stringify(newValue));
  };

  const handlePrint = () => window.print();

  if (!result) return null;

  const status = evaluateValue(result.current_value, result.min_value, result.max_value);
  const flag = getFlag(status);

  return (
    <>
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" id="lab-results-modal">
        <div className="bg-white rounded-lg max-w-3xl w-full max-h-[95vh] flex flex-col shadow-2xl overflow-hidden">

          {/* Report Header - Hospital Style */}
          <div className="bg-gradient-to-r from-purple-900 to-purple-800 text-white p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white/10 rounded-lg flex items-center justify-center">
                  <Building2 className="w-8 h-8 text-purple-300" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-wide">LABORATORY REPORT</h1>
                  <p className="text-purple-300 text-sm font-medium mt-1">VipSim Medical Center</p>
                  <p className="text-purple-400 text-xs mt-0.5">Clinical Laboratory Services</p>
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
              <div className="text-slate-500 text-xs uppercase tracking-wide">Report Date</div>
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

          {/* Settings Bar */}
          <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 print:hidden">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={showRanges}
                  onChange={toggleRanges}
                  className="w-4 h-4 rounded"
                />
                <span className="text-slate-600">Show Ranges</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={showFlags}
                  onChange={toggleFlags}
                  className="w-4 h-4 rounded"
                />
                <span className="text-slate-600">Show Flags</span>
              </label>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Test Information */}
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FlaskConical className="w-6 h-6 text-purple-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-slate-800">{result.test_name}</h2>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                      {result.test_group || 'General'}
                    </span>
                    {result.gender_category && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs">
                        Reference: {result.gender_category}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Results Table */}
            <div className="p-6">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">Test</th>
                    <th className="text-right py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">Result</th>
                    <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">Unit</th>
                    {showRanges && (
                      <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">Reference Range</th>
                    )}
                    {showFlags && (
                      <th className="text-center py-3 px-4 text-xs uppercase tracking-wider text-slate-600 font-semibold border-b border-slate-200">Flag</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  <tr className={`${status === 'high' ? 'bg-orange-50' : status === 'low' ? 'bg-blue-50' : ''}`}>
                    <td className="py-4 px-4 text-sm font-medium text-slate-800 border-b border-slate-100">
                      {result.test_name}
                    </td>
                    <td className={`py-4 px-4 text-right text-xl font-bold border-b border-slate-100 ${
                      status === 'high' ? 'text-orange-600' :
                      status === 'low' ? 'text-blue-600' :
                      'text-green-600'
                    }`}>
                      {result.current_value !== null && result.current_value !== undefined
                        ? Number(result.current_value).toFixed(2)
                        : 'N/A'}
                    </td>
                    <td className="py-4 px-4 text-sm text-slate-500 border-b border-slate-100">
                      {result.unit || '-'}
                    </td>
                    {showRanges && (
                      <td className="py-4 px-4 text-sm text-slate-500 font-mono border-b border-slate-100">
                        {result.min_value !== null && result.max_value !== null
                          ? `${result.min_value} - ${result.max_value}`
                          : 'Not available'}
                      </td>
                    )}
                    {showFlags && (
                      <td className="py-4 px-4 text-center border-b border-slate-100">
                        {status !== 'normal' ? (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                            status === 'high' ? 'bg-orange-100 text-orange-700' :
                            status === 'low' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            <span className="text-base">{flag.symbol}</span>
                            {flag.text}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            ✓ Normal
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>

              {/* Interpretation */}
              {status !== 'normal' && (
                <div className={`mt-6 p-4 rounded-lg border ${
                  status === 'high' ? 'bg-orange-50 border-orange-200' :
                  status === 'low' ? 'bg-blue-50 border-blue-200' :
                  'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-5 h-5 mt-0.5 ${
                      status === 'high' ? 'text-orange-500' :
                      status === 'low' ? 'text-blue-500' :
                      'text-slate-500'
                    }`} />
                    <div>
                      <div className={`text-sm font-semibold mb-1 ${
                        status === 'high' ? 'text-orange-800' :
                        status === 'low' ? 'text-blue-800' :
                        'text-slate-800'
                      }`}>
                        {status === 'low' ? 'Below Normal Range' : status === 'high' ? 'Above Normal Range' : 'Value Status Unknown'}
                      </div>
                      <div className="text-sm text-slate-600">
                        This value is outside the normal reference range. Clinical correlation is recommended.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="mt-8 pt-4 border-t border-slate-200">
                <div className="text-xs text-slate-500 space-y-1">
                  <div className="font-semibold text-slate-600 mb-2">Legend</div>
                  <div className="flex gap-6 flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="text-orange-500">↑</span> HIGH - Above reference range
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-blue-500">↓</span> LOW - Below reference range
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-green-500">✓</span> Normal - Within reference range
                    </span>
                  </div>
                </div>
              </div>

              {/* Signature Block */}
              <div className="pt-6 border-t border-slate-200 mt-8">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-slate-800 font-semibold">Electronically Verified</div>
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
                    <div className="font-serif italic text-xl text-slate-700">Clinical Laboratory</div>
                    <div className="text-slate-500 text-sm">CAP Accredited</div>
                    <div className="text-slate-400 text-xs">Quality Assured Results</div>
                  </div>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="mt-6 pt-4 border-t border-slate-200 text-xs text-slate-400">
                <strong>Note:</strong> This report is for educational/simulation purposes only and does not constitute actual medical laboratory data.
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="bg-slate-100 border-t border-slate-200 p-4 flex items-center justify-between print:hidden">
            <div className="text-xs text-slate-500">
              Results verified and released
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors"
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

      {/* Print Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #lab-results-modal,
          #lab-results-modal * {
            visibility: visible !important;
          }
          #lab-results-modal {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: auto !important;
            background: white !important;
            padding: 0 !important;
          }
          #lab-results-modal > div {
            max-height: none !important;
            overflow: visible !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
};

export default LabResultsModal;
