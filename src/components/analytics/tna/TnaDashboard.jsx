import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AlertCircle, Loader2, Users, BarChart3, Activity, ArrowLeft, Layers, ChevronLeft, ChevronRight, ToggleLeft, ToggleRight, Sun, Moon } from 'lucide-react';
import { apiUrl } from '../../../config/api';
import { AuthService } from '../../../services/authService';
import { tna, prune, clusterSequences } from './tnaUtils';
import NetworkGraph from './NetworkGraph';
import DistributionPlot from './DistributionPlot';
import IndexPlot from './IndexPlot';
import FrequencyChart from './FrequencyChart';
import CentralityChart from './CentralityChart';
import { getClusterColor } from './tnaColors';
import './tnaTheme.css';

const CLUSTER_OPTIONS = [null, 2, 3, 4, 5];

export default function TnaDashboard({ onClose }) {
  const [cases, setCases] = useState([]);
  const [caseId, setCaseId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pruneThreshold, setPruneThreshold] = useState(0.05);
  const [clusterCount, setClusterCount] = useState(null);
  const [activeCluster, setActiveCluster] = useState(0);
  const [showIndexPlot, setShowIndexPlot] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('tna-theme') || 'dark');
  const contentRef = useRef(null);

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('tna-theme', next);
      return next;
    });
  };

  useEffect(() => {
    const token = AuthService.getToken();
    fetch(apiUrl('/cases'), {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(d => setCases(d.cases || []))
      .catch(() => {});
  }, []);

  const fetchSequences = useCallback(() => {
    setLoading(true);
    setError(null);
    const token = AuthService.getToken();
    const params = new URLSearchParams();
    if (caseId) params.set('case_id', caseId);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);

    fetch(apiUrl(`/analytics/tna-sequences?${params.toString()}`), {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [caseId, startDate, endDate]);

  useEffect(() => { fetchSequences(); }, [fetchSequences]);

  // Reset active cluster when cluster count changes
  useEffect(() => { setActiveCluster(0); }, [clusterCount]);

  const { models, labels } = useMemo(() => {
    if (!data?.sequences?.length || !data?.metadata?.uniqueVerbs?.length) {
      return { models: null, labels: [] };
    }
    const lbls = data.metadata.uniqueVerbs;

    if (clusterCount && data.userSequences) {
      const clusters = clusterSequences(data.userSequences, lbls, clusterCount);
      return {
        models: clusters.map(c => ({
          id: c.id,
          userIds: c.userIds,
          sequences: c.sequences,
          model: tna(c.sequences, { labels: lbls }),
        })),
        labels: lbls,
      };
    }

    const model = tna(data.sequences, { labels: lbls });
    return { models: [{ id: 0, sequences: data.sequences, model, userIds: null }], labels: lbls };
  }, [data, clusterCount]);

  const prunedModels = useMemo(() => {
    if (!models) return null;
    return models.map(m => ({ ...m, pruned: prune(m.model, pruneThreshold) }));
  }, [models, pruneThreshold]);

  const isClustering = clusterCount !== null;
  const totalUsers = data?.metadata?.totalUsers || 0;
  const totalEvents = data?.metadata?.totalEvents || 0;

  // The currently visible model
  const visibleModel = prunedModels && prunedModels.length > 0
    ? prunedModels[Math.min(activeCluster, prunedModels.length - 1)]
    : null;

  const scrollToTop = () => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  };

  return (
    <div
      data-tna-theme={theme}
      className="h-full flex flex-col"
      style={{ backgroundColor: 'var(--tna-bg)', color: 'var(--tna-text)' }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 py-3 flex items-center gap-4"
        style={{ borderBottom: '1px solid var(--tna-border)' }}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--tna-text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--tna-bg-hover)'; e.currentTarget.style.color = 'var(--tna-text)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--tna-text-secondary)'; }}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--tna-text)' }}>
          <Activity className="w-5 h-5 text-purple-400" />
          TNA Analytics
        </h1>
        <div className="flex-1" />
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--tna-text-secondary)' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--tna-bg-hover)'; e.currentTarget.style.color = 'var(--tna-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--tna-text-secondary)'; }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <select
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          className="text-sm rounded-lg px-3 py-1.5"
          style={{ backgroundColor: 'var(--tna-bg-input)', border: '1px solid var(--tna-border-card)', color: 'var(--tna-text)' }}
        >
          <option value="">All Cases</option>
          {cases.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="text-sm rounded-lg px-2 py-1.5"
          style={{ backgroundColor: 'var(--tna-bg-input)', border: '1px solid var(--tna-border-card)', color: 'var(--tna-text)' }}
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="text-sm rounded-lg px-2 py-1.5"
          style={{ backgroundColor: 'var(--tna-bg-input)', border: '1px solid var(--tna-border-card)', color: 'var(--tna-text)' }}
        />
      </div>

      {/* Controls */}
      <div
        className="flex-shrink-0 px-6 py-2 flex items-center gap-6 text-sm"
        style={{ borderBottom: '1px solid var(--tna-border)' }}
      >
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4" style={{ color: 'var(--tna-text-secondary)' }} />
          <span style={{ color: 'var(--tna-text-secondary)' }}>Clusters:</span>
          <div className="flex gap-1">
            {CLUSTER_OPTIONS.map(opt => (
              <button
                key={opt ?? 'off'}
                onClick={() => setClusterCount(opt)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  clusterCount === opt
                    ? 'bg-purple-600 text-white'
                    : ''
                }`}
                style={clusterCount !== opt ? { backgroundColor: 'var(--tna-bg-card)', color: 'var(--tna-text-secondary)' } : undefined}
                onMouseEnter={e => { if (clusterCount !== opt) { e.currentTarget.style.backgroundColor = 'var(--tna-bg-hover)'; e.currentTarget.style.color = 'var(--tna-text)'; } }}
                onMouseLeave={e => { if (clusterCount !== opt) { e.currentTarget.style.backgroundColor = 'var(--tna-bg-card)'; e.currentTarget.style.color = 'var(--tna-text-secondary)'; } }}
              >
                {opt === null ? 'Off' : opt}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--tna-text-secondary)' }}>Prune:</span>
          <input
            type="range" min={0} max={0.5} step={0.01}
            value={pruneThreshold}
            onChange={(e) => setPruneThreshold(Number(e.target.value))}
            className="w-24"
          />
          <span className="text-xs w-8" style={{ color: 'var(--tna-text)' }}>{pruneThreshold.toFixed(2)}</span>
        </div>
        <button
          onClick={() => setShowIndexPlot(v => !v)}
          className="flex items-center gap-1.5 transition-colors"
          style={{ color: 'var(--tna-text-secondary)' }}
          title={showIndexPlot ? 'Switch to Distribution Plot' : 'Switch to Index Plot'}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--tna-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--tna-text-secondary)'; }}
        >
          {showIndexPlot
            ? <ToggleRight className="w-4 h-4 text-purple-400" />
            : <ToggleLeft className="w-4 h-4" />
          }
          <span className="text-xs">{showIndexPlot ? 'Index' : 'Distribution'}</span>
        </button>
      </div>

      {/* Stats */}
      {data?.sequences?.length > 0 && (
        <div
          className="flex-shrink-0 px-6 py-2 flex items-center gap-4 text-sm"
          style={{ borderBottom: '1px solid var(--tna-border)' }}
        >
          <span className="flex items-center gap-1.5" style={{ color: 'var(--tna-text-secondary)' }}>
            <Users className="w-3.5 h-3.5 text-blue-400" />
            Users: <span className="font-semibold" style={{ color: 'var(--tna-text)' }}>{totalUsers}</span>
          </span>
          <span style={{ color: 'var(--tna-text-dim)' }}>|</span>
          <span className="flex items-center gap-1.5" style={{ color: 'var(--tna-text-secondary)' }}>
            <BarChart3 className="w-3.5 h-3.5 text-green-400" />
            Events: <span className="font-semibold" style={{ color: 'var(--tna-text)' }}>{totalEvents.toLocaleString()}</span>
          </span>
          <span style={{ color: 'var(--tna-text-dim)' }}>|</span>
          <span className="flex items-center gap-1.5" style={{ color: 'var(--tna-text-secondary)' }}>
            <Activity className="w-3.5 h-3.5 text-purple-400" />
            Actions: <span className="font-semibold" style={{ color: 'var(--tna-text)' }}>{labels.length}</span>
          </span>
          {isClustering && prunedModels && (
            <>
              <span style={{ color: 'var(--tna-text-dim)' }}>|</span>
              <span className="flex items-center gap-1.5" style={{ color: 'var(--tna-text-secondary)' }}>
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                Clusters: <span className="font-semibold" style={{ color: 'var(--tna-text)' }}>{prunedModels.length}</span>
              </span>
            </>
          )}
        </div>
      )}

      {/* Cluster navigation tabs */}
      {isClustering && prunedModels && prunedModels.length > 1 && (
        <div
          className="flex-shrink-0 px-6 py-2 flex items-center gap-2"
          style={{ borderBottom: '1px solid var(--tna-border)' }}
        >
          <button
            onClick={() => { setActiveCluster(Math.max(0, activeCluster - 1)); scrollToTop(); }}
            disabled={activeCluster === 0}
            className="p-1 rounded disabled:opacity-30 disabled:cursor-default transition-colors"
            style={{ color: 'var(--tna-text-secondary)' }}
            onMouseEnter={e => { if (!e.currentTarget.disabled) { e.currentTarget.style.backgroundColor = 'var(--tna-bg-hover)'; e.currentTarget.style.color = 'var(--tna-text)'; } }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--tna-text-secondary)'; }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {prunedModels.map((cm, idx) => {
            const count = cm.userIds ? cm.userIds.length : cm.sequences.length;
            return (
              <button
                key={cm.id}
                onClick={() => { setActiveCluster(idx); scrollToTop(); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors"
                style={activeCluster === idx
                  ? { backgroundColor: 'var(--tna-bg-active)', color: 'var(--tna-text)' }
                  : { color: 'var(--tna-text-secondary)' }
                }
                onMouseEnter={e => { if (activeCluster !== idx) { e.currentTarget.style.backgroundColor = 'var(--tna-bg-hover)'; e.currentTarget.style.color = 'var(--tna-text)'; } }}
                onMouseLeave={e => { if (activeCluster !== idx) { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--tna-text-secondary)'; } }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getClusterColor(cm.id) }}
                />
                Cluster {cm.id + 1}
                <span style={{ color: 'var(--tna-text-muted)' }}>({count})</span>
              </button>
            );
          })}
          <button
            onClick={() => { setActiveCluster(Math.min(prunedModels.length - 1, activeCluster + 1)); scrollToTop(); }}
            disabled={activeCluster >= prunedModels.length - 1}
            className="p-1 rounded disabled:opacity-30 disabled:cursor-default transition-colors"
            style={{ color: 'var(--tna-text-secondary)' }}
            onMouseEnter={e => { if (!e.currentTarget.disabled) { e.currentTarget.style.backgroundColor = 'var(--tna-bg-hover)'; e.currentTarget.style.color = 'var(--tna-text)'; } }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--tna-text-secondary)'; }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Scrollable content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div
            className="rounded-lg p-4 text-sm"
            style={{ backgroundColor: 'var(--tna-error-bg)', border: '1px solid var(--tna-error-border)', color: 'var(--tna-error-text)' }}
          >
            Failed to load data: {error}
          </div>
        )}

        {!loading && !error && !data?.sequences?.length && (
          <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--tna-text-muted)' }}>
            <AlertCircle className="w-12 h-12 mb-3" />
            <p className="text-lg font-medium">No data available</p>
            <p className="text-sm mt-1">Run simulation sessions to generate learning events.</p>
          </div>
        )}

        {!loading && !error && visibleModel && (
          <>
            {/* Cluster title when clustering is active */}
            {isClustering && (
              <div className="flex items-center gap-2 mb-1">
                <div
                  className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getClusterColor(visibleModel.id) }}
                />
                <span className="text-base font-bold" style={{ color: 'var(--tna-text)' }}>
                  Cluster {visibleModel.id + 1}
                </span>
                <span className="text-sm" style={{ color: 'var(--tna-text-muted)' }}>
                  — {visibleModel.userIds ? visibleModel.userIds.length : visibleModel.sequences.length} student{(visibleModel.userIds ? visibleModel.userIds.length : visibleModel.sequences.length) !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {/* 2x2 grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Network Graph */}
              <div
                className="rounded-lg p-4"
                style={{
                  backgroundColor: 'var(--tna-bg-card)',
                  border: '1px solid var(--tna-border-card)',
                  ...(isClustering ? { borderLeftWidth: 3, borderLeftColor: getClusterColor(visibleModel.id) } : {}),
                }}
              >
                <NetworkGraph
                  model={visibleModel.pruned}
                  pruneThreshold={pruneThreshold}
                  onPruneChange={setPruneThreshold}
                />
              </div>

              {/* Distribution / Index Plot */}
              <div
                className="rounded-lg p-4"
                style={{ backgroundColor: 'var(--tna-bg-card)', border: '1px solid var(--tna-border-card)' }}
              >
                <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--tna-text-secondary)' }}>
                  {showIndexPlot ? 'Sequence Index Plot' : 'Action Distribution by Timestep'}
                </h4>
                {showIndexPlot
                  ? <IndexPlot sequences={visibleModel.sequences} labels={labels} />
                  : <DistributionPlot sequences={visibleModel.sequences} labels={labels} />
                }
              </div>

              {/* InStrength Centrality */}
              <div
                className="rounded-lg p-4"
                style={{ backgroundColor: 'var(--tna-bg-card)', border: '1px solid var(--tna-border-card)' }}
              >
                <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--tna-text-secondary)' }}>InStrength Centrality</h4>
                <CentralityChart model={visibleModel.pruned} labels={labels} />
              </div>

              {/* Frequency */}
              <div
                className="rounded-lg p-4"
                style={{ backgroundColor: 'var(--tna-bg-card)', border: '1px solid var(--tna-border-card)' }}
              >
                <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--tna-text-secondary)' }}>Action Frequency</h4>
                <FrequencyChart sequences={visibleModel.sequences} labels={labels} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
