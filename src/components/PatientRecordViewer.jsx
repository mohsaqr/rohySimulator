/**
 * PatientRecordViewer - Live view of PatientRecord events
 *
 * Displays events as they happen during the simulation session.
 * Can be hidden later but useful for development/debugging.
 */

import React, { useState, useEffect, useRef } from 'react';
import { usePatientRecord } from '../services/PatientRecord';
import {
    FileText, Clock, Activity, Stethoscope, FlaskConical,
    Bell, Pill, TrendingUp, MessageCircle, RefreshCw,
    ChevronDown, ChevronUp, Filter, Download
} from 'lucide-react';

// Verb icon mapping
const VERB_ICONS = {
    OBTAINED: FileText,
    EXAMINED: Stethoscope,
    ELICITED: FlaskConical,
    NOTED: Bell,
    ORDERED: FileText,
    ADMINISTERED: Pill,
    CHANGED: TrendingUp,
    EXPRESSED: MessageCircle
};

// Verb color mapping
const VERB_COLORS = {
    OBTAINED: 'text-blue-400 bg-blue-900/30 border-blue-700',
    EXAMINED: 'text-cyan-400 bg-cyan-900/30 border-cyan-700',
    ELICITED: 'text-purple-400 bg-purple-900/30 border-purple-700',
    NOTED: 'text-yellow-400 bg-yellow-900/30 border-yellow-700',
    ORDERED: 'text-green-400 bg-green-900/30 border-green-700',
    ADMINISTERED: 'text-pink-400 bg-pink-900/30 border-pink-700',
    CHANGED: 'text-orange-400 bg-orange-900/30 border-orange-700',
    EXPRESSED: 'text-indigo-400 bg-indigo-900/30 border-indigo-700'
};

export default function PatientRecordViewer() {
    const {
        record,
        isLoading,
        getEvents,
        getSummary,
        getEventCount,
        toJSON,
        toNarrative,
        lastSyncTime,
        syncError,
        forceSync
    } = usePatientRecord();

    const [events, setEvents] = useState([]);
    const [summary, setSummary] = useState(null);
    const [filterVerb, setFilterVerb] = useState('all');
    const [autoScroll, setAutoScroll] = useState(true);
    const [viewMode, setViewMode] = useState('events'); // 'events' | 'narrative' | 'json'
    const [narrativeStyle, setNarrativeStyle] = useState('context'); // 'context' | 'timeline' | 'summary'
    const [narrative, setNarrative] = useState('');
    const eventsEndRef = useRef(null);

    // Update events display
    useEffect(() => {
        const updateEvents = () => {
            const allEvents = getEvents();
            setEvents(filterVerb === 'all' ? allEvents : allEvents.filter(e => e.verb === filterVerb));
            setSummary(getSummary());
            setNarrative(toNarrative(narrativeStyle));
        };

        updateEvents();
        const interval = setInterval(updateEvents, 1000);
        return () => clearInterval(interval);
    }, [getEvents, getSummary, toNarrative, filterVerb, narrativeStyle]);

    // Auto-scroll to bottom when new events arrive
    useEffect(() => {
        if (autoScroll && eventsEndRef.current) {
            eventsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [events.length, autoScroll]);

    // Download JSON
    const handleDownloadJSON = () => {
        const json = toJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `patient-record-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <RefreshCw className="w-8 h-8 mx-auto mb-2 text-neutral-500 animate-spin" />
                    <p className="text-sm text-neutral-400">Loading patient record...</p>
                </div>
            </div>
        );
    }

    if (!record) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <FileText className="w-12 h-12 mx-auto mb-2 text-neutral-600" />
                    <p className="text-sm text-neutral-400">No active session</p>
                    <p className="text-xs text-neutral-500 mt-1">Start a session to see patient record events</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-neutral-950">
            {/* Header */}
            <div className="p-4 border-b border-neutral-800 bg-neutral-900">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Activity className="w-4 h-4 text-green-400" />
                            Patient Record - Live View
                        </h3>
                        {summary && (
                            <p className="text-xs text-neutral-400 mt-1">
                                {summary.patient_name} | {summary.elapsed_minutes} min | {summary.total_events} events
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Sync Status */}
                        <div className="text-xs text-neutral-500">
                            {syncError ? (
                                <span className="text-red-400">Sync error</span>
                            ) : lastSyncTime ? (
                                <span>Synced {lastSyncTime.toLocaleTimeString()}</span>
                            ) : (
                                <span>Not synced</span>
                            )}
                        </div>
                        <button
                            onClick={forceSync}
                            className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded"
                            title="Force sync now"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                            onClick={handleDownloadJSON}
                            className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded"
                            title="Download JSON"
                        >
                            <Download className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                    <Filter className="w-4 h-4 text-neutral-500" />
                    <button
                        onClick={() => setFilterVerb('all')}
                        className={`px-2 py-1 text-xs rounded ${
                            filterVerb === 'all'
                                ? 'bg-neutral-700 text-white'
                                : 'text-neutral-400 hover:text-white'
                        }`}
                    >
                        All ({getEventCount()})
                    </button>
                    {Object.keys(VERB_ICONS).map(verb => {
                        const count = getEvents().filter(e => e.verb === verb).length;
                        if (count === 0) return null;
                        const Icon = VERB_ICONS[verb];
                        return (
                            <button
                                key={verb}
                                onClick={() => setFilterVerb(verb)}
                                className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                                    filterVerb === verb
                                        ? VERB_COLORS[verb]
                                        : 'text-neutral-400 hover:text-white'
                                }`}
                            >
                                <Icon className="w-3 h-3" />
                                {verb} ({count})
                            </button>
                        );
                    })}
                    <div className="ml-auto flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-neutral-400 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={autoScroll}
                                onChange={(e) => setAutoScroll(e.target.checked)}
                                className="w-3 h-3"
                            />
                            Auto-scroll
                        </label>
                        {/* View mode toggle */}
                        <div className="flex bg-neutral-800 rounded overflow-hidden">
                            <button
                                onClick={() => setViewMode('events')}
                                className={`px-2 py-1 text-xs ${
                                    viewMode === 'events' ? 'bg-neutral-600 text-white' : 'text-neutral-400 hover:text-white'
                                }`}
                            >
                                Events
                            </button>
                            <button
                                onClick={() => setViewMode('narrative')}
                                className={`px-2 py-1 text-xs ${
                                    viewMode === 'narrative' ? 'bg-neutral-600 text-white' : 'text-neutral-400 hover:text-white'
                                }`}
                            >
                                Narrative
                            </button>
                            <button
                                onClick={() => setViewMode('json')}
                                className={`px-2 py-1 text-xs ${
                                    viewMode === 'json' ? 'bg-neutral-600 text-white' : 'text-neutral-400 hover:text-white'
                                }`}
                            >
                                JSON
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex">
                {viewMode === 'json' ? (
                    /* JSON View */
                    <div className="flex-1 overflow-auto p-4">
                        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                            {toJSON()}
                        </pre>
                    </div>
                ) : viewMode === 'narrative' ? (
                    /* Narrative View */
                    <div className="flex-1 overflow-auto p-4">
                        {/* Narrative style selector */}
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-xs text-neutral-500">Style:</span>
                            <button
                                onClick={() => setNarrativeStyle('context')}
                                className={`px-2 py-1 text-xs rounded ${
                                    narrativeStyle === 'context'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-neutral-800 text-neutral-400 hover:text-white'
                                }`}
                            >
                                Context (LLM)
                            </button>
                            <button
                                onClick={() => setNarrativeStyle('summary')}
                                className={`px-2 py-1 text-xs rounded ${
                                    narrativeStyle === 'summary'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-neutral-800 text-neutral-400 hover:text-white'
                                }`}
                            >
                                Summary (SOAP)
                            </button>
                            <button
                                onClick={() => setNarrativeStyle('timeline')}
                                className={`px-2 py-1 text-xs rounded ${
                                    narrativeStyle === 'timeline'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-neutral-800 text-neutral-400 hover:text-white'
                                }`}
                            >
                                Timeline
                            </button>
                        </div>
                        {/* Narrative content */}
                        <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
                            <pre className="text-sm text-neutral-200 font-sans whitespace-pre-wrap leading-relaxed">
                                {narrative || 'No events recorded yet.'}
                            </pre>
                        </div>
                        {/* Copy button */}
                        <button
                            onClick={() => navigator.clipboard.writeText(narrative)}
                            className="mt-3 px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded"
                        >
                            Copy to Clipboard
                        </button>
                    </div>
                ) : (
                    /* Events Timeline */
                    <div className="flex-1 overflow-y-auto p-4">
                        {events.length === 0 ? (
                            <div className="text-center py-8">
                                <Clock className="w-8 h-8 mx-auto mb-2 text-neutral-600" />
                                <p className="text-sm text-neutral-400">No events yet</p>
                                <p className="text-xs text-neutral-500 mt-1">Events will appear here as they happen</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {events.map((event, index) => {
                                    const Icon = VERB_ICONS[event.verb] || FileText;
                                    const colorClass = VERB_COLORS[event.verb] || 'text-neutral-400 bg-neutral-900/30 border-neutral-700';

                                    return (
                                        <div
                                            key={event.id || index}
                                            className={`p-3 rounded border ${colorClass} transition-all`}
                                        >
                                            <div className="flex items-start gap-3">
                                                {/* Time & Icon */}
                                                <div className="flex flex-col items-center">
                                                    <span className="text-xs font-mono opacity-70">{event.time}m</span>
                                                    <Icon className="w-4 h-4 mt-1" />
                                                </div>

                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xs font-bold uppercase">{event.verb}</span>
                                                        {event.category && (
                                                            <span className="text-xs opacity-70">{event.category}</span>
                                                        )}
                                                        {event.region && (
                                                            <span className="text-xs opacity-70">{event.region}</span>
                                                        )}
                                                        {event.source && (
                                                            <span className="text-xs opacity-70">({event.source})</span>
                                                        )}
                                                        {event.abnormal && (
                                                            <span className="text-xs bg-red-600 text-white px-1 rounded">ABNORMAL</span>
                                                        )}
                                                    </div>

                                                    {/* Main content */}
                                                    {event.content && (
                                                        <p className="text-sm">{event.content}</p>
                                                    )}
                                                    {event.finding && (
                                                        <p className="text-sm">{event.finding}</p>
                                                    )}
                                                    {event.item && (
                                                        <p className="text-sm">{event.item}</p>
                                                    )}

                                                    {/* Additional details */}
                                                    <div className="flex flex-wrap gap-2 mt-1 text-xs opacity-70">
                                                        {event.value && (
                                                            <span>Value: {event.value}{event.unit ? ` ${event.unit}` : ''}</span>
                                                        )}
                                                        {event.dose && (
                                                            <span>Dose: {event.dose}</span>
                                                        )}
                                                        {event.route && (
                                                            <span>Route: {event.route}</span>
                                                        )}
                                                        {event.from && event.to && (
                                                            <span>{event.from} → {event.to}</span>
                                                        )}
                                                        {event.response && (
                                                            <span>Response: {event.response}</span>
                                                        )}
                                                        {event.technique && (
                                                            <span>Technique: {event.technique}</span>
                                                        )}
                                                        {event.type && (
                                                            <span>Type: {event.type}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={eventsEndRef} />
                            </div>
                        )}
                    </div>
                )}

                {/* Summary Sidebar */}
                {summary && viewMode === 'events' && (
                    <div className="w-64 border-l border-neutral-800 bg-neutral-900/50 p-4 overflow-y-auto">
                        <h4 className="text-xs font-bold text-neutral-400 uppercase mb-3">Summary</h4>

                        {/* Verb counts */}
                        <div className="space-y-2 mb-4">
                            {Object.entries(summary.events_by_verb || {}).map(([verb, count]) => {
                                const Icon = VERB_ICONS[verb] || FileText;
                                return (
                                    <div key={verb} className="flex items-center justify-between text-sm">
                                        <span className="flex items-center gap-2 text-neutral-400">
                                            <Icon className="w-3 h-3" />
                                            {verb}
                                        </span>
                                        <span className="text-white font-bold">{count}</span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Current vitals */}
                        {summary.current_vitals && (
                            <>
                                <h4 className="text-xs font-bold text-neutral-400 uppercase mb-2 mt-4">Current Vitals</h4>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    {summary.current_vitals.hr && (
                                        <div className="bg-neutral-800 p-2 rounded">
                                            <span className="text-neutral-500">HR</span>
                                            <span className="text-white font-bold ml-2">{summary.current_vitals.hr}</span>
                                        </div>
                                    )}
                                    {summary.current_vitals.bp_sys && (
                                        <div className="bg-neutral-800 p-2 rounded">
                                            <span className="text-neutral-500">BP</span>
                                            <span className="text-white font-bold ml-2">
                                                {summary.current_vitals.bp_sys}/{summary.current_vitals.bp_dia}
                                            </span>
                                        </div>
                                    )}
                                    {summary.current_vitals.spo2 && (
                                        <div className="bg-neutral-800 p-2 rounded">
                                            <span className="text-neutral-500">SpO2</span>
                                            <span className="text-white font-bold ml-2">{summary.current_vitals.spo2}%</span>
                                        </div>
                                    )}
                                    {summary.current_vitals.rr && (
                                        <div className="bg-neutral-800 p-2 rounded">
                                            <span className="text-neutral-500">RR</span>
                                            <span className="text-white font-bold ml-2">{summary.current_vitals.rr}</span>
                                        </div>
                                    )}
                                    {summary.current_vitals.temp && (
                                        <div className="bg-neutral-800 p-2 rounded">
                                            <span className="text-neutral-500">Temp</span>
                                            <span className="text-white font-bold ml-2">{summary.current_vitals.temp}</span>
                                        </div>
                                    )}
                                    {summary.current_vitals.pain !== null && (
                                        <div className="bg-neutral-800 p-2 rounded">
                                            <span className="text-neutral-500">Pain</span>
                                            <span className="text-white font-bold ml-2">{summary.current_vitals.pain}/10</span>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
