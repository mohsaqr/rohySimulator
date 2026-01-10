import React, { useState, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, FileText, AlertTriangle, TrendingUp, TrendingDown, Minus, Printer } from 'lucide-react';
import { AuthService } from '../../services/authService';

const LabResultsModal = ({ result, sessionId, patientInfo, onClose }) => {
  const [showRanges, setShowRanges] = useState(() => {
    // Get setting from localStorage (default: true)
    const saved = localStorage.getItem('rohy_show_lab_ranges');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [showFlags, setShowFlags] = useState(() => {
    const saved = localStorage.getItem('rohy_show_lab_flags');
    return saved !== null ? JSON.parse(saved) : true;
  });

  // Mark as viewed when opened
  useEffect(() => {
    if (result && !result.viewed_at) {
      markAsViewed();
    }
  }, [result]);

  const markAsViewed = async () => {
    try {
      const token = AuthService.getToken();
      await fetch(`http://localhost:3000/api/orders/${result.order_id}/view`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (error) {
      console.error('Failed to mark as viewed:', error);
    }
  };

  // Evaluate value status
  const evaluateValue = (value, minValue, maxValue) => {
    if (value === null || value === undefined) return 'unknown';
    if (value < minValue) return 'low';
    if (value > maxValue) return 'high';
    return 'normal';
  };

  // Get flag display
  const getFlag = (status) => {
    const flags = {
      'low': { icon: TrendingDown, symbol: '↓', text: 'LOW', color: 'blue' },
      'high': { icon: TrendingUp, symbol: '↑', text: 'HIGH', color: 'yellow' },
      'normal': { icon: Minus, symbol: '', text: '', color: 'green' },
      'unknown': { icon: AlertTriangle, symbol: '?', text: 'UNKNOWN', color: 'gray' }
    };
    return flags[status] || flags['unknown'];
  };

  // Get color classes based on status
  const getColorClasses = (status) => {
    const colors = {
      'low': {
        bg: 'bg-blue-900/20',
        border: 'border-blue-700/50',
        text: 'text-blue-400',
        badge: 'bg-blue-600'
      },
      'high': {
        bg: 'bg-yellow-900/20',
        border: 'border-yellow-700/50',
        text: 'text-yellow-400',
        badge: 'bg-yellow-600'
      },
      'normal': {
        bg: '',
        border: 'border-neutral-700',
        text: 'text-green-400',
        badge: 'bg-green-600'
      },
      'unknown': {
        bg: 'bg-neutral-800/50',
        border: 'border-neutral-700',
        text: 'text-neutral-400',
        badge: 'bg-neutral-600'
      }
    };
    return colors[status] || colors['unknown'];
  };

  // Save settings
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

  if (!result) return null;

  const status = evaluateValue(result.current_value, result.min_value, result.max_value);
  const flag = getFlag(status);
  const colors = getColorClasses(status);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 print:bg-white print:relative print:inset-auto">
      <div className="bg-neutral-900 rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl print:bg-white print:shadow-none print:max-w-full print:max-h-none">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-neutral-800 print:border-black">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-6 h-6 text-purple-500 print:text-black" />
              <h2 className="text-2xl font-bold text-white print:text-black">Laboratory Results</h2>
            </div>
            {patientInfo && (
              <div className="text-sm text-neutral-400 print:text-black">
                Patient: {patientInfo.name || 'Unknown'} • {patientInfo.age}yo {patientInfo.gender}
              </div>
            )}
            <div className="text-xs text-neutral-500 mt-1 print:text-black">
              Ordered: {new Date(result.ordered_at).toLocaleString()} • 
              Resulted: {new Date(result.available_at).toLocaleString()}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-800 rounded-full transition-colors print:hidden"
          >
            <X className="w-6 h-6 text-neutral-400" />
          </button>
        </div>

        {/* Settings Bar */}
        <div className="px-6 py-3 border-b border-neutral-800 flex items-center justify-between bg-neutral-850 print:hidden">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={showRanges}
                onChange={toggleRanges}
                className="w-4 h-4"
              />
              <span className="text-neutral-300">Show Normal Ranges</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={showFlags}
                onChange={toggleFlags}
                className="w-4 h-4"
              />
              <span className="text-neutral-300">Show Flags</span>
            </label>
          </div>
          <button
            onClick={handlePrint}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-sm flex items-center gap-2 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Test Information */}
          <div className={`p-5 rounded-lg border ${colors.border} ${colors.bg} mb-6`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-xl font-bold text-white mb-2 print:text-black">{result.test_name}</h3>
                <div className="text-sm text-neutral-400 print:text-black">
                  Group: {result.test_group}
                  {result.gender_category && ` • Reference: ${result.gender_category}`}
                </div>
              </div>
              {showFlags && status !== 'normal' && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded ${colors.badge} text-white font-bold`}>
                  {flag.icon && <flag.icon className="w-5 h-5" />}
                  <span>{flag.text}</span>
                </div>
              )}
            </div>
          </div>

          {/* Result Table */}
          <div className="bg-neutral-800 rounded-lg overflow-hidden border border-neutral-700 print:bg-white print:border-black">
            <table className="w-full">
              <thead>
                <tr className="bg-neutral-750 border-b border-neutral-700 print:bg-gray-200 print:border-black">
                  <th className="text-left py-3 px-4 text-sm font-bold text-neutral-300 print:text-black">Parameter</th>
                  <th className="text-right py-3 px-4 text-sm font-bold text-neutral-300 print:text-black">Value</th>
                  <th className="text-left py-3 px-4 text-sm font-bold text-neutral-300 print:text-black">Unit</th>
                  {showRanges && (
                    <th className="text-left py-3 px-4 text-sm font-bold text-neutral-300 print:text-black">Normal Range</th>
                  )}
                  {showFlags && (
                    <th className="text-center py-3 px-4 text-sm font-bold text-neutral-300 print:text-black">Flag</th>
                  )}
                </tr>
              </thead>
              <tbody>
                <tr className={`border-b border-neutral-700 print:border-black ${status !== 'normal' ? colors.bg : ''}`}>
                  <td className="py-4 px-4 text-sm font-medium text-white print:text-black">
                    {result.test_name}
                  </td>
                  <td className={`py-4 px-4 text-right text-lg font-bold ${colors.text} print:text-black`}>
                    {result.current_value !== null && result.current_value !== undefined 
                      ? result.current_value.toFixed(2)
                      : 'N/A'}
                  </td>
                  <td className="py-4 px-4 text-sm text-neutral-400 print:text-black">
                    {result.unit || '-'}
                  </td>
                  {showRanges && (
                    <td className="py-4 px-4 text-sm text-neutral-400 font-mono print:text-black">
                      {result.min_value !== null && result.max_value !== null
                        ? `${result.min_value} - ${result.max_value}`
                        : 'Not available'}
                    </td>
                  )}
                  {showFlags && (
                    <td className="py-4 px-4 text-center">
                      {status !== 'normal' && (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${colors.badge} text-white print:border print:border-black print:bg-transparent print:text-black`}>
                          <span className="text-lg">{flag.symbol}</span>
                          <span>{flag.text}</span>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Interpretation / Warnings */}
          {status !== 'normal' && (
            <div className={`mt-6 p-4 rounded-lg border ${colors.border} ${colors.bg}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 ${colors.text} mt-0.5 print:text-black`} />
                <div>
                  <div className={`text-sm font-bold ${colors.text} mb-1 print:text-black`}>
                    {status === 'low' ? 'Below Normal Range' : status === 'high' ? 'Above Normal Range' : 'Value Status Unknown'}
                  </div>
                  <div className="text-sm text-neutral-300 print:text-black">
                    This value is outside the normal range. Clinical correlation is recommended.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Notes */}
          <div className="mt-6 pt-4 border-t border-neutral-800 text-xs text-neutral-500 space-y-1 print:border-black print:text-black">
            <div className="flex items-start gap-2">
              <span className="font-bold min-w-[60px]">Legend:</span>
              <div className="space-y-1">
                <div>↑ HIGH = Above normal range</div>
                <div>↓ LOW = Below normal range</div>
                <div>⚠️ = Abnormal value requiring attention</div>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-neutral-800 print:border-black">
              <strong>Note:</strong> These results are for educational/simulation purposes only and do not constitute actual medical data.
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-neutral-800 flex justify-end gap-2 print:hidden">
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded font-bold flex items-center gap-2 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print Results
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded font-bold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default LabResultsModal;
