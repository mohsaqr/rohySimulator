import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertCircle, Loader2, Users, BarChart3, Activity } from 'lucide-react';
import { apiUrl } from '../../../config/api';
import { AuthService } from '../../../services/authService';
import { tna, prune } from './tnaUtils';
import NetworkGraph from './NetworkGraph';
import DistributionPlot from './DistributionPlot';
import FrequencyChart from './FrequencyChart';

export default function TnaDashboard() {
  const [cases, setCases] = useState([]);
  const [caseId, setCaseId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pruneThreshold, setPruneThreshold] = useState(0.05);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load available cases for filter dropdown
  useEffect(() => {
    const token = AuthService.getToken();
    fetch(apiUrl('/cases'), {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(d => setCases(d.cases || []))
      .catch(() => {});
  }, []);

  // Fetch TNA sequences when filters change
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
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [caseId, startDate, endDate]);

  useEffect(() => {
    fetchSequences();
  }, [fetchSequences]);

  // Compute TNA model client-side, memoized on data + threshold
  const { prunedModel, labels } = useMemo(() => {
    if (!data?.sequences?.length || !data?.metadata?.uniqueVerbs?.length) {
      return { prunedModel: null, labels: [] };
    }
    const model = tna(data.sequences, { labels: data.metadata.uniqueVerbs });
    const pruned = prune(model, pruneThreshold);
    return { prunedModel: pruned, labels: data.metadata.uniqueVerbs };
  }, [data, pruneThreshold]);

  return (
    <div className="space-y-4">
      {/* Header + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-purple-400" />
          TNA Analytics
        </h2>
        <div className="flex-1" />

        {/* Case filter */}
        <select
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 text-neutral-200 text-sm rounded-lg px-3 py-1.5"
        >
          <option value="">All Cases</option>
          {cases.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Date range */}
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 text-neutral-200 text-sm rounded-lg px-2 py-1.5"
          placeholder="From"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 text-neutral-200 text-sm rounded-lg px-2 py-1.5"
          placeholder="To"
        />
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          Failed to load data: {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && (!data?.sequences?.length) && (
        <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
          <AlertCircle className="w-12 h-12 mb-3" />
          <p className="text-lg font-medium">No data available</p>
          <p className="text-sm mt-1">Run simulation sessions to generate learning events.</p>
        </div>
      )}

      {/* Data loaded */}
      {!loading && !error && data?.sequences?.length > 0 && (
        <>
          {/* Stats cards */}
          <div className="flex gap-3">
            <div className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-neutral-300">
                Users: <span className="text-white font-semibold">{data.metadata.totalUsers}</span>
              </span>
            </div>
            <div className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-green-400" />
              <span className="text-sm text-neutral-300">
                Events: <span className="text-white font-semibold">{data.metadata.totalEvents.toLocaleString()}</span>
              </span>
            </div>
            <div className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-neutral-300">
                Actions: <span className="text-white font-semibold">{labels.length}</span>
              </span>
            </div>
          </div>

          {/* Network Graph (full width) */}
          <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
            <NetworkGraph
              model={prunedModel}
              pruneThreshold={pruneThreshold}
              onPruneChange={setPruneThreshold}
            />
          </div>

          {/* Distribution + Frequency side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-neutral-300 mb-2">Action Distribution by Timestep</h3>
              <DistributionPlot sequences={data.sequences} labels={labels} />
            </div>
            <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-neutral-300 mb-2">Action Frequency</h3>
              <FrequencyChart sequences={data.sequences} labels={labels} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
