import React, { useState, useCallback, useMemo } from 'react';
import { X, RotateCcw, User, UserCheck, Brain, Download, Users } from 'lucide-react';
import BodyMap from './BodyMap';
import ExamTypeSelector from './ExamTypeSelector';
import FindingDisplay from './FindingDisplay';
import ExamLog from './ExamLog';
import { BODY_REGIONS, getDefaultFinding, SAMPLE_ABNORMAL_EXAM } from '../../data/examRegions';
import { useToast } from '../../contexts/ToastContext';

/**
 * Manikin Panel - Main Physical Examination Interface
 *
 * Props:
 * - isOpen: boolean to control visibility
 * - onClose: function to close the panel
 * - physicalExam: object containing configured findings for each region/exam type
 *                 Format: { regionId: { examType: { finding, abnormal } } }
 * - onExamPerformed: callback when an exam is performed (for logging/analytics)
 * - patientGender: 'male' or 'female' (optional, defaults to 'male')
 */
export default function ManikinPanel({
    isOpen,
    onClose,
    physicalExam = null, // If null, uses default findings
    onExamPerformed,
    patientGender = 'male'
}) {
    const toast = useToast();
    // State
    const [view, setView] = useState('anterior'); // anterior | posterior
    const [gender, setGender] = useState(patientGender); // male | female
    const [selectedRegion, setSelectedRegion] = useState(null);

    // Sync gender with patientGender prop
    React.useEffect(() => {
        if (patientGender) {
            setGender(patientGender.toLowerCase() === 'female' ? 'female' : 'male');
        }
    }, [patientGender]);
    const [selectedExamType, setSelectedExamType] = useState(null);
    const [examLog, setExamLog] = useState([]);
    const [currentFinding, setCurrentFinding] = useState(null);

    // Use sample abnormal exam if no physicalExam provided (for demo)
    const examData = physicalExam || SAMPLE_ABNORMAL_EXAM;

    // Compute examined regions and abnormal regions from log
    const { examinedRegions, abnormalRegions } = useMemo(() => {
        const examined = new Set();
        const abnormal = new Set();

        examLog.forEach(entry => {
            examined.add(entry.regionId);
            if (entry.abnormal) {
                abnormal.add(entry.regionId);
            }
        });

        return { examinedRegions: examined, abnormalRegions: abnormal };
    }, [examLog]);

    // Compute performed exams set for ExamTypeSelector
    const performedExams = useMemo(() => {
        const performed = new Set();
        examLog.forEach(entry => {
            performed.add(`${entry.regionId}:${entry.examType}`);
        });
        return performed;
    }, [examLog]);

    // Handle region selection
    const handleRegionClick = useCallback((regionId) => {
        setSelectedRegion(regionId);
        setSelectedExamType(null);
        setCurrentFinding(null);
    }, []);

    // Handle exam type selection - this performs the exam
    const handleExamTypeSelect = useCallback((examType) => {
        if (!selectedRegion) return;

        setSelectedExamType(examType);

        // Get the finding for this region and exam type
        let finding = '';
        let abnormal = false;
        let audioUrl = null;
        let audioUrls = {};
        let heartAudio = null;
        let lungAudio = null;

        // Check if we have configured data for this exam
        if (examData[selectedRegion] && examData[selectedRegion][examType]) {
            finding = examData[selectedRegion][examType].finding;
            abnormal = examData[selectedRegion][examType].abnormal || false;
            audioUrl = examData[selectedRegion][examType].audioUrl || null;
            audioUrls = examData[selectedRegion][examType].audioUrls || {};
            heartAudio = examData[selectedRegion][examType].heartAudio || null;
            lungAudio = examData[selectedRegion][examType].lungAudio || null;
        } else {
            // Use default finding
            finding = getDefaultFinding(selectedRegion, examType);
            abnormal = false;
        }

        setCurrentFinding({ finding, abnormal, audioUrl, audioUrls, heartAudio, lungAudio });

        // Add to exam log
        const logEntry = {
            regionId: selectedRegion,
            examType: examType,
            finding: finding,
            abnormal: abnormal,
            timestamp: new Date().toISOString()
        };

        setExamLog(prev => {
            // Check if already performed (avoid duplicates)
            const exists = prev.some(e =>
                e.regionId === selectedRegion && e.examType === examType
            );
            if (exists) {
                // Update existing entry
                return prev.map(e =>
                    e.regionId === selectedRegion && e.examType === examType
                        ? logEntry
                        : e
                );
            }
            return [...prev, logEntry];
        });

        // Callback for external logging
        if (onExamPerformed) {
            onExamPerformed(logEntry);
        }
    }, [selectedRegion, examData, onExamPerformed]);

    // Handle clicking on a log entry
    const handleSelectExam = useCallback((entry) => {
        setSelectedRegion(entry.regionId);
        setSelectedExamType(entry.examType);
        setCurrentFinding({
            finding: entry.finding,
            abnormal: entry.abnormal
        });
    }, []);

    // Clear log
    const handleClearLog = useCallback(async () => {
        const confirmed = await toast.confirm('Clear all examination records?', { title: 'Clear Records', type: 'warning' });
        if (confirmed) {
            setExamLog([]);
            setSelectedRegion(null);
            setSelectedExamType(null);
            setCurrentFinding(null);
        }
    }, [toast]);

    // Export findings
    const handleExportFindings = useCallback(() => {
        if (examLog.length === 0) return;

        let report = 'PHYSICAL EXAMINATION FINDINGS\n';
        report += '==============================\n\n';
        report += `Date: ${new Date().toLocaleString()}\n\n`;

        // Group by region
        const byRegion = {};
        examLog.forEach(entry => {
            if (!byRegion[entry.regionId]) {
                byRegion[entry.regionId] = [];
            }
            byRegion[entry.regionId].push(entry);
        });

        Object.entries(byRegion).forEach(([regionId, entries]) => {
            const region = BODY_REGIONS[regionId];
            report += `${region?.name || regionId}:\n`;
            entries.forEach(e => {
                const status = e.abnormal ? '[ABNORMAL]' : '[Normal]';
                report += `  - ${e.examType}: ${e.finding} ${status}\n`;
            });
            report += '\n';
        });

        // Count summary
        const normalCount = examLog.filter(e => !e.abnormal).length;
        const abnormalCount = examLog.filter(e => e.abnormal).length;
        report += `\nSUMMARY: ${examLog.length} examinations performed\n`;
        report += `Normal findings: ${normalCount}\n`;
        report += `Abnormal findings: ${abnormalCount}\n`;

        // Download
        const blob = new Blob([report], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `physical_exam_${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }, [examLog]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-slate-900 rounded-xl shadow-2xl border border-slate-700 w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <User className="w-6 h-6 text-cyan-400" />
                        <h2 className="text-xl font-bold text-white">Physical Examination</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {examLog.length > 0 && (
                            <button
                                onClick={handleExportFindings}
                                className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 rounded flex items-center gap-2"
                            >
                                <Download className="w-4 h-4" />
                                Export
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 overflow-hidden flex min-h-0">
                    {/* Left Panel - Body Map */}
                    <div className="w-1/3 border-r border-slate-700 p-4 flex flex-col min-h-0">
                        {/* View Toggle */}
                        <div className="flex gap-2 mb-3">
                            <button
                                onClick={() => setView('anterior')}
                                className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                                    view === 'anterior'
                                        ? 'bg-cyan-600 text-white'
                                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                }`}
                            >
                                Anterior
                            </button>
                            <button
                                onClick={() => setView('posterior')}
                                className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
                                    view === 'posterior'
                                        ? 'bg-cyan-600 text-white'
                                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                }`}
                            >
                                Posterior
                            </button>
                        </div>

                        {/* Gender Display - locked when patient gender is set */}
                        <div className="flex gap-2 mb-4">
                            {patientGender ? (
                                // Show locked gender indicator when case is loaded
                                <div className={`flex-1 py-1.5 px-2 rounded text-xs font-medium flex items-center justify-center gap-1 ${
                                    gender === 'male' ? 'bg-blue-600 text-white' : 'bg-pink-600 text-white'
                                }`}>
                                    {gender === 'male' ? <User className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                                    {gender === 'male' ? 'Male' : 'Female'} Patient
                                </div>
                            ) : (
                                // Show toggle buttons when no case is loaded
                                <>
                                    <button
                                        onClick={() => setGender('male')}
                                        className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                                            gender === 'male'
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                        }`}
                                    >
                                        <User className="w-3 h-3" />
                                        Male
                                    </button>
                                    <button
                                        onClick={() => setGender('female')}
                                        className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                                            gender === 'female'
                                                ? 'bg-pink-600 text-white'
                                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                        }`}
                                    >
                                        <Users className="w-3 h-3" />
                                        Female
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Body Map */}
                        <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
                            <BodyMap
                                view={view}
                                gender={gender}
                                selectedRegion={selectedRegion}
                                onRegionClick={handleRegionClick}
                                examinedRegions={examinedRegions}
                                abnormalRegions={abnormalRegions}
                            />
                        </div>

                        {/* Quick access buttons */}
                        <div className="mt-4 flex gap-2">
                            <button
                                onClick={() => handleRegionClick('general')}
                                className={`flex-1 py-2 px-3 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                                    selectedRegion === 'general'
                                        ? 'bg-cyan-600 text-white'
                                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                }`}
                            >
                                <UserCheck className="w-3 h-3" />
                                General
                            </button>
                            <button
                                onClick={() => handleRegionClick('neurological')}
                                className={`flex-1 py-2 px-3 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                                    selectedRegion === 'neurological'
                                        ? 'bg-cyan-600 text-white'
                                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                }`}
                            >
                                <Brain className="w-3 h-3" />
                                Neuro
                            </button>
                        </div>
                    </div>

                    {/* Right Panel - Controls and Results */}
                    <div className="flex-1 flex flex-col p-4 overflow-y-auto">
                        {/* Selected Region */}
                        {selectedRegion && (
                            <div className="mb-4 pb-3 border-b border-slate-700">
                                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                                    <span className="w-2 h-2 bg-cyan-400 rounded-full"></span>
                                    {BODY_REGIONS[selectedRegion]?.name || selectedRegion}
                                </h3>
                            </div>
                        )}

                        {/* Exam Type Selector */}
                        <div className="mb-4">
                            <ExamTypeSelector
                                selectedRegion={selectedRegion}
                                selectedExamType={selectedExamType}
                                onExamTypeSelect={handleExamTypeSelect}
                                performedExams={performedExams}
                            />
                        </div>

                        {/* Finding Display */}
                        <div className="mb-4">
                            <FindingDisplay
                                selectedRegion={selectedRegion}
                                selectedExamType={selectedExamType}
                                finding={currentFinding?.finding}
                                isAbnormal={currentFinding?.abnormal}
                                audioUrl={currentFinding?.audioUrl}
                                audioUrls={currentFinding?.audioUrls || {}}
                                heartAudio={currentFinding?.heartAudio}
                                lungAudio={currentFinding?.lungAudio}
                            />
                        </div>

                        {/* Exam Log */}
                        <div className="mt-auto">
                            <ExamLog
                                examLog={examLog}
                                onClearLog={handleClearLog}
                                onSelectExam={handleSelectExam}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
