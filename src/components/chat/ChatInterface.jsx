import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User as UserIcon, Loader2, Stethoscope } from 'lucide-react';
import { LLMService } from '../../services/llmService';
import { useAuth } from '../../contexts/AuthContext';
import { AuthService } from '../../services/authService';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';

export default function ChatInterface({ activeCase, onSessionStart, restoredSessionId }) {
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [messagesLoaded, setMessagesLoaded] = useState(false);
    const messagesEndRef = useRef(null);
    const { user } = useAuth();
    const [messages, setMessages] = useState([]);
    const [chatSettings, setChatSettings] = useState({
        doctorName: 'Dr. Carmen',
        doctorAvatar: ''
    });

    // Load chat settings (doctor name/avatar)
    useEffect(() => {
        const loadChatSettings = async () => {
            try {
                const token = AuthService.getToken();
                const res = await fetch('/api/platform-settings/chat', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setChatSettings(data);
                }
            } catch (err) {
                console.error('Failed to load chat settings:', err);
            }
        };
        loadChatSettings();
    }, []);

    // Load chat history from database or localStorage
    useEffect(() => {
        const loadChatHistory = async () => {
            if (!activeCase) return;

            // Try localStorage first (faster)
            try {
                const savedChat = localStorage.getItem('rohy_chat_history');
                if (savedChat) {
                    const parsed = JSON.parse(savedChat);
                    if (parsed.caseId === activeCase.id && parsed.messages?.length > 0) {
                        console.log('Restored chat from localStorage:', parsed.messages.length, 'messages');
                        setMessages(parsed.messages);
                        setMessagesLoaded(true);
                        return;
                    }
                }
            } catch (e) {
                console.warn('Failed to parse localStorage chat:', e);
            }

            // If restoring a session, fetch from database
            if (restoredSessionId) {
                try {
                    const token = AuthService.getToken();
                    const res = await fetch(`/api/interactions/${restoredSessionId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.interactions?.length > 0) {
                            const chatMessages = data.interactions.map(i => ({
                                role: i.role,
                                content: i.content
                            }));
                            console.log('Restored chat from database:', chatMessages.length, 'messages');
                            setMessages(chatMessages);
                            // Also save to localStorage for faster next load
                            localStorage.setItem('rohy_chat_history', JSON.stringify({
                                caseId: activeCase.id,
                                messages: chatMessages,
                                timestamp: Date.now()
                            }));
                        }
                    }
                } catch (e) {
                    console.error('Failed to fetch chat history from database:', e);
                }
            }
            setMessagesLoaded(true);
        };

        loadChatHistory();
    }, [activeCase, restoredSessionId]);

    // Save messages to localStorage whenever they change
    useEffect(() => {
        if (activeCase && messages.length > 0 && messagesLoaded) {
            localStorage.setItem('rohy_chat_history', JSON.stringify({
                caseId: activeCase.id,
                messages,
                timestamp: Date.now()
            }));
        }
    }, [messages, activeCase, messagesLoaded]);

    // Initialize Session when Active Case Changes
    useEffect(() => {
        if (!activeCase || !user) return;

        const init = async () => {
            // If we have a restored session ID from parent, use it
            if (restoredSessionId) {
                console.log('Using restored session:', restoredSessionId);
                setSessionId(restoredSessionId);
                if (onSessionStart) {
                    onSessionStart(restoredSessionId);
                }
            } else {
                // Start new session
                setMessages([]); // Clear previous chat
                const sid = await LLMService.startSession(activeCase.id, user.username);
                setSessionId(sid);

                // Log session start
                EventLogger.sessionStarted(sid, activeCase.id, activeCase.name);

                // Notify parent of session start
                if (onSessionStart) {
                    onSessionStart(sid);
                }

                // Initial Greeting from Config
                const greeting = activeCase.config?.greeting;
                if (greeting) {
                    setMessages([{ role: 'assistant', content: greeting }]);
                    // Log initial greeting as received message
                    EventLogger.messageReceived(greeting, COMPONENTS.CHAT_INTERFACE);
                }
            }
        };
        init();
    }, [activeCase, user, restoredSessionId]);

    // Scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    useEffect(() => { scrollToBottom(); }, [messages]);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim() || loading || !sessionId) return;

        const userMsg = { role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);

        // Log user message sent
        EventLogger.messageSent(input, COMPONENTS.CHAT_INTERFACE);

        setInput('');
        setLoading(true);

        // --- CONSTRUCT COMPREHENSIVE SYSTEM PROMPT ---
        const config = activeCase.config || {};
        const demo = config.demographics || {};

        let richSystemPrompt = `## PERSONA\n`;
        richSystemPrompt += `Role: ${config.persona_type || 'Patient'}\n`;
        richSystemPrompt += `Name: ${config.patient_name || activeCase.name}\n`;
        richSystemPrompt += `Demographics: ${demo.age || 'Unknown'} year old ${demo.gender || 'Unknown'}\n`;

        richSystemPrompt += `\n## INSTRUCTIONS\n`;
        richSystemPrompt += `${activeCase.system_prompt || 'You are a patient.'}\n`;

        if (config.constraints) {
            richSystemPrompt += `\n## CONSTRAINTS\n${config.constraints}\n`;
        }

        // Append Config Pages as Markdown Context if they exist
        if (config.pages && config.pages.length > 0) {
            richSystemPrompt += "\n---\n## PATIENT MEDICAL RECORD (Hidden Context)\n";
            richSystemPrompt += "Only reveal this information if specifically asked or relevant to the history taking.\n";

            config.pages.forEach(page => {
                richSystemPrompt += `\n### ${page.title}\n${page.content}\n`;
            });
        }

        // Append Clinical Records based on AI Access settings
        const clinicalRecords = config.clinicalRecords || {};
        const aiAccess = clinicalRecords.aiAccess || {
            history: true,
            physicalExam: true,
            medications: true,
            labs: false,
            radiology: false,
            procedures: true,
            notes: false
        };

        let hasAnyRecords = false;

        // History & HPI
        if (aiAccess.history && clinicalRecords.history) {
            const h = clinicalRecords.history;
            const historyParts = [];
            if (h.chiefComplaint) historyParts.push(`Chief Complaint: ${h.chiefComplaint}`);
            if (h.hpi) historyParts.push(`History of Present Illness: ${h.hpi}`);
            if (h.pastMedical) historyParts.push(`Past Medical History: ${h.pastMedical}`);
            if (h.pastSurgical) historyParts.push(`Past Surgical History: ${h.pastSurgical}`);
            if (h.allergies) historyParts.push(`Allergies: ${h.allergies}`);
            if (h.social) historyParts.push(`Social History: ${h.social}`);
            if (h.family) historyParts.push(`Family History: ${h.family}`);

            if (historyParts.length > 0) {
                if (!hasAnyRecords) {
                    richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                    hasAnyRecords = true;
                }
                richSystemPrompt += `\n### Medical History\n${historyParts.join('\n')}\n`;
            }
        }

        // Physical Exam
        if (aiAccess.physicalExam && clinicalRecords.physicalExam) {
            const pe = clinicalRecords.physicalExam;
            const peParts = [];
            if (pe.general) peParts.push(`General: ${pe.general}`);
            if (pe.heent) peParts.push(`HEENT: ${pe.heent}`);
            if (pe.cardiovascular) peParts.push(`Cardiovascular: ${pe.cardiovascular}`);
            if (pe.respiratory) peParts.push(`Respiratory: ${pe.respiratory}`);
            if (pe.abdomen) peParts.push(`Abdomen: ${pe.abdomen}`);
            if (pe.neurological) peParts.push(`Neurological: ${pe.neurological}`);
            if (pe.extremities) peParts.push(`Extremities/Skin: ${pe.extremities}`);

            if (peParts.length > 0) {
                if (!hasAnyRecords) {
                    richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                    hasAnyRecords = true;
                }
                richSystemPrompt += `\n### Physical Examination\n${peParts.join('\n')}\n`;
            }
        }

        // Medications
        if (aiAccess.medications && clinicalRecords.medications?.length > 0) {
            if (!hasAnyRecords) {
                richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                hasAnyRecords = true;
            }
            const medList = clinicalRecords.medications.map(m =>
                `- ${m.name} ${m.dose} ${m.route} ${m.frequency}`
            ).join('\n');
            richSystemPrompt += `\n### Current Medications\n${medList}\n`;
        }

        // Radiology (text findings only, not images)
        if (aiAccess.radiology && clinicalRecords.radiology?.length > 0) {
            if (!hasAnyRecords) {
                richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                hasAnyRecords = true;
            }
            const radList = clinicalRecords.radiology.map(r =>
                `- ${r.type}${r.name ? ` (${r.name})` : ''}: ${r.findings || 'No findings documented'}${r.interpretation ? ` - Interpretation: ${r.interpretation}` : ''}`
            ).join('\n');
            richSystemPrompt += `\n### Radiology Studies\n${radList}\n`;
        }

        // Procedures
        if (aiAccess.procedures && clinicalRecords.procedures?.length > 0) {
            if (!hasAnyRecords) {
                richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                hasAnyRecords = true;
            }
            const procList = clinicalRecords.procedures.map(p =>
                `- ${p.name}${p.date ? ` (${p.date})` : ''}: ${p.indication || 'No indication documented'}${p.findings ? ` - Findings: ${p.findings}` : ''}${p.complications ? ` - Complications: ${p.complications}` : ''}`
            ).join('\n');
            richSystemPrompt += `\n### Procedures\n${procList}\n`;
        }

        // Clinical Notes
        if (aiAccess.notes && clinicalRecords.notes?.length > 0) {
            if (!hasAnyRecords) {
                richSystemPrompt += "\n---\n## CLINICAL RECORDS (Accessible to AI)\n";
                hasAnyRecords = true;
            }
            const noteList = clinicalRecords.notes.map(n =>
                `#### ${n.type}${n.title ? `: ${n.title}` : ''} (${n.date || 'No date'}${n.author ? `, ${n.author}` : ''})\n${n.content || 'No content'}`
            ).join('\n\n');
            richSystemPrompt += `\n### Clinical Notes\n${noteList}\n`;
        }

        const responseText = await LLMService.sendMessage(
            sessionId,
            [...messages, userMsg],
            richSystemPrompt
        );

        setMessages(prev => [...prev, { role: 'assistant', content: responseText }]);

        // Log assistant response received
        EventLogger.messageReceived(responseText, COMPONENTS.CHAT_INTERFACE);

        setLoading(false);
    };

    if (!activeCase) {
        return (
            <div className="flex items-center justify-center h-full text-neutral-500 bg-neutral-900 border-t border-neutral-800">
                <div className="text-center">
                    <p>No Case Selected.</p>
                    <p className="text-xs">Please load a case from settings.</p>
                </div>
            </div>
        );
    }

    // Get patient info from case config
    const patientName = activeCase?.config?.patient_name || activeCase?.name || 'Patient';
    const patientAvatar = activeCase?.config?.patient_avatar || '';

    return (
        <div className="flex flex-col h-full bg-neutral-900 text-white font-sans border-t border-neutral-800">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, i) => (
                    <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {/* Patient (assistant) avatar and name */}
                        {msg.role === 'assistant' && (
                            <div className="flex flex-col items-center gap-1 shrink-0">
                                <div className="w-9 h-9 rounded-full bg-neutral-800 flex items-center justify-center border border-neutral-700 overflow-hidden">
                                    {patientAvatar ? (
                                        <img src={patientAvatar} alt={patientName} className="w-full h-full object-cover" />
                                    ) : (
                                        <Bot className="w-5 h-5 text-emerald-400" />
                                    )}
                                </div>
                                <span className="text-[10px] text-neutral-500 max-w-[60px] truncate">{patientName}</span>
                            </div>
                        )}

                        <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : 'bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-bl-none'
                            }`}>
                            {msg.content}
                        </div>

                        {/* Doctor (user) avatar and name */}
                        {msg.role === 'user' && (
                            <div className="flex flex-col items-center gap-1 shrink-0">
                                <div className="w-9 h-9 rounded-full bg-blue-900/30 flex items-center justify-center border border-blue-700 overflow-hidden">
                                    {chatSettings.doctorAvatar ? (
                                        <img src={chatSettings.doctorAvatar} alt={chatSettings.doctorName} className="w-full h-full object-cover" />
                                    ) : (
                                        <Stethoscope className="w-5 h-5 text-blue-400" />
                                    )}
                                </div>
                                <span className="text-[10px] text-neutral-500 max-w-[60px] truncate">{chatSettings.doctorName}</span>
                            </div>
                        )}
                    </div>
                ))}
                {loading && (
                    <div className="flex gap-3 justify-start">
                        <div className="flex flex-col items-center gap-1 shrink-0">
                            <div className="w-9 h-9 rounded-full bg-neutral-800 flex items-center justify-center border border-neutral-700 overflow-hidden">
                                {patientAvatar ? (
                                    <img src={patientAvatar} alt={patientName} className="w-full h-full object-cover" />
                                ) : (
                                    <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                                )}
                            </div>
                            <span className="text-[10px] text-neutral-500 max-w-[60px] truncate">{patientName}</span>
                        </div>
                        <div className="bg-neutral-800 px-4 py-2.5 rounded-2xl rounded-bl-none border border-neutral-700 text-neutral-400 text-sm flex items-center gap-2">
                            <span className="inline-flex gap-1">
                                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-neutral-900/90 border-t border-neutral-800">
                <form onSubmit={handleSend} className="relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={loading}
                        placeholder={loading ? "Waiting for response..." : "Type your message..."}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-neutral-600 disabled:opacity-50"
                    />
                    <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        className="absolute right-2 top-2 p-1.5 bg-blue-600 rounded-md hover:bg-blue-500 transition-colors text-white disabled:bg-neutral-700 disabled:text-neutral-500"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>
        </div>
    );
}
