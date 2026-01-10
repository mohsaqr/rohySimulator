import React, { useState, useEffect } from 'react';
import { Settings, Save, Plus, Trash2, Cpu, FileText, Database, Image, Loader2, Upload, Users, ClipboardList, Download, X, FileDown, FileUp, Layers, Activity } from 'lucide-react';
import { LLMService } from '../../services/llmService';
import { useAuth } from '../../contexts/AuthContext';
import { AuthService } from '../../services/authService';
import EventLog from '../monitor/EventLog';
import SessionLogViewer from '../analytics/SessionLogViewer';
import ScenarioRepository from './ScenarioRepository';
import LabInvestigationEditor from './LabInvestigationEditor';
import { SCENARIO_TEMPLATES, scaleScenarioTimeline } from '../../data/scenarioTemplates';

export default function ConfigPanel({ onClose, onLoadCase, fullPage = false }) {
    const { user, isAdmin } = useAuth();
    const [activeTab, setActiveTab] = useState(fullPage ? 'cases' : 'llm'); // llm, cases, users, history, logs

    // Provider Configurations
    const PROVIDERS = {
        openai: {
            name: 'OpenAI API',
            defaultBase: 'https://api.openai.com/v1',
            defaultModel: 'gpt-3.5-turbo',
            needsKey: true,
            needsModel: true
        },
        lmstudio: {
            name: 'LM Studio (Local)',
            defaultBase: 'http://localhost:1234/v1',
            defaultModel: 'local-model',
            needsKey: false,
            needsModel: false
        },
        ollama: {
            name: 'Ollama (Local)',
            defaultBase: 'http://localhost:11434/v1',
            defaultModel: 'llama3',
            needsKey: false,
            needsModel: true
        }
    };

    // LLM Config State - Initialize with localStorage defaults or service config
    const [llmConfig, setLlmConfig] = useState(() => {
        // Try to load from localStorage first
        const savedDefaults = localStorage.getItem('rohy_llm_defaults');
        if (savedDefaults) {
            try {
                const parsed = JSON.parse(savedDefaults);
                // Validate provider exists
                if (parsed.provider && PROVIDERS[parsed.provider]) {
                    return parsed;
                }
            } catch (e) {
                console.warn('Failed to parse saved LLM defaults:', e);
            }
        }

        // Fallback to current service config or defaults
        const current = LLMService.config;
        let provider = current.provider === 'local' ? 'lmstudio' : current.provider;
        if (!PROVIDERS[provider]) provider = 'openai';

        return {
            provider,
            apiKey: current.apiKey || '',
            baseUrl: current.baseUrl || PROVIDERS[provider].defaultBase,
            model: current.model || PROVIDERS[provider].defaultModel
        };
    });

    const [hasDefaults, setHasDefaults] = useState(() => !!localStorage.getItem('rohy_llm_defaults'));

    // Handle Provider Change
    const handleProviderChange = (newProvider) => {
        const defaults = PROVIDERS[newProvider];
        setLlmConfig({
            provider: newProvider,
            baseUrl: defaults.defaultBase,
            model: defaults.defaultModel,
            apiKey: '' // Clear key on switch for security/cleanliness
        });
    };

    // Cases State
    const [cases, setCases] = useState([]);
    const [selectedCaseId, setSelectedCaseId] = useState(null);
    const [editingCase, setEditingCase] = useState(() => {
        // Restore editing case from localStorage on mount
        const savedCase = localStorage.getItem('rohy_editing_case');
        if (savedCase) {
            try {
                const parsed = JSON.parse(savedCase);
                console.log('Restored case from auto-save:', parsed.name);
                return parsed;
            } catch (e) {
                console.warn('Failed to restore auto-saved case:', e);
            }
        }
        return null;
    });
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState(null);

    // Auto-save editing case to localStorage
    useEffect(() => {
        if (editingCase) {
            localStorage.setItem('rohy_editing_case', JSON.stringify(editingCase));
            setHasUnsavedChanges(true);
            setLastSavedAt(new Date());
        }
    }, [editingCase]);

    // Warn before leaving with unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (editingCase && hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [editingCase, hasUnsavedChanges]);

    // Clear auto-save after successful save
    const clearAutoSave = () => {
        localStorage.removeItem('rohy_editing_case');
        setHasUnsavedChanges(false);
    };

    // Apply LLM defaults to service on mount
    useEffect(() => {
        LLMService.setConfig(llmConfig);
    }, []); // Only run once on mount

    // Load Cases on Mount
    useEffect(() => {
        const token = AuthService.getToken();
        fetch('/api/cases', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
            .then(res => res.json())
            .then(data => {
                setCases(data.cases || []);
                if (data.cases?.length > 0) setSelectedCaseId(data.cases[0].id);
            })
            .catch(err => console.error("Failed to load cases", err));
    }, []);

    const handleSaveLLMAsDefault = () => {
        // Save to localStorage
        localStorage.setItem('rohy_llm_defaults', JSON.stringify(llmConfig));
        // Apply to service
        LLMService.setConfig(llmConfig);
        setHasDefaults(true);
        alert('✓ LLM Settings saved as default!\nThey will persist across sessions.');
    };

    const handleSaveLLMForSession = () => {
        // Only apply to service, don't save to localStorage
        LLMService.setConfig(llmConfig);
        alert('✓ LLM Settings applied for this session only.\nThey will reset when you refresh.');
    };

    const handleResetLLMDefaults = () => {
        if (!confirm('Reset to factory defaults? This will clear your saved settings.')) return;
        localStorage.removeItem('rohy_llm_defaults');
        const provider = 'lmstudio';
        const defaults = PROVIDERS[provider];
        const newConfig = {
            provider,
            apiKey: '',
            baseUrl: defaults.defaultBase,
            model: defaults.defaultModel
        };
        setLlmConfig(newConfig);
        LLMService.setConfig(newConfig);
        setHasDefaults(false);
        alert('✓ Reset to factory defaults (LM Studio)');
    };

    const handleSaveCase = async () => {
        if (!editingCase) return;

        // Validate required fields
        if (!editingCase.name || editingCase.name.trim() === '') {
            alert('Please enter a case name before saving.');
            return;
        }

        const isUpdate = !!editingCase.id;
        const url = isUpdate
            ? `/api/cases/${editingCase.id}`
            : '/api/cases';

        // Auto-generate system prompt if empty
        const sysPrompt = editingCase.system_prompt || `You are ${editingCase.name}. ${editingCase.description}`;
        
        // Ensure config exists
        const config = editingCase.config || {};
        
        const payload = { 
            ...editingCase, 
            system_prompt: sysPrompt,
            config: config,
            description: editingCase.description || ''
        };

        const token = AuthService.getToken();
        
        if (!token) {
            alert('Authentication required. Please log in again.');
            return;
        }

        console.log('Saving case:', { isUpdate, url, payload: { ...payload, config: 'omitted for brevity' } });

        try {
            const res = await fetch(url, {
                method: isUpdate ? 'PUT' : 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            console.log('Response status:', res.status);

            if (!res.ok) {
                // Check if response is JSON
                const contentType = res.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const error = await res.json();
                    throw new Error(error.error || `Failed to save case (${res.status})`);
                } else {
                    // Response is not JSON (likely HTML error page)
                    const text = await res.text();
                    console.error('Non-JSON response:', text);
                    throw new Error(`Server error (${res.status}). Check console for details.`);
                }
            }

            const saved = await res.json();
            console.log('Case saved successfully:', saved);

            // Save lab investigations to database if any
            const labs = editingCase.config?.investigations?.labs || [];
            if (labs.length > 0) {
                const caseId = saved.id;
                
                // First, delete existing labs for this case (to handle updates)
                // Then insert new ones
                for (const lab of labs) {
                    try {
                        await fetch(`/api/cases/${caseId}/labs`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify(lab)
                        });
                    } catch (labErr) {
                        console.error('Failed to save lab:', labErr);
                    }
                }
            }

            // Update List
            if (isUpdate) {
                setCases(prev => prev.map(c => c.id === saved.id ? saved : c));
            } else {
                setCases(prev => [saved, ...prev]);
                // For new cases, update editingCase with the new ID so subsequent saves are updates
                setEditingCase(prev => ({ ...prev, id: saved.id }));
            }

            setSelectedCaseId(saved.id);

            // Clear auto-save after successful database save
            clearAutoSave();

            // Show success notification without closing editor
            const notification = document.createElement('div');
            notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-top-2';
            notification.innerHTML = `<div class="flex items-center gap-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><span class="font-bold">Case saved successfully!</span></div>`;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
            
        } catch (err) {
            console.error(err);
            alert(err.message || 'Failed to save case');
        }
    };

    const handleDeleteCase = async (caseId) => {
        if (!confirm('Are you sure you want to delete this case?')) return;

        const token = AuthService.getToken();
        try {
            const res = await fetch(`/api/cases/${caseId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok) {
                throw new Error('Failed to delete case');
            }

            setCases(prev => prev.filter(c => c.id !== caseId));
            alert('Case deleted successfully!');
        } catch (err) {
            console.error(err);
            alert('Failed to delete case');
        }
    };

    return (
        <div className={`flex flex-col h-full bg-neutral-900 text-white ${fullPage ? '' : 'rounded-xl'} overflow-hidden`}>

            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-neutral-800 bg-neutral-900 relative">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Settings className="w-6 h-6 text-purple-500" />
                    {fullPage ? 'Rohy - Settings & Administration' : 'Platform Configuration'}
                </h2>
                {fullPage && (
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <X className="w-4 h-4" />
                        Back to Simulation
                    </button>
                )}
            </div>

            <div className="flex flex-1 overflow-hidden">

                {/* Sidebar */}
                <div className="w-48 bg-neutral-950 border-r border-neutral-800 flex flex-col pt-4">
                    <button
                        onClick={() => setActiveTab('llm')}
                        className={`px-4 py-3 text-left text-sm font-bold flex items-center gap-2 border-l-2 transition-colors ${activeTab === 'llm' ? 'border-purple-500 bg-neutral-900 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                    >
                        <Cpu className="w-4 h-4" /> LLM Settings
                    </button>
                    <button
                        onClick={() => setActiveTab('cases')}
                        className={`px-4 py-3 text-left text-sm font-bold flex items-center gap-2 border-l-2 transition-colors ${activeTab === 'cases' ? 'border-purple-500 bg-neutral-900 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                    >
                        <FileText className="w-4 h-4" /> {isAdmin() ? 'Manage Cases' : 'Cases'}
                    </button>
                    <button
                        onClick={() => setActiveTab('scenarios')}
                        className={`px-4 py-3 text-left text-sm font-bold flex items-center gap-2 border-l-2 transition-colors ${activeTab === 'scenarios' ? 'border-purple-500 bg-neutral-900 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                    >
                        <Layers className="w-4 h-4" /> Scenarios
                    </button>
                    {isAdmin() && (
                        <>
                            <button
                                onClick={() => setActiveTab('users')}
                                className={`px-4 py-3 text-left text-sm font-bold flex items-center gap-2 border-l-2 transition-colors ${activeTab === 'users' ? 'border-purple-500 bg-neutral-900 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                            >
                                <Users className="w-4 h-4" /> User Management
                            </button>
                            <button
                                onClick={() => setActiveTab('logs')}
                                className={`px-4 py-3 text-left text-sm font-bold flex items-center gap-2 border-l-2 transition-colors ${activeTab === 'logs' ? 'border-purple-500 bg-neutral-900 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                            >
                                <ClipboardList className="w-4 h-4" /> System Logs
                            </button>
                        </>
                    )}
                </div>

                {/* Content Area */}
                <div className="flex-1 p-8 overflow-y-auto bg-neutral-900">

                    {/* --- LLM TAB --- */}
                    {activeTab === 'llm' && (
                        <div className="space-y-6 max-w-2xl">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                                    <h3 className="text-lg font-bold">Model Connection</h3>
                                    {hasDefaults && (
                                        <span className="text-xs bg-purple-900/30 text-purple-300 px-2 py-1 rounded border border-purple-700">
                                            ✓ Using Saved Defaults
                                        </span>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-neutral-500 mb-1 uppercase">Provider</label>
                                        <select
                                            value={llmConfig.provider}
                                            onChange={(e) => handleProviderChange(e.target.value)}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded p-2 text-sm focus:border-purple-500 outline-none"
                                        >
                                            {Object.entries(PROVIDERS).map(([key, config]) => (
                                                <option key={key} value={key}>{config.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* BASE URL */}
                                    <div>
                                        <label className="block text-xs font-bold text-neutral-500 mb-1 uppercase">Base URL</label>
                                        <input
                                            type="text"
                                            value={llmConfig.baseUrl}
                                            onChange={(e) => setLlmConfig({ ...llmConfig, baseUrl: e.target.value })}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded p-2 text-sm font-mono focus:border-purple-500 outline-none"
                                        />
                                        <p className="text-[10px] text-neutral-500 mt-1">Default: {PROVIDERS[llmConfig.provider].defaultBase}</p>
                                    </div>

                                    {/* MODEL NAME (Conditional) */}
                                    {PROVIDERS[llmConfig.provider].needsModel && (
                                        <div>
                                            <label className="block text-xs font-bold text-neutral-500 mb-1 uppercase">Model Name</label>
                                            <input
                                                type="text"
                                                value={llmConfig.model}
                                                onChange={(e) => setLlmConfig({ ...llmConfig, model: e.target.value })}
                                                className="w-full bg-neutral-800 border border-neutral-700 rounded p-2 text-sm focus:border-purple-500 outline-none"
                                                placeholder={PROVIDERS[llmConfig.provider].defaultModel}
                                            />
                                        </div>
                                    )}

                                    {/* API KEY (Conditional) */}
                                    {PROVIDERS[llmConfig.provider].needsKey && (
                                        <div>
                                            <label className="block text-xs font-bold text-neutral-500 mb-1 uppercase">API Key</label>
                                            <div className="relative">
                                                <input
                                                    type="password"
                                                    value={llmConfig.apiKey}
                                                    onChange={(e) => setLlmConfig({ ...llmConfig, apiKey: e.target.value })}
                                                    className="w-full bg-neutral-800 border border-neutral-700 rounded p-2 text-sm focus:border-purple-500 outline-none pr-10"
                                                    placeholder="sk-..."
                                                />
                                                <div className="absolute right-3 top-2.5 text-neutral-500">
                                                    <Cpu className="w-4 h-4" />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                </div> {/* End Grid */}

                                <div className="flex items-center justify-between pt-4 border-t border-neutral-800">
                                    <button
                                        onClick={handleResetLLMDefaults}
                                        className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-sm text-neutral-400 hover:text-white"
                                    >
                                        Reset to Factory
                                    </button>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleSaveLLMForSession}
                                            className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded font-bold text-sm"
                                        >
                                            For This Session
                                        </button>
                                        <button
                                            onClick={handleSaveLLMAsDefault}
                                            className="px-6 py-2 bg-purple-600 hover:bg-purple-500 rounded font-bold text-sm shadow-lg shadow-purple-900/20 flex items-center gap-2"
                                        >
                                            <Save className="w-4 h-4" /> Save as Default
                                        </button>
                                    </div>
                                </div>

                                <div className="bg-neutral-800/50 border border-neutral-700 rounded p-3 text-xs text-neutral-400">
                                    <p className="font-bold text-neutral-300 mb-1">💡 Save Options:</p>
                                    <ul className="space-y-1 ml-4 list-disc">
                                        <li><strong className="text-purple-400">Save as Default:</strong> Persists across sessions (stored in browser)</li>
                                        <li><strong className="text-neutral-300">For This Session:</strong> Applies now, resets on refresh</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}


                    {/* --- CASES TAB --- */}
                    {activeTab === 'cases' && (
                        <div className="space-y-6">

                            {!editingCase ? (
                                <>
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-lg font-bold">{isAdmin() ? 'Manage Cases' : 'Available Cases'}</h3>
                                        <div className="flex gap-2">
                                            {isAdmin() && (
                                                <>
                                                    <button
                                                        onClick={() => setEditingCase({ name: '', description: '', config: { pages: [] } })}
                                                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold"
                                                    >
                                                        <Plus className="w-4 h-4" /> New Case
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const input = document.createElement('input');
                                                            input.type = 'file';
                                                            input.accept = '.json';
                                                            input.onchange = async (e) => {
                                                                const file = e.target.files[0];
                                                                if (!file) return;
                                                                
                                                                try {
                                                                    const text = await file.text();
                                                                    const caseData = JSON.parse(text);
                                                                    
                                                                    // Validate
                                                                    if (!caseData.name || !caseData.description) {
                                                                        throw new Error('Invalid case file format');
                                                                    }
                                                                    
                                                                    // Save to database
                                                                    const token = AuthService.getToken();
                                                                    const res = await fetch('/api/cases', {
                                                                        method: 'POST',
                                                                        headers: { 
                                                                            'Content-Type': 'application/json',
                                                                            'Authorization': `Bearer ${token}`
                                                                        },
                                                                        body: JSON.stringify(caseData)
                                                                    });
                                                                    
                                                                    if (res.ok) {
                                                                        alert('✓ Case imported successfully!');
                                                                        // Reload cases
                                                                        const casesRes = await fetch('/api/cases', {
                                                                            headers: { 'Authorization': `Bearer ${token}` }
                                                                        });
                                                                        const data = await casesRes.json();
                                                                        setCases(data.cases || []);
                                                                    } else {
                                                                        throw new Error('Failed to save case');
                                                                    }
                                                                } catch (err) {
                                                                    alert('✗ Failed to import case: ' + err.message);
                                                                }
                                                            };
                                                            input.click();
                                                        }}
                                                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm font-bold"
                                                        title="Import Case from JSON"
                                                    >
                                                        <FileUp className="w-4 h-4" /> Import
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid gap-3">
                                        {cases.map(c => (
                                            <div key={c.id} className="p-4 bg-neutral-800 border border-neutral-700 rounded-lg flex justify-between items-center hover:bg-neutral-800/80">
                                                <div>
                                                    <div className="font-bold text-white">{c.name}</div>
                                                    <div className="text-sm text-neutral-400">{c.description}</div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => {
                                                            if (onLoadCase) onLoadCase(c);
                                                            if (onClose) onClose();
                                                        }}
                                                        className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-bold text-white shadow-lg shadow-green-900/20"
                                                    >
                                                        Load
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            // Export case to JSON
                                                            const caseJSON = {
                                                                version: '1.0',
                                                                exportedAt: new Date().toISOString(),
                                                                ...c
                                                            };
                                                            // Remove database ID for portability
                                                            delete caseJSON.id;
                                                            
                                                            const json = JSON.stringify(caseJSON, null, 2);
                                                            const blob = new Blob([json], { type: 'application/json' });
                                                            const url = window.URL.createObjectURL(blob);
                                                            const a = document.createElement('a');
                                                            a.href = url;
                                                            a.download = `case-${c.name.replace(/\s+/g, '-').toLowerCase()}.json`;
                                                            document.body.appendChild(a);
                                                            a.click();
                                                            document.body.removeChild(a);
                                                            window.URL.revokeObjectURL(url);
                                                        }}
                                                        className="p-2 bg-blue-700 hover:bg-blue-600 rounded text-xs"
                                                        title="Export to JSON"
                                                    >
                                                        <FileDown className="w-4 h-4" />
                                                    </button>
                                                    {isAdmin() && (
                                                        <>
                                                            <button onClick={() => setEditingCase(c)} className="p-2 bg-neutral-700 rounded text-xs hover:bg-neutral-600">Edit</button>
                                                            <button onClick={() => handleDeleteCase(c.id)} className="p-2 bg-red-900/30 text-red-400 rounded text-xs hover:bg-red-900/50">Delete</button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        {cases.length === 0 && (
                                            <div className="text-neutral-500 text-center py-8">No cases found in database.</div>
                                        )}
                                    </div>
                                </>
                            ) : isAdmin() ? (
                                /* CASE WIZARD - Admin only */
                                <CaseWizard
                                    caseData={editingCase}
                                    setCaseData={setEditingCase}
                                    onSave={handleSaveCase}
                                    onCancel={() => {
                                        if (hasUnsavedChanges) {
                                            const action = window.confirm(
                                                'You have unsaved changes.\n\nClick OK to save before exiting, or Cancel to discard changes.'
                                            );
                                            if (action) {
                                                handleSaveCase();
                                            } else {
                                                clearAutoSave();
                                                setEditingCase(null);
                                            }
                                        } else {
                                            clearAutoSave();
                                            setEditingCase(null);
                                        }
                                    }}
                                    hasUnsavedChanges={hasUnsavedChanges}
                                    lastSavedAt={lastSavedAt}
                                />
                            ) : null}

                        </div>
                    )}

                    {/* --- SCENARIOS TAB --- */}
                    {activeTab === 'scenarios' && (
                        <ScenarioRepository 
                            onSelectScenario={(scenario) => {
                                if (editingCase) {
                                    // Apply scenario to editing case
                                    const scaledScenario = {
                                        enabled: true,
                                        autoStart: false,
                                        timeline: scenario.timeline
                                    };
                                    
                                    setEditingCase(prev => ({
                                        ...prev,
                                        scenario: scaledScenario,
                                        scenario_duration: scenario.duration_minutes,
                                        scenario_from_repository: {
                                            id: scenario.id,
                                            name: scenario.name
                                        }
                                    }));
                                    
                                    // Switch back to cases tab
                                    setActiveTab('cases');
                                    alert(`Scenario "${scenario.name}" applied to case! Return to Step 3 to configure.`);
                                } else {
                                    alert('Please start editing a case first, then browse scenarios from Step 3.');
                                }
                            }} 
                        />
                    )}

                    {/* --- USER MANAGEMENT TAB (Admin Only) --- */}
                    {activeTab === 'users' && isAdmin() && (
                        <UserManagement />
                    )}

                    {/* --- SYSTEM LOGS TAB (Admin Only) --- */}
                    {activeTab === 'logs' && isAdmin() && (
                        <SystemLogs />
                    )}

                </div>
            </div>
        </div>
    );
}

// System Logs Component (Admin Only)
function SystemLogs() {
    const [activeLogTab, setActiveLogTab] = useState('activity'); // activity, login, sessions, settings, events
    const [loginLogs, setLoginLogs] = useState([]);
    const [settingsLogs, setSettingsLogs] = useState([]);
    const [sessionsList, setSessionsList] = useState([]);
    const [loading, setLoading] = useState(false);
    const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
    const [selectedSessionForEvents, setSelectedSessionForEvents] = useState(null);
    const [selectedSessionForActivity, setSelectedSessionForActivity] = useState(null);

    useEffect(() => {
        if (activeLogTab === 'login') {
            loadLoginLogs();
        } else if (activeLogTab === 'settings') {
            loadSettingsLogs();
        } else if (activeLogTab === 'sessions') {
            loadSessions();
        } else if (activeLogTab === 'events') {
            // Load sessions for event log selector
            loadSessions();
        } else if (activeLogTab === 'activity') {
            // Load sessions for activity log selector
            loadSessions();
        }
    }, [activeLogTab, dateFilter]);

    const loadLoginLogs = async () => {
        setLoading(true);
        const token = AuthService.getToken();
        try {
            const res = await fetch('/api/analytics/login-logs?limit=200', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setLoginLogs(data.logs || []);
        } catch (err) {
            console.error('Failed to load login logs', err);
        } finally {
            setLoading(false);
        }
    };

    const loadSettingsLogs = async () => {
        setLoading(true);
        const token = AuthService.getToken();
        try {
            const res = await fetch('/api/analytics/settings-logs?limit=200', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setSettingsLogs(data.logs || []);
        } catch (err) {
            console.error('Failed to load settings logs', err);
        } finally {
            setLoading(false);
        }
    };

    const loadSessions = async () => {
        setLoading(true);
        const token = AuthService.getToken();
        try {
            const res = await fetch('/api/analytics/sessions', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setSessionsList(data.sessions || []);
        } catch (err) {
            console.error('Failed to load sessions', err);
        } finally {
            setLoading(false);
        }
    };

    const downloadCSV = async (logType) => {
        const token = AuthService.getToken();
        let url = '';
        
        switch (logType) {
            case 'login':
                url = '/api/export/login-logs';
                break;
            case 'chat':
                url = '/api/export/chat-logs';
                break;
            case 'settings':
                url = '/api/export/settings-logs';
                break;
            case 'session-settings':
                url = '/api/export/session-settings';
                break;
        }

        // Add date filters if set
        const params = new URLSearchParams();
        if (dateFilter.start) params.append('start_date', dateFilter.start);
        if (dateFilter.end) params.append('end_date', dateFilter.end);
        const queryString = params.toString() ? `?${params.toString()}` : '';

        try {
            // Fetch with auth header
            const response = await fetch(url + queryString, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Export failed');
            }

            // Get the CSV content
            const blob = await response.blob();
            
            // Create download link
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `${logType}_logs_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(downloadUrl);
            
            alert(`${logType} logs exported successfully!`);
        } catch (error) {
            console.error('Export failed:', error);
            alert('Export failed. Please try again.');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">System Logs & Data Export</h3>
                <div className="flex gap-2">
                    <input
                        type="date"
                        value={dateFilter.start}
                        onChange={(e) => setDateFilter(prev => ({ ...prev, start: e.target.value }))}
                        className="px-3 py-1 bg-neutral-800 border border-neutral-700 rounded text-sm"
                        placeholder="Start Date"
                    />
                    <input
                        type="date"
                        value={dateFilter.end}
                        onChange={(e) => setDateFilter(prev => ({ ...prev, end: e.target.value }))}
                        className="px-3 py-1 bg-neutral-800 border border-neutral-700 rounded text-sm"
                        placeholder="End Date"
                    />
                </div>
            </div>

            {/* Export Buttons */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-neutral-800 border border-neutral-700 rounded-lg">
                <div className="space-y-2">
                    <h4 className="font-bold text-sm">Login & Authentication Logs</h4>
                    <button
                        onClick={() => downloadCSV('login')}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded text-sm font-bold"
                    >
                        <Download className="w-4 h-4" />
                        Export Login Logs (CSV)
                    </button>
                    <p className="text-xs text-neutral-400">All login, logout, and failed login attempts</p>
                </div>

                <div className="space-y-2">
                    <h4 className="font-bold text-sm">Chat & Conversation Logs</h4>
                    <button
                        onClick={() => downloadCSV('chat')}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded text-sm font-bold"
                    >
                        <Download className="w-4 h-4" />
                        Export Chat Logs (CSV)
                    </button>
                    <p className="text-xs text-neutral-400">Complete conversation history with timestamps</p>
                </div>

                <div className="space-y-2">
                    <h4 className="font-bold text-sm">Settings Change Logs</h4>
                    <button
                        onClick={() => downloadCSV('settings')}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded text-sm font-bold"
                    >
                        <Download className="w-4 h-4" />
                        Export Settings Logs (CSV)
                    </button>
                    <p className="text-xs text-neutral-400">All LLM and monitor settings changes</p>
                </div>

                <div className="space-y-2">
                    <h4 className="font-bold text-sm">Session Settings Snapshots</h4>
                    <button
                        onClick={() => downloadCSV('session-settings')}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-700 hover:bg-orange-600 text-white rounded text-sm font-bold"
                    >
                        <Download className="w-4 h-4" />
                        Export Session Settings (CSV)
                    </button>
                    <p className="text-xs text-neutral-400">Complete settings used in each session</p>
                </div>
            </div>

            {/* Log Viewer Tabs */}
            <div className="border-b border-neutral-700 flex gap-4 overflow-x-auto">
                <button
                    onClick={() => setActiveLogTab('activity')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-1 whitespace-nowrap ${activeLogTab === 'activity' ? 'border-cyan-500 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    <Activity className="w-4 h-4" />
                    Activity Log
                </button>
                <button
                    onClick={() => setActiveLogTab('login')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'login' ? 'border-green-500 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    Login Activity ({loginLogs.length})
                </button>
                <button
                    onClick={() => setActiveLogTab('sessions')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'sessions' ? 'border-blue-500 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    All Sessions ({sessionsList.length})
                </button>
                <button
                    onClick={() => setActiveLogTab('settings')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'settings' ? 'border-purple-500 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    Settings Changes ({settingsLogs.length})
                </button>
                <button
                    onClick={() => setActiveLogTab('events')}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeLogTab === 'events' ? 'border-orange-500 text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                    Event Log
                </button>
            </div>

            {/* Log Content - Table View */}
            <div className="flex-1 overflow-auto">
                {loading && activeLogTab !== 'activity' ? (
                    <div className="text-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                    </div>
                ) : activeLogTab === 'activity' ? (
                    <div className="bg-neutral-800 border border-neutral-700 rounded overflow-hidden" style={{ height: '650px' }}>
                        <SessionLogViewer showAllSessions={true} />
                    </div>
                ) : activeLogTab === 'login' ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-800 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left font-bold">Username</th>
                                    <th className="px-4 py-3 text-left font-bold">Email</th>
                                    <th className="px-4 py-3 text-left font-bold">Action</th>
                                    <th className="px-4 py-3 text-left font-bold">IP Address</th>
                                    <th className="px-4 py-3 text-left font-bold">Timestamp</th>
                                    <th className="px-4 py-3 text-left font-bold">User Agent</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loginLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-8 text-neutral-500">
                                            No login logs yet
                                        </td>
                                    </tr>
                                ) : (
                                    loginLogs.map((log, idx) => (
                                        <tr key={idx} className="border-b border-neutral-800 hover:bg-neutral-800/50">
                                            <td className="px-4 py-3 font-medium">{log.username || 'N/A'}</td>
                                            <td className="px-4 py-3 text-neutral-400">{log.email || 'N/A'}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${
                                                    log.action === 'login' ? 'bg-green-900 text-green-200' :
                                                    log.action === 'logout' ? 'bg-blue-900 text-blue-200' :
                                                    'bg-red-900 text-red-200'
                                                }`}>
                                                    {log.action}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-neutral-400">{log.ip_address}</td>
                                            <td className="px-4 py-3 text-neutral-400">{new Date(log.timestamp).toLocaleString()}</td>
                                            <td className="px-4 py-3 text-xs text-neutral-500 max-w-xs truncate">{log.user_agent}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : activeLogTab === 'sessions' ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-800 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left font-bold">ID</th>
                                    <th className="px-4 py-3 text-left font-bold">User</th>
                                    <th className="px-4 py-3 text-left font-bold">Case</th>
                                    <th className="px-4 py-3 text-left font-bold">Start Time</th>
                                    <th className="px-4 py-3 text-left font-bold">Duration</th>
                                    <th className="px-4 py-3 text-left font-bold">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessionsList.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="text-center py-8 text-neutral-500">
                                            No sessions yet
                                        </td>
                                    </tr>
                                ) : (
                                    sessionsList.map((session, idx) => (
                                        <tr key={idx} className="border-b border-neutral-800 hover:bg-neutral-800/50">
                                            <td className="px-4 py-3 font-mono">#{session.id}</td>
                                            <td className="px-4 py-3 font-medium">{session.username || session.student_name}</td>
                                            <td className="px-4 py-3 text-neutral-400">{session.case_name}</td>
                                            <td className="px-4 py-3 text-neutral-400">{new Date(session.start_time).toLocaleString()}</td>
                                            <td className="px-4 py-3">
                                                {session.duration ? 
                                                    `${Math.floor(session.duration / 60)}m ${session.duration % 60}s` : 
                                                    <span className="text-yellow-400">In Progress</span>
                                                }
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${
                                                    session.end_time ? 'bg-green-900 text-green-200' : 'bg-yellow-900 text-yellow-200'
                                                }`}>
                                                    {session.end_time ? 'Completed' : 'Active'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : activeLogTab === 'settings' ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-800 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left font-bold">User</th>
                                    <th className="px-4 py-3 text-left font-bold">Type</th>
                                    <th className="px-4 py-3 text-left font-bold">Setting</th>
                                    <th className="px-4 py-3 text-left font-bold">Old Value</th>
                                    <th className="px-4 py-3 text-left font-bold">New Value</th>
                                    <th className="px-4 py-3 text-left font-bold">Case</th>
                                    <th className="px-4 py-3 text-left font-bold">Timestamp</th>
                                </tr>
                            </thead>
                            <tbody>
                                {settingsLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="text-center py-8 text-neutral-500">
                                            No settings changes yet
                                        </td>
                                    </tr>
                                ) : (
                                    settingsLogs.map((log, idx) => (
                                        <tr key={idx} className="border-b border-neutral-800 hover:bg-neutral-800/50">
                                            <td className="px-4 py-3 font-medium">{log.username}</td>
                                            <td className="px-4 py-3">
                                                <span className="px-2 py-1 bg-purple-900 text-purple-200 rounded text-xs font-bold">
                                                    {log.setting_type}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-neutral-400">{log.setting_name || 'N/A'}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-neutral-500">{log.old_value || '-'}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-green-400">{log.new_value || '-'}</td>
                                            <td className="px-4 py-3 text-neutral-400">{log.case_name || 'N/A'}</td>
                                            <td className="px-4 py-3 text-neutral-400 text-xs">{new Date(log.timestamp).toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : activeLogTab === 'events' ? (
                    <div className="space-y-4">
                        {/* Session Selector */}
                        <div className="bg-neutral-800 p-4 rounded border border-neutral-700">
                            <label className="block text-sm font-bold mb-2">Select Session to View Events</label>
                            <select
                                value={selectedSessionForEvents || ''}
                                onChange={(e) => setSelectedSessionForEvents(e.target.value)}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded p-2 text-sm"
                            >
                                <option value="">-- Select a session --</option>
                                {sessionsList.map(session => (
                                    <option key={session.id} value={session.id}>
                                        Session #{session.id} - {session.username || session.student_name} - {session.case_name} - {new Date(session.start_time).toLocaleString()}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Event Log Display */}
                        {selectedSessionForEvents ? (
                            <div className="bg-neutral-800 border border-neutral-700 rounded overflow-hidden" style={{ height: '600px' }}>
                                <EventLog sessionId={selectedSessionForEvents} />
                            </div>
                        ) : (
                            <div className="text-center py-12 text-neutral-500">
                                Please select a session to view its event log
                            </div>
                        )}
                    </div>
                ) : null}
            </div>

            {/* Info Box */}
            <div className="p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                <h4 className="font-bold text-sm mb-2 flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Comprehensive Data Logging
                </h4>
                <div className="text-xs text-neutral-300 space-y-1">
                    <p>✅ All logins, logouts, and failed attempts are logged</p>
                    <p>✅ Every chat message is recorded with timestamps</p>
                    <p>✅ All settings changes are tracked (LLM, monitor)</p>
                    <p>✅ Each session includes complete settings snapshot</p>
                    <p>✅ All data is linked by User, Session, and Case</p>
                    <p className="mt-2 text-yellow-400">💾 Export to CSV for spreadsheet analysis (Excel, Google Sheets, etc.)</p>
                </div>
            </div>
        </div>
    );
}

// User Management Component (Admin Only)
function UserManagement() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [showBatchUpload, setShowBatchUpload] = useState(false);
    const [formData, setFormData] = useState({ username: '', name: '', email: '', password: '', role: 'user' });

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        setLoading(true);
        const token = AuthService.getToken();
        try {
            const res = await fetch('/api/users', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setUsers(data.users || []);
        } catch (err) {
            console.error('Failed to load users', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateUser = async (e) => {
        e.preventDefault();
        const token = AuthService.getToken();
        try {
            const res = await fetch('/api/users/create', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const data = await res.json();
            if (res.ok) {
                alert('User created successfully!');
                loadUsers();
                setShowCreateForm(false);
                setFormData({ username: '', name: '', email: '', password: '', role: 'user' });
            } else {
                alert(data.error || 'Failed to create user');
            }
        } catch (err) {
            alert('Error creating user');
        }
    };

    const handleEditUser = async (e) => {
        e.preventDefault();
        const token = AuthService.getToken();
        try {
            const res = await fetch(`/api/users/${editingUser.id}`, {
                method: 'PUT',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const data = await res.json();
            if (res.ok) {
                alert('User updated successfully!');
                loadUsers();
                setShowEditForm(false);
                setEditingUser(null);
                setFormData({ username: '', name: '', email: '', password: '', role: 'user' });
            } else {
                alert(data.error || 'Failed to update user');
            }
        } catch (err) {
            alert('Error updating user');
        }
    };

    const handleBatchUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const csv = event.target.result;
                const lines = csv.split('\n');
                const users = [];

                // Skip header row
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const [username, name, email, password, role] = line.split(',').map(s => s.trim());
                    if (username && email && password) {
                        users.push({ username, name: name || '', email, password, role: role || 'user' });
                    }
                }

                if (users.length === 0) {
                    alert('No valid users found in CSV');
                    return;
                }

                const token = AuthService.getToken();
                const res = await fetch('/api/users/batch', {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ users })
                });

                const data = await res.json();
                alert(data.message);
                if (data.results.failed.length > 0) {
                    console.log('Failed users:', data.results.failed);
                }
                loadUsers();
                setShowBatchUpload(false);
            } catch (err) {
                alert('Error processing CSV file');
            }
        };
        reader.readAsText(file);
    };

    const downloadCSVTemplate = () => {
        const csv = `username,name,email,password,role
john_doe,John Doe,john@example.com,password123,user
jane_admin,Jane Smith,jane@example.com,admin456,admin
student1,Student One,student1@school.edu,stud123,user`;
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'user_upload_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    };

    const handleDeleteUser = async (userId) => {
        if (!confirm('Are you sure you want to delete this user?')) return;

        const token = AuthService.getToken();
        try {
            const res = await fetch(`/api/users/${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                setUsers(prev => prev.filter(u => u.id !== userId));
                alert('User deleted successfully');
            }
        } catch (err) {
            alert('Failed to delete user');
        }
    };

    const handleToggleRole = async (userId, currentRole) => {
        const newRole = currentRole === 'admin' ? 'user' : 'admin';
        const token = AuthService.getToken();

        try {
            const user = users.find(u => u.id === userId);
            const res = await fetch(`/api/users/${userId}`, {
                method: 'PUT',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: user.username, name: user.name, email: user.email, role: newRole })
            });

            if (res.ok) {
                setUsers(prev => prev.map(u => 
                    u.id === userId ? { ...u, role: newRole } : u
                ));
                alert('User role updated');
            }
        } catch (err) {
            alert('Failed to update role');
        }
    };

    const openEditForm = (user) => {
        setEditingUser(user);
        setFormData({ username: user.username, name: user.name || '', email: user.email, password: '', role: user.role });
        setShowEditForm(true);
    };

    if (loading) {
        return <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
    }

    // Create User Form
    if (showCreateForm) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Create New User</h3>
                    <button onClick={() => setShowCreateForm(false)} className="text-sm text-neutral-400 hover:text-white">
                        ← Back
                    </button>
                </div>

                <form onSubmit={handleCreateUser} className="space-y-4 max-w-md">
                    <div>
                        <label className="block text-sm font-bold mb-2">Username *</label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({...formData, username: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Full Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            placeholder="e.g. John Doe"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Email *</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({...formData, email: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Password * (min 6 characters)</label>
                        <input
                            type="password"
                            value={formData.password}
                            onChange={(e) => setFormData({...formData, password: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            minLength={6}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Role</label>
                        <select
                            value={formData.role}
                            onChange={(e) => setFormData({...formData, role: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                        >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-bold">
                        Create User
                    </button>
                </form>
            </div>
        );
    }

    // Edit User Form
    if (showEditForm && editingUser) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Edit User: {editingUser.username}</h3>
                    <button onClick={() => { setShowEditForm(false); setEditingUser(null); }} className="text-sm text-neutral-400 hover:text-white">
                        ← Back
                    </button>
                </div>

                <form onSubmit={handleEditUser} className="space-y-4 max-w-md">
                    <div>
                        <label className="block text-sm font-bold mb-2">Username *</label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({...formData, username: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Full Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            placeholder="e.g. John Doe"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Email *</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({...formData, email: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">New Password (leave blank to keep current)</label>
                        <input
                            type="password"
                            value={formData.password}
                            onChange={(e) => setFormData({...formData, password: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                            minLength={6}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold mb-2">Role</label>
                        <select
                            value={formData.role}
                            onChange={(e) => setFormData({...formData, role: e.target.value})}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2"
                        >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-bold">
                        Update User
                    </button>
                </form>
            </div>
        );
    }

    // Batch Upload View
    if (showBatchUpload) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Batch Upload Users (CSV)</h3>
                    <button onClick={() => setShowBatchUpload(false)} className="text-sm text-neutral-400 hover:text-white">
                        ← Back
                    </button>
                </div>

                <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-6 space-y-4">
                    <div>
                        <h4 className="font-bold mb-2">CSV Format</h4>
                        <p className="text-sm text-neutral-400 mb-4">
                            Upload a CSV file with the following columns: username, name, email, password, role
                        </p>
                        <button
                            onClick={downloadCSVTemplate}
                            className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded font-bold"
                        >
                            <Download className="w-4 h-4" />
                            Download CSV Template
                        </button>
                    </div>

                    <div>
                        <label className="block text-sm font-bold mb-2">Upload CSV File</label>
                        <input
                            type="file"
                            accept=".csv"
                            onChange={handleBatchUpload}
                            className="w-full bg-neutral-700 border border-neutral-600 rounded px-3 py-2 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-purple-600 file:text-white hover:file:bg-purple-500"
                        />
                    </div>

                    <div className="bg-blue-900/20 border border-blue-700/50 rounded p-4 text-sm">
                        <p className="font-bold mb-2">CSV Example:</p>
                        <pre className="text-xs text-neutral-300">
{`username,name,email,password,role
john_doe,John Doe,john@example.com,password123,user
jane_admin,Jane Smith,jane@example.com,admin456,admin`}
                        </pre>
                    </div>
                </div>
            </div>
        );
    }

    // Main User List View
    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">User Management</h3>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowBatchUpload(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm font-bold"
                    >
                        <Upload className="w-4 h-4" />
                        Batch Upload
                    </button>
                    <button
                        onClick={() => setShowCreateForm(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold"
                    >
                        <Plus className="w-4 h-4" />
                        Create User
                    </button>
                </div>
            </div>

            <div className="text-sm text-neutral-400">{users.length} total users</div>

            <div className="space-y-2">
                {users.map(user => (
                    <div key={user.id} className="p-4 bg-neutral-800 border border-neutral-700 rounded-lg">
                        <div className="flex justify-between items-center">
                            <div>
                                <div className="font-bold flex items-center gap-2">
                                    {user.username}
                                    {user.name && <span className="text-neutral-500 font-normal text-sm">({user.name})</span>}
                                    {user.role === 'admin' && (
                                        <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded">Admin</span>
                                    )}
                                </div>
                                <div className="text-xs text-neutral-400 mt-1">
                                    {user.email} • Joined {new Date(user.created_at).toLocaleDateString()}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => openEditForm(user)}
                                    className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleToggleRole(user.id, user.role)}
                                    className="text-xs bg-neutral-700 px-3 py-1.5 rounded hover:bg-neutral-600"
                                >
                                    {user.role === 'admin' ? 'Demote' : 'Make Admin'}
                                </button>
                                <button
                                    onClick={() => handleDeleteUser(user.id)}
                                    className="text-xs bg-red-900/30 text-red-400 px-3 py-1.5 rounded hover:bg-red-900/50"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Lab Investigation Selector Component
function LabInvestigationSelector({ caseData, onAddLab, patientGender, showAddByGroup = false }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [groups, setGroups] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [addingGroup, setAddingGroup] = useState(false);

    // Load groups on mount
    useEffect(() => {
        const token = AuthService.getToken();
        fetch('/api/labs/groups', {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(data => setGroups(data.groups || []))
            .catch(err => console.error('Failed to load groups:', err));
    }, []);

    // Search labs
    useEffect(() => {
        if (!searchQuery || searchQuery.trim().length < 2) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        const token = AuthService.getToken();
        fetch(`/api/labs/search?q=${encodeURIComponent(searchQuery)}&limit=20`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(data => {
                setSearchResults(data.results || []);
                setIsSearching(false);
            })
            .catch(err => {
                console.error('Search failed:', err);
                setIsSearching(false);
            });
    }, [searchQuery]);

    const handleAddLab = (testGroup) => {
        // testGroup is array of gender variations
        // Find gender-specific test or first available
        let selectedTest = testGroup.find(t => t.category === patientGender);
        if (!selectedTest) {
            selectedTest = testGroup.find(t => t.category === 'Both');
        }
        if (!selectedTest) {
            selectedTest = testGroup[0];
        }

        // Get random normal value as default
        const normalValue = selectedTest.normal_samples && selectedTest.normal_samples.length > 0
            ? selectedTest.normal_samples[Math.floor(Math.random() * selectedTest.normal_samples.length)]
            : (selectedTest.min_value + selectedTest.max_value) / 2;

        const labData = {
            test_name: selectedTest.test_name,
            test_group: selectedTest.group,
            gender_category: selectedTest.category,
            min_value: selectedTest.min_value,
            max_value: selectedTest.max_value,
            current_value: normalValue,
            unit: selectedTest.unit,
            normal_samples: selectedTest.normal_samples,
            is_abnormal: false,
            turnaround_minutes: 30
        };

        onAddLab(labData);
        setSearchQuery('');
        setSearchResults([]);
    };

    const handleAddByGroup = async () => {
        if (selectedGroup === 'all') {
            alert('Please select a specific group to add');
            return;
        }

        setAddingGroup(true);
        try {
            const token = AuthService.getToken();
            const response = await fetch(`/api/labs/group/${encodeURIComponent(selectedGroup)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                const tests = data.tests || [];
                
                // Group tests by name
                const grouped = {};
                tests.forEach(test => {
                    if (!grouped[test.test_name]) {
                        grouped[test.test_name] = [];
                    }
                    grouped[test.test_name].push(test);
                });

                // Add each unique test
                Object.values(grouped).forEach(testGroup => {
                    handleAddLab(testGroup);
                });

                alert(`Added ${Object.keys(grouped).length} tests from ${selectedGroup}`);
            }
        } catch (error) {
            console.error('Failed to add group:', error);
            alert('Failed to add tests by group');
        } finally {
            setAddingGroup(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <div className="flex-1">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search lab tests (e.g., glucose, hemoglobin, sodium)..."
                        className="input-dark w-full"
                    />
                </div>
                <select
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    className="input-dark"
                >
                    <option value="all">All Groups</option>
                    {groups.map(group => (
                        <option key={group} value={group}>{group}</option>
                    ))}
                </select>
                {showAddByGroup && (
                    <button
                        onClick={handleAddByGroup}
                        disabled={selectedGroup === 'all' || addingGroup}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white rounded font-bold text-sm whitespace-nowrap flex items-center gap-2"
                        title="Add all tests from selected group"
                    >
                        {addingGroup ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Adding...
                            </>
                        ) : (
                            <>
                                <Plus className="w-4 h-4" />
                                Add Group
                            </>
                        )}
                    </button>
                )}
            </div>

            {isSearching && (
                <div className="text-center py-4 text-neutral-500">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </div>
            )}

            {searchResults.length > 0 && (
                <div className="bg-neutral-900 border border-neutral-700 rounded max-h-64 overflow-y-auto">
                    {searchResults
                        .filter(testGroup => selectedGroup === 'all' || testGroup[0].group === selectedGroup)
                        .map((testGroup, idx) => {
                            const test = testGroup[0];
                            return (
                                <div
                                    key={idx}
                                    className="p-3 border-b border-neutral-800 hover:bg-neutral-800 cursor-pointer transition-colors"
                                    onClick={() => handleAddLab(testGroup)}
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-bold text-sm">{test.test_name}</div>
                                            <div className="text-xs text-neutral-400">
                                                {test.group} • {testGroup.length} variation(s)
                                            </div>
                                        </div>
                                        <Plus className="w-4 h-4 text-green-400" />
                                    </div>
                                </div>
                            );
                        })}
                </div>
            )}

            {searchQuery && !isSearching && searchResults.length === 0 && (
                <div className="text-center py-4 text-neutral-500 text-sm">
                    No tests found matching "{searchQuery}"
                </div>
            )}
        </div>
    );
}

// Sub-component for the Wizard to keep code clean
function CaseWizard({ caseData, setCaseData, onSave, onCancel, hasUnsavedChanges, lastSavedAt }) {
    const [step, setStep] = useState(1);
    const [uploading, setUploading] = useState(false);

    // Format last saved time
    const formatLastSaved = () => {
        if (!lastSavedAt) return null;
        const now = new Date();
        const diff = Math.floor((now - lastSavedAt) / 1000);
        if (diff < 5) return 'Just now';
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return lastSavedAt.toLocaleTimeString();
    };

    // Helper to update deeply nested config
    const updateConfig = (key, value) => {
        setCaseData(prev => ({
            ...prev,
            config: { ...prev.config, [key]: value }
        }));
    };

    const handlePhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('photo', file);

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.imageUrl) {
                setCaseData(prev => ({ ...prev, image_url: data.imageUrl }));
            }
        } catch (err) {
            console.error("Upload failed", err);
            alert("Failed to upload photo");
        } finally {
            setUploading(false);
        }
    };

    const updateDemographics = (key, value) => {
        setCaseData(prev => ({
            ...prev,
            config: {
                ...prev.config,
                demographics: { ...(prev.config?.demographics || {}), [key]: value }
            }
        }));
    };

    const applyPersonaDefaults = () => {
        setCaseData(prev => ({
            ...prev,
            name: 'Angina Pectoris - 62M',
            description: 'A 62-year-old male presenting with classic angina pectoris. Known history of hypertension and hyperlipidemia. Experiencing substernal chest pressure with radiation to the left arm, triggered by exertion and relieved by rest. Risk factors include smoking history (30 pack-years, quit 5 years ago) and family history of coronary artery disease.',
            system_prompt: `You are Richard Thompson, a 62-year-old male accountant presenting with chest pain. 

CURRENT SYMPTOMS:
- Substernal chest pressure (6/10 severity), feels like "squeezing" or "tightness"
- Started 2 hours ago after climbing stairs at work
- Radiates to left arm and jaw
- Associated with mild shortness of breath and sweating
- Partially relieved by rest

MEDICAL HISTORY:
- Hypertension (controlled on amlodipine 5mg daily)
- Hyperlipidemia (on atorvastatin 40mg daily)
- No diabetes
- Previous episodes of similar chest pain over past 3 months, but less severe
- Smoking: 30 pack-year history, quit 5 years ago
- Family history: Father had MI at age 58

CURRENT MEDICATIONS:
- Amlodipine 5mg once daily
- Atorvastatin 40mg once daily
- Aspirin 81mg daily

ALLERGIES: No known drug allergies

SOCIAL HISTORY:
- Occupation: Accountant (sedentary job)
- Lives with wife, two adult children
- Occasional alcohol (1-2 drinks per week)
- No current tobacco or recreational drug use

PERSONALITY: You are anxious but cooperative. You're worried this might be a heart attack because of your father's history. You answer questions directly but sometimes ramble when nervous. You appreciate clear explanations and want to understand what's happening.`,
            config: {
                ...prev.config,
                persona_type: 'Standard Simulated Patient',
                constraints: 'Stick to the provided history. If asked about tests or values, say you don\'t remember exact numbers unless specifically mentioned. Express appropriate concern about cardiac symptoms. Do not volunteer diagnosis - let the doctor make conclusions.',
                greeting: 'Doctor, I\'ve been having this pressure in my chest... it\'s really worrying me.',
                patient_name: 'Richard Thompson',
                demographics: { 
                    age: 62, 
                    gender: 'Male',
                    weight: '85 kg',
                    height: '175 cm',
                    bmi: '27.8'
                },
                // Initial vitals - stable angina
                hr: 88,
                spo2: 97,
                rr: 18,
                temp: 36.8,
                sbp: 145,
                dbp: 88,
                etco2: 38,
                // Clinical records for angina pectoris
                clinical_records: {
                    chief_complaint: 'Chest pain and pressure for 2 hours',
                    present_illness: `Patient is a 62-year-old male with history of hypertension and hyperlipidemia presenting with substernal chest pressure that began 2 hours ago after climbing 3 flights of stairs at work. Describes sensation as "squeezing" or "tight band around chest" rated 6/10 severity. Pain radiates to left arm and occasionally to jaw. Associated with diaphoresis and mild dyspnea. Reports similar but milder episodes over past 3 months, typically triggered by exertion and relieved by rest within 5-10 minutes. Today's episode more severe and lasted 20 minutes before partially improving with rest. Denies nausea, vomiting, palpitations, syncope, or loss of consciousness.`,
                    risk_factors: [
                        'Hypertension (on treatment)',
                        'Hyperlipidemia (on statin)',
                        'Former smoker (30 pack-years, quit 5 years ago)',
                        'Family history of premature CAD (father MI at 58)',
                        'Male gender',
                        'Age > 60',
                        'Sedentary lifestyle',
                        'Overweight (BMI 27.8)'
                    ],
                    physical_exam: {
                        general: 'Alert, oriented, appears anxious, diaphoretic',
                        cardiovascular: 'Regular rate and rhythm, no murmurs, rubs, or gallops. Normal S1/S2. No JVD. Peripheral pulses 2+ and equal bilaterally.',
                        respiratory: 'Clear to auscultation bilaterally, no wheezes or crackles',
                        abdomen: 'Soft, non-tender, no organomegaly',
                        extremities: 'No edema, no cyanosis'
                    },
                    differential_diagnosis: [
                        'Stable angina pectoris (most likely)',
                        'Unstable angina',
                        'NSTEMI',
                        'GERD',
                        'Musculoskeletal chest pain',
                        'Anxiety/panic attack'
                    ],
                    management_plan: [
                        'Obtain 12-lead ECG',
                        'Cardiac biomarkers (Troponin I/T, CK-MB)',
                        'Complete metabolic panel',
                        'Lipid panel',
                        'CBC',
                        'Chest X-ray',
                        'Consider stress test if biomarkers negative',
                        'Optimize anti-anginal medications',
                        'Cardiology consultation if indicated'
                    ]
                }
            }
        }));
    };

    const WIZARD_STEPS = [
        { num: 1, title: 'Persona', icon: '🎭' },
        { num: 2, title: 'Details', icon: '📋' },
        { num: 3, title: 'Vitals', icon: '💓' },
        { num: 4, title: 'Scenario', icon: '📈' },
        { num: 5, title: 'Labs', icon: '🧪' },
        { num: 6, title: 'Records', icon: '📄' }
    ];

    return (
        <div className="flex flex-col h-full max-w-3xl animate-in fade-in slide-in-from-right-4">

            {/* Wizard Header with Step Navigation */}
            <div className="border-b border-neutral-800 pb-4 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-xl font-bold text-white">Case Configuration</h3>
                        <div className="flex items-center gap-3">
                            <p className="text-xs text-neutral-500">{caseData.name || 'New Case'}</p>
                            {lastSavedAt && (
                                <span className="text-[10px] text-green-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                                    Auto-saved {formatLastSaved()}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onSave}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm font-bold rounded-lg flex items-center gap-1"
                        >
                            <Save className="w-4 h-4" />
                            Save
                        </button>
                        <button
                            onClick={onCancel}
                            className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-white text-sm font-bold rounded-lg flex items-center gap-1"
                        >
                            <X className="w-4 h-4" />
                            Exit
                        </button>
                    </div>
                </div>

                {/* Clickable Step Navigation */}
                <div className="flex gap-1">
                    {WIZARD_STEPS.map((s, idx) => (
                        <button
                            key={s.num}
                            onClick={async () => {
                                // Auto-save before switching
                                await onSave();
                                setStep(s.num);
                            }}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                                step === s.num
                                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                                    : step > s.num
                                    ? 'bg-green-900/30 text-green-300 hover:bg-green-900/50 border border-green-700/50'
                                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white'
                            }`}
                        >
                            <span>{s.icon}</span>
                            <span className="hidden sm:inline">{s.title}</span>
                            <span className="sm:hidden">{s.num}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2">

                {/* STEP 1: PERSONA */}
                {step === 1 && (
                    <div className="space-y-6">
                        <div className="flex justify-between items-end">
                            <h4 className="text-lg font-bold text-purple-400">1. Persona & Behavior</h4>
                            <button onClick={applyPersonaDefaults} className="text-xs bg-neutral-800 hover:bg-neutral-700 px-3 py-1 rounded text-purple-300">
                                Load Standard Defaults
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="label-xs">Persona Type</label>
                                <select
                                    value={caseData.config?.persona_type || 'Standard Simulated Patient'}
                                    onChange={e => updateConfig('persona_type', e.target.value)}
                                    className="input-dark"
                                >
                                    <option>Standard Simulated Patient</option>
                                    <option>Difficult/Angry Patient</option>
                                    <option>Pediatric Proxy (Parent)</option>
                                </select>
                            </div>
                            <div>
                                <label className="label-xs">Initial Greeting</label>
                                <input
                                    type="text"
                                    value={caseData.config?.greeting || ''}
                                    onChange={e => updateConfig('greeting', e.target.value)}
                                    className="input-dark"
                                    placeholder="e.g. Doctor, I don't feel well..."
                                />
                            </div>
                        </div>

                        <div>
                            <label className="label-xs">Behavioral Constraints</label>
                            <textarea
                                value={caseData.config?.constraints || ''}
                                onChange={e => updateConfig('constraints', e.target.value)}
                                className="input-dark h-20"
                                placeholder="e.g. Only speak English. Do not reveal diagnosis."
                            />
                        </div>

                        <div>
                            <label className="label-xs">System Prompt (Master Instruction)</label>
                            <textarea
                                value={caseData.system_prompt || ''}
                                onChange={e => setCaseData({ ...caseData, system_prompt: e.target.value })}
                                className="input-dark h-40 font-mono text-xs"
                                placeholder="You are John Doe..."
                            />
                        </div>
                    </div>
                )}

                {/* STEP 2: DETAILS */}
                {step === 2 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-purple-400">2. Case Details & Vitals</h4>

                        <div className="grid grid-cols-3 gap-6">
                            {/* Avatar Preview */}
                            <div className="col-span-1">
                                <label className="label-xs">Patient Avatar</label>
                                <div className="aspect-square bg-neutral-800 rounded-lg border border-neutral-700 overflow-hidden flex flex-col items-center justify-center relative group">
                                    {uploading ? (
                                        <div className="flex flex-col items-center gap-2">
                                            <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                                            <p className="text-[10px] text-neutral-500">Uploading...</p>
                                        </div>
                                    ) : caseData.image_url ? (
                                        <img src={caseData.image_url} alt="Avatar" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="text-center p-4">
                                            <Image className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
                                            <p className="text-[10px] text-neutral-500">No Image</p>
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                        <label className="text-[10px] font-bold bg-purple-600 hover:bg-purple-500 px-3 py-1.5 rounded cursor-pointer flex items-center gap-2">
                                            <Upload className="w-3 h-3" /> Upload Photo
                                            <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
                                        </label>
                                        <button
                                            onClick={() => alert("Ask the AI to 'Generate Avatar' based on the summary.")}
                                            className="text-[10px] font-bold bg-neutral-700 hover:bg-neutral-600 px-3 py-1.5 rounded flex items-center gap-2"
                                        >
                                            <Plus className="w-3 h-3" /> AI Generate
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="col-span-2 space-y-4">
                                <div>
                                    <label className="label-xs">Case Title (Internal)</label>
                                    <input
                                        type="text"
                                        value={caseData.name}
                                        onChange={e => setCaseData({ ...caseData, name: e.target.value })}
                                        className="input-dark"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Patient Name (Display)</label>
                                    <input
                                        type="text"
                                        value={caseData.config?.patient_name || ''}
                                        onChange={e => updateConfig('patient_name', e.target.value)}
                                        className="input-dark"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="label-xs">Age</label>
                                <input type="number" className="input-dark"
                                    value={caseData.config?.demographics?.age || ''}
                                    onChange={e => updateDemographics('age', e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="label-xs">Gender</label>
                                <select className="input-dark"
                                    value={caseData.config?.demographics?.gender || ''}
                                    onChange={e => updateDemographics('gender', e.target.value)}
                                >
                                    <option value="">Select</option>
                                    <option>Male</option>
                                    <option>Female</option>
                                    <option>Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="label-xs">Weight (kg)</label>
                                <input type="text" className="input-dark"
                                    value={caseData.config?.demographics?.weight || ''}
                                    onChange={e => updateDemographics('weight', e.target.value)}
                                    placeholder="e.g. 70 kg"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="label-xs">Case Summary (Description)</label>
                            <textarea
                                value={caseData.description || ''}
                                onChange={e => setCaseData({ ...caseData, description: e.target.value })}
                                className="input-dark h-24"
                                placeholder="Brief summary of the case..."
                            />
                            <p className="text-[10px] text-neutral-500 mt-1 italic">This summary will be used by the AI to generate the visual avatar.</p>
                        </div>
                    </div>
                )}

                {/* STEP 3: VITALS & ALARMS */}
                {step === 3 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-purple-400">3. Initial Vitals & Alarms</h4>
                        <p className="text-xs text-neutral-500">Configure the patient's baseline vital signs and alarm thresholds. These will be applied when the case loads.</p>

                        {/* Rhythm Selection */}
                        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                            <h5 className="text-sm font-bold text-white mb-3">ECG Rhythm</h5>
                            <div className="grid grid-cols-3 gap-2">
                                {['NSR', 'Sinus Tachycardia', 'Sinus Bradycardia', 'Atrial Fibrillation', 'Atrial Flutter', 'SVT', 'Ventricular Tachycardia', 'Ventricular Fibrillation', 'Asystole'].map(rhythm => (
                                    <button
                                        key={rhythm}
                                        onClick={() => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), rhythm })}
                                        className={`px-3 py-2 rounded text-xs font-bold transition-all ${
                                            (caseData.config?.initialVitals?.rhythm || 'NSR') === rhythm
                                                ? 'bg-purple-600 text-white'
                                                : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                                        }`}
                                    >
                                        {rhythm}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Vital Signs */}
                        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                            <h5 className="text-sm font-bold text-white mb-3">Vital Signs</h5>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label-xs">Heart Rate (bpm)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.hr ?? 80}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), hr: parseInt(e.target.value) || 80 })}
                                        className="input-dark"
                                        min="20" max="250"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">SpO2 (%)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.spo2 ?? 98}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), spo2: parseInt(e.target.value) || 98 })}
                                        className="input-dark"
                                        min="50" max="100"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Respiratory Rate (/min)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.rr ?? 16}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), rr: parseInt(e.target.value) || 16 })}
                                        className="input-dark"
                                        min="4" max="60"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">Temperature (°C)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={caseData.config?.initialVitals?.temp ?? 37.0}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), temp: parseFloat(e.target.value) || 37.0 })}
                                        className="input-dark"
                                        min="32" max="42"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">BP Systolic (mmHg)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.bpSys ?? 120}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), bpSys: parseInt(e.target.value) || 120 })}
                                        className="input-dark"
                                        min="40" max="300"
                                    />
                                </div>
                                <div>
                                    <label className="label-xs">BP Diastolic (mmHg)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.bpDia ?? 80}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), bpDia: parseInt(e.target.value) || 80 })}
                                        className="input-dark"
                                        min="20" max="200"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="label-xs">EtCO2 (mmHg)</label>
                                    <input
                                        type="number"
                                        value={caseData.config?.initialVitals?.etco2 ?? 38}
                                        onChange={e => updateConfig('initialVitals', { ...(caseData.config?.initialVitals || {}), etco2: parseInt(e.target.value) || 38 })}
                                        className="input-dark"
                                        min="0" max="100"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* ECG Conditions */}
                        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                            <h5 className="text-sm font-bold text-white mb-3">ECG Conditions</h5>
                            <div className="grid grid-cols-2 gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={caseData.config?.initialVitals?.conditions?.pvc || false}
                                        onChange={e => updateConfig('initialVitals', {
                                            ...(caseData.config?.initialVitals || {}),
                                            conditions: { ...(caseData.config?.initialVitals?.conditions || {}), pvc: e.target.checked }
                                        })}
                                        className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                    />
                                    <span className="text-sm text-neutral-300">PVCs (Premature Ventricular)</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={caseData.config?.initialVitals?.conditions?.wideQRS || false}
                                        onChange={e => updateConfig('initialVitals', {
                                            ...(caseData.config?.initialVitals || {}),
                                            conditions: { ...(caseData.config?.initialVitals?.conditions || {}), wideQRS: e.target.checked }
                                        })}
                                        className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                    />
                                    <span className="text-sm text-neutral-300">Wide QRS</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={caseData.config?.initialVitals?.conditions?.tInv || false}
                                        onChange={e => updateConfig('initialVitals', {
                                            ...(caseData.config?.initialVitals || {}),
                                            conditions: { ...(caseData.config?.initialVitals?.conditions || {}), tInv: e.target.checked }
                                        })}
                                        className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                    />
                                    <span className="text-sm text-neutral-300">T-Wave Inversion</span>
                                </label>
                                <div>
                                    <label className="label-xs">ST Elevation (0-5)</label>
                                    <input
                                        type="range"
                                        min="0" max="5" step="1"
                                        value={caseData.config?.initialVitals?.conditions?.stElev || 0}
                                        onChange={e => updateConfig('initialVitals', {
                                            ...(caseData.config?.initialVitals || {}),
                                            conditions: { ...(caseData.config?.initialVitals?.conditions || {}), stElev: parseInt(e.target.value) }
                                        })}
                                        className="w-full"
                                    />
                                    <div className="text-xs text-neutral-400 text-center">{caseData.config?.initialVitals?.conditions?.stElev || 0}</div>
                                </div>
                            </div>
                        </div>

                        {/* Alarm Thresholds */}
                        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
                            <h5 className="text-sm font-bold text-white mb-3">Alarm Thresholds</h5>
                            <p className="text-xs text-neutral-500 mb-4">Set alarm limits for this case. Leave empty to use system defaults.</p>

                            <div className="space-y-3">
                                {[
                                    { key: 'hr', label: 'Heart Rate', unit: 'bpm', defaultLow: 50, defaultHigh: 120 },
                                    { key: 'spo2', label: 'SpO2', unit: '%', defaultLow: 90, defaultHigh: null },
                                    { key: 'rr', label: 'Resp Rate', unit: '/min', defaultLow: 8, defaultHigh: 30 },
                                    { key: 'bpSys', label: 'BP Systolic', unit: 'mmHg', defaultLow: 90, defaultHigh: 180 },
                                    { key: 'bpDia', label: 'BP Diastolic', unit: 'mmHg', defaultLow: 50, defaultHigh: 110 },
                                    { key: 'temp', label: 'Temperature', unit: '°C', defaultLow: 36, defaultHigh: 38.5 },
                                    { key: 'etco2', label: 'EtCO2', unit: 'mmHg', defaultLow: 30, defaultHigh: 50 }
                                ].map(vital => (
                                    <div key={vital.key} className="grid grid-cols-4 gap-2 items-center">
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={caseData.config?.alarms?.[vital.key]?.enabled ?? true}
                                                onChange={e => updateConfig('alarms', {
                                                    ...(caseData.config?.alarms || {}),
                                                    [vital.key]: { ...(caseData.config?.alarms?.[vital.key] || {}), enabled: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded bg-neutral-700 border-neutral-600"
                                            />
                                            <span className="text-xs text-neutral-300">{vital.label}</span>
                                        </label>
                                        <div>
                                            <input
                                                type="number"
                                                placeholder={`Low (${vital.defaultLow || '-'})`}
                                                value={caseData.config?.alarms?.[vital.key]?.low ?? ''}
                                                onChange={e => updateConfig('alarms', {
                                                    ...(caseData.config?.alarms || {}),
                                                    [vital.key]: { ...(caseData.config?.alarms?.[vital.key] || {}), low: e.target.value ? parseFloat(e.target.value) : null }
                                                })}
                                                className="input-dark text-xs"
                                            />
                                        </div>
                                        <div>
                                            <input
                                                type="number"
                                                placeholder={`High (${vital.defaultHigh || '-'})`}
                                                value={caseData.config?.alarms?.[vital.key]?.high ?? ''}
                                                onChange={e => updateConfig('alarms', {
                                                    ...(caseData.config?.alarms || {}),
                                                    [vital.key]: { ...(caseData.config?.alarms?.[vital.key] || {}), high: e.target.value ? parseFloat(e.target.value) : null }
                                                })}
                                                className="input-dark text-xs"
                                            />
                                        </div>
                                        <span className="text-xs text-neutral-500">{vital.unit}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 4: SCENARIO (OPTIONAL) */}
                {step === 4 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-purple-400">4. Progression Scenario (Optional)</h4>
                        <p className="text-xs text-neutral-500">Add automatic deterioration or improvement over time. Choose from quick templates or browse the full repository.</p>
                        
                        {/* Scenario Selector */}
                        <div className="space-y-4">
                            {/* Repository Browser */}
                            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <h5 className="text-sm font-bold text-blue-300">Scenario Repository</h5>
                                        <p className="text-xs text-neutral-400">Browse reusable scenarios from database</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            // Switch to scenarios tab
                                            setActiveTab('scenarios');
                                        }}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold flex items-center gap-2"
                                    >
                                        <Database className="w-4 h-4" />
                                        Browse Repository
                                    </button>
                                </div>
                                {caseData.scenario_from_repository && (
                                    <div className="mt-3 bg-green-900/20 border border-green-700/50 rounded p-3">
                                        <p className="text-xs text-green-300">
                                            ✓ Using scenario from repository: <strong>{caseData.scenario_from_repository.name}</strong>
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* OR divider */}
                            <div className="flex items-center gap-4 text-neutral-500 text-xs">
                                <div className="flex-1 border-t border-neutral-700"></div>
                                <span>OR USE QUICK TEMPLATE</span>
                                <div className="flex-1 border-t border-neutral-700"></div>
                            </div>

                            <div>
                                <label className="label-xs">Quick Templates</label>
                                <select
                                    value={caseData.scenario_template || 'none'}
                                    onChange={(e) => {
                                        const templateName = e.target.value;
                                        if (templateName === 'none') {
                                            // Remove scenario
                                            setCaseData(prev => ({ ...prev, scenario_template: null, scenario: null, scenario_from_repository: null }));
                                        } else {
                                            // Set template name (will be built on duration change)
                                            setCaseData(prev => ({ 
                                                ...prev, 
                                                scenario_template: templateName,
                                                scenario_duration: SCENARIO_TEMPLATES[templateName]?.duration || 30,
                                                scenario_from_repository: null
                                            }));
                                        }
                                    }}
                                    className="input-dark"
                                >
                                    <option value="none">No Scenario (Static Patient)</option>
                                    {Object.entries(SCENARIO_TEMPLATES).map(([key, template]) => (
                                        <option key={key} value={key}>
                                            {template.name} - {template.description}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-xs text-neutral-500 mt-1">
                                    Built-in templates (not from database)
                                </p>
                            </div>

                            {/* Duration Selector */}
                            {caseData.scenario_template && caseData.scenario_template !== 'none' && (
                                <div>
                                    <label className="label-xs">Progression Duration</label>
                                    <select
                                        value={caseData.scenario_duration || 30}
                                        onChange={(e) => {
                                            const duration = parseInt(e.target.value);
                                            const template = SCENARIO_TEMPLATES[caseData.scenario_template];
                                            if (template) {
                                                const scaledScenario = scaleScenarioTimeline(template, duration);
                                                setCaseData(prev => ({ 
                                                    ...prev, 
                                                    scenario_duration: duration,
                                                    scenario: scaledScenario
                                                }));
                                            }
                                        }}
                                        className="input-dark"
                                    >
                                        <option value="5">Very Fast (5 minutes)</option>
                                        <option value="10">Fast (10 minutes)</option>
                                        <option value="15">15 minutes</option>
                                        <option value="20">20 minutes</option>
                                        <option value="30">Standard (30 minutes)</option>
                                        <option value="45">45 minutes</option>
                                        <option value="60">1 hour</option>
                                        <option value="90">1.5 hours</option>
                                        <option value="120">2 hours</option>
                                    </select>
                                    <p className="text-xs text-neutral-500 mt-1">
                                        Patient will progress from initial state to late stage over {caseData.scenario_duration} minutes.
                                    </p>
                                </div>
                            )}

                            {/* Preview */}
                            {caseData.scenario?.timeline && (
                                <div className="mt-4 bg-neutral-800 border border-neutral-700 rounded p-4">
                                    <h5 className="text-sm font-bold mb-2 text-purple-300">Timeline Preview</h5>
                                    <div className="space-y-2 text-xs">
                                        {caseData.scenario.timeline.map((step, idx) => (
                                            <div key={idx} className="flex items-start gap-3 text-neutral-300">
                                                <span className="text-purple-400 font-mono min-w-[60px]">
                                                    {Math.floor(step.time / 60)}:{String(step.time % 60).padStart(2, '0')}
                                                </span>
                                                <span>{step.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Auto-start option */}
                            {caseData.scenario && (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="autostart-scenario"
                                        checked={caseData.scenario?.autoStart || false}
                                        onChange={(e) => {
                                            setCaseData(prev => ({
                                                ...prev,
                                                scenario: { ...prev.scenario, autoStart: e.target.checked }
                                            }));
                                        }}
                                        className="w-4 h-4"
                                    />
                                    <label htmlFor="autostart-scenario" className="text-sm text-neutral-300">
                                        Auto-start scenario when case loads (otherwise instructor must trigger manually)
                                    </label>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* STEP 5: LABORATORY INVESTIGATIONS */}
                {step === 5 && (
                    <div className="space-y-6">
                        <h4 className="text-lg font-bold text-purple-400">5. Laboratory Investigations</h4>
                        <p className="text-xs text-neutral-500">
                            Configure lab tests with smart search, clinical panel templates, and visual value editors.
                        </p>

                        <LabInvestigationEditor
                            caseData={caseData}
                            setCaseData={setCaseData}
                            patientGender={caseData.config?.demographics?.gender}
                        />
                    </div>
                )}

                {/* STEP 6: CLINICAL PAGES */}
                {step === 6 && (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <h4 className="text-lg font-bold text-purple-400">6. Clinical Records</h4>
                            <button
                                onClick={() => {
                                    const newPages = [...(caseData.config?.pages || [])];
                                    newPages.push({ title: 'New Section', content: '' });
                                    updateConfig('pages', newPages);
                                }}
                                className="btn-secondary text-xs"
                            >
                                <Plus className="w-3 h-3 mr-1" /> Add Page
                            </button>
                        </div>
                        <p className="text-xs text-neutral-500">These pages are hidden context for the AI and can be requested by the student (e.g. 'Show me the ECG').</p>

                        <div className="space-y-4">
                            {(caseData.config?.pages || []).map((page, idx) => (
                                <div key={idx} className="p-4 bg-neutral-800 border border-neutral-700 rounded-lg animate-in slide-in-from-bottom-2">
                                    <div className="flex justify-between mb-2">
                                        <input
                                            type="text"
                                            value={page.title}
                                            onChange={e => {
                                                const newPages = [...caseData.config.pages];
                                                newPages[idx].title = e.target.value;
                                                updateConfig('pages', newPages);
                                            }}
                                            className="bg-transparent border-b border-neutral-600 font-bold focus:border-purple-500 outline-none text-sm"
                                            placeholder="Page Title (e.g. History)"
                                        />
                                        <button
                                            onClick={() => {
                                                const newPages = caseData.config.pages.filter((_, i) => i !== idx);
                                                updateConfig('pages', newPages);
                                            }}
                                            className="text-neutral-500 hover:text-red-400"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <textarea
                                        rows={4}
                                        value={page.content}
                                        onChange={e => {
                                            const newPages = [...caseData.config.pages];
                                            newPages[idx].content = e.target.value;
                                            updateConfig('pages', newPages);
                                        }}
                                        className="input-dark text-xs font-mono"
                                        placeholder="Content for the AI to know..."
                                    />
                                </div>
                            ))}
                            {(caseData.config?.pages || []).length === 0 && (
                                <div className="text-center py-10 bg-neutral-800/50 rounded-lg border border-dashed border-neutral-700 text-neutral-500">
                                    No clinical pages added yet.
                                </div>
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* Footer Actions */}
            <div className="pt-4 border-t border-neutral-800 flex justify-between mt-4">
                <button onClick={onCancel} className="text-neutral-500 hover:text-white px-4">Cancel</button>
                <div className="flex gap-2">
                    {step > 1 && (
                        <button 
                            onClick={async () => {
                                // Auto-save before going back
                                await onSave();
                                setStep(s => s - 1);
                            }} 
                            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded font-bold text-sm"
                        >
                            Back
                        </button>
                    )}
                    
                    {/* Save Progress button on all steps except last */}
                    {step < 5 && (
                        <button 
                            onClick={onSave} 
                            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded font-bold text-sm flex items-center gap-2 shadow-lg shadow-blue-900/20"
                        >
                            <Save className="w-4 h-4" /> Save Progress
                        </button>
                    )}
                    
                    {step < 5 ? (
                        <button 
                            onClick={async () => {
                                // Auto-save before moving forward
                                await onSave();
                                setStep(s => s + 1);
                            }} 
                            className="px-6 py-2 bg-purple-600 hover:bg-purple-500 rounded font-bold text-sm"
                        >
                            Next
                        </button>
                    ) : (
                        <button 
                            onClick={async () => {
                                await onSave();
                                // Close wizard after final save
                                setTimeout(() => onCancel(), 500);
                            }} 
                            className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded font-bold text-sm shadow-lg shadow-green-900/20 flex items-center gap-2"
                        >
                            <Save className="w-4 h-4" /> Save & Finish
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
