import React, { useState, useEffect, useRef } from 'react';
import { Clock, Activity, AlertTriangle, Settings, FileText, Zap } from 'lucide-react';
import { apiUrl } from '../../config/api';

const EventLog = ({ sessionId }) => {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('all'); // all, vitals, alarms, scenario, settings
  const [loading, setLoading] = useState(false);
  const logEndRef = useRef(null);

  // Fetch events from backend
  const fetchEvents = async () => {
    if (!sessionId) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(apiUrl(`/api/sessions/${sessionId}/events`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
      }
    } catch (error) {
      console.error('Failed to fetch events:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    // Refresh every 10 seconds
    const interval = setInterval(fetchEvents, 10000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Auto-scroll to latest
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // Filter events
  const filteredEvents = events.filter(event => {
    if (filter === 'all') return true;
    if (filter === 'vitals') return event.event_type === 'vital_change';
    if (filter === 'alarms') return event.event_type === 'alarm';
    if (filter === 'scenario') return event.event_type === 'scenario_step';
    if (filter === 'settings') return event.event_type === 'settings_change' || event.event_type === 'ecg_change';
    return true;
  });

  // Get icon for event type
  const getEventIcon = (eventType) => {
    switch (eventType) {
      case 'vital_change':
        return <Activity className="w-4 h-4 text-blue-500" />;
      case 'alarm':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'scenario_step':
        return <Zap className="w-4 h-4 text-purple-500" />;
      case 'settings_change':
      case 'ecg_change':
        return <Settings className="w-4 h-4 text-gray-500" />;
      case 'case_load':
        return <FileText className="w-4 h-4 text-green-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  // Format timestamp
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  };

  // Export to CSV
  const exportToCSV = () => {
    const csvHeaders = ['Timestamp', 'Type', 'Description', 'Vital', 'Old Value', 'New Value'];
    const csvRows = [csvHeaders.join(',')];

    events.forEach(event => {
      const row = [
        event.timestamp,
        event.event_type,
        `"${event.description || ''}"`,
        event.vital_sign || '',
        event.old_value || '',
        event.new_value || ''
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-log-${sessionId}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!sessionId) {
    return (
      <div className="p-4 text-center text-gray-500">
        No active session. Start a case to begin logging events.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">Event Log</h3>
        <button
          onClick={exportToCSV}
          className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
          disabled={events.length === 0}
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 p-3 border-b border-gray-700 overflow-x-auto">
        {['all', 'vitals', 'alarms', 'scenario', 'settings'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-sm whitespace-nowrap ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Event List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && events.length === 0 ? (
          <div className="text-center text-gray-500 py-8">Loading events...</div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            {filter === 'all' ? 'No events yet' : `No ${filter} events`}
          </div>
        ) : (
          filteredEvents.map((event, index) => (
            <div
              key={event.id || index}
              className="flex items-start gap-3 p-2 rounded bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
            >
              <div className="mt-1">{getEventIcon(event.event_type)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-mono">
                    {formatTime(event.timestamp)}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                    {event.event_type}
                  </span>
                </div>
                <p className="text-sm text-white mt-1">{event.description}</p>
                {(event.old_value || event.new_value) && (
                  <div className="text-xs text-gray-400 mt-1">
                    {event.old_value && <span>From: {event.old_value}</span>}
                    {event.old_value && event.new_value && <span className="mx-2">→</span>}
                    {event.new_value && <span>To: {event.new_value}</span>}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 text-xs text-gray-400 text-center">
        {filteredEvents.length} {filter === 'all' ? '' : filter} event{filteredEvents.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

export default EventLog;
