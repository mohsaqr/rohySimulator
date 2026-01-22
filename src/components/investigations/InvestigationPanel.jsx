import React, { useState, useEffect, useRef } from 'react';
import { ClipboardList, Clock, CheckCircle, Search, Filter, List, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import EventLogger, { VERBS, OBJECT_TYPES, COMPONENTS } from '../../services/eventLogger';
import { apiUrl } from '../../config/api';

const InvestigationPanel = ({ caseId, sessionId, onViewResult }) => {
  // Track when panel was opened for timing
  const panelOpenTime = useRef(null);
  const [availableLabs, setAvailableLabs] = useState([]);
  const [allGroups, setAllGroups] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedTests, setSelectedTests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  
  // Search and filter state
  const [viewMode, setViewMode] = useState('search'); // 'search' or 'browse'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  // Fetch available labs for this session's case
  useEffect(() => {
    if (!sessionId) return;

    const fetchLabs = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(apiUrl(`/sessions/${sessionId}/available-labs`), {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          setAvailableLabs(data.labs || []);
          
          // Extract unique groups
          const groups = [...new Set(data.labs.map(lab => lab.test_group))].sort();
          setAllGroups(groups);
        }
      } catch (error) {
        console.error('Failed to fetch labs:', error);
      }
    };

    fetchLabs();
  }, [sessionId]);

  // Fetch orders for session
  const fetchOrders = async () => {
    if (!sessionId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(apiUrl(`/sessions/${sessionId}/orders`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setOrders(data.orders || []);
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    }
  };

  useEffect(() => {
    fetchOrders();
    // Poll every 10 seconds for updates
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Order selected tests
  const handleOrderTests = async () => {
    if (selectedTests.length === 0) return;

    setLoading(true);
    EventLogger.startTiming('orderLabs');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(apiUrl(`/sessions/${sessionId}/order-labs`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          lab_ids: selectedTests
        })
      });

      if (response.ok) {
        // Log each ordered lab
        selectedTests.forEach(labId => {
          const lab = availableLabs.find(l => l.id === labId);
          EventLogger.labOrdered(labId, lab?.test_name || `Lab ${labId}`, COMPONENTS.INVESTIGATION_PANEL);
        });

        setSelectedTests([]);
        await fetchOrders();
      } else {
        EventLogger.apiError(apiUrl('/sessions/order-labs'), response.status, 'Failed to order labs', COMPONENTS.INVESTIGATION_PANEL);
      }
    } catch (error) {
      console.error('Failed to order tests:', error);
      EventLogger.errorOccurred('OrderLabsError', error.message, COMPONENTS.INVESTIGATION_PANEL);
    } finally {
      setLoading(false);
    }
  };

  // Toggle test selection
  const toggleTest = (testId) => {
    const lab = availableLabs.find(l => l.id === testId);
    const isSelecting = !selectedTests.includes(testId);

    EventLogger.log(
      isSelecting ? VERBS.SELECTED : VERBS.DESELECTED,
      OBJECT_TYPES.LAB_TEST,
      {
        objectId: String(testId),
        objectName: lab?.test_name || `Lab ${testId}`,
        component: COMPONENTS.INVESTIGATION_PANEL,
        context: { group: lab?.test_group }
      }
    );

    setSelectedTests(prev =>
      prev.includes(testId)
        ? prev.filter(id => id !== testId)
        : [...prev, testId]
    );
  };

  // Toggle group expansion
  const toggleGroup = (group) => {
    const isExpanding = !expandedGroups.has(group);
    if (isExpanding) {
      EventLogger.groupExpanded(group, COMPONENTS.INVESTIGATION_PANEL);
    } else {
      EventLogger.groupCollapsed(group, COMPONENTS.INVESTIGATION_PANEL);
    }

    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(group)) {
        newSet.delete(group);
      } else {
        newSet.add(group);
      }
      return newSet;
    });
  };

  // Handle search with logging
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchQuery(value);

    // Debounce search logging
    if (value.length >= 2) {
      const resultsCount = availableLabs.filter(lab =>
        lab.test_name.toLowerCase().includes(value.toLowerCase()) ||
        lab.test_group.toLowerCase().includes(value.toLowerCase())
      ).length;
      EventLogger.labSearched(value, resultsCount, COMPONENTS.INVESTIGATION_PANEL);
    }
  };

  // Handle group filter change
  const handleGroupFilterChange = (e) => {
    const value = e.target.value;
    setSelectedGroup(value);
    EventLogger.labFiltered('group', value === 'all' ? 'All Groups' : value, COMPONENTS.INVESTIGATION_PANEL);
  };

  // Handle view mode change
  const handleViewModeChange = (newMode) => {
    EventLogger.viewModeChanged(viewMode, newMode, COMPONENTS.INVESTIGATION_PANEL);
    setViewMode(newMode);
  };

  // Handle panel open/close
  const handlePanelToggle = () => {
    if (!showPanel) {
      panelOpenTime.current = Date.now();
      EventLogger.labPanelOpened(COMPONENTS.INVESTIGATION_PANEL);
    } else {
      const duration = panelOpenTime.current ? Date.now() - panelOpenTime.current : null;
      EventLogger.log(VERBS.CLOSED, OBJECT_TYPES.PANEL, {
        objectId: 'investigation_panel',
        objectName: 'Investigation Panel',
        component: COMPONENTS.INVESTIGATION_PANEL,
        durationMs: duration
      });
    }
    setShowPanel(!showPanel);
  };

  // Handle viewing result
  const handleViewResult = (order) => {
    EventLogger.labResultViewed(order.id, order.test_name, order.current_value, COMPONENTS.INVESTIGATION_PANEL);
    onViewResult(order);
    setShowPanel(false);
  };

  // Calculate time remaining
  const getTimeRemaining = (availableAt) => {
    const now = new Date();
    const available = new Date(availableAt);
    const diff = available - now;

    if (diff <= 0) return 'Ready';

    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Filter labs based on search and group
  const filteredLabs = availableLabs.filter(lab => {
    const matchesSearch = !searchQuery || 
      lab.test_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lab.test_group.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesGroup = selectedGroup === 'all' || lab.test_group === selectedGroup;
    
    return matchesSearch && matchesGroup;
  });

  // Group labs by test_group for browse mode
  const groupedLabs = filteredLabs.reduce((acc, lab) => {
    if (!acc[lab.test_group]) {
      acc[lab.test_group] = [];
    }
    acc[lab.test_group].push(lab);
    return acc;
  }, {});

  const pendingOrders = orders.filter(o => !o.is_ready);
  const readyOrders = orders.filter(o => o.is_ready && !o.viewed_at);

  if (!caseId || !sessionId) {
    return null;
  }

  return (
    <div className="relative">
      {/* Order Button */}
      <button
        onClick={handlePanelToggle}
        className="relative px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2 transition-colors"
      >
        <ClipboardList className="w-5 h-5" />
        Order Labs
        {readyOrders.length > 0 && (
          <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center animate-pulse">
            {readyOrders.length}
          </span>
        )}
      </button>

      {/* Panel */}
      {showPanel && (
        <div className="absolute top-full right-0 mt-2 w-[500px] max-h-[700px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-neutral-800">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-purple-500" />
              Order Laboratory Tests
            </h3>
            <p className="text-xs text-neutral-400 mt-1">Search and select tests to order</p>
          </div>

          {/* Mode Toggle */}
          <div className="px-4 pt-4 pb-2 border-b border-neutral-800">
            <div className="flex gap-2">
              <button
                onClick={() => handleViewModeChange('search')}
                className={`flex-1 px-3 py-2 rounded text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                  viewMode === 'search'
                    ? 'bg-purple-600 text-white'
                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                }`}
              >
                <Search className="w-4 h-4" />
                Search Mode
              </button>
              <button
                onClick={() => handleViewModeChange('browse')}
                className={`flex-1 px-3 py-2 rounded text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                  viewMode === 'browse'
                    ? 'bg-purple-600 text-white'
                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                }`}
              >
                <List className="w-4 h-4" />
                Browse All
              </button>
            </div>
          </div>

          {/* Search & Filter */}
          <div className="p-4 space-y-3 border-b border-neutral-800">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search tests (e.g., glucose, CBC, sodium)..."
                className="w-full pl-10 pr-4 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
              />
            </div>

            {/* Group Filter */}
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <select
                value={selectedGroup}
                onChange={handleGroupFilterChange}
                className="w-full pl-10 pr-4 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm text-white focus:border-purple-500 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="all">All Groups ({availableLabs.length} tests)</option>
                {allGroups.map(group => (
                  <option key={group} value={group}>
                    {group} ({availableLabs.filter(l => l.test_group === group).length})
                  </option>
                ))}
              </select>
            </div>

            {/* Selected Count */}
            {selectedTests.length > 0 && (
              <div className="text-sm text-purple-400 font-bold">
                {selectedTests.length} test{selectedTests.length > 1 ? 's' : ''} selected
              </div>
            )}
          </div>

          {/* Available Tests */}
          <div className="flex-1 overflow-y-auto p-4">
            {filteredLabs.length === 0 ? (
              <div className="text-center py-8 text-neutral-500">
                <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">
                  {searchQuery ? `No tests found matching "${searchQuery}"` : 'No tests available'}
                </p>
              </div>
            ) : viewMode === 'search' ? (
              /* Search Mode - List View */
              <div className="space-y-2">
                {filteredLabs.map(lab => {
                  const alreadyOrdered = orders.some(o => o.investigation_id === lab.id);
                  return (
                    <label
                      key={lab.id}
                      className={`flex items-start gap-3 p-3 rounded border transition-colors ${
                        alreadyOrdered
                          ? 'bg-neutral-800/30 border-neutral-700 opacity-50'
                          : selectedTests.includes(lab.id)
                          ? 'bg-purple-900/30 border-purple-600 hover:bg-purple-900/40'
                          : 'bg-neutral-800/50 border-neutral-700 hover:bg-neutral-800 cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTests.includes(lab.id)}
                        onChange={() => !alreadyOrdered && toggleTest(lab.id)}
                        disabled={alreadyOrdered}
                        className="mt-1 w-4 h-4"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-white truncate">{lab.test_name}</div>
                        <div className="text-xs text-neutral-400 flex items-center gap-2 mt-1">
                          <span>{lab.test_group}</span>
                          <span>•</span>
                          <span>{lab.turnaround_minutes || 30} min</span>
                          {lab.is_abnormal && (
                            <>
                              <span>•</span>
                              <span className="text-yellow-500">⚠️ Abnormal</span>
                            </>
                          )}
                        </div>
                        {alreadyOrdered && (
                          <div className="text-xs text-blue-400 mt-1">✓ Already ordered</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              /* Browse Mode - Grouped View */
              <div className="space-y-3">
                {Object.entries(groupedLabs).map(([group, labs]) => {
                  const isExpanded = expandedGroups.has(group);
                  return (
                    <div key={group} className="border border-neutral-700 rounded overflow-hidden">
                      <button
                        onClick={() => toggleGroup(group)}
                        className="w-full px-4 py-3 bg-neutral-800 hover:bg-neutral-750 flex items-center justify-between transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{group}</span>
                          <span className="text-xs text-neutral-500">({labs.length})</span>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-neutral-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-neutral-400" />
                        )}
                      </button>
                      {isExpanded && (
                        <div className="p-2 space-y-1">
                          {labs.map(lab => {
                            const alreadyOrdered = orders.some(o => o.investigation_id === lab.id);
                            return (
                              <label
                                key={lab.id}
                                className={`flex items-center gap-3 p-2 rounded transition-colors ${
                                  alreadyOrdered
                                    ? 'opacity-50'
                                    : selectedTests.includes(lab.id)
                                    ? 'bg-purple-900/30'
                                    : 'hover:bg-neutral-800 cursor-pointer'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedTests.includes(lab.id)}
                                  onChange={() => !alreadyOrdered && toggleTest(lab.id)}
                                  disabled={alreadyOrdered}
                                  className="w-4 h-4"
                                />
                                <div className="flex-1 text-sm text-white">{lab.test_name}</div>
                                <div className="text-xs text-neutral-500">{lab.turnaround_minutes || 30}m</div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Order Button */}
            {selectedTests.length > 0 && (
              <button
                onClick={handleOrderTests}
                disabled={loading}
                className="w-full mt-4 px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-neutral-600 text-white rounded font-bold flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Ordering...
                  </>
                ) : (
                  <>
                    Order {selectedTests.length} Test{selectedTests.length > 1 ? 's' : ''}
                  </>
                )}
              </button>
            )}

            {/* Pending Orders */}
            {pendingOrders.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-bold text-neutral-300 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-yellow-500" />
                  Pending Results ({pendingOrders.length})
                </h4>
                <div className="space-y-2">
                  {pendingOrders.map(order => (
                    <div key={order.id} className="p-3 rounded bg-yellow-900/20 border border-yellow-700/50">
                      <div className="text-sm text-white font-medium">{order.test_name}</div>
                      <div className="text-xs text-yellow-400 mt-1 flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        Available in: {getTimeRemaining(order.available_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ready Results */}
            {readyOrders.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-bold text-neutral-300 mb-3 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Results Ready ({readyOrders.length})
                </h4>
                <div className="space-y-2">
                  {readyOrders.map(order => (
                    <button
                      key={order.id}
                      onClick={() => handleViewResult(order)}
                      className="w-full p-3 rounded bg-green-900/20 border border-green-700/50 hover:bg-green-900/30 text-left transition-colors group"
                    >
                      <div className="text-sm text-white font-bold group-hover:text-green-300">{order.test_name}</div>
                      <div className="text-xs text-green-400 mt-1">Click to view results →</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-neutral-800 flex gap-2">
            <button
              onClick={() => {
                const duration = panelOpenTime.current ? Date.now() - panelOpenTime.current : null;
                EventLogger.log(VERBS.CLOSED, OBJECT_TYPES.PANEL, {
                  objectId: 'investigation_panel',
                  objectName: 'Investigation Panel',
                  component: COMPONENTS.INVESTIGATION_PANEL,
                  durationMs: duration
                });
                setShowPanel(false);
                setSearchQuery('');
                setSelectedGroup('all');
                setSelectedTests([]);
              }}
              className="flex-1 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded font-bold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvestigationPanel;
