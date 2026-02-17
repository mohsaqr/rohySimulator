# TNA Dashboard Implementation Guide

A practical guide for implementing Transition Network Analysis (TNA) visualizations in a web dashboard. This guide covers the full pipeline: data extraction, model computation, and three complementary visualizations rendered as pure SVG in a reactive frontend.

---

## Table of Contents

1. [What is TNA?](#1-what-is-tna)
2. [Data Pipeline](#2-data-pipeline)
3. [The TNA Model](#3-the-tna-model)
4. [Visualization 1: Network Graph](#4-visualization-1-network-graph)
5. [Visualization 2: Distribution Plot](#5-visualization-2-distribution-plot)
6. [Visualization 3: Frequency Chart](#6-visualization-3-frequency-chart)
7. [Dashboard Integration](#7-dashboard-integration)
8. [Common Pitfalls](#8-common-pitfalls)

---

## 1. What is TNA?

Transition Network Analysis models sequential behavioral data as a directed weighted graph. Given sequences of categorical actions (e.g., `["read", "watch", "quiz", "read"]`), TNA computes:

- **Transition probabilities**: How likely is action B to follow action A?
- **Initial probabilities**: How likely is each action to be the first in a sequence?
- **Frequency distributions**: How often does each action appear at each position?

The output is a square matrix of transition weights, a vector of initial probabilities, and a set of labels (the unique actions).

---

## 2. Data Pipeline

### 2.1 Raw Data Requirements

You need a table of timestamped events with at minimum:

| Concept | Description |
|---------|-------------|
| **User identifier** | Groups events into per-user sequences |
| **Action label** | The categorical action (a string like "viewed", "submitted", "navigated") |
| **Timestamp** | Orders events chronologically within each user's sequence |

Optional but useful: a scope/context filter (e.g., course, project, session) and a date range filter.

### 2.2 Extracting Sequences

The server-side query should:

1. **Filter** events by scope and date range
2. **Order** by user, then by timestamp ascending
3. **Group** into per-user sequences: `string[][]` where each inner array is one user's ordered action labels
4. **Enforce a minimum sequence length** (typically 2) — single-action sequences carry no transition information

```
Input events (sorted by user + time):
  User A: ["read", "watch", "quiz"]
  User B: ["watch", "read", "read", "submit"]
  User C: ["read"]  ← discard (length < 2)

Output sequences:
  [["read", "watch", "quiz"], ["watch", "read", "read", "submit"]]
```

### 2.3 Verb Merging (Recommended)

Raw action labels often contain near-duplicates or overly granular categories. Merge similar actions server-side before computing TNA:

```
Merge map:
  "seeked"   → "navigated"
  "scrolled" → "navigated"
  "paused"   → "media_control"
  "resumed"  → "media_control"
```

Apply the merge map to every action in every sequence before returning to the client.

### 2.4 Rare Verb Filtering (Recommended)

Actions that appear in less than ~5% of total events add visual noise. Replace them with a generic "other" label, then collapse consecutive "other" entries:

```
Before: ["read", "rare_action_1", "rare_action_2", "watch"]
After:  ["read", "other", "watch"]
```

This keeps the graph readable. Make the threshold configurable (e.g., a `minVerbPct` query parameter defaulting to 0.05).

### 2.5 Safety Caps

Activity log tables can be massive. Always:

- Cap the database query (e.g., `LIMIT 50000` events)
- Return metadata alongside sequences: total user count, total event count, unique action labels, and applied filters

### 2.6 API Response Shape

```json
{
  "sequences": [["a", "b", "c"], ["b", "a", "a"]],
  "metadata": {
    "totalUsers": 142,
    "totalEvents": 8609,
    "uniqueVerbs": ["a", "b", "c", "d"],
    "dateRange": { "start": "2025-01-01", "end": "2025-12-31" }
  }
}
```

---

## 3. The TNA Model

### 3.1 Using the tnaj Library

The `tnaj` library (TypeScript, installable from GitHub) computes TNA models:

```typescript
import { tna, prune } from 'tnaj';
import type { TNA } from 'tnaj';

// Compute relative transition model
const model: TNA = tna(sequences, { labels: uniqueVerbs });

// Prune weak edges (threshold 0–0.5, typically 0.05)
const pruned: TNA = prune(model, 0.05);
```

### 3.2 Model Structure

A TNA model contains:

| Property | Type | Description |
|----------|------|-------------|
| `labels` | `string[]` | Ordered list of unique action names |
| `weights` | `Matrix` | N x N transition matrix. `weights.get(i, j)` = probability of transitioning from label[i] to label[j]. Rows sum to ~1.0. |
| `inits` | `Float64Array` | Length N. `inits[i]` = probability that label[i] is the first action in a sequence. Sums to ~1.0. |

The `Matrix` class has `.get(i, j)` for element access and `.max()` for the global maximum.

### 3.3 Pruning

`prune(model, threshold)` zeroes out any transition weight below the threshold. This removes visual clutter from the network graph without affecting the underlying data. The threshold should be user-controllable via a slider (range 0.00–0.50, step 0.01).

### 3.4 Client-Side Computation

Compute TNA models on the client using `useMemo` (or equivalent memoization). The computation is fast even for hundreds of sequences:

```typescript
const { prunedModel, labels } = useMemo(() => {
  if (!data?.sequences?.length) return { prunedModel: null, labels: [] };
  const model = tna(data.sequences, { labels: data.metadata.uniqueVerbs });
  const pruned = prune(model, pruneThreshold);
  return { prunedModel: pruned, labels: data.metadata.uniqueVerbs };
}, [data, pruneThreshold]);
```

---

## 4. Visualization 1: Network Graph

The network graph is the primary TNA visualization — a directed weighted graph where nodes are actions and edges represent transition probabilities.

### 4.1 Layout: Circular

Place nodes in a circle. This is the standard layout for TNA and works well for up to ~15 nodes:

```
Angle for node i = (2 * PI * i / N) - PI/2     // start from top
x = centerX + radius * cos(angle)
y = centerY + radius * sin(angle)
```

The layout radius should account for padding around nodes: `radius = min(width, height) / 2 - nodeRadius - 45`.

### 4.2 Recommended Defaults

| Parameter | Value | Notes |
|-----------|-------|-------|
| SVG viewBox width | 960 | Use `width="100%"` with a fixed viewBox for responsiveness |
| SVG viewBox height | 500 | Adjustable via slider (300–800) |
| Node radius | 25 | Adjustable via slider (15–50) |
| Edge color | `#4a7fba` | Uniform blue-gray for all edges |
| Arrow color | `#3a6a9f` | Slightly darker than edge color |
| Arrow size | 10 | Equilateral triangle at edge tip |
| Edge width range | 0.6–2.8 px | Linear scale based on weight |
| Edge opacity range | 0.2–0.55 | Linear scale based on weight |
| Edge curvature | 22 px | Only for bidirectional edges; unidirectional edges are straight |
| Node colors | `#4e79a7, #f28e2b, #e15759, #76b7b2, #59a14f, #edc948, #b07aa1, #ff9da7, #9c755f` | Cycle through for > 9 nodes |

### 4.3 Node Rendering

Each node has three layers:

1. **Donut ring** (outermost): A circular arc showing the initial probability (`inits[i]`). The arc length is proportional to the init value. The background ring is light gray (`#e0e0e0`); the filled arc uses the node's color.

   ```
   Ring radius = nodeRadius + rimWidth * 0.7
   Ring stroke width = nodeRadius * 0.18
   Arc angle = inits[i] * 2 * PI
   ```

2. **Filled circle**: The node body, colored per the palette, with a white stroke border (2.5 px) and slight transparency (opacity 0.9).

3. **Label text**: White, centered, font-weight 600. Truncate labels longer than 12 characters with an ellipsis. Reduce font size for labels > 8 characters (9 px vs 11 px).

Add a tooltip on hover showing the label and init probability: `"viewed (init: 23.5%)"`.

### 4.4 Edge Rendering

#### Bidirectional Detection

Before rendering, scan all edges. If both A→B and B→A exist with weight > 0, mark both as bidirectional. Bidirectional edges are rendered as quadratic Bezier curves with a perpendicular offset (curvature); unidirectional edges are straight lines.

```typescript
const isBidir = edges.some(e => e.from === to && e.to === from);
const curvature = isBidir ? 22 : 0;
```

#### Edge Path Computation

For curved edges, compute a quadratic Bezier curve:

1. Find the perpendicular to the line connecting source and target
2. Offset the midpoint by `curvature` pixels along this perpendicular
3. Start the path at the source node's edge (not center) — offset by `nodeRadius` along the direction toward the control point
4. End the path at `nodeRadius + arrowSize` from the target center, so the arrow tip lands at the node edge

#### Arrow Rendering

Use a polygon triangle (not SVG markers — they scale poorly):

```typescript
function arrowPoly(tipX, tipY, dirX, dirY, size) {
  const halfW = size / 2;
  const baseX = tipX - dirX * size;
  const baseY = tipY - dirY * size;
  return `${tipX},${tipY} ${baseX - dirY * halfW},${baseY + dirX * halfW} ${baseX + dirY * halfW},${baseY - dirX * halfW}`;
}
```

The arrow direction (`dirX, dirY`) comes from the tangent of the Bezier curve at the target end.

#### Edge Scaling

Scale edge width and opacity linearly based on the maximum weight across all edges (including self-loops):

```
width(w)   = 0.6 + (w / maxWeight) * (2.8 - 0.6)
opacity(w) = 0.2 + (w / maxWeight) * (0.55 - 0.2)
```

Add a tooltip on hover: `"viewed → submitted: 0.342"`.

#### Edge Labels (Optional, Togglable)

Position labels at ~55% along the Bezier curve (using the parametric `t = 0.55`). Show the weight formatted to 2 decimal places with the leading zero removed (`.34` instead of `0.34`). Font size 7 px, color `#555566`.

### 4.5 Self-Loops

Self-loops (A→A transitions) are rendered as small circular arcs outside the node, pointing away from the graph center:

1. Compute direction from graph centroid to the node
2. Place the loop center at `nodeRadius + loopRadius` along this direction (where `loopRadius = nodeRadius * 0.55`)
3. Draw an arc with a gap facing the node (gap angle ~0.4 radians on each side)
4. Add an arrow polygon at the arc endpoint, pointing toward the node
5. Position the label outside the loop, along the same outward direction

Self-loops should be togglable (checkbox, default: on). Their opacity is boosted by +0.15 compared to regular edges, and their minimum stroke width is 1.2 px.

### 4.6 SVG Layer Order

Render in this order (back to front):

1. Self-loops (paths + arrows)
2. Edges (paths + arrows + optional labels)
3. Nodes (donut rings + circles + text labels)

This ensures nodes are always on top of edges.

### 4.7 Interactive Controls

Provide these user-configurable settings (collapsible panel):

| Control | Type | Default | Range |
|---------|------|---------|-------|
| Show self-loops | Checkbox | On | — |
| Show edge labels | Checkbox | Off | — |
| Node radius | Slider | 25 | 15–50 |
| Graph height | Slider | 500 | 300–800 |
| Prune threshold | Slider | 0.05 | 0.00–0.50 |

---

## 5. Visualization 2: Distribution Plot

A stacked bar chart showing the proportion of each action at each timestep position across all sequences.

### 5.1 Data Computation

1. Find the maximum sequence length across all sequences
2. For each timestep (position 0, 1, 2, ...):
   - Count how many times each action label appears at that position across all sequences
   - Normalize to proportions (sum to 1.0 at each timestep)
3. Only include timesteps where at least a few sequences have data (e.g., timesteps where count >= 5% of total sequences)

```typescript
const maxLen = Math.max(...sequences.map(s => s.length));
for (let t = 0; t < maxLen; t++) {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const seq of sequences) {
    if (t < seq.length) {
      counts[seq[t]] = (counts[seq[t]] || 0) + 1;
      total++;
    }
  }
  // Convert counts to proportions: counts[label] / total
}
```

### 5.2 Rendering

- **X-axis**: Timestep positions (1, 2, 3, ...)
- **Y-axis**: Proportion (0.0 to 1.0)
- Each bar is a stack of colored rectangles, one per action label
- Use the same color palette as the network graph nodes
- Add a legend mapping colors to labels
- Tooltips on each segment: `"viewed at step 3: 34.2%"`

### 5.3 SVG Details

- ViewBox: `0 0 width height` (e.g., 600 x 300)
- Bar width: `(plotWidth / timestepCount) * 0.8` with 20% gap
- Axis labels: small font (10–11 px), gray color
- Grid lines: light gray, horizontal only

---

## 6. Visualization 3: Frequency Chart

A horizontal bar chart showing total occurrence counts of each action, sorted descending.

### 6.1 Data Computation

Flatten all sequences and count each action:

```typescript
const counts: Record<string, number> = {};
for (const seq of sequences) {
  for (const action of seq) {
    counts[action] = (counts[action] || 0) + 1;
  }
}
const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
```

### 6.2 Rendering

- **Y-axis**: Action labels (sorted by count, highest at top)
- **X-axis**: Count values
- Horizontal bars, colored using the same palette as the network graph
- Label each bar with its count value (positioned to the right of the bar or inside if the bar is wide enough)
- Tooltips: `"viewed: 1,234 occurrences"`

### 6.3 SVG Details

- Bar height: Fixed (e.g., 28 px) with 6 px gap
- Total SVG height: Computed dynamically from number of labels
- Bar width: Proportional to `count / maxCount * plotWidth`
- Round bar corners slightly (rx=3)

---

## 7. Dashboard Integration

### 7.1 Page Layout

Use a full-width layout (no sidebar) for maximum visualization space:

```
+------------------------------------------------------------------+
| Title                    [Course Filter] [Date Range] [Threshold] |
+------------------------------------------------------------------+
| [Users: 142]  [Events: 8609]  [Actions: 7]                      |
+------------------------------------------------------------------+
|                                                                    |
|              Network Graph (full width)                            |
|                        [Settings gear icon]                        |
|                                                                    |
+------------------------------------------------------------------+
|  Distribution Plot (50%)     |    Frequency Chart (50%)           |
|                              |                                     |
+------------------------------------------------------------------+
```

- **Network graph**: Full width, first position, largest visualization
- **Distribution + Frequency**: Side by side in a responsive grid (stack vertically on mobile)
- **Stats cards**: Compact row above the visualizations showing key metrics

### 7.2 Filter Bar

Place filters in the page header, inline with the title:

- **Scope selector** (dropdown): Filter by context (course, project, etc.)
- **Date range** (two date inputs): Start and end date
- **Prune threshold** (slider): 0.00–0.50 with current value displayed

### 7.3 Data Fetching

Use a reactive query that refetches when filters change:

```typescript
const { data, isLoading } = useQuery({
  queryKey: ['tna-sequences', scopeId, startDate, endDate],
  queryFn: () => fetchTnaSequences({ scopeId, startDate, endDate }),
});
```

Compute the TNA model client-side with memoization, keyed on the data and prune threshold. This avoids re-fetching when only the threshold changes.

### 7.4 Loading and Empty States

- Show a full-screen spinner while data loads
- Show a centered "No data available" message when sequences are empty
- Stat cards and network settings only render when data exists

### 7.5 Dark Mode

Support both light and dark themes. Key color mappings:

| Element | Light | Dark |
|---------|-------|------|
| Page background | `#f9fafb` | `#111827` |
| Card background | `#ffffff` | `#1f2937` |
| Card border | `#e5e7eb` | `#374151` |
| Primary text | `#1f2937` | `#ffffff` |
| Secondary text | `#6b7280` | `#9ca3af` |
| SVG backgrounds | Keep as-is — the node/edge colors work on both |

---

## 8. Common Pitfalls

### 8.1 Data Issues

- **Verb explosion**: Without merging and filtering, you can end up with 20+ nodes, making the graph unreadable. Always merge synonyms and filter rare actions.
- **Empty sequences**: Sequences of length 0 or 1 contribute nothing. Filter them server-side.
- **Massive datasets**: Cap database queries. TNA computation is O(N * L) where N = number of sequences and L = average length. 50,000 events is a reasonable cap.

### 8.2 Rendering Issues

- **SVG markers vs. polygon arrows**: SVG `<marker>` elements don't scale with edge width and are hard to style per-edge. Use inline `<polygon>` elements for arrows instead.
- **Edge-colored edges**: Coloring edges by their source node makes the graph visually chaotic. Use a single uniform color for all edges (blue-gray works well).
- **Missing self-loops**: Self-transitions (A→A) are often the strongest edges in behavioral data. Skipping them loses important information. Always render them (with a toggle to hide).
- **Straight bidirectional edges**: When A→B and B→A both exist as straight lines, they overlap and only one is visible. Always curve bidirectional edges.
- **Node label overflow**: Long action names break layouts. Truncate at 12 characters with ellipsis and reduce font size for labels > 8 characters.

### 8.3 Interaction Issues

- **No tooltips**: Without tooltips, users can't read exact values. Add `<title>` elements to all SVG shapes.
- **Fixed sizing**: Different datasets need different node sizes and graph heights. Make these adjustable via sliders.
- **Non-responsive SVG**: Use `width="100%"` with a fixed `viewBox` instead of fixed pixel width. This makes the graph responsive to container width.

### 8.4 Performance Issues

- **Recomputing TNA on every render**: The TNA model only needs recomputation when sequences or prune threshold change. Memoize it.
- **Fetching on threshold change**: The prune threshold only affects client-side model computation. Don't re-fetch data from the server when it changes.
- **Rendering all timesteps**: In the distribution plot, if the maximum sequence length is 200 but only 10% of users have sequences longer than 20, cap the x-axis at a reasonable cutoff.

---

## Appendix: Color Palette Reference

The recommended 9-color palette (colorblind-friendly, good contrast on both light and dark backgrounds):

| Index | Hex | Name |
|-------|-----|------|
| 0 | `#4e79a7` | Steel Blue |
| 1 | `#f28e2b` | Orange |
| 2 | `#e15759` | Red |
| 3 | `#76b7b2` | Teal |
| 4 | `#59a14f` | Green |
| 5 | `#edc948` | Gold |
| 6 | `#b07aa1` | Purple |
| 7 | `#ff9da7` | Pink |
| 8 | `#9c755f` | Brown |

For datasets with more than 9 unique actions, cycle through the palette. If a specific color causes readability issues (e.g., pale yellow on white backgrounds), substitute it with a darker variant.

---

## Appendix: Donut Ring Arc Formula

To draw a partial arc (for initial probability visualization):

```typescript
function donutArc(radius: number, fraction: number): string {
  if (fraction <= 0) return '';
  if (fraction >= 0.9999) {
    // Full circle: two semicircles (SVG can't draw a full arc)
    return `M 0 ${-radius} A ${radius} ${radius} 0 1 1 0 ${radius} A ${radius} ${radius} 0 1 1 0 ${-radius}`;
  }
  const angle = fraction * 2 * Math.PI;
  const endX = radius * Math.sin(angle);
  const endY = -radius * Math.cos(angle);
  const largeArc = angle > Math.PI ? 1 : 0;
  return `M 0 ${-radius} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;
}
```

Place this arc inside a `<g transform="translate(nodeX, nodeY)">` group centered on the node.

---

## Appendix: Self-Loop Geometry

Self-loops are drawn as circular arcs outside the node, pointing away from the graph center:

1. **Direction**: Compute the unit vector from graph centroid to the node position
2. **Loop center**: Place at `nodeCenter + direction * (nodeRadius + loopRadius)` where `loopRadius = nodeRadius * 0.55`
3. **Arc**: Draw a nearly-full circle (gap of ~0.8 radians facing the node) using SVG arc commands
4. **Arrow**: Place a polygon arrow at the arc endpoint, pointing back toward the node
5. **Label**: Position outside the loop along the outward direction

This ensures self-loops don't overlap with the node or other edges and are visually distinct.
