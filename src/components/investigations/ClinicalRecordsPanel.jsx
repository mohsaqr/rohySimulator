import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Stethoscope, Pill, Image, Syringe, ClipboardList, ChevronDown, ChevronUp, ChevronRight, X, ZoomIn } from 'lucide-react';
import { HISTORY_GROUPS as CANONICAL_HISTORY_GROUPS } from '../../data/historyGroups';
import EventLogger from '../../services/eventLogger';

// Tab id → readable label for the analytics event (mirrors RECORD_TABS).
const RECORD_TAB_LABELS = {
    history: 'History', physical: 'Past Physical Exam', medications: 'Medications',
    radiology: 'Radiology', procedures: 'Procedures', notes: 'Notes',
};

// `labelKey` is the i18n key (namespace: investigations) for the visible
// tab label; the analytics label above stays hardcoded English so events
// remain comparable across UI languages.
const RECORD_TABS = [
    { id: 'history', labelKey: 'tab_history', icon: FileText },
    { id: 'physical', labelKey: 'tab_physical', icon: Stethoscope },
    { id: 'medications', labelKey: 'tab_medications', icon: Pill },
    { id: 'radiology', labelKey: 'tab_radiology', icon: Image },
    { id: 'procedures', labelKey: 'tab_procedures', icon: Syringe },
    { id: 'notes', labelKey: 'tab_notes', icon: ClipboardList }
];

// Viewer-specific overlays: only Chief Complaint gets a red highlight band
// (it's the case's headline finding). Everything else uses the canonical
// HISTORY_GROUPS labels from src/data/historyGroups.js — same source the
// editor and AI prompt builder use, so renaming a field updates all three.
const VIEWER_FIELD_META = {
    chiefComplaint: { highlight: 'red' },
};

const HISTORY_GROUPS = CANONICAL_HISTORY_GROUPS.map(group => ({
    ...group,
    fields: group.fields.map(f => ({ ...f, ...(VIEWER_FIELD_META[f.key] || {}) })),
}));

export default function ClinicalRecordsPanel({ caseConfig, initialTab = 'history' }) {
    const { t } = useTranslation('investigations');
    const [activeTab, setActiveTab] = useState(initialTab);

    // Record review is `assessing` activity. Log the tab the trainee is
    // reading — on first mount and whenever they switch tabs — so "reading the
    // history / medications" actually shows up in the activity analytics
    // instead of being invisible (this panel logged nothing before).
    useEffect(() => {
        EventLogger.recordTabViewed(activeTab, RECORD_TAB_LABELS[activeTab], 'ClinicalRecordsPanel');
    }, [activeTab]);
    const [expandedSection, setExpandedSection] = useState(null);
    const [openHistoryGroups, setOpenHistoryGroups] = useState({
        presentHistory: true,
        pastMedical: true,
        personalSocial: true,
    });
    const toggleHistoryGroup = (key) => {
        setOpenHistoryGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };
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
                            {t(tab.labelKey)}
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
                        {!hasContent('history') && (
                            <div className="text-center py-8 text-neutral-500">
                                {t('no_history')}
                            </div>
                        )}
                        {hasContent('history') && HISTORY_GROUPS.map(group => {
                            const populatedFields = group.fields.filter(f => (history[f.key] || '').trim());
                            if (populatedFields.length === 0) return null;
                            const isOpen = openHistoryGroups[group.key];
                            return (
                                <div key={group.key} className="border border-neutral-700 rounded-lg overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => toggleHistoryGroup(group.key)}
                                        className="w-full flex items-center justify-between px-3 py-2 bg-neutral-800 hover:bg-neutral-700/70 text-left transition-colors"
                                        aria-expanded={isOpen}
                                        aria-controls={`history-group-${group.key}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            {isOpen
                                                ? <ChevronDown className="w-4 h-4 text-neutral-400" />
                                                : <ChevronRight className="w-4 h-4 text-neutral-400" />
                                            }
                                            <span className="text-xs font-bold text-neutral-100 uppercase tracking-wide">
                                                {group.label}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-neutral-500 font-mono">
                                            {t('n_items', { count: populatedFields.length })}
                                        </span>
                                    </button>
                                    {isOpen && (
                                        <div id={`history-group-${group.key}`} className="p-2 space-y-2 bg-neutral-900/40">
                                            {populatedFields.map(field => {
                                                const content = history[field.key];
                                                if (field.highlight === 'red') {
                                                    return (
                                                        <div key={field.key} className="bg-red-900/20 border border-red-700/50 rounded-lg p-3">
                                                            <h4 className="text-xs font-bold text-red-400 uppercase mb-1">{field.label}</h4>
                                                            <p className="text-sm text-white whitespace-pre-wrap">{content}</p>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <div key={field.key} className="bg-neutral-800/70 border border-neutral-700 rounded-lg p-3">
                                                        <h4 className="text-xs font-bold text-neutral-400 uppercase mb-1">{field.label}</h4>
                                                        <p className="text-sm text-neutral-200 whitespace-pre-wrap">{content}</p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* PHYSICAL EXAM TAB */}
                {activeTab === 'physical' && (
                    <div className="space-y-2">
                        {physicalExam.general && (
                            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
                                <h4 className="text-xs font-bold text-blue-400 uppercase mb-1">{t('general_appearance')}</h4>
                                <p className="text-sm text-white">{physicalExam.general}</p>
                            </div>
                        )}
                        <Section title={t('section_heent')} content={physicalExam.heent} sectionKey="heent" />
                        <Section title={t('section_cardiovascular')} content={physicalExam.cardiovascular} sectionKey="cardiovascular" />
                        <Section title={t('section_respiratory')} content={physicalExam.respiratory} sectionKey="respiratory" />
                        <Section title={t('section_abdomen')} content={physicalExam.abdomen} sectionKey="abdomen" />
                        <Section title={t('section_neurological')} content={physicalExam.neurological} sectionKey="neurological" />
                        <Section title={t('section_extremities')} content={physicalExam.extremities} sectionKey="extremities" />
                        {!hasContent('physical') && (
                            <div className="text-center py-8 text-neutral-500">
                                {t('no_physical_exam')}
                            </div>
                        )}
                    </div>
                )}

                {/* MEDICATIONS TAB */}
                {activeTab === 'medications' && (
                    <div>
                        {medications.length > 0 ? (
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-neutral-400 uppercase mb-2">{t('current_medications')}</h4>
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
                                {t('no_medications')}
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
                                                    <h5 className="text-xs font-bold text-neutral-400 uppercase">{t('findings')}</h5>
                                                    <p className="text-sm text-neutral-300">{study.findings}</p>
                                                </div>
                                            )}
                                            {study.interpretation && (
                                                <div>
                                                    <h5 className="text-xs font-bold text-neutral-400 uppercase">{t('interpretation')}</h5>
                                                    <p className="text-sm text-neutral-300">{study.interpretation}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-neutral-500">
                                {t('no_radiology')}
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
                                                    <span className="text-neutral-500">{t('proc_indication_prefix')}</span>
                                                    <span className="text-neutral-300">{proc.indication}</span>
                                                </div>
                                            )}
                                            {proc.findings && (
                                                <div>
                                                    <span className="text-neutral-500">{t('proc_findings_prefix')}</span>
                                                    <span className="text-neutral-300">{proc.findings}</span>
                                                </div>
                                            )}
                                            {proc.complications && (
                                                <div>
                                                    <span className="text-neutral-500">{t('proc_complications_prefix')}</span>
                                                    <span className="text-neutral-300">{proc.complications}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-neutral-500">
                                {t('no_procedures')}
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
                                {t('no_clinical_notes')}
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
                        alt={t('full_size_view')}
                        className="max-w-full max-h-full object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}
