import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    FileText, Download, Filter, Search, Clock, User, FlaskConical,
    MessageSquare, Bell, Settings, Eye, ChevronDown, ChevronRight,
    Play, Pause, CheckCircle, AlertCircle, X, RefreshCw, Clipboard,
    Calendar, Activity, MousePointer, ToggleLeft, BarChart3, AlertTriangle,
    Info, Bug, Zap, TrendingUp, PieChart
} from 'lucide-react';
import { AuthService } from '../../services/authService';
import { SEVERITY, CATEGORIES } from '../../services/eventLogger';
import { apiUrl } from '../../config/api';

// Icon mapping for different verbs
const VERB_ICONS = {
    STARTED_SESSION: Play,
    ENDED_SESSION: Pause,
    RESUMED_SESSION: RefreshCw,
    IDLE_TIMEOUT: Clock,
    VIEWED: Eye,
    OPENED: ChevronRight,
    CLOSED: X,
    NAVIGATED: Activity,
    SWITCHED_TAB: ToggleLeft,
    CLICKED: MousePointer,
    SELECTED: CheckCircle,
    DESELECTED: X,
    EXPANDED: ChevronDown,
    COLLAPSED: ChevronRight,
    ORDERED_LAB: FlaskConical,
    CANCELLED_LAB: X,
    VIEWED_LAB_RESULT: Eye,
    SEARCHED_LABS: Search,
    FILTERED_LABS: Filter,
    LAB_RESULT_READY: CheckCircle,
    ORDERED_MEDICATION: Zap,
    ADMINISTERED_MEDICATION: Zap,
    CANCELLED_MEDICATION: X,
    ORDERED_TREATMENT: Activity,
    PERFORMED_INTERVENTION: Zap,
    SENT_MESSAGE: MessageSquare,
    RECEIVED_MESSAGE: MessageSquare,
    COPIED_MESSAGE: Clipboard,
    ACKNOWLEDGED_ALARM: Bell,
    SILENCED_ALARM: Bell,
    ALARM_TRIGGERED: AlertTriangle,
    VIEWED_TRENDS: TrendingUp,
    CHANGED_SETTING: Settings,
    LOADED_CASE: FileText,
    SAVED_CASE: FileText,
    EXPORTED_CASE: Download,
    STARTED_SCENARIO: Play,
    COMPLETED_SCENARIO: CheckCircle,
    ERROR_OCCURRED: AlertCircle,
    API_ERROR: AlertCircle,
    VALIDATION_ERROR: AlertTriangle,
};

// Severity icons and colors
const SEVERITY_CONFIG = {
    DEBUG: { icon: Bug, color: 'text-neutral-500', bg: 'bg-neutral-800/50', border: 'border-neutral-700' },
    INFO: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-900/20', border: 'border-blue-800' },
    ACTION: { icon: MousePointer, color: 'text-cyan-400', bg: 'bg-cyan-900/20', border: 'border-cyan-800' },
    IMPORTANT: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-800' },
    CRITICAL: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-800' },
};

// Category colors
const CATEGORY_COLORS = {
    SESSION: 'bg-purple-600',
    NAVIGATION: 'bg-neutral-600',
    CLINICAL: 'bg-green-600',
    COMMUNICATION: 'bg-blue-600',
    MONITORING: 'bg-orange-600',
    CONFIGURATION: 'bg-slate-600',
    ASSESSMENT: 'bg-indigo-600',
    ERROR: 'bg-red-600',
};

// Color mapping for different verbs
const VERB_COLORS = {
    STARTED_SESSION: 'text-green-400 bg-green-900/30 border-green-700',
    ENDED_SESSION: 'text-red-400 bg-red-900/30 border-red-700',
    RESUMED_SESSION: 'text-blue-400 bg-blue-900/30 border-blue-700',
    ORDERED_LAB: 'text-purple-400 bg-purple-900/30 border-purple-700',
    VIEWED_LAB_RESULT: 'text-cyan-400 bg-cyan-900/30 border-cyan-700',
    SENT_MESSAGE: 'text-blue-400 bg-blue-900/30 border-blue-700',
    RECEIVED_MESSAGE: 'text-emerald-400 bg-emerald-900/30 border-emerald-700',
    ACKNOWLEDGED_ALARM: 'text-yellow-400 bg-yellow-900/30 border-yellow-700',
    SILENCED_ALARM: 'text-orange-400 bg-orange-900/30 border-orange-700',
    CLICKED: 'text-neutral-400 bg-neutral-800/50 border-neutral-700',
    OPENED: 'text-sky-400 bg-sky-900/30 border-sky-700',
    CLOSED: 'text-neutral-400 bg-neutral-800/50 border-neutral-700',
    SWITCHED_TAB: 'text-indigo-400 bg-indigo-900/30 border-indigo-700',
    LOADED_CASE: 'text-amber-400 bg-amber-900/30 border-amber-700',
    DEFAULT: 'text-neutral-400 bg-neutral-800/50 border-neutral-700',
};

// Format timestamp for display
const formatTimestamp = (ts) => {
    const date = new Date(ts);
    return {
        time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        full: date.toLocaleString()
    };
};

// Format duration
const formatDuration = (ms) => {
    if (!ms) return null;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
};

// Single log entry component
function LogEntry({ event, isExpanded, onToggle, showSeverity = true }) {
    const Icon = VERB_ICONS[event.verb] || Activity;
    const colorClass = VERB_COLORS[event.verb] || VERB_COLORS.DEFAULT;
    const ts = formatTimestamp(event.timestamp);
    const severityConfig = SEVERITY_CONFIG[event.severity] || SEVERITY_CONFIG.INFO;
    const categoryColor = CATEGORY_COLORS[event.category] || CATEGORY_COLORS.NAVIGATION;

    const hasDetails = event.context || event.message_content || event.result || event.duration_ms;

    return (
        <div className={`border-l-2 ${colorClass.split(' ')[2]} pl-4 py-2 hover:bg-neutral-800/30 transition-colors`}>
            <div
                className={`flex items-start gap-3 ${hasDetails ? 'cursor-pointer' : ''}`}
                onClick={() => hasDetails && onToggle()}
            >
                {/* Icon */}
                <div className={`p-1.5 rounded ${colorClass.split(' ').slice(1, 3).join(' ')} shrink-0 mt-0.5`}>
                    <Icon className={`w-3.5 h-3.5 ${colorClass.split(' ')[0]}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Severity badge */}
                        {showSeverity && event.severity && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${severityConfig.bg} ${severityConfig.color} border ${severityConfig.border}`}>
                                {event.severity}
                            </span>
                        )}

                        {/* Category badge */}
                        {event.category && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${categoryColor} text-white`}>
                                {event.category}
                            </span>
                        )}

                        {/* Session/User badge */}
                        {event.session_id && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-neutral-800 border border-neutral-600 rounded text-neutral-500">
                                #{event.session_id} {event.username && `@${event.username}`}
                            </span>
                        )}

                        {/* Verb */}
                        <span className={`text-sm font-bold ${colorClass.split(' ')[0]}`}>
                            {event.verb.replace(/_/g, ' ')}
                        </span>

                        {/* Object */}
                        {event.object_name && (
                            <span className="text-sm text-white">
                                {event.object_name}
                            </span>
                        )}

                        {/* Case name */}
                        {event.case_name && (
                            <span className="text-xs px-1.5 py-0.5 bg-amber-900/30 border border-amber-700/50 rounded text-amber-400">
                                {event.case_name}
                            </span>
                        )}

                        {/* Component */}
                        {event.component && (
                            <span className="text-xs px-1.5 py-0.5 bg-neutral-700 rounded text-neutral-400">
                                {event.component}
                            </span>
                        )}

                        {/* Duration */}
                        {event.duration_ms && (
                            <span className="text-xs text-neutral-500">
                                ({formatDuration(event.duration_ms)})
                            </span>
                        )}
                    </div>

                    {/* Result preview */}
                    {event.result && !isExpanded && (
                        <div className="text-xs text-neutral-500 mt-0.5 truncate">
                            {event.result}
                        </div>
                    )}

                    {/* Message preview */}
                    {event.message_content && !isExpanded && (
                        <div className="text-xs text-neutral-400 mt-1 truncate max-w-md italic">
                            "{event.message_content.substring(0, 100)}{event.message_content.length > 100 ? '...' : ''}"
                        </div>
                    )}
                </div>

                {/* Timestamp */}
                <div className="text-right shrink-0">
                    <div className="text-xs font-mono text-neutral-400">{ts.time}</div>
                    <div className="text-[10px] text-neutral-600">{ts.date}</div>
                </div>

                {/* Expand indicator */}
                {hasDetails && (
                    <div className="shrink-0 text-neutral-500">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                )}
            </div>

            {/* Expanded details */}
            {isExpanded && hasDetails && (
                <div className="mt-2 ml-10 p-3 bg-neutral-800/50 rounded-lg border border-neutral-700 space-y-2 text-sm">
                    {event.message_content && (
                        <div>
                            <div className="text-xs font-bold text-neutral-500 uppercase mb-1">
                                {event.message_role === 'user' ? 'User Message' : 'Assistant Response'}
                            </div>
                            <div className="text-neutral-300 whitespace-pre-wrap bg-neutral-900 p-2 rounded text-xs font-mono">
                                {event.message_content}
                            </div>
                        </div>
                    )}

                    {event.result && (
                        <div>
                            <div className="text-xs font-bold text-neutral-500 uppercase mb-1">Result</div>
                            <div className="text-neutral-300">{event.result}</div>
                        </div>
                    )}

                    {event.duration_ms && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-neutral-500 uppercase">Duration:</span>
                            <span className="text-neutral-300">{formatDuration(event.duration_ms)}</span>
                        </div>
                    )}

                    {event.context && (
                        <div>
                            <div className="text-xs font-bold text-neutral-500 uppercase mb-1">Context</div>
                            <pre className="text-xs text-neutral-400 bg-neutral-900 p-2 rounded overflow-x-auto">
                                {JSON.stringify(event.context, null, 2)}
                            </pre>
                        </div>
                    )}

                    <div className="text-[10px] text-neutral-600 pt-2 border-t border-neutral-700">
                        Event ID: {event.id} | Full timestamp: {ts.full}
                    </div>
                </div>
            )}
        </div>
    );
}

// Statistics component
function EventStatistics({ events }) {
    const stats = useMemo(() => {
        const severityCounts = {};
        const categoryCounts = {};
        const verbCounts = {};
        const componentCounts = {};
        let totalDuration = 0;
        let eventsWithDuration = 0;

        events.forEach(e => {
            // Severity counts
            if (e.severity) {
                severityCounts[e.severity] = (severityCounts[e.severity] || 0) + 1;
            }
            // Category counts
            if (e.category) {
                categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
            }
            // Verb counts
            verbCounts[e.verb] = (verbCounts[e.verb] || 0) + 1;
            // Component counts
            if (e.component) {
                componentCounts[e.component] = (componentCounts[e.component] || 0) + 1;
            }
            // Duration tracking
            if (e.duration_ms) {
                totalDuration += e.duration_ms;
                eventsWithDuration++;
            }
        });

        return {
            total: events.length,
            severityCounts,
            categoryCounts,
            verbCounts,
            componentCounts,
            avgDuration: eventsWithDuration > 0 ? Math.round(totalDuration / eventsWithDuration) : 0,
            totalDuration
        };
    }, [events]);

    const topVerbs = Object.entries(stats.verbCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-neutral-850 border-b border-neutral-800">
            {/* Total Events */}
            <div className="bg-neutral-800 rounded-lg p-3">
                <div className="text-xs text-neutral-500 uppercase font-bold">Total Events</div>
                <div className="text-2xl font-bold text-white">{stats.total}</div>
            </div>

            {/* Severity Breakdown */}
            <div className="bg-neutral-800 rounded-lg p-3">
                <div className="text-xs text-neutral-500 uppercase font-bold mb-2">By Severity</div>
                <div className="space-y-1">
                    {Object.entries(SEVERITY_CONFIG).map(([sev, config]) => (
                        <div key={sev} className="flex items-center justify-between text-xs">
                            <span className={config.color}>{sev}</span>
                            <span className="text-white font-mono">{stats.severityCounts[sev] || 0}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Category Breakdown */}
            <div className="bg-neutral-800 rounded-lg p-3">
                <div className="text-xs text-neutral-500 uppercase font-bold mb-2">By Category</div>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                    {Object.entries(stats.categoryCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, count]) => (
                            <div key={cat} className="flex items-center justify-between text-xs">
                                <span className={`px-1.5 py-0.5 rounded ${CATEGORY_COLORS[cat]} text-white text-[10px]`}>{cat}</span>
                                <span className="text-white font-mono">{count}</span>
                            </div>
                        ))}
                </div>
            </div>

            {/* Top Actions */}
            <div className="bg-neutral-800 rounded-lg p-3">
                <div className="text-xs text-neutral-500 uppercase font-bold mb-2">Top Actions</div>
                <div className="space-y-1">
                    {topVerbs.map(([verb, count]) => (
                        <div key={verb} className="flex items-center justify-between text-xs">
                            <span className="text-neutral-300 truncate">{verb.replace(/_/g, ' ')}</span>
                            <span className="text-white font-mono">{count}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Main Log Viewer Component
export default function SessionLogViewer({ sessionId, userId, onClose, showAllSessions = true }) {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedIds, setExpandedIds] = useState(new Set());

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedVerbs, setSelectedVerbs] = useState([]);
    const [selectedComponents, setSelectedComponents] = useState([]);
    const [selectedSessions, setSelectedSessions] = useState([]);
    const [selectedSeverities, setSelectedSeverities] = useState([]);
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [showFilters, setShowFilters] = useState(false);
    const [showStats, setShowStats] = useState(false);

    // Auto-refresh
    const [autoRefresh, setAutoRefresh] = useState(true);
    const refreshInterval = useRef(null);

    // Fetch events
    const fetchEvents = async () => {
        try {
            const token = AuthService.getToken();
            // Always fetch all recent events, or filter by session if specified
            let url = sessionId
                ? apiUrl(`/api/learning-events/session/${sessionId}`)
                : apiUrl(`/api/learning-events/all?limit=500`);

            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const data = await res.json();
                setEvents(data.events || []);
                setError(null);
            } else {
                const errData = await res.json().catch(() => ({}));
                setError(errData.error || 'Failed to fetch events');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEvents();
    }, [sessionId]);

    // Auto-refresh
    useEffect(() => {
        if (autoRefresh) {
            refreshInterval.current = setInterval(fetchEvents, 5000);
        }
        return () => {
            if (refreshInterval.current) {
                clearInterval(refreshInterval.current);
            }
        };
    }, [autoRefresh, sessionId, userId]);

    // Get unique verbs, components, and sessions for filters
    const uniqueVerbs = [...new Set(events.map(e => e.verb))].sort();
    const uniqueComponents = [...new Set(events.map(e => e.component).filter(Boolean))].sort();
    const uniqueSessions = [...new Map(events.filter(e => e.session_id).map(e => [
        e.session_id,
        { id: e.session_id, case_name: e.case_name, username: e.username }
    ])).values()];

    // Get unique severities and categories
    const uniqueSeverities = [...new Set(events.map(e => e.severity).filter(Boolean))];
    const uniqueCategories = [...new Set(events.map(e => e.category).filter(Boolean))];

    // Filter events
    const filteredEvents = events.filter(event => {
        // Search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const matchesSearch =
                event.verb.toLowerCase().includes(query) ||
                (event.object_name && event.object_name.toLowerCase().includes(query)) ||
                (event.message_content && event.message_content.toLowerCase().includes(query)) ||
                (event.component && event.component.toLowerCase().includes(query)) ||
                (event.case_name && event.case_name.toLowerCase().includes(query)) ||
                (event.username && event.username.toLowerCase().includes(query)) ||
                (event.severity && event.severity.toLowerCase().includes(query)) ||
                (event.category && event.category.toLowerCase().includes(query));
            if (!matchesSearch) return false;
        }

        // Verb filter
        if (selectedVerbs.length > 0 && !selectedVerbs.includes(event.verb)) {
            return false;
        }

        // Component filter
        if (selectedComponents.length > 0 && !selectedComponents.includes(event.component)) {
            return false;
        }

        // Session filter
        if (selectedSessions.length > 0 && !selectedSessions.includes(event.session_id)) {
            return false;
        }

        // Severity filter
        if (selectedSeverities.length > 0 && !selectedSeverities.includes(event.severity)) {
            return false;
        }

        // Category filter
        if (selectedCategories.length > 0 && !selectedCategories.includes(event.category)) {
            return false;
        }

        return true;
    });

    // Calculate active filter count
    const activeFilterCount = selectedVerbs.length + selectedComponents.length +
        selectedSessions.length + selectedSeverities.length + selectedCategories.length;

    // Toggle expanded state
    const toggleExpanded = (id) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Export functions
    const exportJSON = () => {
        const data = {
            exportedAt: new Date().toISOString(),
            sessionId,
            userId,
            totalEvents: filteredEvents.length,
            events: filteredEvents
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session-log-${sessionId || 'all'}-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportCSV = () => {
        const headers = ['Timestamp', 'Verb', 'Object Type', 'Object Name', 'Component', 'Result', 'Duration (ms)', 'Message Content'];
        const rows = filteredEvents.map(e => [
            e.timestamp,
            e.verb,
            e.object_type,
            e.object_name || '',
            e.component || '',
            e.result || '',
            e.duration_ms || '',
            e.message_content ? `"${e.message_content.replace(/"/g, '""')}"` : ''
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session-log-${sessionId || 'all'}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const copyToClipboard = () => {
        const text = filteredEvents.map(e => {
            let line = `[${formatTimestamp(e.timestamp).time}] ${e.verb}`;
            if (e.object_name) line += ` - ${e.object_name}`;
            if (e.component) line += ` (${e.component})`;
            if (e.message_content) line += `\n    "${e.message_content.substring(0, 200)}"`;
            return line;
        }).join('\n');
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="flex flex-col h-full bg-neutral-900">
            {/* Header */}
            <div className="p-4 border-b border-neutral-800 bg-neutral-800">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <FileText className="w-5 h-5 text-blue-400" />
                        Session Activity Log
                        {sessionId && <span className="text-sm font-normal text-neutral-400">#{sessionId}</span>}
                    </h2>
                    <div className="flex items-center gap-2">
                        {/* Statistics toggle */}
                        <button
                            onClick={() => setShowStats(!showStats)}
                            className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                                showStats ? 'bg-indigo-600 text-white' : 'bg-neutral-700 text-neutral-400'
                            }`}
                            title="Toggle Statistics"
                        >
                            <BarChart3 className="w-3 h-3" />
                            Stats
                        </button>

                        {/* Auto-refresh toggle */}
                        <button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                                autoRefresh ? 'bg-green-900/50 text-green-400' : 'bg-neutral-700 text-neutral-400'
                            }`}
                        >
                            <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} />
                            Live
                        </button>

                        {/* Manual refresh */}
                        <button
                            onClick={fetchEvents}
                            className="p-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-neutral-300"
                            title="Refresh"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>

                        {onClose && (
                            <button
                                onClick={onClose}
                                className="p-1.5 bg-neutral-700 hover:bg-neutral-600 rounded text-neutral-300"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Search and Filter Bar */}
                <div className="flex items-center gap-2">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search events, messages, actions..."
                            className="w-full pl-10 pr-4 py-2 bg-neutral-700 border border-neutral-600 rounded text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                        />
                    </div>

                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`px-3 py-2 rounded flex items-center gap-1 text-sm ${
                            showFilters || activeFilterCount > 0
                                ? 'bg-blue-600 text-white'
                                : 'bg-neutral-700 text-neutral-300'
                        }`}
                    >
                        <Filter className="w-4 h-4" />
                        Filters
                        {activeFilterCount > 0 && (
                            <span className="px-1.5 py-0.5 bg-white/20 rounded text-xs">
                                {activeFilterCount}
                            </span>
                        )}
                    </button>
                </div>

                {/* Filter Panel */}
                {showFilters && (
                    <div className="mt-3 p-3 bg-neutral-900 rounded-lg border border-neutral-700 space-y-3">
                        {/* Severity filters */}
                        {uniqueSeverities.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-neutral-500 uppercase mb-2">Severity Level</div>
                                <div className="flex flex-wrap gap-1">
                                    {Object.keys(SEVERITY_CONFIG).map(sev => {
                                        const config = SEVERITY_CONFIG[sev];
                                        return (
                                            <button
                                                key={sev}
                                                onClick={() => {
                                                    setSelectedSeverities(prev =>
                                                        prev.includes(sev)
                                                            ? prev.filter(s => s !== sev)
                                                            : [...prev, sev]
                                                    );
                                                }}
                                                className={`px-2 py-1 text-xs rounded border ${
                                                    selectedSeverities.includes(sev)
                                                        ? `${config.bg} ${config.color} ${config.border}`
                                                        : 'bg-neutral-800 text-neutral-400 border-neutral-700 hover:bg-neutral-700'
                                                }`}
                                            >
                                                {sev}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Category filters */}
                        {uniqueCategories.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-neutral-500 uppercase mb-2">Category</div>
                                <div className="flex flex-wrap gap-1">
                                    {Object.keys(CATEGORY_COLORS).map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => {
                                                setSelectedCategories(prev =>
                                                    prev.includes(cat)
                                                        ? prev.filter(c => c !== cat)
                                                        : [...prev, cat]
                                                );
                                            }}
                                            className={`px-2 py-1 text-xs rounded ${
                                                selectedCategories.includes(cat)
                                                    ? `${CATEGORY_COLORS[cat]} text-white`
                                                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                                            }`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Verb filters */}
                        <div>
                            <div className="text-xs font-bold text-neutral-500 uppercase mb-2">Action Types</div>
                            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                                {uniqueVerbs.map(verb => (
                                    <button
                                        key={verb}
                                        onClick={() => {
                                            setSelectedVerbs(prev =>
                                                prev.includes(verb)
                                                    ? prev.filter(v => v !== verb)
                                                    : [...prev, verb]
                                            );
                                        }}
                                        className={`px-2 py-1 text-xs rounded ${
                                            selectedVerbs.includes(verb)
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                                        }`}
                                    >
                                        {verb.replace(/_/g, ' ')}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Session filters */}
                        {uniqueSessions.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-neutral-500 uppercase mb-2">Sessions</div>
                                <div className="flex flex-wrap gap-1">
                                    {uniqueSessions.map(sess => (
                                        <button
                                            key={sess.id}
                                            onClick={() => {
                                                setSelectedSessions(prev =>
                                                    prev.includes(sess.id)
                                                        ? prev.filter(s => s !== sess.id)
                                                        : [...prev, sess.id]
                                                );
                                            }}
                                            className={`px-2 py-1 text-xs rounded ${
                                                selectedSessions.includes(sess.id)
                                                    ? 'bg-cyan-600 text-white'
                                                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                                            }`}
                                        >
                                            #{sess.id} {sess.case_name ? `- ${sess.case_name}` : ''} {sess.username ? `(${sess.username})` : ''}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Component filters */}
                        {uniqueComponents.length > 0 && (
                            <div>
                                <div className="text-xs font-bold text-neutral-500 uppercase mb-2">Components</div>
                                <div className="flex flex-wrap gap-1">
                                    {uniqueComponents.map(comp => (
                                        <button
                                            key={comp}
                                            onClick={() => {
                                                setSelectedComponents(prev =>
                                                    prev.includes(comp)
                                                        ? prev.filter(c => c !== comp)
                                                        : [...prev, comp]
                                                );
                                            }}
                                            className={`px-2 py-1 text-xs rounded ${
                                                selectedComponents.includes(comp)
                                                    ? 'bg-purple-600 text-white'
                                                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                                            }`}
                                        >
                                            {comp}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Clear filters */}
                        {activeFilterCount > 0 && (
                            <button
                                onClick={() => {
                                    setSelectedVerbs([]);
                                    setSelectedComponents([]);
                                    setSelectedSessions([]);
                                    setSelectedSeverities([]);
                                    setSelectedCategories([]);
                                }}
                                className="text-xs text-red-400 hover:text-red-300"
                            >
                                Clear all filters
                            </button>
                        )}
                    </div>
                )}

                {/* Statistics Panel */}
                {showStats && <EventStatistics events={filteredEvents} />}
            </div>

            {/* Stats Bar */}
            <div className="px-4 py-2 bg-neutral-850 border-b border-neutral-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-4 text-neutral-400">
                    <span>{filteredEvents.length} events</span>
                    {filteredEvents.length !== events.length && (
                        <span className="text-neutral-500">({events.length} total)</span>
                    )}
                    {events.length > 0 && (
                        <span>
                            {formatTimestamp(events[events.length - 1]?.timestamp).time} - {formatTimestamp(events[0]?.timestamp).time}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={copyToClipboard}
                        className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-neutral-300 flex items-center gap-1"
                        title="Copy to clipboard"
                    >
                        <Clipboard className="w-3 h-3" />
                        Copy
                    </button>
                    <button
                        onClick={exportCSV}
                        className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-neutral-300 flex items-center gap-1"
                    >
                        <Download className="w-3 h-3" />
                        CSV
                    </button>
                    <button
                        onClick={exportJSON}
                        className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 rounded text-neutral-300 flex items-center gap-1"
                    >
                        <Download className="w-3 h-3" />
                        JSON
                    </button>
                </div>
            </div>

            {/* Event List */}
            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-2" />
                            <p className="text-neutral-400">Loading events...</p>
                        </div>
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center text-red-400">
                            <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                            <p>{error}</p>
                            <button
                                onClick={fetchEvents}
                                className="mt-2 px-4 py-2 bg-red-900/30 hover:bg-red-900/50 rounded text-sm"
                            >
                                Retry
                            </button>
                        </div>
                    </div>
                ) : filteredEvents.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-neutral-500">
                        <div className="text-center">
                            <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
                            <p>No events recorded yet</p>
                            <p className="text-xs mt-1">Events will appear here as you interact with the simulation</p>
                        </div>
                    </div>
                ) : (
                    <div className="p-4 space-y-1">
                        {filteredEvents.map(event => (
                            <LogEntry
                                key={event.id}
                                event={event}
                                isExpanded={expandedIds.has(event.id)}
                                onToggle={() => toggleExpanded(event.id)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
