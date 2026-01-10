import React, { useState } from 'react';
import { FileText, Stethoscope, Pill, Image, Syringe, ClipboardList, ChevronDown, ChevronUp, X, ZoomIn } from 'lucide-react';

const RECORD_TABS = [
    { id: 'history', label: 'History', icon: FileText },
    { id: 'physical', label: 'Past Physical Exam', icon: Stethoscope },
    { id: 'medications', label: 'Medications', icon: Pill },
    { id: 'radiology', label: 'Radiology', icon: Image },
    { id: 'procedures', label: 'Procedures', icon: Syringe },
    { id: 'notes', label: 'Notes', icon: ClipboardList }
];

export default function ClinicalRecordsPanel({ caseConfig, initialTab = 'history' }) {
    const [activeTab, setActiveTab] = useState(initialTab);
    const [expandedSection, setExpandedSection] = useState(null);
    const [viewingImage, setViewingImage] = useState(null);

    const records = caseConfig?.clinicalRecords || {};
    const history = records.history || {};
    const physicalExam = records.physicalExam || {};
    const medications = records.medications || [];
    const radiology = records.radiology || [];
    const procedures = records.procedures || [];
    const notes = records.notes || [];

    // Check if tab has content
    const hasContent = (tabId) => {
        switch (tabId) {
            case 'history':
                return Object.values(history).some(v => v && v.trim());
            case 'physical':
                return Object.values(physicalExam).some(v => v && v.trim());
            case 'medications':
                return medications.length > 0;
            case 'radiology':
                return radiology.length > 0;
            case 'procedures':
                return procedures.length > 0;
            case 'notes':
                return notes.length > 0;
            default:
                return false;
        }
    };

    const toggleSection = (section) => {
        setExpandedSection(expandedSection === section ? null : section);
    };

    // Section component for collapsible fields
    const Section = ({ title, content, sectionKey }) => {
        if (!content || !content.trim()) return null;
        const isExpanded = expandedSection === sectionKey;

        return (
            <div className="border border-neutral-700 rounded-lg overflow-hidden">
                <button
                    onClick={() => toggleSection(sectionKey)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-neutral-800 hover:bg-neutral-750 text-left"
                >
                    <span className="text-sm font-medium text-neutral-200">{title}</span>
                    {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-neutral-400" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-neutral-400" />
                    )}
                </button>
                {isExpanded && (
                    <div className="px-3 py-2 bg-neutral-900/50 text-sm text-neutral-300 whitespace-pre-wrap">
                        {content}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col bg-neutral-900">
            {/* Tab Navigation */}
            <div className="flex gap-1 px-2 pt-2 border-b border-neutral-700 overflow-x-auto">
                {RECORD_TABS.map(tab => {
                    const Icon = tab.icon;
                    const hasData = hasContent(tab.id);
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-3 py-2 text-xs font-medium rounded-t-lg flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                                activeTab === tab.id
                                    ? 'bg-neutral-800 text-white border-t border-x border-neutral-600'
                                    : hasData
                                        ? 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
                                        : 'text-neutral-600 hover:text-neutral-500'
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {tab.label}
                            {hasData && activeTab !== tab.id && (
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-3">
                {/* HISTORY TAB */}
                {activeTab === 'history' && (
                    <div className="space-y-2">
                        {history.chiefComplaint && (
                            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3">
                                <h4 className="text-xs font-bold text-red-400 uppercase mb-1">Chief Complaint</h4>
                                <p className="text-sm text-white">{history.chiefComplaint}</p>
                            </div>
                        )}
                        <Section title="History of Present Illness" content={history.hpi} sectionKey="hpi" />
                        <Section title="Past Medical History" content={history.pastMedical} sectionKey="pmh" />
                        <Section title="Past Surgical History" content={history.pastSurgical} sectionKey="psh" />
                        <Section title="Allergies" content={history.allergies} sectionKey="allergies" />
                        <Section title="Social History" content={history.social} sectionKey="social" />
                        <Section title="Family History" content={history.family} sectionKey="family" />
                        {!hasContent('history') && (
                            <div className="text-center py-8 text-neutral-500">
                                No history information available
                            </div>
                        )}
                    </div>
                )}

                {/* PHYSICAL EXAM TAB */}
                {activeTab === 'physical' && (
                    <div className="space-y-2">
                        {physicalExam.general && (
                            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
                                <h4 className="text-xs font-bold text-blue-400 uppercase mb-1">General Appearance</h4>
                                <p className="text-sm text-white">{physicalExam.general}</p>
                            </div>
                        )}
                        <Section title="HEENT" content={physicalExam.heent} sectionKey="heent" />
                        <Section title="Cardiovascular" content={physicalExam.cardiovascular} sectionKey="cardiovascular" />
                        <Section title="Respiratory" content={physicalExam.respiratory} sectionKey="respiratory" />
                        <Section title="Abdomen" content={physicalExam.abdomen} sectionKey="abdomen" />
                        <Section title="Neurological" content={physicalExam.neurological} sectionKey="neurological" />
                        <Section title="Extremities/Skin" content={physicalExam.extremities} sectionKey="extremities" />
                        {!hasContent('physical') && (
                            <div className="text-center py-8 text-neutral-500">
                                No physical exam findings available
                            </div>
                        )}
                    </div>
                )}

                {/* MEDICATIONS TAB */}
                {activeTab === 'medications' && (
                    <div>
                        {medications.length > 0 ? (
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-neutral-400 uppercase mb-2">Current Medications</h4>
                                {medications.map((med, idx) => (
                                    <div key={idx} className="flex items-center gap-3 bg-neutral-800/50 rounded-lg px-3 py-2 border border-neutral-700">
                                        <Pill className="w-4 h-4 text-purple-400 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <span className="text-sm font-medium text-white">{med.name}</span>
                                            <span className="text-xs text-neutral-400 ml-2">
                                                {med.dose} {med.route} {med.frequency}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-neutral-500">
                                No medications recorded
                            </div>
                        )}
                    </div>
                )}

                {/* RADIOLOGY TAB */}
                {activeTab === 'radiology' && (
                    <div>
                        {radiology.length > 0 ? (
                            <div className="space-y-4">
                                {radiology.map((study, idx) => (
                                    <div key={study.id || idx} className="bg-neutral-800/50 rounded-lg border border-neutral-700 overflow-hidden">
                                        <div className="px-3 py-2 bg-neutral-800 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Image className="w-4 h-4 text-cyan-400" />
                                                <span className="text-sm font-medium text-white">{study.type}</span>
                                                {study.name && (
                                                    <span className="text-xs text-neutral-400">- {study.name}</span>
                                                )}
                                            </div>
                                            {study.date && (
                                                <span className="text-xs text-neutral-500">{study.date}</span>
                                            )}
                                        </div>
                                        <div className="p-3">
                                            {study.imageUrl && (
                                                <div
                                                    className="relative mb-3 group cursor-pointer"
                                                    onClick={() => setViewingImage(study.imageUrl)}
                                                >
                                                    <img
                                                        src={study.imageUrl}
                                                        alt={study.type}
                                                        className="max-h-48 rounded border border-neutral-600 object-contain mx-auto"
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded">
                                                        <ZoomIn className="w-8 h-8 text-white" />
                                                    </div>
                                                </div>
                                            )}
                                            {study.findings && (
                                                <div className="mb-2">
                                                    <h5 className="text-xs font-bold text-neutral-400 uppercase">Findings</h5>
                                                    <p className="text-sm text-neutral-300">{study.findings}</p>
                                                </div>
                                            )}
                                            {study.interpretation && (
                                                <div>
                                                    <h5 className="text-xs font-bold text-neutral-400 uppercase">Interpretation</h5>
                                                    <p className="text-sm text-neutral-300">{study.interpretation}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-neutral-500">
                                No radiology studies available
                            </div>
                        )}
                    </div>
                )}

                {/* PROCEDURES TAB */}
                {activeTab === 'procedures' && (
                    <div>
                        {procedures.length > 0 ? (
                            <div className="space-y-3">
                                {procedures.map((proc, idx) => (
                                    <div key={proc.id || idx} className="bg-neutral-800/50 rounded-lg border border-neutral-700 p-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Syringe className="w-4 h-4 text-orange-400" />
                                                <span className="text-sm font-medium text-white">{proc.name}</span>
                                            </div>
                                            {proc.date && (
                                                <span className="text-xs text-neutral-500">{proc.date}</span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            {proc.indication && (
                                                <div>
                                                    <span className="text-neutral-500">Indication: </span>
                                                    <span className="text-neutral-300">{proc.indication}</span>
                                                </div>
                                            )}
                                            {proc.findings && (
                                                <div>
                                                    <span className="text-neutral-500">Findings: </span>
                                                    <span className="text-neutral-300">{proc.findings}</span>
                                                </div>
                                            )}
                                            {proc.complications && (
                                                <div>
                                                    <span className="text-neutral-500">Complications: </span>
                                                    <span className="text-neutral-300">{proc.complications}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-neutral-500">
                                No procedures recorded
                            </div>
                        )}
                    </div>
                )}

                {/* NOTES TAB */}
                {activeTab === 'notes' && (
                    <div>
                        {notes.length > 0 ? (
                            <div className="space-y-3">
                                {notes.map((note, idx) => (
                                    <div key={note.id || idx} className="bg-neutral-800/50 rounded-lg border border-neutral-700 overflow-hidden">
                                        <div className="px-3 py-2 bg-neutral-800 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <ClipboardList className="w-4 h-4 text-yellow-400" />
                                                <span className="text-xs font-medium text-neutral-400">{note.type}</span>
                                                {note.title && (
                                                    <span className="text-sm text-white">- {note.title}</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-neutral-500">
                                                {note.date} {note.author && `| ${note.author}`}
                                            </div>
                                        </div>
                                        <div className="p-3 text-sm text-neutral-300 whitespace-pre-wrap">
                                            {note.content}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-neutral-500">
                                No clinical notes available
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Image Viewer Modal */}
            {viewingImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setViewingImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 text-white hover:text-neutral-300"
                        onClick={() => setViewingImage(null)}
                    >
                        <X className="w-8 h-8" />
                    </button>
                    <img
                        src={viewingImage}
                        alt="Full size view"
                        className="max-w-full max-h-full object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}
