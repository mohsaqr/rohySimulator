import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Bot, User as UserIcon, Loader2, Stethoscope, Phone, Clock, Users, MessageCircle, X } from 'lucide-react';
import { LLMService } from '../../services/llmService';
import { AgentService } from '../../services/AgentService';
import { useAuth } from '../../contexts/AuthContext';
import { AuthService } from '../../services/authService';
import EventLogger, { COMPONENTS } from '../../services/eventLogger';
import { apiUrl } from '../../config/api';
import { usePatientRecord } from '../../services/PatientRecord';

export default function ChatInterface({ activeCase, onSessionStart, restoredSessionId, sessionStartTime, currentVitals }) {
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [messagesLoaded, setMessagesLoaded] = useState(false);
    const messagesEndRef = useRef(null);
    const { user } = useAuth();
    const patientRecord = usePatientRecord();
    const { obtained } = patientRecord;
    const [messages, setMessages] = useState([]);
    const [chatSettings, setChatSettings] = useState({
        doctorName: 'Dr. Carmen',
        doctorAvatar: ''
    });

    // Multi-agent state
    const [activeTab, setActiveTab] = useState('patient'); // 'patient' or agent_type
    const [agents, setAgents] = useState([]);
    const [agentConversations, setAgentConversations] = useState({}); // { agent_type: [...messages] }
    const [agentStates, setAgentStates] = useState({}); // { agent_type: { status, paged_at, ... } }
    const [pagingTimers, setPagingTimers] = useState({}); // { agent_type: timeoutId }
    const [teamLog, setTeamLog] = useState([]);

    // Load chat settings (doctor name/avatar)
    useEffect(() => {
        const loadChatSettings = async () => {
            try {
                const token = AuthService.getToken();
                const res = await fetch(apiUrl('/platform-settings/chat'), {
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

    // Load agents for this case/session
    useEffect(() => {
        if (!sessionId || !activeCase) return;

        const loadAgents = async () => {
            try {
                const agentList = await AgentService.getSessionAgents(sessionId);
                setAgents(agentList);

                // Initialize agent states
                const states = {};
                agentList.forEach(a => {
                    states[a.agent_type] = {
                        status: a.status || 'absent',
                        paged_at: a.paged_at,
                        arrived_at: a.arrived_at
                    };
                });
                setAgentStates(states);

                // Load team communications
                const log = await AgentService.getTeamCommunications(sessionId);
                setTeamLog(log);
            } catch (err) {
                console.error('Failed to load agents:', err);
            }
        };

        loadAgents();
    }, [sessionId, activeCase]);

    // Load agent conversations when switching tabs
    useEffect(() => {
        if (activeTab === 'patient' || !sessionId) return;

        const loadConversation = async () => {
            try {
                const conversation = await AgentService.getConversation(sessionId, activeTab);
                setAgentConversations(prev => ({
                    ...prev,
                    [activeTab]: conversation.map(m => ({ role: m.role, content: m.content }))
                }));
            } catch (err) {
                console.error('Failed to load agent conversation:', err);
            }
        };

        // Only load if not already loaded
        if (!agentConversations[activeTab]) {
            loadConversation();
        }
    }, [activeTab, sessionId]);

    // Calculate elapsed time since session start
    const getElapsedMinutes = useCallback(() => {
        if (!sessionStartTime) return 0;
        return Math.floor((Date.now() - sessionStartTime) / 60000);
    }, [sessionStartTime]);

    // Check agent availability based on elapsed time
    const getAgentDisplayStatus = useCallback((agent) => {
        const elapsedMinutes = getElapsedMinutes();
        return AgentService.getAgentDisplayStatus(agent, elapsedMinutes);
    }, [getElapsedMinutes]);

    // Handle paging an agent
    const handlePageAgent = async (agentType) => {
        const agent = agents.find(a => a.agent_type === agentType);
        if (!agent) return;

        try {
            await AgentService.pageAgent(sessionId, agentType);

            // Update local state
            setAgentStates(prev => ({
                ...prev,
                [agentType]: { ...(prev[agentType] || {}), status: 'paged', paged_at: new Date().toISOString() }
            }));

            // Calculate wait time and set timer for arrival
            const waitTime = AgentService.calculateWaitTime(agent);
            const timerId = setTimeout(async () => {
                await AgentService.arriveAgent(sessionId, agentType);
                setAgentStates(prev => ({
                    ...prev,
                    [agentType]: { ...(prev[agentType] || {}), status: 'present', arrived_at: new Date().toISOString() }
                }));
                setPagingTimers(prev => {
                    const newTimers = { ...prev };
                    delete newTimers[agentType];
                    return newTimers;
                });
            }, waitTime * 60 * 1000); // Convert minutes to ms

            setPagingTimers(prev => ({ ...prev, [agentType]: timerId }));
        } catch (err) {
            console.error('Failed to page agent:', err);
        }
    };

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
                    const res = await fetch(apiUrl(`/interactions/${restoredSessionId}`), {
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
    useEffect(() => { scrollToBottom(); }, [messages, agentConversations, activeTab]);

    // Build rich system prompt for patient chat
    const buildPatientSystemPrompt = () => {
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
                `- ${m.name} ${m.dose} ${m.route} ${m.frequency}${m.indication ? ` (for ${m.indication})` : ''}`
            ).join('\n');
            richSystemPrompt += `\n### Current Medications\n${medList}\n`;
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
            }
            const noteList = clinicalRecords.notes.map(n =>
                `#### ${n.type}${n.title ? `: ${n.title}` : ''} (${n.date || 'No date'}${n.author ? `, ${n.author}` : ''})\n${n.content || 'No content'}`
            ).join('\n\n');
            richSystemPrompt += `\n### Clinical Notes\n${noteList}\n`;
        }

        return richSystemPrompt;
    };

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim() || loading || !sessionId) return;

        // If on patient tab, send to patient
        if (activeTab === 'patient') {
            await handleSendToPatient();
        } else {
            // Send to agent
            await handleSendToAgent(activeTab);
        }
    };

    const handleSendToPatient = async () => {
        const userMsg = { role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);

        // Log user message sent
        EventLogger.messageSent(input, COMPONENTS.CHAT_INTERFACE);

        setInput('');
        setLoading(true);

        const richSystemPrompt = buildPatientSystemPrompt();

        const responseText = await LLMService.sendMessage(
            sessionId,
            [...messages, userMsg],
            richSystemPrompt
        );

        setMessages(prev => [...prev, { role: 'assistant', content: responseText }]);

        // Log assistant response received
        EventLogger.messageReceived(responseText, COMPONENTS.CHAT_INTERFACE);

        // Record to PatientRecord - history item obtained
        obtained('history', input.trim(), responseText);

        setLoading(false);
    };

    const handleSendToAgent = async (agentType) => {
        const agent = agents.find(a => a.agent_type === agentType);
        if (!agent) return;

        const userMsg = { role: 'user', content: input };
        const currentConversation = agentConversations[agentType] || [];

        // Use functional update to properly add user message
        setAgentConversations(prev => ({
            ...prev,
            [agentType]: [...(prev[agentType] || []), userMsg]
        }));

        setInput('');
        setLoading(true);

        try {
            const responseText = await AgentService.sendAgentMessage(
                sessionId,
                agent,
                input,
                patientRecord.record,
                teamLog,
                currentVitals,
                currentConversation
            );

            // Use functional update with fallback to empty array
            setAgentConversations(prev => ({
                ...prev,
                [agentType]: [...(prev[agentType] || []), { role: 'assistant', content: responseText }]
            }));

            // Reload team log after agent response
            const updatedLog = await AgentService.getTeamCommunications(sessionId);
            setTeamLog(updatedLog);
        } catch (err) {
            console.error('Failed to send message to agent:', err);
            // Use functional update with fallback to empty array
            setAgentConversations(prev => ({
                ...prev,
                [agentType]: [...(prev[agentType] || []), { role: 'assistant', content: 'Error: Could not get response.' }]
            }));
        }

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

    // Get current conversation based on active tab
    const currentMessages = activeTab === 'patient' ? messages : (agentConversations[activeTab] || []);
    const currentAgent = agents.find(a => a.agent_type === activeTab);
    const agentStatus = currentAgent ? getAgentDisplayStatus(currentAgent) : null;

    // Render tab button
    const renderTab = (key, label, icon, status = null) => {
        const isActive = activeTab === key;
        return (
            <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                    isActive
                        ? 'bg-neutral-900 text-white border-t border-l border-r border-neutral-700'
                        : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-800/80'
                }`}
            >
                {icon}
                <span>{label}</span>
                {status && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        status === 'present' ? 'bg-green-900/50 text-green-400' :
                        status === 'paged' ? 'bg-amber-900/50 text-amber-400' :
                        status === 'on-call' ? 'bg-blue-900/50 text-blue-400' :
                        'bg-neutral-700 text-neutral-500'
                    }`}>
                        {status === 'present' ? 'Here' :
                         status === 'paged' ? 'Coming' :
                         status === 'on-call' ? 'On-Call' :
                         'Away'}
                    </span>
                )}
            </button>
        );
    };

    // Get icon for agent type
    const getAgentIcon = (type) => {
        switch (type) {
            case 'nurse': return <Users className="w-4 h-4 text-blue-400" />;
            case 'consultant': return <Stethoscope className="w-4 h-4 text-green-400" />;
            case 'relative': return <UserIcon className="w-4 h-4 text-amber-400" />;
            default: return <Bot className="w-4 h-4 text-purple-400" />;
        }
    };

    return (
        <div className="flex flex-col h-full bg-neutral-900 text-white font-sans border-t border-neutral-800">
            {/* Tab Bar */}
            <div className="flex items-end gap-1 px-2 pt-2 bg-neutral-950 border-b border-neutral-800">
                {renderTab('patient', patientName, <Bot className="w-4 h-4 text-emerald-400" />)}
                {agents.filter(a => a.enabled !== false).map(agent => {
                    const status = agentStates[agent.agent_type]?.status || agent.status || 'absent';
                    return renderTab(
                        agent.agent_type,
                        agent.name,
                        getAgentIcon(agent.agent_type),
                        status
                    );
                })}
            </div>

            {/* Agent Status Bar (when on agent tab) */}
            {activeTab !== 'patient' && currentAgent && agentStatus && (
                <div className={`px-4 py-2 flex items-center justify-between text-sm ${
                    agentStatus.status === 'present' ? 'bg-green-900/20 border-b border-green-800/50' :
                    agentStatus.status === 'paged' ? 'bg-amber-900/20 border-b border-amber-800/50' :
                    agentStatus.status === 'on-call' ? 'bg-blue-900/20 border-b border-blue-800/50' :
                    'bg-neutral-800/50 border-b border-neutral-700'
                }`}>
                    <div className="flex items-center gap-2">
                        {getAgentIcon(currentAgent.agent_type)}
                        <span className="font-medium">{currentAgent.name}</span>
                        <span className="text-neutral-500">• {currentAgent.role_title}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {agentStatus.canPage && (
                            <button
                                onClick={() => handlePageAgent(currentAgent.agent_type)}
                                className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs font-bold"
                            >
                                <Phone className="w-3 h-3" /> Page
                            </button>
                        )}
                        {agentStatus.status === 'paged' && (
                            <span className="flex items-center gap-1 text-amber-400">
                                <Clock className="w-3 h-3 animate-pulse" />
                                On the way...
                            </span>
                        )}
                        {!agentStatus.canChat && agentStatus.status !== 'paged' && (
                            <span className="text-neutral-500">{agentStatus.label}</span>
                        )}
                    </div>
                </div>
            )}

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Empty state hint */}
                {currentMessages.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center h-full text-center px-6">
                        <div className="w-16 h-16 rounded-full bg-neutral-800 flex items-center justify-center border border-neutral-700 mb-4">
                            {activeTab === 'patient' ? (
                                <Bot className="w-8 h-8 text-emerald-400" />
                            ) : (
                                getAgentIcon(activeTab)
                            )}
                        </div>
                        {activeTab === 'patient' ? (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">Start a conversation with your patient</p>
                                <p className="text-neutral-600 text-xs">Type a message below to begin taking the patient's history</p>
                            </>
                        ) : agentStatus?.canChat ? (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">Chat with {currentAgent?.name}</p>
                                <p className="text-neutral-600 text-xs">Type a message to communicate with the {currentAgent?.role_title?.toLowerCase()}</p>
                            </>
                        ) : agentStatus?.canPage ? (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">{currentAgent?.name} is on-call</p>
                                <p className="text-neutral-600 text-xs">Click the "Page" button above to request their presence</p>
                            </>
                        ) : (
                            <>
                                <p className="text-neutral-400 text-sm mb-2">{currentAgent?.name} is not available</p>
                                <p className="text-neutral-600 text-xs">{agentStatus?.label}</p>
                            </>
                        )}
                    </div>
                )}

                {currentMessages.map((msg, i) => (
                    <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {/* Assistant avatar and name */}
                        {msg.role === 'assistant' && (
                            <div className="flex flex-col items-center gap-1 shrink-0">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center border overflow-hidden ${
                                    activeTab === 'patient'
                                        ? 'bg-neutral-800 border-neutral-700'
                                        : currentAgent?.agent_type === 'nurse' ? 'bg-blue-900/30 border-blue-700'
                                        : currentAgent?.agent_type === 'consultant' ? 'bg-green-900/30 border-green-700'
                                        : currentAgent?.agent_type === 'relative' ? 'bg-amber-900/30 border-amber-700'
                                        : 'bg-purple-900/30 border-purple-700'
                                }`}>
                                    {activeTab === 'patient' ? (
                                        patientAvatar ? (
                                            <img src={BASE_PATH + patientAvatar} alt={patientName} className="w-full h-full object-cover" />
                                        ) : (
                                            <Bot className="w-5 h-5 text-emerald-400" />
                                        )
                                    ) : (
                                        getAgentIcon(currentAgent?.agent_type)
                                    )}
                                </div>
                                <span className="text-[10px] text-neutral-500 max-w-[60px] truncate">
                                    {activeTab === 'patient' ? 'Patient' : currentAgent?.name?.split(' ')[0]}
                                </span>
                            </div>
                        )}

                        <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : activeTab === 'patient'
                            ? 'bg-neutral-800 text-neutral-200 border border-neutral-700 rounded-bl-none'
                            : currentAgent?.agent_type === 'nurse' ? 'bg-blue-900/20 text-blue-100 border border-blue-800/50 rounded-bl-none'
                            : currentAgent?.agent_type === 'consultant' ? 'bg-green-900/20 text-green-100 border border-green-800/50 rounded-bl-none'
                            : currentAgent?.agent_type === 'relative' ? 'bg-amber-900/20 text-amber-100 border border-amber-800/50 rounded-bl-none'
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
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center border overflow-hidden ${
                                activeTab === 'patient'
                                    ? 'bg-neutral-800 border-neutral-700'
                                    : 'bg-neutral-800 border-neutral-700'
                            }`}>
                                <Loader2 className={`w-5 h-5 animate-spin ${
                                    activeTab === 'patient' ? 'text-emerald-400' :
                                    currentAgent?.agent_type === 'nurse' ? 'text-blue-400' :
                                    currentAgent?.agent_type === 'consultant' ? 'text-green-400' :
                                    currentAgent?.agent_type === 'relative' ? 'text-amber-400' :
                                    'text-purple-400'
                                }`} />
                            </div>
                            <span className="text-[10px] text-neutral-500 max-w-[60px] truncate">
                                {activeTab === 'patient' ? 'Patient' : currentAgent?.name?.split(' ')[0]}
                            </span>
                        </div>
                        <div className="bg-neutral-800 px-4 py-2.5 rounded-2xl rounded-bl-none border border-neutral-700 text-neutral-400 text-sm flex items-center gap-2">
                            <span className="inline-flex gap-1">
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-neutral-900/90 border-t border-neutral-800">
                <form onSubmit={handleSend} className="relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={loading || (activeTab !== 'patient' && !agentStatus?.canChat)}
                        placeholder={
                            loading ? "Waiting for response..." :
                            activeTab !== 'patient' && !agentStatus?.canChat ? `${currentAgent?.name} is not available` :
                            `Message ${activeTab === 'patient' ? patientName : currentAgent?.name}...`
                        }
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-neutral-600 disabled:opacity-50"
                    />
                    <button
                        type="submit"
                        disabled={loading || !input.trim() || (activeTab !== 'patient' && !agentStatus?.canChat)}
                        className="absolute right-2 top-2 p-1.5 bg-blue-600 rounded-md hover:bg-blue-500 transition-colors text-white disabled:bg-neutral-700 disabled:text-neutral-500"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>
        </div>
    );
}
