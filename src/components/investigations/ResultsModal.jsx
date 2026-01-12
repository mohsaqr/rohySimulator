import React, { useState, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, Download, FileText } from 'lucide-react';
import { apiUrl } from '../../config/api';

const ResultsModal = ({ order, onClose }) => {
  const [zoom, setZoom] = useState(1);

  // Mark as viewed when opened
  useEffect(() => {
    if (order && !order.viewed_at) {
      markAsViewed();
    }
  }, [order]);

  const markAsViewed = async () => {
    try {
      const token = localStorage.getItem('token');
      await fetch(apiUrl(`/api/orders/${order.id}/view`), {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (error) {
      console.error('Failed to mark as viewed:', error);
    }
  };

  if (!order) return null;

  const isLab = order.investigation_type === 'lab';
  const isRadiology = order.investigation_type === 'radiology';

  // Parse result data
  const resultData = order.result_data || {};

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-white">{order.test_name}</h2>
            <p className="text-sm text-gray-400">
              Ordered: {new Date(order.ordered_at).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-full transition-colors"
          >
            <X className="w-6 h-6 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Lab Results */}
          {isLab && (
            <div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-2 px-3 text-sm font-semibold text-gray-300">Test</th>
                    <th className="text-left py-2 px-3 text-sm font-semibold text-gray-300">Result</th>
                    <th className="text-left py-2 px-3 text-sm font-semibold text-gray-300">Unit</th>
                    <th className="text-left py-2 px-3 text-sm font-semibold text-gray-300">Normal Range</th>
                    <th className="text-center py-2 px-3 text-sm font-semibold text-gray-300">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(resultData).map(([key, data], index) => {
                    const flag = data.flag || '';
                    const isCritical = flag.includes('CRITICAL');
                    const isHigh = flag.includes('HIGH');
                    const isLow = flag.includes('LOW');

                    return (
                      <tr
                        key={index}
                        className={`border-b border-gray-700/50 ${
                          isCritical
                            ? 'bg-red-900/20'
                            : isHigh || isLow
                            ? 'bg-yellow-900/20'
                            : ''
                        }`}
                      >
                        <td className="py-3 px-3 text-sm text-white">{key}</td>
                        <td className={`py-3 px-3 text-sm font-semibold ${
                          isCritical ? 'text-red-400' : isHigh || isLow ? 'text-yellow-400' : 'text-white'
                        }`}>
                          {data.value !== null && data.value !== undefined ? data.value : '-'}
                        </td>
                        <td className="py-3 px-3 text-sm text-gray-400">{data.unit || '-'}</td>
                        <td className="py-3 px-3 text-sm text-gray-400">{data.normalRange || '-'}</td>
                        <td className="py-3 px-3 text-center">
                          {flag && (
                            <span className={`text-xs px-2 py-1 rounded ${
                              isCritical
                                ? 'bg-red-600 text-white'
                                : isHigh
                                ? 'bg-yellow-600 text-white'
                                : isLow
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-600 text-white'
                            }`}>
                              {flag}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Interpretation */}
              {resultData.interpretation && (
                <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700/50 rounded">
                  <div className="flex items-start gap-2">
                    <FileText className="w-5 h-5 text-blue-400 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-blue-300 mb-1">Interpretation</div>
                      <div className="text-sm text-gray-300">{resultData.interpretation}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Radiology Results */}
          {isRadiology && (
            <div>
              {/* Image Viewer */}
              {order.image_url && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-gray-300">Image</div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                        className="p-2 bg-gray-700 hover:bg-gray-600 rounded"
                        disabled={zoom <= 0.5}
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                        className="p-2 bg-gray-700 hover:bg-gray-600 rounded"
                        disabled={zoom >= 3}
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                      <span className="px-3 py-2 bg-gray-700 rounded text-sm">{Math.round(zoom * 100)}%</span>
                    </div>
                  </div>
                  <div className="bg-black rounded overflow-auto max-h-96">
                    <img
                      src={order.image_url}
                      alt={order.test_name}
                      style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                      className="transition-transform"
                    />
                  </div>
                </div>
              )}

              {/* Findings */}
              {resultData.findings && resultData.findings.length > 0 && (
                <div className="mb-6">
                  <div className="text-sm font-semibold text-gray-300 mb-2">Findings</div>
                  <ul className="list-disc list-inside space-y-1">
                    {resultData.findings.map((finding, index) => (
                      <li key={index} className="text-sm text-gray-300">{finding}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Interpretation */}
              {resultData.interpretation && (
                <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded">
                  <div className="flex items-start gap-2">
                    <FileText className="w-5 h-5 text-blue-400 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-blue-300 mb-1">Interpretation</div>
                      <div className="text-sm text-gray-300 whitespace-pre-wrap">
                        {resultData.interpretation}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* No data */}
              {!order.image_url && (!resultData.findings || resultData.findings.length === 0) && !resultData.interpretation && (
                <div className="text-center text-gray-500 py-8">
                  No results available
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultsModal;
