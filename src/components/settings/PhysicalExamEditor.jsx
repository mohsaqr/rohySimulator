import React, { useState, useEffect } from 'react';
import { User, Users, RotateCcw, CheckCircle, AlertCircle, Upload, Volume2, Trash2 } from 'lucide-react';
import BodyMap from '../examination/BodyMap';
import { BODY_REGIONS, EXAM_TECHNIQUES, getDefaultFinding } from '../../data/examRegions';
import { AuthService } from '../../services/authService';
import { useToast } from '../../contexts/ToastContext';

/**
 * Physical Examination Editor for Case Design
 * Allows case designers to configure physical exam findings for each body region
 * Special support for auscultation with audio upload
 */
export default function PhysicalExamEditor({ caseData, setCaseData, patientGender = 'male' }) {
    const toast = useToast();
    const [view, setView] = useState('anterior');
    const [selectedRegion, setSelectedRegion] = useState(null);
    const [gender, setGender] = useState(patientGender);
    const [uploading, setUploading] = useState(false);

    // Update gender when patient gender changes
    useEffect(() => {
        if (patientGender) {
            setGender(patientGender.toLowerCase() === 'female' ? 'female' : 'male');
        }
    }, [patientGender]);

    // Get physical exam data from case
    const physicalExam = caseData.config?.physical_exam || {};

    // Update physical exam in case data (supports audioUrl for auscultation)
    const updatePhysicalExam = (regionId, examType, finding, abnormal = false, audioUrl = null) => {
        setCaseData(prev => {
            const existingExam = prev.config?.physical_exam?.[regionId]?.[examType] || {};
            return {
                ...prev,
                config: {
                    ...prev.config,
                    physical_exam: {
                        ...prev.config?.physical_exam,
                        [regionId]: {
                            ...prev.config?.physical_exam?.[regionId],
                            [examType]: {
                                finding,
                                abnormal,
                                // Preserve existing audio fields
                                audioUrl: audioUrl !== null ? audioUrl : existingExam.audioUrl,
                                heartAudio: existingExam.heartAudio,
                                lungAudio: existingExam.lungAudio,
                                audioUrls: existingExam.audioUrls
                            }
                        }
                    }
                }
            };
        });
    };

    // Upload audio file for auscultation
    const handleAudioUpload = async (regionId, examType, file) => {
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('photo', file);

        try {
            const token = AuthService.getToken();
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });
            const data = await res.json();
            if (data.imageUrl) { // Server returns imageUrl for all uploads
                const existingExam = physicalExam[regionId]?.[examType] || {};
                updatePhysicalExam(
                    regionId,
                    examType,
                    existingExam.finding || '',
                    existingExam.abnormal || false,
                    data.imageUrl
                );
            }
        } catch (err) {
            console.error('Audio upload failed:', err);
            toast.error('Failed to upload audio file');
        } finally {
            setUploading(false);
        }
    };

    // Remove audio from auscultation
    const removeAudio = (regionId, examType) => {
        const existingExam = physicalExam[regionId]?.[examType] || {};
        setCaseData(prev => ({
            ...prev,
            config: {
                ...prev.config,
                physical_exam: {
                    ...prev.config?.physical_exam,
                    [regionId]: {
                        ...prev.config?.physical_exam?.[regionId],
                        [examType]: {
                            ...existingExam,
                            audioUrl: null
                        }
                    }
                }
            }
        }));
    };

    // Update specific auscultation audio (heartAudio or lungAudio)
    const updateAuscultationAudio = (regionId, examType, audioType, url) => {
        const existingExam = physicalExam[regionId]?.[examType] || {};
        setCaseData(prev => ({
            ...prev,
            config: {
                ...prev.config,
                physical_exam: {
                    ...prev.config?.physical_exam,
                    [regionId]: {
                        ...prev.config?.physical_exam?.[regionId],
                        [examType]: {
                            ...existingExam,
                            [audioType]: url
                        }
                    }
                }
            }
        }));
    };

    // Upload auscultation audio (heart or lung)
    const handleAuscultationAudioUpload = async (regionId, examType, audioType, file) => {
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('photo', file);

        try {
            const token = AuthService.getToken();
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });
            const data = await res.json();
            if (data.imageUrl) {
                updateAuscultationAudio(regionId, examType, audioType, data.imageUrl);
            }
        } catch (err) {
            console.error('Audio upload failed:', err);
            toast.error('Failed to upload audio file');
        } finally {
            setUploading(false);
        }
    };

    // Initialize all regions with default findings
    const initializeAllDefaults = () => {
        const newPhysicalExam = {};
        Object.entries(BODY_REGIONS).forEach(([regionId, region]) => {
            newPhysicalExam[regionId] = {};
            region.examTypes.forEach(examType => {
                newPhysicalExam[regionId][examType] = {
                    finding: region.defaultFindings?.[examType] || 'Normal examination',
                    abnormal: false
                };
            });
        });
        setCaseData(prev => ({
            ...prev,
            config: {
                ...prev.config,
                physical_exam: newPhysicalExam
            }
        }));
    };

    // Get regions that have been configured
    const getConfiguredRegions = () => {
        return new Set(Object.keys(physicalExam));
    };

    // Get regions with abnormal findings
    const getAbnormalRegions = () => {
        const abnormal = new Set();
        Object.entries(physicalExam).forEach(([regionId, exams]) => {
            Object.values(exams).forEach(exam => {
                if (exam.abnormal) abnormal.add(regionId);
            });
        });
        return abnormal;
    };

    const configuredRegions = getConfiguredRegions();
    const abnormalRegions = getAbnormalRegions();

    // Get current region data
    const currentRegion = selectedRegion ? BODY_REGIONS[selectedRegion] : null;
    const currentRegionExams = selectedRegion ? physicalExam[selectedRegion] || {} : {};

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="text-lg font-bold text-purple-400">6. Physical Examination</h4>
                    <p className="text-xs text-neutral-500">
                        Configure physical examination findings for each body region. Click a region to edit.
                    </p>
                </div>
                <button
                    onClick={initializeAllDefaults}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded flex items-center gap-1"
                >
                    <RotateCcw className="w-3 h-3" />
                    Fill All Defaults
                </button>
            </div>

            {/* Gender indicator */}
            <div className="flex items-center gap-2 text-sm">
                <span className="text-neutral-400">Patient Gender:</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${gender === 'female' ? 'bg-pink-900/50 text-pink-300' : 'bg-blue-900/50 text-blue-300'}`}>
                    {gender === 'female' ? 'Female' : 'Male'}
                </span>
                <span className="text-neutral-500 text-xs">(Set in Step 2 - Details)</span>
            </div>

            <div className="flex gap-6">
                {/* Left: Body Map */}
                <div className="w-1/3 flex flex-col">
                    {/* View Toggle */}
                    <div className="flex gap-2 mb-3">
                        <button
                            onClick={() => setView('anterior')}
                            className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                                view === 'anterior'
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                            }`}
                        >
                            Anterior
                        </button>
                        <button
                            onClick={() => setView('posterior')}
                            className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                                view === 'posterior'
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                            }`}
                        >
                            Posterior
                        </button>
                    </div>

                    {/* Body Map */}
                    <div className="flex-1 bg-neutral-900 rounded-lg border border-neutral-700 overflow-hidden" style={{ minHeight: '400px' }}>
                        <BodyMap
                            view={view}
                            gender={gender}
                            selectedRegion={selectedRegion}
                            onRegionClick={setSelectedRegion}
                            examinedRegions={configuredRegions}
                            abnormalRegions={abnormalRegions}
                        />
                    </div>

                    {/* Quick buttons for special regions */}
                    <div className="mt-3 flex gap-2">
                        <button
                            onClick={() => setSelectedRegion('general')}
                            className={`flex-1 py-2 px-3 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                                selectedRegion === 'general'
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                            }`}
                        >
                            <User className="w-3 h-3" />
                            General
                        </button>
                        <button
                            onClick={() => setSelectedRegion('neurological')}
                            className={`flex-1 py-2 px-3 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                                selectedRegion === 'neurological'
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                            }`}
                        >
                            Neuro
                        </button>
                    </div>
                </div>

                {/* Right: Region Editor */}
                <div className="flex-1 bg-neutral-900 rounded-lg border border-neutral-700 p-4 overflow-y-auto" style={{ maxHeight: '500px' }}>
                    {selectedRegion && currentRegion ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b border-neutral-700 pb-3">
                                <h5 className="text-lg font-bold text-white">{currentRegion.name}</h5>
                                <button
                                    onClick={() => {
                                        // Fill this region with defaults
                                        currentRegion.examTypes.forEach(examType => {
                                            updatePhysicalExam(
                                                selectedRegion,
                                                examType,
                                                currentRegion.defaultFindings?.[examType] || 'Normal examination',
                                                false
                                            );
                                        });
                                    }}
                                    className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-xs rounded"
                                >
                                    Fill Defaults
                                </button>
                            </div>

                            {/* Exam types for this region */}
                            {currentRegion.examTypes.map(examType => {
                                const technique = EXAM_TECHNIQUES[examType];
                                const examData = currentRegionExams[examType] || {};
                                const defaultFinding = currentRegion.defaultFindings?.[examType] || 'Normal examination';
                                const isAuscultation = examType === 'auscultation';

                                return (
                                    <div key={examType} className={`space-y-2 ${isAuscultation ? 'bg-neutral-800/50 p-3 rounded-lg border border-cyan-900/30' : ''}`}>
                                        <div className="flex items-center justify-between">
                                            <label className="text-sm font-medium text-neutral-300 flex items-center gap-2">
                                                {isAuscultation && <Volume2 className="w-4 h-4 text-cyan-400" />}
                                                {technique?.name || examType}
                                            </label>
                                            <label className="flex items-center gap-2 text-xs">
                                                <input
                                                    type="checkbox"
                                                    checked={examData.abnormal || false}
                                                    onChange={(e) => updatePhysicalExam(
                                                        selectedRegion,
                                                        examType,
                                                        examData.finding || defaultFinding,
                                                        e.target.checked
                                                    )}
                                                    className="w-3 h-3"
                                                />
                                                <span className={examData.abnormal ? 'text-red-400' : 'text-neutral-500'}>
                                                    Abnormal
                                                </span>
                                            </label>
                                        </div>
                                        <textarea
                                            value={examData.finding || ''}
                                            onChange={(e) => updatePhysicalExam(
                                                selectedRegion,
                                                examType,
                                                e.target.value,
                                                examData.abnormal || false
                                            )}
                                            placeholder={defaultFinding}
                                            rows={2}
                                            className={`w-full px-3 py-2 bg-neutral-800 border rounded text-sm text-white placeholder-neutral-600 ${
                                                examData.abnormal ? 'border-red-600/50' : 'border-neutral-700'
                                            }`}
                                        />
                                        {!examData.finding && (
                                            <button
                                                onClick={() => updatePhysicalExam(selectedRegion, examType, defaultFinding, false)}
                                                className="text-xs text-blue-400 hover:text-blue-300"
                                            >
                                                Use default: "{defaultFinding.substring(0, 50)}..."
                                            </button>
                                        )}

                                        {/* Audio upload for auscultation */}
                                        {isAuscultation && (
                                            <div className="mt-3 pt-3 border-t border-neutral-700 space-y-3">
                                                <div className="text-xs text-cyan-400 font-medium">Auscultation Audio Files</div>

                                                {/* Default sounds info */}
                                                {!examData.abnormal && (
                                                    <div className="bg-emerald-900/20 border border-emerald-700/30 rounded p-2 text-xs text-emerald-300">
                                                        Normal findings use default heart/lung sounds automatically
                                                    </div>
                                                )}

                                                {/* Heart Sound */}
                                                <div className="space-y-1">
                                                    <label className="text-xs text-red-400 flex items-center gap-1">
                                                        <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                                                        Heart Sound (all cardiac points)
                                                    </label>
                                                    {examData.heartAudio ? (
                                                        <div className="flex items-center gap-2 bg-neutral-900 p-2 rounded">
                                                            <audio controls src={examData.heartAudio} className="h-7 flex-1" />
                                                            <button
                                                                onClick={() => updateAuscultationAudio(selectedRegion, examType, 'heartAudio', null)}
                                                                className="p-1 text-red-400 hover:text-red-300"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <label className="flex items-center gap-2 px-2 py-1.5 bg-neutral-800 border border-dashed border-red-700/30 rounded cursor-pointer hover:bg-neutral-700 transition-colors">
                                                            <Upload className="w-3 h-3 text-red-400" />
                                                            <span className="text-xs text-neutral-400">
                                                                {uploading ? 'Uploading...' : 'Upload custom heart sound'}
                                                            </span>
                                                            <input
                                                                type="file"
                                                                accept="audio/*"
                                                                className="hidden"
                                                                onChange={(e) => handleAuscultationAudioUpload(selectedRegion, examType, 'heartAudio', e.target.files[0])}
                                                                disabled={uploading}
                                                            />
                                                        </label>
                                                    )}
                                                </div>

                                                {/* Lung Sound */}
                                                <div className="space-y-1">
                                                    <label className="text-xs text-cyan-400 flex items-center gap-1">
                                                        <span className="w-2 h-2 bg-cyan-500 rounded-full"></span>
                                                        Lung Sound (all lung fields)
                                                    </label>
                                                    {examData.lungAudio ? (
                                                        <div className="flex items-center gap-2 bg-neutral-900 p-2 rounded">
                                                            <audio controls src={examData.lungAudio} className="h-7 flex-1" />
                                                            <button
                                                                onClick={() => updateAuscultationAudio(selectedRegion, examType, 'lungAudio', null)}
                                                                className="p-1 text-red-400 hover:text-red-300"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <label className="flex items-center gap-2 px-2 py-1.5 bg-neutral-800 border border-dashed border-cyan-700/30 rounded cursor-pointer hover:bg-neutral-700 transition-colors">
                                                            <Upload className="w-3 h-3 text-cyan-400" />
                                                            <span className="text-xs text-neutral-400">
                                                                {uploading ? 'Uploading...' : 'Upload custom lung sound'}
                                                            </span>
                                                            <input
                                                                type="file"
                                                                accept="audio/*"
                                                                className="hidden"
                                                                onChange={(e) => handleAuscultationAudioUpload(selectedRegion, examType, 'lungAudio', e.target.files[0])}
                                                                disabled={uploading}
                                                            />
                                                        </label>
                                                    )}
                                                </div>

                                                <p className="text-[10px] text-neutral-500">
                                                    Custom audio overrides defaults. Heart sounds play at cardiac points, lung sounds at lung fields.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Special tests if available */}
                            {currentRegion.specialTests && currentRegion.specialTests.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-neutral-700">
                                    <p className="text-xs text-neutral-500 mb-2">Available special tests:</p>
                                    <div className="flex flex-wrap gap-1">
                                        {currentRegion.specialTests.map(test => (
                                            <span key={test} className="px-2 py-0.5 bg-neutral-800 text-neutral-400 text-xs rounded">
                                                {test}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-neutral-500">
                            <User className="w-12 h-12 mb-3 opacity-30" />
                            <p className="text-sm">Select a body region to configure findings</p>
                            <p className="text-xs mt-1">Click on the body map or use the buttons below</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Summary */}
            <div className="bg-neutral-800/50 rounded-lg p-4 border border-neutral-700">
                <h5 className="text-sm font-bold text-neutral-300 mb-2">Configuration Summary</h5>
                <div className="flex gap-6 text-xs">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-neutral-400">Configured regions:</span>
                        <span className="text-white font-bold">{configuredRegions.size}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500" />
                        <span className="text-neutral-400">Abnormal findings:</span>
                        <span className="text-white font-bold">{abnormalRegions.size}</span>
                    </div>
                </div>
                {configuredRegions.size === 0 && (
                    <p className="text-xs text-yellow-500 mt-2">
                        Click "Fill All Defaults" to initialize all regions with normal findings.
                    </p>
                )}
            </div>
        </div>
    );
}
