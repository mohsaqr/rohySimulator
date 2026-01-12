import React, { useState, useEffect } from 'react';
import { Edit3, Save, RefreshCw, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { AuthService } from '../../services/authService';
import { useToast } from '../../contexts/ToastContext';
import { apiUrl } from '../../config/api';

const LabValueEditor = ({ sessionId, caseId, onUpdate }) => {
  const toast = useToast();
  const [availableLabs, setAvailableLabs] = useState([]);
  const [expandedLabs, setExpandedLabs] = useState(new Set());
  const [editingValues, setEditingValues] = useState({});
  const [saving, setSaving] = useState({});
  const [loading, setLoading] = useState(false);

  // Fetch available labs for this session
  useEffect(() => {
    if (!sessionId) return;
    fetchLabs();
  }, [sessionId]);

  const fetchLabs = async () => {
    setLoading(true);
    try {
      const token = AuthService.getToken();
      const response = await fetch(apiUrl(`/api/sessions/${sessionId}/available-labs`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setAvailableLabs(data.labs || []);
        
        // Initialize editing values
        const initialValues = {};
        data.labs.forEach(lab => {
          initialValues[lab.id] = lab.current_value;
        });
        setEditingValues(initialValues);
      }
    } catch (error) {
      console.error('Failed to fetch labs:', error);
    } finally {
      setLoading(false);
    }
  };

  // Toggle lab expansion
  const toggleLab = (labId) => {
    setExpandedLabs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(labId)) {
        newSet.delete(labId);
      } else {
        newSet.add(labId);
      }
      return newSet;
    });
  };

  // Update editing value
  const updateValue = (labId, value) => {
    setEditingValues(prev => ({
      ...prev,
      [labId]: value
    }));
  };

  // Save updated value
  const saveValue = async (lab) => {
    const newValue = editingValues[lab.id];
    if (newValue === lab.current_value) {
      return; // No change
    }

    setSaving(prev => ({ ...prev, [lab.id]: true }));
    try {
      const token = AuthService.getToken();
      const response = await fetch(apiUrl(`/api/sessions/${sessionId}/labs/${lab.id}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          current_value: parseFloat(newValue)
        })
      });

      if (response.ok) {
        // Update local state
        setAvailableLabs(prev => prev.map(l =>
          l.id === lab.id
            ? { ...l, current_value: parseFloat(newValue), is_abnormal: true }
            : l
        ));

        if (onUpdate) {
          onUpdate(lab.id, parseFloat(newValue));
        }
      } else {
        toast.error('Failed to update lab value');
      }
    } catch (error) {
      console.error('Failed to save lab value:', error);
      toast.error('Failed to update lab value');
    } finally {
      setSaving(prev => ({ ...prev, [lab.id]: false }));
    }
  };

  // Reset to default value
  const resetToNormal = (lab) => {
    // Get a random normal sample value
    const normalValue = lab.normal_samples && lab.normal_samples.length > 0
      ? lab.normal_samples[Math.floor(Math.random() * lab.normal_samples.length)]
      : (lab.min_value + lab.max_value) / 2;
    
    updateValue(lab.id, normalValue);
  };

  // Evaluate if value is abnormal
  const evaluateValue = (value, minValue, maxValue) => {
    if (value === null || value === undefined) return 'unknown';
    if (value < minValue) return 'low';
    if (value > maxValue) return 'high';
    return 'normal';
  };

  // Get color for status
  const getStatusColor = (status) => {
    const colors = {
      'low': 'text-blue-400',
      'high': 'text-yellow-400',
      'normal': 'text-green-400',
      'unknown': 'text-neutral-400'
    };
    return colors[status] || colors['unknown'];
  };

  // Group labs by test group
  const groupedLabs = availableLabs.reduce((acc, lab) => {
    if (!acc[lab.test_group]) {
      acc[lab.test_group] = [];
    }
    acc[lab.test_group].push(lab);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
      </div>
    );
  }

  if (availableLabs.length === 0) {
    return (
      <div className="text-center py-8 text-neutral-500">
        <Edit3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No lab tests configured for this case</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-purple-500" />
            Edit Lab Values (Instructor)
          </h3>
          <p className="text-xs text-neutral-400 mt-1">
            Modify lab values during simulation. Changes apply immediately if tests are already ordered.
          </p>
        </div>
        <button
          onClick={fetchLabs}
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-sm flex items-center gap-2 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Warning */}
      <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-neutral-300">
          <strong className="text-yellow-400">Instructor Mode:</strong> Changes will update existing ordered results immediately. 
          Use this to simulate disease progression or treatment response.
        </div>
      </div>

      {/* Labs by Group */}
      <div className="space-y-2">
        {Object.entries(groupedLabs).map(([group, labs]) => (
          <div key={group} className="border border-neutral-700 rounded-lg overflow-hidden">
            <div className="bg-neutral-800 px-4 py-3 border-b border-neutral-700">
              <div className="flex items-center justify-between">
                <div className="font-bold text-white">{group}</div>
                <div className="text-xs text-neutral-500">{labs.length} test{labs.length > 1 ? 's' : ''}</div>
              </div>
            </div>
            <div className="bg-neutral-900/50 p-2 space-y-2">
              {labs.map(lab => {
                const isExpanded = expandedLabs.has(lab.id);
                const editValue = editingValues[lab.id];
                const status = evaluateValue(editValue, lab.min_value, lab.max_value);
                const hasChanged = editValue != lab.current_value;
                const isSaving = saving[lab.id];

                return (
                  <div key={lab.id} className="bg-neutral-850 border border-neutral-700 rounded">
                    <button
                      onClick={() => toggleLab(lab.id)}
                      className="w-full px-3 py-2 flex items-center justify-between hover:bg-neutral-800 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 text-left">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-white">{lab.test_name}</div>
                          <div className="text-xs text-neutral-400 mt-0.5">
                            Current: <span className={getStatusColor(status)}>{lab.current_value} {lab.unit}</span>
                            {lab.is_abnormal && <span className="text-yellow-500 ml-2">⚠️ Modified</span>}
                          </div>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-neutral-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-neutral-400" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-2 border-t border-neutral-700">
                        <div className="space-y-3">
                          {/* Value Editor */}
                          <div>
                            <label className="text-xs text-neutral-400 block mb-1">
                              New Value (Normal Range: {lab.min_value} - {lab.max_value} {lab.unit})
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                step="0.01"
                                value={editValue}
                                onChange={(e) => updateValue(lab.id, e.target.value)}
                                className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:border-purple-500 focus:outline-none"
                              />
                              <span className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-neutral-400 text-sm">
                                {lab.unit}
                              </span>
                            </div>
                          </div>

                          {/* Status Indicator */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-neutral-500">Status:</span>
                            <span className={`text-xs font-bold ${getStatusColor(status)}`}>
                              {status === 'low' && '↓ BELOW NORMAL'}
                              {status === 'high' && '↑ ABOVE NORMAL'}
                              {status === 'normal' && '✓ NORMAL'}
                              {status === 'unknown' && '? UNKNOWN'}
                            </span>
                          </div>

                          {/* Actions */}
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveValue(lab)}
                              disabled={!hasChanged || isSaving}
                              className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white rounded text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                            >
                              {isSaving ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <Save className="w-4 h-4" />
                                  {hasChanged ? 'Save Changes' : 'No Changes'}
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => resetToNormal(lab)}
                              className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded text-sm font-bold transition-colors"
                              title="Reset to normal value"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LabValueEditor;
