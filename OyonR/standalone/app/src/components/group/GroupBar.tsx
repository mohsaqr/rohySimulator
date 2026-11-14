import { InlineSelect } from './InlineSelect';
import { SpanBrush, type BrushSpan } from './SpanBrush';

/*
 * The bar every group sub-page shares, rendered by the /group layout above the
 * page: which group (when the data holds several), one line saying what is
 * loaded, and the time-span brush. The span is one selection for the whole
 * dashboard, so it lives here rather than on any one page.
 */

export interface GroupBarSummary {
  source: string;
  members: number;
  channels: number;
  live: string | null;
}

export function GroupBar({
  groupIds,
  groupId,
  onGroup,
  summary,
  extent,
  span,
  onSpan,
}: {
  groupIds: string[];
  groupId: string;
  onGroup: (groupId: string) => void;
  summary: GroupBarSummary;
  extent: { min_s: number; max_s: number };
  span: BrushSpan | null;
  onSpan: (span: BrushSpan | null) => void;
}) {
  const value: BrushSpan = span ?? { start_s: extent.min_s, end_s: extent.max_s };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line pb-2">
      {groupIds.length > 1 ? (
        <InlineSelect
          label="group"
          value={groupId}
          options={groupIds.map((g) => ({ value: g, label: g }))}
          onChange={onGroup}
          title={`The other ${groupIds.length - 1} group(s) form the pseudo-group pool for the null.`}
        />
      ) : null}
      <span className="text-xs tabular-nums text-ink-2" title={`source: ${summary.source}`}>
        <b className="text-ink-1">{groupId}</b> · {summary.members} members · {summary.channels} channels
        {summary.live ? ` · ${summary.live}` : ''}
      </span>
      <SpanBrush
        min={extent.min_s}
        max={extent.max_s}
        step={extent.max_s - extent.min_s >= 60 ? 1 : 0.2}
        value={value}
        onChange={(s) => onSpan(s && (s.start_s > extent.min_s || s.end_s < extent.max_s) ? s : null)}
      />
    </div>
  );
}
