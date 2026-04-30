import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Users } from 'lucide-react';
import NetworkGraph from './NetworkGraph';
import DistributionPlot from './DistributionPlot';
import FrequencyChart from './FrequencyChart';
import { getClusterColor } from './tnaColors';

export default function ClusterPanel({
  clusterId,
  model,
  sequences,
  labels,
  userCount,
  pruneThreshold,
  onPruneChange,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const accent = getClusterColor(clusterId);

  return (
    <div
      className="bg-neutral-800 border border-neutral-700 rounded-lg overflow-hidden"
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-neutral-750 transition-colors text-left"
      >
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: accent }}
        />
        <span className="text-sm font-semibold text-white">
          Cluster {clusterId + 1}
        </span>
        <span className="text-xs text-neutral-400 flex items-center gap-1">
          <Users className="w-3 h-3" />
          {userCount} student{userCount !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        {open ? (
          <ChevronUp className="w-4 h-4 text-neutral-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-neutral-400" />
        )}
      </button>

      {/* Content */}
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <NetworkGraph
            model={model}
            pruneThreshold={pruneThreshold}
            onPruneChange={onPruneChange}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-neutral-400 mb-2">
                Action Distribution by Timestep
              </h4>
              <DistributionPlot sequences={sequences} labels={labels} />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-neutral-400 mb-2">
                Action Frequency
              </h4>
              <FrequencyChart sequences={sequences} labels={labels} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
