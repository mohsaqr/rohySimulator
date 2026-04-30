# Implementing a TNA Dashboard in Moodle

A practical implementation guide for building a Transition Network Analysis (TNA) dashboard as a Moodle local plugin. This guide is based on a working implementation in a clinical simulation platform and adapted for Moodle's architecture.

---

## 1. What You're Building

A dashboard that analyzes sequential student actions (from Moodle's log store) and visualizes them as:

1. **Network Graph** — Directed weighted graph where nodes are action types and edges show transition probabilities
2. **Distribution Plot** — Stacked bar chart showing action proportions at each timestep position
3. **InStrength Centrality Chart** — Horizontal bar chart showing incoming edge weight totals per node
4. **Frequency Chart** — Horizontal bar chart showing total action counts
5. **Behavioral Clustering** — Levenshtein distance + Ward's hierarchical clustering groups students by sequence similarity, producing separate visualizations per cluster

The dashboard lives under Site Administration or as a course-level report, rendered as a full-page view.

---

## 2. Plugin Structure

Create a Moodle local plugin:

```
local/tna/
  version.php
  settings.php           -- Admin settings page registration
  lang/en/local_tna.php  -- Language strings
  classes/
    tna_model.php         -- TNA computation (transition matrix, pruning)
    sequence_extractor.php -- Extract action sequences from log store
  amd/src/
    dashboard.js          -- Main dashboard controller (AMD module)
    network_graph.js      -- SVG circular network graph
    distribution_plot.js  -- SVG stacked bar chart
    frequency_chart.js    -- SVG horizontal bar chart
    tna_utils.js          -- Client-side TNA computation + clustering
    tna_colors.js         -- Color palette constants + cluster colors
  amd/build/              -- Minified AMD modules (grunt)
  templates/
    dashboard.mustache    -- Main dashboard template
  db/
    access.php            -- Capabilities (local/tna:view)
  index.php               -- Dashboard entry point
  ajax.php                -- AJAX endpoint (or use external functions)
  lib.php                 -- Navigation hooks
```

---

## 3. Data Pipeline

### 3.1 Source: Moodle Log Store

Moodle's `mdl_logstore_standard_log` table contains all user actions:

| Column | Use |
|--------|-----|
| `userid` | Groups events into per-user sequences |
| `eventname` | The action (e.g., `\mod_quiz\event\attempt_started`) |
| `timecreated` | Orders events chronologically |
| `courseid` | Scope filter |
| `contextlevel`, `contextinstanceid` | Activity-level filtering |

### 3.2 Sequence Extraction (PHP)

```php
class sequence_extractor {

    // Verb merge map: collapse Moodle's granular event names into meaningful categories
    const VERB_MERGE_MAP = [
        // Navigation
        '\core\event\course_viewed'              => 'NAVIGATION',
        '\mod_page\event\course_module_viewed'    => 'NAVIGATION',
        '\mod_resource\event\course_module_viewed' => 'VIEWED_RESOURCE',
        '\mod_url\event\course_module_viewed'     => 'VIEWED_RESOURCE',
        '\mod_folder\event\course_module_viewed'  => 'VIEWED_RESOURCE',
        '\mod_book\event\course_module_viewed'    => 'VIEWED_RESOURCE',

        // Quiz/Assessment
        '\mod_quiz\event\attempt_started'         => 'QUIZ_ATTEMPT',
        '\mod_quiz\event\attempt_submitted'       => 'QUIZ_SUBMIT',
        '\mod_quiz\event\attempt_reviewed'        => 'QUIZ_REVIEW',
        '\mod_quiz\event\attempt_viewed'          => 'QUIZ_ATTEMPT',

        // Assignment
        '\mod_assign\event\submission_created'    => 'ASSIGNMENT_SUBMIT',
        '\mod_assign\event\assessable_submitted'  => 'ASSIGNMENT_SUBMIT',
        '\mod_assign\event\submission_viewed'     => 'ASSIGNMENT_VIEW',
        '\mod_assign\event\grading_form_viewed'   => 'ASSIGNMENT_VIEW',

        // Forum
        '\mod_forum\event\discussion_viewed'      => 'FORUM_READ',
        '\mod_forum\event\post_created'           => 'FORUM_POST',
        '\mod_forum\event\discussion_created'     => 'FORUM_POST',

        // Messaging
        '\core\event\message_sent'                => 'SENT_MESSAGE',
        '\core\event\message_viewed'              => 'VIEWED_MESSAGE',

        // Grades
        '\core\event\user_graded'                 => 'GRADED',
        '\mod_assign\event\submission_graded'     => 'GRADED',
        '\core\event\grade_report_viewed'         => 'VIEWED_GRADES',

        // System events to exclude (map to null)
        '\core\event\user_loggedin'               => null,
        '\core\event\user_loggedout'              => null,
        '\core\event\dashboard_viewed'            => null,
    ];

    public static function extract(int $courseid, int $startdate = 0, int $enddate = 0,
                                    float $min_verb_pct = 0.05, int $limit = 50000): array {
        global $DB;

        // Step 1: Query log store
        $params = ['courseid' => $courseid];
        $where = "courseid = :courseid AND userid > 0";
        if ($startdate > 0) {
            $where .= " AND timecreated >= :startdate";
            $params['startdate'] = $startdate;
        }
        if ($enddate > 0) {
            $where .= " AND timecreated <= :enddate";
            $params['enddate'] = $enddate;
        }

        $sql = "SELECT userid, eventname, timecreated
                FROM {logstore_standard_log}
                WHERE $where
                ORDER BY userid, timecreated ASC";

        $records = $DB->get_records_sql($sql, $params, 0, $limit);

        // Step 2: Apply verb merge map
        $merged = [];
        foreach ($records as $record) {
            $mapped = self::VERB_MERGE_MAP[$record->eventname] ?? $record->eventname;
            if ($mapped === null) continue; // Excluded event
            $merged[] = (object)['userid' => $record->userid, 'verb' => $mapped];
        }

        // Step 3: Count verb frequencies, filter rare verbs
        $verb_counts = [];
        foreach ($merged as $m) {
            $verb_counts[$m->verb] = ($verb_counts[$m->verb] ?? 0) + 1;
        }
        $total = count($merged);
        $rare_verbs = [];
        foreach ($verb_counts as $verb => $count) {
            if ($count / $total < $min_verb_pct) {
                $rare_verbs[$verb] = true;
            }
        }

        // Step 4: Replace rare verbs with OTHER, group by user, collapse consecutive duplicates
        $user_sequences = [];
        foreach ($merged as $m) {
            $verb = isset($rare_verbs[$m->verb]) ? 'OTHER' : $m->verb;
            $uid = $m->userid;
            if (!isset($user_sequences[$uid])) {
                $user_sequences[$uid] = [];
            }
            $seq = &$user_sequences[$uid];
            // Collapse consecutive duplicates
            if (empty($seq) || end($seq) !== $verb) {
                $seq[] = $verb;
            }
        }

        // Step 5: Filter sequences with length < 2, preserving user_id mapping
        $filtered_user_sequences = [];
        foreach ($user_sequences as $uid => $seq) {
            if (count($seq) >= 2) {
                $filtered_user_sequences[$uid] = $seq;
            }
        }
        $sequences = array_values($filtered_user_sequences);

        // Collect unique verbs
        $unique_verbs = [];
        foreach ($sequences as $seq) {
            foreach ($seq as $v) {
                $unique_verbs[$v] = true;
            }
        }

        return [
            'sequences' => $sequences,
            'userSequences' => $filtered_user_sequences,
            'metadata' => [
                'totalUsers' => count($sequences),
                'totalEvents' => count($records),
                'uniqueVerbs' => array_keys($unique_verbs),
                'dateRange' => ['start' => $startdate, 'end' => $enddate],
            ],
        ];
    }
}
```

**Important:** The response returns both `sequences` (flat array for single-model TNA) and `userSequences` (userid→sequence mapping for clustering). This is backward-compatible — existing code that only reads `sequences` still works.

### 3.3 Key Design Decisions for Verb Merging

The verb merge map is the most important decision. Without it, Moodle produces 100+ distinct event names that make the graph unreadable. Principles:

- **Group by intent, not by module**: `\mod_page\event\course_module_viewed` and `\mod_resource\event\course_module_viewed` are both "viewing a resource"
- **Separate read from write**: Viewing a forum vs posting to a forum are distinct behaviors
- **Exclude system events**: Logins, logouts, dashboard views add noise
- **Keep assessment stages separate**: Starting, submitting, and reviewing a quiz represent different learning behaviors
- **Aim for 7-12 final labels**: More than 15 makes the graph cluttered, fewer than 5 loses nuance

### 3.4 Rare Verb Filtering

Actions appearing in less than 5% of total events are replaced with "OTHER", then consecutive "OTHER" entries are collapsed. This is done server-side before sending to the client. Make the threshold configurable.

---

## 4. AJAX Endpoint

Expose the data via Moodle's external functions API or a simple AJAX handler:

```php
// ajax.php
require_once('../../config.php');
require_login();
require_capability('local/tna:view', context_course::instance($courseid));

$courseid = required_param('courseid', PARAM_INT);
$startdate = optional_param('startdate', 0, PARAM_INT);
$enddate = optional_param('enddate', 0, PARAM_INT);

$result = \local_tna\sequence_extractor::extract($courseid, $startdate, $enddate);
echo json_encode($result);
```

---

## 5. TNA Computation (Client-Side JavaScript)

Compute the TNA model in the browser. It's fast even for hundreds of sequences and avoids recomputing when only the prune threshold changes.

### 5.1 Core Algorithm

```javascript
// amd/src/tna_utils.js
define([], function() {

    /**
     * Build transition probability matrix from sequences.
     * @param {string[][]} sequences
     * @param {string[]} labels - Ordered unique action labels
     * @returns {{ labels: string[], weights: number[][], inits: Float64Array }}
     */
    function tna(sequences, labels) {
        var n = labels.length;
        var labelIndex = {};
        labels.forEach(function(l, i) { labelIndex[l] = i; });

        // Count transitions
        var counts = [];
        for (var i = 0; i < n; i++) {
            counts[i] = new Float64Array(n);
        }
        var initCounts = new Float64Array(n);

        sequences.forEach(function(seq) {
            if (seq.length === 0) return;
            var first = labelIndex[seq[0]];
            if (first !== undefined) initCounts[first]++;

            for (var k = 0; k < seq.length - 1; k++) {
                var from = labelIndex[seq[k]];
                var to = labelIndex[seq[k + 1]];
                if (from !== undefined && to !== undefined) {
                    counts[from][to]++;
                }
            }
        });

        // Normalize rows to probabilities
        var weights = counts.map(function(row) {
            var sum = 0;
            for (var j = 0; j < row.length; j++) sum += row[j];
            if (sum === 0) return Array.from(row);
            return Array.from(row, function(v) { return v / sum; });
        });

        // Normalize initial probabilities
        var initSum = 0;
        for (var i = 0; i < initCounts.length; i++) initSum += initCounts[i];
        var inits = initSum > 0
            ? new Float64Array(Array.from(initCounts, function(v) { return v / initSum; }))
            : new Float64Array(n);

        return { labels: labels, weights: weights, inits: inits };
    }

    /**
     * Zero out transition weights below threshold.
     */
    function prune(model, threshold) {
        var pruned = model.weights.map(function(row) {
            return row.map(function(w) { return w >= threshold ? w : 0; });
        });
        return { labels: model.labels, weights: pruned, inits: model.inits };
    }

    /**
     * Find max value in 2D weight matrix.
     */
    function maxWeight(weights) {
        var max = 0;
        weights.forEach(function(row) {
            row.forEach(function(w) { if (w > max) max = w; });
        });
        return max;
    }

    /**
     * Levenshtein edit distance between two string arrays.
     * Matches the R tna package's string-distance approach via stringdist.
     * @param {string[]} a - First sequence
     * @param {string[]} b - Second sequence
     * @returns {number} Edit distance
     */
    function seqDistance(a, b) {
        var m = a.length;
        var n = b.length;
        var prev = new Uint32Array(n + 1);
        var curr = new Uint32Array(n + 1);
        for (var j = 0; j <= n; j++) prev[j] = j;
        for (var i = 1; i <= m; i++) {
            curr[0] = i;
            for (var j2 = 1; j2 <= n; j2++) {
                var cost = a[i - 1] === b[j2 - 1] ? 0 : 1;
                curr[j2] = Math.min(prev[j2] + 1, curr[j2 - 1] + 1, prev[j2 - 1] + cost);
            }
            var tmp = prev; prev = curr; curr = tmp;
        }
        return prev[n];
    }

    /**
     * Ward's D2 hierarchical clustering with Lance-Williams update.
     * O(n^3) — efficient for up to ~500 items.
     * Cuts dendrogram at k clusters.
     *
     * @param {Float64Array} rawDist - Flat n×n distance matrix (Levenshtein)
     * @param {number} n - Number of items
     * @param {number} k - Desired number of clusters
     * @returns {number[]} Cluster assignments (0 to k-1)
     */
    function wardCluster(rawDist, n, k) {
        if (n <= k) {
            var trivial = [];
            for (var t = 0; t < n; t++) trivial[t] = t;
            return trivial;
        }

        // Ward's operates on squared distances
        var D = new Float64Array(n * n);
        for (var i = 0; i < n * n; i++) {
            D[i] = rawDist[i] * rawDist[i];
        }

        var size = new Float64Array(n);
        for (var s = 0; s < n; s++) size[s] = 1;

        var parent = new Int32Array(n);
        for (var p = 0; p < n; p++) parent[p] = p;

        function root(x) {
            while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
            return x;
        }

        var active = new Uint8Array(n);
        for (var a = 0; a < n; a++) active[a] = 1;
        var numActive = n;

        while (numActive > k) {
            // Find pair of active clusters with minimum Ward distance
            var minD = Infinity, mi = -1, mj = -1;
            for (var i2 = 0; i2 < n; i2++) {
                if (!active[i2]) continue;
                for (var j = i2 + 1; j < n; j++) {
                    if (!active[j]) continue;
                    var d = D[i2 * n + j];
                    if (d < minD) { minD = d; mi = i2; mj = j; }
                }
            }
            if (mi < 0) break;

            // Merge mj into mi using Lance-Williams formula for Ward's D2
            var ni = size[mi], nj = size[mj];
            for (var q = 0; q < n; q++) {
                if (!active[q] || q === mi || q === mj) continue;
                var nq = size[q];
                var totalN = ni + nj + nq;
                var newD = ((nq + ni) * D[q * n + mi] + (nq + nj) * D[q * n + mj]
                            - nq * D[mi * n + mj]) / totalN;
                D[q * n + mi] = newD;
                D[mi * n + q] = newD;
            }

            size[mi] = ni + nj;
            active[mj] = 0;
            parent[mj] = mi;
            numActive--;
        }

        // Assign each item to its root cluster, then renumber 0..k-1
        var roots = {};
        var assign = new Array(n);
        for (var i3 = 0; i3 < n; i3++) {
            assign[i3] = root(i3);
            roots[assign[i3]] = true;
        }
        var remap = {};
        var idx = 0;
        for (var r in roots) { remap[r] = idx++; }
        return assign.map(function(a) { return remap[a]; });
    }

    /**
     * Cluster user sequences by behavioral similarity.
     * Uses Levenshtein string distance + Ward's hierarchical clustering,
     * matching the R tna package's cluster_sequences approach.
     *
     * @param {Object} userSequences - { userId: string[] } mapping
     * @param {string[]} labels - Ordered label list
     * @param {number} k - Number of clusters
     * @returns {{ id: number, userIds: string[], sequences: string[][] }[]}
     */
    function clusterSequences(userSequences, labels, k) {
        var userIds = Object.keys(userSequences);
        var seqs = userIds.map(function(uid) { return userSequences[uid]; });
        var m = seqs.length;

        if (m <= k) {
            return seqs.map(function(seq, i) {
                return { id: i, userIds: [userIds[i]], sequences: [seq] };
            });
        }

        // Build pairwise Levenshtein distance matrix
        var dist = new Float64Array(m * m);
        for (var i = 0; i < m; i++) {
            for (var j = i + 1; j < m; j++) {
                var d = seqDistance(seqs[i], seqs[j]);
                dist[i * m + j] = d;
                dist[j * m + i] = d;
            }
        }

        var assignments = wardCluster(dist, m, k);

        // Group by cluster
        var groups = {};
        for (var i2 = 0; i2 < m; i2++) {
            var c = assignments[i2];
            if (!groups[c]) groups[c] = { userIds: [], sequences: [] };
            groups[c].userIds.push(userIds[i2]);
            groups[c].sequences.push(seqs[i2]);
        }

        var clusters = [];
        for (var key in groups) {
            var g = groups[key];
            clusters.push({ id: clusters.length, userIds: g.userIds, sequences: g.sequences });
        }
        return clusters;
    }

    /**
     * Compute centrality metrics for each node in a TNA model.
     * Matches the R tna package centralities() function.
     * @param {{ labels: string[], weights: number[][] }} model
     * @returns {{ label: string, inStrength: number, outStrength: number }[]}
     */
    function centralities(model) {
        var labels = model.labels;
        var weights = model.weights;
        var n = labels.length;

        var result = labels.map(function(label, i) {
            var outStrength = 0, inStrength = 0;
            for (var j = 0; j < n; j++) {
                outStrength += weights[i][j];
                inStrength += weights[j][i];
            }
            return {
                label: label,
                inStrength: Math.round(inStrength * 1000) / 1000,
                outStrength: Math.round(outStrength * 1000) / 1000
            };
        });
        result.sort(function(a, b) { return b.inStrength - a.inStrength; });
        return result;
    }

    return {
        tna: tna,
        prune: prune,
        maxWeight: maxWeight,
        seqDistance: seqDistance,
        wardCluster: wardCluster,
        clusterSequences: clusterSequences,
        centralities: centralities
    };
});
```

### 5.2 How It Works

Given sequences like `[["A","B","C"], ["B","A","A","C"]]`:

1. **Count transitions**: A→B: 1, B→C: 1, B→A: 1, A→A: 1, A→C: 1
2. **Normalize per row**: Row A sums to 3 transitions → A→B: 0.33, A→A: 0.33, A→C: 0.33
3. **Initial probabilities**: A starts 1 sequence, B starts 1 → A: 0.5, B: 0.5
4. **Prune**: At threshold 0.05, all weights above 0.05 survive. At 0.34, the A→B, A→A, A→C edges would be pruned.

### 5.3 Clustering Algorithm

The clustering groups students who exhibit similar behavioral patterns, matching the R `tna` package's `cluster_sequences()` approach:

1. **Pairwise distance matrix**: Compute Levenshtein edit distance between every pair of user sequences. This measures how many insertions, deletions, or substitutions are needed to transform one sequence into another.
2. **Ward's D2 hierarchical clustering**: Agglomerative clustering using Ward's minimum variance method with Lance-Williams update formula. Operates on squared distances. O(n³) complexity — efficient for up to ~500 users.
3. **Dendrogram cut**: The dendrogram is cut at k clusters. Each item's cluster is determined by tracing to its root in the merge tree.
4. **Grouping**: Sequences are grouped by cluster assignment. The resulting clusters contain users with similar behavioral sequences.
5. **Per-cluster TNA**: Each cluster's sequences are fed into `tna()` independently, producing separate transition matrices and initial probability vectors.

**Why Levenshtein distance?** Unlike transition-matrix similarity (which loses ordering info), Levenshtein distance captures the full sequential structure: two students who do A→B→C→D are close, while A→D→C→B is far despite identical action frequencies. This matches the R `tna` package's use of `stringdist` for sequence comparison.

### 5.4 InStrength Centrality

The `centralities()` function computes how "important" each action is as a transition target:

- **InStrength**: Sum of all incoming transition probabilities for a node: `Σ weights[j][i]` for all j
- **OutStrength**: Sum of all outgoing transition probabilities: `Σ weights[i][j]` for all j
- Results are sorted by InStrength descending

Rendered as a horizontal bar chart (same color palette as network graph). High InStrength nodes are frequent destinations in the transition network — they represent actions that students commonly transition *to*.

---

## 6. Visualizations (Pure SVG)

All three charts are rendered as inline SVG in the DOM. No charting library required.

### 6.1 Color Palette

Use this 9-color colorblind-friendly palette consistently across all three visualizations:

```javascript
var NODE_COLORS = [
    '#4e79a7', // Steel Blue
    '#f28e2b', // Orange
    '#e15759', // Red
    '#76b7b2', // Teal
    '#59a14f', // Green
    '#edc948', // Gold
    '#b07aa1', // Purple
    '#ff9da7', // Pink
    '#9c755f', // Brown
];
var EDGE_COLOR = '#4a7fba';
var ARROW_COLOR = '#3a6a9f';

// Accent colors for cluster panels (max k=5)
var CLUSTER_COLORS = [
    '#6366f1', // Indigo
    '#f59e0b', // Amber
    '#10b981', // Emerald
    '#ef4444', // Red
    '#8b5cf6', // Violet
];
```

### 6.2 Network Graph

The main visualization. Circular layout with nodes representing actions and edges representing transition probabilities.

**Layout:**
```
Angle for node i = (2 * PI * i / N) - PI/2    // Start from top
x = centerX + radius * cos(angle)
y = centerY + radius * sin(angle)
radius = min(width, height) / 2 - nodeRadius - 45
```

**Nodes (3 layers per node):**

1. **Donut ring** — Circular arc showing initial probability. Arc length = `inits[i] * 2π`. Background ring is light gray `#e0e0e0`, filled arc uses the node's color. Ring radius = `nodeRadius + rimWidth * 0.7`, stroke width = `nodeRadius * 0.18`.

2. **Filled circle** — Node body colored per palette, white stroke border (2.5px), opacity 0.9.

3. **Label text** — White, centered, font-weight 600. Truncate labels > 12 chars with ellipsis. Reduce font size for labels > 8 chars (9px vs 11px).

**Donut arc SVG path formula:**
```javascript
function donutArc(radius, fraction) {
    if (fraction <= 0) return '';
    if (fraction >= 0.9999) {
        // Full circle needs two semicircles (SVG limitation)
        return 'M 0 ' + (-radius) + ' A ' + radius + ' ' + radius +
               ' 0 1 1 0 ' + radius + ' A ' + radius + ' ' + radius +
               ' 0 1 1 0 ' + (-radius);
    }
    var angle = fraction * 2 * Math.PI;
    var endX = radius * Math.sin(angle);
    var endY = -radius * Math.cos(angle);
    var largeArc = angle > Math.PI ? 1 : 0;
    return 'M 0 ' + (-radius) + ' A ' + radius + ' ' + radius +
           ' 0 ' + largeArc + ' 1 ' + endX + ' ' + endY;
}
```

**Edges:**

- **Bidirectional detection**: If both A→B and B→A exist with weight > 0, both are curved. Otherwise straight.
- **Curved edges**: Quadratic Bezier with 22px perpendicular offset at midpoint.
- **Straight edges**: Direct line between node edges.
- **Arrows**: Use `<polygon>` triangles, NOT SVG `<marker>` elements (markers don't scale per-edge).
- **Width**: Linear scale `0.6 + (weight / maxWeight) * 2.2` px
- **Opacity**: Linear scale `0.2 + (weight / maxWeight) * 0.35`

**Arrow polygon formula:**
```javascript
function arrowPoly(tipX, tipY, dirX, dirY, size) {
    var halfW = size / 2;
    var baseX = tipX - dirX * size;
    var baseY = tipY - dirY * size;
    return tipX + ',' + tipY + ' ' +
           (baseX - dirY * halfW) + ',' + (baseY + dirX * halfW) + ' ' +
           (baseX + dirY * halfW) + ',' + (baseY - dirX * halfW);
}
```

**Self-loops:**
- Rendered as circular arcs outside the node, pointing away from the graph center.
- Loop center placed at `nodeCenter + direction * (nodeRadius + loopRadius)` where `loopRadius = nodeRadius * 0.55`.
- Gap angle of 0.4 radians at the node-facing side creates the arc opening.
- **Arrow direction**: Use the arc tangent at the endpoint, NOT the radial vector to node center. Compute the tangent from `endAngle`, then verify orientation with a dot-product check:
```javascript
var arrowDirX = Math.sin(endAngle);
var arrowDirY = -Math.cos(endAngle);
var toNodeX = node.x - ex;
var toNodeY = node.y - ey;
var dot = arrowDirX * toNodeX + arrowDirY * toNodeY;
var finalDirX = dot >= 0 ? arrowDirX : -arrowDirX;
var finalDirY = dot >= 0 ? arrowDirY : -arrowDirY;
```
- Togglable via checkbox (default: on). Opacity boosted +0.15, min stroke width 1.2px.

**SVG layer order (back to front):**
1. Self-loops (paths + arrows)
2. Edges (paths + arrows + optional labels)
3. Nodes (donut rings + circles + text)

**Interactive controls (collapsible panel):**
| Control | Type | Default | Range |
|---------|------|---------|-------|
| Show self-loops | Checkbox | On | — |
| Show edge labels | Checkbox | Off | — |
| Node radius | Slider | 25 | 15–50 |
| Graph height | Slider | 500 | 300–800 |
| Prune threshold | Slider | 0.05 | 0.00–0.50 |

**SVG container:** Use `viewBox="0 0 960 {height}"` with `width="100%"` for responsiveness. Never use fixed pixel width.

### 6.3 Distribution Plot

Stacked bar chart showing what proportion of students are doing each action at each timestep.

**Data computation:**
```
For each timestep t = 0, 1, 2, ...:
  Count how many times each action appears at position t across all sequences
  Normalize counts to proportions (sum = 1.0)
  Only include timesteps where count >= 5% of total sequences
```

- X-axis: timestep positions (1, 2, 3, ...)
- Y-axis: proportion 0–1
- Bar width: `(plotWidth / timestepCount) * 0.8` with 20% gaps
- Same color palette as network graph
- Tooltips on each segment: `"QUIZ_ATTEMPT at step 3: 34.2%"`
- Legend row below the chart

### 6.4 Frequency Chart

Horizontal bar chart showing total occurrence count per action, sorted descending.

- Flatten all sequences, count each action
- Sort by count descending (highest at top)
- Fixed bar height: 28px with 6px gap
- SVG height computed dynamically from number of labels
- Bar width proportional to `count / maxCount * plotWidth`
- Rounded corners (rx=3)
- Count label to the right of each bar
- Tooltips: `"NAVIGATION: 1,234 occurrences"`

### 6.5 Tooltips

Add `<title>` elements inside every interactive SVG element. This gives native browser tooltips without any JS:

```html
<g>
  <title>NAVIGATION → QUIZ_ATTEMPT: 0.342</title>
  <path d="..." />
  <polygon points="..." />
</g>
```

---

## 7. Dashboard Page Layout

The dashboard operates in two modes depending on whether clustering is enabled.

### 7.1 Without Clustering (Single Model)

```
+------------------------------------------------------------------+
| ← Back   TNA Analytics      [Course ▼] [From] [To]              |
+------------------------------------------------------------------+
| Clusters: [Off] [2] [3] [4] [5]    Prune: [===|====] 0.05      |
+------------------------------------------------------------------+
| Users: 142  |  Events: 8,609  |  Actions: 10                    |
+------------------------------------------------------------------+
| ┌─ Network Graph ──────────┐  ┌─ Distribution Plot ────────┐    |
| │                          │  │                             │    |
| │                          │  │                             │    |
| └──────────────────────────┘  └─────────────────────────────┘    |
| ┌─ InStrength Centrality ──┐  ┌─ Frequency Chart ──────────┐    |
| │                          │  │                             │    |
| └──────────────────────────┘  └─────────────────────────────┘    |
+------------------------------------------------------------------+
```

### 7.2 With Clustering (e.g., k=3) — Tab Navigation

```
+------------------------------------------------------------------+
| ← Back   TNA Analytics      [Course ▼] [From] [To]              |
+------------------------------------------------------------------+
| Clusters: [Off] [2] [3] [4] [5]    Prune: [===|====] 0.05      |
+------------------------------------------------------------------+
| Users: 142  |  Events: 8,609  |  Actions: 10  |  Clusters: 3    |
+------------------------------------------------------------------+
| [<] [● Cluster 1 (58)] [● Cluster 2 (47)] [● Cluster 3 (37)] [>]|
+------------------------------------------------------------------+
| ● Cluster 1 — 58 students                                       |
| ┌─ Network Graph ──────────┐  ┌─ Distribution Plot ────────┐    |
| │                          │  │                             │    |
| │                          │  │                             │    |
| └──────────────────────────┘  └─────────────────────────────┘    |
| ┌─ InStrength Centrality ──┐  ┌─ Frequency Chart ──────────┐    |
| │                          │  │                             │    |
| └──────────────────────────┘  └─────────────────────────────┘    |
+------------------------------------------------------------------+
```

**Key layout rules:**
- All modes use a **2×2 grid**: Network | Distribution / InStrength Centrality | Frequency
- When clustering is active, a **tab navigation bar** appears with colored dots + student counts
- Only **one cluster is visible at a time** — click tabs or use prev/next arrows to switch
- Active tab is highlighted; switching tabs scrolls content to top
- Each cluster's network card has a colored left border accent from `CLUSTER_COLORS`
- A cluster title with colored dot and student count appears above the grid

### 7.3 Mustache Template

```mustache
{{! templates/dashboard.mustache }}
<div id="local-tna-dashboard" data-courseid="{{courseid}}">
    {{! Header }}
    <div class="tna-header">
        <a href="{{backurl}}" class="tna-back-btn">&larr; Back</a>
        <h2>TNA Analytics</h2>
        <select id="tna-course-filter">
            {{#courses}}
            <option value="{{id}}">{{fullname}}</option>
            {{/courses}}
        </select>
        <input type="date" id="tna-start-date" />
        <input type="date" id="tna-end-date" />
    </div>

    {{! Controls bar }}
    <div class="tna-controls">
        <div class="tna-cluster-selector">
            <span>Clusters:</span>
            <button class="tna-cluster-btn active" data-k="">Off</button>
            <button class="tna-cluster-btn" data-k="2">2</button>
            <button class="tna-cluster-btn" data-k="3">3</button>
            <button class="tna-cluster-btn" data-k="4">4</button>
            <button class="tna-cluster-btn" data-k="5">5</button>
        </div>
        <label class="tna-prune-control">
            Prune: <span id="tna-prune-value">0.05</span>
            <input type="range" id="tna-prune-slider" min="0" max="0.5" step="0.01" value="0.05" />
        </label>
    </div>

    {{! Stats }}
    <div id="tna-stats" class="tna-stats"></div>

    {{! Cluster navigation tabs (shown when clustering is active) }}
    <div id="tna-cluster-tabs" class="tna-cluster-tabs" style="display:none">
        <button id="tna-prev-cluster" class="tna-nav-btn">&lsaquo;</button>
        <div id="tna-tab-buttons" class="tna-tab-buttons"></div>
        <button id="tna-next-cluster" class="tna-nav-btn">&rsaquo;</button>
    </div>

    {{! 2×2 visualization grid (one cluster at a time, or single model) }}
    <div id="tna-viz-grid" class="tna-viz-grid">
        <div id="tna-network" class="tna-viz-cell"></div>
        <div id="tna-distribution" class="tna-viz-cell"></div>
        <div id="tna-centrality" class="tna-viz-cell"></div>
        <div id="tna-frequency" class="tna-viz-cell"></div>
    </div>

    <div id="tna-loading" class="tna-loading">Loading...</div>
    <div id="tna-empty" class="tna-empty" style="display:none">
        No learning activity data available for this course.
    </div>
</div>
```

### 7.4 CSS for Layout

```css
/* 2×2 visualization grid */
#local-tna-dashboard .tna-viz-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    padding: 1rem;
}
@media (max-width: 1024px) {
    #local-tna-dashboard .tna-viz-grid {
        grid-template-columns: 1fr;
    }
}
#local-tna-dashboard .tna-viz-cell {
    background: #262626;
    border: 1px solid #404040;
    border-radius: 0.5rem;
    padding: 1rem;
}

/* Cluster navigation tabs */
#local-tna-dashboard .tna-cluster-tabs {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1.5rem;
    border-bottom: 1px solid #333;
}
#local-tna-dashboard .tna-tab-buttons {
    display: flex;
    gap: 0.25rem;
}
#local-tna-dashboard .tna-tab-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 6px 12px;
    border-radius: 0.5rem;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    background: transparent;
    color: #9ca3af;
    border: none;
    transition: all 0.15s;
}
#local-tna-dashboard .tna-tab-btn:hover {
    background: #262626;
    color: white;
}
#local-tna-dashboard .tna-tab-btn.active {
    background: #404040;
    color: white;
}
#local-tna-dashboard .tna-tab-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}
#local-tna-dashboard .tna-nav-btn {
    padding: 4px;
    border-radius: 4px;
    background: transparent;
    color: #9ca3af;
    border: none;
    cursor: pointer;
}
#local-tna-dashboard .tna-nav-btn:hover {
    background: #262626;
    color: white;
}
#local-tna-dashboard .tna-nav-btn:disabled {
    opacity: 0.3;
    cursor: default;
}

/* Cluster count selector */
#local-tna-dashboard .tna-cluster-btn {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    background: #262626;
    color: #9ca3af;
    border: none;
}
#local-tna-dashboard .tna-cluster-btn.active {
    background: #7c3aed;
    color: white;
}
```

### 7.5 Data Flow

```
User changes filter    → AJAX fetch → JSON response → cache sequences + userSequences
                                                      ↓
Cluster selector change → clusterSequences(userSequences, labels, k) → tna() per cluster
                                                      ↓
Prune slider change    → prune() on cached models → re-render SVGs (no refetch, no recluster)
```

**Three levels of caching:**
1. **Fetch**: Only when course/date filters change
2. **Cluster + TNA**: Only when cluster count changes (reuses cached sequences)
3. **Prune**: Only applies threshold to cached models (cheapest operation)

---

## 8. Moodle-Specific Considerations

### 8.1 AMD Modules
Moodle uses RequireJS (AMD). All JS must be in `amd/src/` and built with `grunt amd`:
```bash
cd /path/to/moodle
npx grunt amd --root=local/tna
```

### 8.2 Capabilities
Define in `db/access.php`:
```php
$capabilities = [
    'local/tna:view' => [
        'captype' => 'read',
        'contextlevel' => CONTEXT_COURSE,
        'archetypes' => [
            'editingteacher' => CAP_ALLOW,
            'manager' => CAP_ALLOW,
        ],
    ],
];
```

### 8.3 Navigation
Add to course navigation in `lib.php`:
```php
function local_tna_extend_navigation_course($navigation, $course, $context) {
    if (has_capability('local/tna:view', $context)) {
        $url = new moodle_url('/local/tna/index.php', ['courseid' => $course->id]);
        $navigation->add('TNA Analytics', $url, navigation_node::TYPE_CUSTOM, null, 'tna');
    }
}
```

### 8.4 Performance
- Always cap the log store query: `LIMIT 50000`
- Moodle log tables can be huge. Index usage is critical — `courseid + timecreated` should already be indexed.
- Consider caching the extracted sequences in `mdl_cache` if courses have 100k+ events.
- Ward's clustering with Levenshtein distance is O(n³) where n = number of users. For 100 users it takes <100ms, for 500 users ~1-2s. If you have 1000+ users, consider pre-computing clusters server-side or using a web worker.

### 8.5 Theme Compatibility
Moodle themes vary. Use Moodle's CSS classes where possible and scope custom styles:
```css
#local-tna-dashboard .tna-stats { ... }
#local-tna-dashboard .tna-chart-half { ... }
```

SVG node/edge colors work on both light and dark themes. Axis labels and grid lines should use theme-aware colors — use `var(--color-text)` or fall back to `#666` / `#ccc`.

---

## 9. Common Pitfalls

1. **Verb explosion**: Without merging, Moodle produces 100+ event names. Always merge synonyms and filter rare actions.
2. **Empty sequences**: Single-event sequences carry no transition info. Filter them server-side.
3. **SVG markers vs polygon arrows**: SVG `<marker>` elements don't scale with edge width. Always use inline `<polygon>`.
4. **Straight bidirectional edges overlap**: When A→B and B→A both exist as straight lines, only one is visible. Always curve bidirectional edges.
5. **Recomputing on every slider change**: Cache the raw sequences. Only recompute the TNA model (not refetch data) when the prune threshold changes.
6. **Long event names**: Moodle's `\mod_quiz\event\attempt_started` is way too long for a node label. The verb merge map should produce short labels (QUIZ_ATTEMPT, FORUM_POST, etc.).
7. **Guest/admin noise**: Filter out `userid = 0` (guest) and consider excluding admin users from analysis.
8. **Cron-generated events**: Some Moodle events are triggered by cron (grade calculations, completion checks). Exclude `\core\event\*_updated` events that aren't user-initiated.
9. **Self-loop arrow direction**: Do NOT use the radial vector from arc endpoint to node center for the arrow direction — it points incorrectly. Use the arc tangent at the endpoint with a dot-product orientation check (see Section 6.2).
10. **Clustering on transition matrices loses ordering**: K-means on transition matrices can produce identical clusters because sequences with different orderings map to the same matrix. Use Levenshtein edit distance on raw sequences instead — it captures the full sequential structure.
11. **Ward's clustering performance**: The O(n³) Lance-Williams Ward's algorithm works well for up to ~500 users. For larger datasets, consider server-side clustering or a web worker to avoid blocking the UI thread.
12. **Fewer clusters than requested**: Ward's hierarchical clustering always produces exactly k clusters (unless n < k), but some clusters may be very small. Display the actual cluster count and student count per cluster.

---

## 10. Suggested Verb Merge Map for Common Moodle Activities

| Merged Label | Moodle Events |
|---|---|
| NAVIGATION | `course_viewed`, `course_module_viewed` (for pages, labels) |
| VIEWED_RESOURCE | `course_module_viewed` (for resource, file, url, book, folder) |
| QUIZ_ATTEMPT | `attempt_started`, `attempt_viewed`, `question_answered` |
| QUIZ_SUBMIT | `attempt_submitted` |
| QUIZ_REVIEW | `attempt_reviewed`, `attempt_summary_viewed` |
| ASSIGNMENT_SUBMIT | `submission_created`, `assessable_submitted` |
| ASSIGNMENT_VIEW | `submission_viewed`, `submission_status_viewed` |
| FORUM_READ | `discussion_viewed`, `post_viewed` |
| FORUM_POST | `post_created`, `discussion_created` |
| SENT_MESSAGE | `message_sent` |
| VIEWED_GRADES | `grade_report_viewed`, `user_report_viewed` |
| COMPLETED | `course_module_completion_updated` |

Adapt this map based on which activity modules are used in the target Moodle instance. The map is the single most impactful configuration — get it right and the visualizations become immediately useful.
