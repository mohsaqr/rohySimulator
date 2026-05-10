// src/core/matrix.ts
var Matrix = class _Matrix {
  data;
  rows;
  cols;
  constructor(rows, cols, data) {
    this.rows = rows;
    this.cols = cols;
    if (data) {
      this.data = data instanceof Float64Array ? data : new Float64Array(data);
      if (this.data.length !== rows * cols) {
        throw new Error(
          `Data length ${this.data.length} doesn't match ${rows}x${cols}=${rows * cols}`
        );
      }
    } else {
      this.data = new Float64Array(rows * cols);
    }
  }
  /** Create from a 2D array. */
  static from2D(arr) {
    const rows = arr.length;
    if (rows === 0) return new _Matrix(0, 0);
    const cols = arr[0].length;
    const data = new Float64Array(rows * cols);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        data[i * cols + j] = arr[i][j];
      }
    }
    return new _Matrix(rows, cols, data);
  }
  /** Create a matrix filled with a value. */
  static fill(rows, cols, value) {
    const data = new Float64Array(rows * cols);
    data.fill(value);
    return new _Matrix(rows, cols, data);
  }
  /** Create a zero matrix. */
  static zeros(rows, cols) {
    return new _Matrix(rows, cols);
  }
  /** Get element at (i, j). */
  get(i, j) {
    return this.data[i * this.cols + j];
  }
  /** Set element at (i, j). */
  set(i, j, value) {
    this.data[i * this.cols + j] = value;
  }
  /** Deep copy. */
  clone() {
    return new _Matrix(this.rows, this.cols, new Float64Array(this.data));
  }
  /** Convert to 2D array. */
  to2D() {
    const result = [];
    for (let i = 0; i < this.rows; i++) {
      const row = [];
      for (let j = 0; j < this.cols; j++) {
        row.push(this.get(i, j));
      }
      result.push(row);
    }
    return result;
  }
  /** Transpose. */
  transpose() {
    const result = new _Matrix(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        result.set(j, i, this.get(i, j));
      }
    }
    return result;
  }
  /** Scalar multiply. */
  scale(s) {
    const result = new _Matrix(this.rows, this.cols);
    for (let i = 0; i < this.data.length; i++) {
      result.data[i] = this.data[i] * s;
    }
    return result;
  }
  /** Element-wise apply. */
  map(fn) {
    const result = new _Matrix(this.rows, this.cols);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        result.set(i, j, fn(this.get(i, j), i, j));
      }
    }
    return result;
  }
  /** Sum of all elements. */
  sum() {
    let s = 0;
    for (let i = 0; i < this.data.length; i++) {
      s += this.data[i];
    }
    return s;
  }
  /** Row sums as array. */
  rowSums() {
    const sums = new Float64Array(this.rows);
    for (let i = 0; i < this.rows; i++) {
      let s = 0;
      for (let j = 0; j < this.cols; j++) {
        s += this.get(i, j);
      }
      sums[i] = s;
    }
    return sums;
  }
  /** Column sums as array. */
  colSums() {
    const sums = new Float64Array(this.cols);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.cols; j++) {
        sums[j] += this.get(i, j);
      }
    }
    return sums;
  }
  /** Get diagonal as array. */
  diag() {
    const n = Math.min(this.rows, this.cols);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      d[i] = this.get(i, i);
    }
    return d;
  }
  /** Set diagonal values. */
  setDiag(value) {
    const result = this.clone();
    const n = Math.min(this.rows, this.cols);
    for (let i = 0; i < n; i++) {
      result.set(i, i, value);
    }
    return result;
  }
  /** Max element. */
  max() {
    let m = -Infinity;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] > m) m = this.data[i];
    }
    return m;
  }
  /** Min element. */
  min() {
    let m = Infinity;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] < m) m = this.data[i];
    }
    return m;
  }
  /** Count elements matching a predicate. */
  count(predicate) {
    let c = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (predicate(this.data[i])) c++;
    }
    return c;
  }
  /** Flatten to array in row-major order. */
  flatten() {
    return new Float64Array(this.data);
  }
  /** Get a row as array. */
  row(i) {
    const result = new Float64Array(this.cols);
    for (let j = 0; j < this.cols; j++) {
      result[j] = this.get(i, j);
    }
    return result;
  }
  /** Get a column as array. */
  col(j) {
    const result = new Float64Array(this.rows);
    for (let i = 0; i < this.rows; i++) {
      result[i] = this.get(i, j);
    }
    return result;
  }
  /** Is square? */
  get isSquare() {
    return this.rows === this.cols;
  }
  /** Mean of non-zero elements. */
  meanNonZero() {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] > 0) {
        sum += this.data[i];
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }
};
function rowNormalize(mat) {
  const result = mat.clone();
  for (let i = 0; i < mat.rows; i++) {
    let rowSum = 0;
    for (let j = 0; j < mat.cols; j++) {
      rowSum += mat.get(i, j);
    }
    if (rowSum === 0) rowSum = 1;
    for (let j = 0; j < mat.cols; j++) {
      result.set(i, j, mat.get(i, j) / rowSum);
    }
  }
  return result;
}
function minmaxScale(mat) {
  const minVal = mat.min();
  const maxVal = mat.max();
  if (maxVal === minVal) return Matrix.zeros(mat.rows, mat.cols);
  const range = maxVal - minVal;
  return mat.map((v) => (v - minVal) / range);
}
function maxScale(mat) {
  const maxVal = mat.max();
  if (maxVal === 0) return mat.clone();
  return mat.map((v) => v / maxVal);
}
function rankScale(mat) {
  const flat = Array.from(mat.data);
  const n = flat.length;
  const indexed = flat.map((v, i2) => ({ v, i: i2 }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      const idx = indexed[k].i;
      if (indexed[k].v === 0) {
        ranks[idx] = 0;
      } else {
        ranks[idx] = avgRank;
      }
    }
    i = j;
  }
  return new Matrix(mat.rows, mat.cols, ranks);
}
function applyScaling(mat, scaling) {
  if (!scaling) return { weights: mat.clone(), applied: [] };
  const methods = typeof scaling === "string" ? [scaling] : scaling;
  let result = mat.clone();
  const applied = [];
  for (const method of methods) {
    const m = method.toLowerCase();
    switch (m) {
      case "minmax":
        result = minmaxScale(result);
        applied.push("minmax");
        break;
      case "max":
        result = maxScale(result);
        applied.push("max");
        break;
      case "rank":
        result = rankScale(result);
        applied.push("rank");
        break;
      default:
        throw new Error(`Unknown scaling method: ${method}`);
    }
  }
  return { weights: result, applied };
}

// src/model/prepare.ts
function createSeqdata(data, options) {
  const stateSet = /* @__PURE__ */ new Set();
  for (const row of data) {
    for (const val of row) {
      if (val !== null && val !== void 0 && val !== "") {
        stateSet.add(val);
      }
    }
  }
  const labels = Array.from(stateSet).sort();
  if (options?.beginState && !labels.includes(options.beginState)) {
    labels.unshift(options.beginState);
  }
  if (options?.endState && !labels.includes(options.endState)) {
    labels.push(options.endState);
  }
  let result = data;
  if (options?.beginState) {
    result = result.map((row) => [options.beginState, ...row]);
  }
  if (options?.endState) {
    result = result.map((row) => [...row, options.endState]);
  }
  return { data: result, labels };
}
function prepareData(data, options) {
  const { data: seqData, labels } = createSeqdata(data, options);
  let totalLength = 0;
  let maxLen = 0;
  for (const row of seqData) {
    let rowLen = 0;
    for (const val of row) {
      if (val !== null && val !== void 0 && val !== "") {
        rowLen++;
      }
    }
    totalLength += rowLen;
    if (rowLen > maxLen) maxLen = rowLen;
  }
  return {
    sequenceData: seqData,
    labels,
    statistics: {
      nSessions: seqData.length,
      nUniqueActions: labels.length,
      uniqueActions: labels,
      maxSequenceLength: maxLen,
      meanSequenceLength: seqData.length > 0 ? totalLength / seqData.length : 0
    }
  };
}

// src/model/transitions.ts
function isNA(val) {
  return val === null || val === void 0 || val === "";
}
function getValidTransitions(row) {
  const result = [];
  for (let i = 0; i < row.length; i++) {
    const val = row[i];
    if (!isNA(val)) {
      result.push({ pos: i, state: val });
    }
  }
  return result;
}
function computeTransitions(data, states, type = "relative", params) {
  const nStates = states.length;
  const stateToIdx = /* @__PURE__ */ new Map();
  states.forEach((s, i) => stateToIdx.set(s, i));
  switch (type) {
    case "relative":
      return transitionsRelative(data, stateToIdx, nStates);
    case "frequency":
      return transitionsFrequency(data, stateToIdx, nStates);
    case "co-occurrence":
      return transitionsCooccurrence(data, stateToIdx, nStates);
    case "attention":
      return transitionsAttention(data, stateToIdx, nStates, params?.beta ?? 0.1);
    default:
      throw new Error(`Unknown transition type: ${type}`);
  }
}
function transitionsRelative(data, stateToIdx, nStates) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i < valid.length - 1; i++) {
      const fromIdx = stateToIdx.get(valid[i].state);
      const toIdx = stateToIdx.get(valid[i + 1].state);
      if (fromIdx !== void 0 && toIdx !== void 0) {
        counts.set(fromIdx, toIdx, counts.get(fromIdx, toIdx) + 1);
      }
    }
  }
  const weights = rowNormalize(counts);
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights, inits };
}
function transitionsFrequency(data, stateToIdx, nStates) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i < valid.length - 1; i++) {
      const fromIdx = stateToIdx.get(valid[i].state);
      const toIdx = stateToIdx.get(valid[i + 1].state);
      if (fromIdx !== void 0 && toIdx !== void 0) {
        counts.set(fromIdx, toIdx, counts.get(fromIdx, toIdx) + 1);
      }
    }
  }
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights: counts, inits };
}
function transitionsCooccurrence(data, stateToIdx, nStates) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i < valid.length - 1; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const idx1 = stateToIdx.get(valid[i].state);
        const idx2 = stateToIdx.get(valid[j].state);
        if (idx1 !== void 0 && idx2 !== void 0) {
          counts.set(idx1, idx2, counts.get(idx1, idx2) + 1);
          if (idx1 !== idx2) {
            counts.set(idx2, idx1, counts.get(idx2, idx1) + 1);
          }
        }
      }
    }
  }
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights: counts, inits };
}
function transitionsAttention(data, stateToIdx, nStates, beta) {
  const counts = Matrix.zeros(nStates, nStates);
  const inits = new Float64Array(nStates);
  for (const row of data) {
    const valid = getValidTransitions(row);
    if (valid.length === 0) continue;
    const firstIdx = stateToIdx.get(valid[0].state);
    if (firstIdx !== void 0) inits[firstIdx]++;
    for (let i = 0; i < valid.length; i++) {
      const fromIdx = stateToIdx.get(valid[i].state);
      if (fromIdx === void 0) continue;
      for (let j = i + 1; j < valid.length; j++) {
        const toIdx = stateToIdx.get(valid[j].state);
        if (toIdx === void 0) continue;
        const distance = j - i;
        const weight = Math.exp(-beta * distance);
        counts.set(fromIdx, toIdx, counts.get(fromIdx, toIdx) + weight);
      }
    }
  }
  const initSum = inits.reduce((a, b) => a + b, 0);
  if (initSum > 0) {
    for (let i = 0; i < inits.length; i++) inits[i] /= initSum;
  }
  return { weights: counts, inits };
}
function computeWeightsFromMatrix(mat, type = "relative") {
  if (type === "relative") return rowNormalize(mat);
  return mat.clone();
}

// src/model/model.ts
function createTNA(weights, inits, labels, data = null, type = "relative", scaling = [], params) {
  return { weights, inits, labels, data, type, scaling, params };
}
function isSquareMatrix(data) {
  if (data.length === 0) return false;
  return data.length === data[0].length;
}
function buildModel(x, options) {
  const type = options?.type ?? "relative";
  const scaling = options?.scaling ?? null;
  let labels = options?.labels;
  const beginState = options?.beginState;
  const endState = options?.endState;
  const params = options?.params;
  if (isTNAData(x)) {
    return buildModel(x.sequenceData, { ...options, labels: labels ?? x.labels });
  }
  if (isNumericMatrix(x)) {
    if (isSquareMatrix(x)) {
      const mat = Matrix.from2D(x);
      const weights2 = computeWeightsFromMatrix(mat, type);
      const n = weights2.rows;
      const stateLabels2 = labels ?? Array.from({ length: n }, (_, i) => `S${i + 1}`);
      const inits2 = new Float64Array(n).fill(1 / n);
      const { weights: scaled2, applied: applied2 } = applyScaling(weights2, scaling);
      return createTNA(scaled2, inits2, stateLabels2, null, type, applied2);
    }
  }
  const seqData = x;
  const { data: processedData, labels: detectedLabels } = createSeqdata(seqData, {
    beginState,
    endState
  });
  const stateLabels = labels ?? detectedLabels;
  const { weights, inits } = computeTransitions(processedData, stateLabels, type, params);
  const { weights: scaled, applied } = applyScaling(weights, scaling);
  return createTNA(scaled, inits, stateLabels, processedData, type, applied, params);
}
function tna(x, options) {
  return buildModel(x, { ...options, type: "relative" });
}
function ftna(x, options) {
  return buildModel(x, { ...options, type: "frequency" });
}
function ctna(x, options) {
  return buildModel(x, { ...options, type: "co-occurrence" });
}
function atna(x, options) {
  return buildModel(x, {
    ...options,
    type: "attention",
    params: { beta: options?.beta ?? 0.1 }
  });
}
function isTNAData(x) {
  return typeof x === "object" && x !== null && "sequenceData" in x && "labels" in x && "statistics" in x;
}
function isNumericMatrix(x) {
  if (!Array.isArray(x) || x.length === 0) return false;
  const first = x[0];
  if (!Array.isArray(first) || first.length === 0) return false;
  return typeof first[0] === "number";
}
function summary(model) {
  return {
    nStates: model.labels.length,
    type: model.type,
    scaling: model.scaling,
    nEdges: model.weights.count((v) => v > 0),
    density: model.weights.count((v) => v > 0) / model.labels.length ** 2,
    meanWeight: model.weights.meanNonZero(),
    maxWeight: model.weights.max(),
    hasSelfLoops: model.weights.diag().some((v) => v > 0)
  };
}

// src/model/group.ts
function isGroupTNA(x) {
  return typeof x === "object" && x !== null && "models" in x;
}
function createGroupTNA(models) {
  return { models };
}
function groupNames(g) {
  return Object.keys(g.models);
}
function groupEntries(g) {
  return Object.entries(g.models);
}
function groupApply(g, fn) {
  const result = {};
  for (const [name, model] of Object.entries(g.models)) {
    result[name] = fn(model, name);
  }
  return result;
}
function renameGroups(g, newNames) {
  const oldNames = Object.keys(g.models);
  if (newNames.length !== oldNames.length) {
    throw new Error(`Expected ${oldNames.length} names, got ${newNames.length}`);
  }
  const models = {};
  for (let i = 0; i < oldNames.length; i++) {
    models[newNames[i]] = g.models[oldNames[i]];
  }
  return { models };
}
function buildGroupModels(data, groups, options) {
  if (data.length !== groups.length) {
    throw new Error(`Data length ${data.length} doesn't match groups length ${groups.length}`);
  }
  let labels = options?.labels;
  if (!labels) {
    const stateSet = /* @__PURE__ */ new Set();
    for (const row of data) {
      for (const val of row) {
        if (val !== null && val !== void 0 && val !== "") {
          stateSet.add(val);
        }
      }
    }
    labels = Array.from(stateSet).sort();
  }
  const uniqueGroups = [];
  const seen = /* @__PURE__ */ new Set();
  for (const g of groups) {
    if (!seen.has(g)) {
      uniqueGroups.push(g);
      seen.add(g);
    }
  }
  const models = {};
  for (const grp of uniqueGroups) {
    const grpData = [];
    for (let i = 0; i < data.length; i++) {
      if (groups[i] === grp) {
        grpData.push(data[i]);
      }
    }
    models[grp] = buildModel(grpData, { ...options, labels });
  }
  return { models };
}
function groupTna(data, groups, options) {
  return buildGroupModels(data, groups, { ...options, type: "relative" });
}
function groupFtna(data, groups, options) {
  return buildGroupModels(data, groups, { ...options, type: "frequency" });
}
function groupCtna(data, groups, options) {
  return buildGroupModels(data, groups, { ...options, type: "co-occurrence" });
}
function groupAtna(data, groups, options) {
  return buildGroupModels(data, groups, {
    ...options,
    type: "attention",
    params: { beta: options?.beta ?? 0.1 }
  });
}

// src/analysis/centralities.ts
var AVAILABLE_MEASURES = [
  "InStrength",
  "OutStrength",
  "Closeness",
  "Betweenness"
];
function centralities(model, options) {
  if (isGroupTNA(model)) {
    const allLabels = [];
    const allGroups = [];
    const allMeasures = {};
    for (const [name, m] of groupEntries(model)) {
      const result = centralities(m, options);
      for (let i = 0; i < result.labels.length; i++) {
        allLabels.push(result.labels[i]);
        allGroups.push(name);
      }
      for (const [measure, values] of Object.entries(result.measures)) {
        if (!allMeasures[measure]) allMeasures[measure] = [];
        for (let i = 0; i < values.length; i++) {
          allMeasures[measure].push(values[i]);
        }
      }
    }
    const measures2 = {};
    for (const [m, vals] of Object.entries(allMeasures)) {
      measures2[m] = new Float64Array(vals);
    }
    return { labels: allLabels, measures: measures2, groups: allGroups };
  }
  const tnaModel = model;
  const requestedMeasures = options?.measures ?? [...AVAILABLE_MEASURES];
  const loops = options?.loops ?? false;
  const normalize = options?.normalize ?? false;
  const weights = tnaModel.weights.clone();
  const n = weights.rows;
  if (!loops) {
    for (let i = 0; i < n; i++) weights.set(i, i, 0);
  }
  const isUndirected = tnaModel.type === "co-occurrence" || tnaModel.type === "attention";
  const measures = {};
  for (const measure of AVAILABLE_MEASURES) {
    if (!requestedMeasures.includes(measure)) continue;
    switch (measure) {
      case "InStrength":
        measures.InStrength = weights.colSums();
        break;
      case "OutStrength":
        measures.OutStrength = weights.rowSums();
        break;
      case "Closeness":
        measures.Closeness = closeness(weights, n);
        break;
      case "Betweenness":
        measures.Betweenness = betweenness(weights, n, isUndirected);
        break;
    }
  }
  if (normalize) {
    for (const key of Object.keys(measures)) {
      const vals = measures[key];
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] < min) min = vals[i];
        if (vals[i] > max) max = vals[i];
      }
      if (max > min) {
        for (let i = 0; i < vals.length; i++) {
          vals[i] = (vals[i] - min) / (max - min);
        }
      } else {
        vals.fill(0);
      }
    }
  }
  return {
    labels: tnaModel.labels,
    measures
  };
}
function dijkstra(weights, n, s) {
  const stack = [];
  const pred = Array.from({ length: n }, () => []);
  const sigma = new Float64Array(n);
  const dist = new Float64Array(n).fill(Infinity);
  sigma[s] = 1;
  dist[s] = 0;
  const visited = new Uint8Array(n);
  for (let step = 0; step < n; step++) {
    let u = -1;
    let minDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && dist[i] < minDist) {
        minDist = dist[i];
        u = i;
      }
    }
    if (u === -1) break;
    visited[u] = 1;
    stack.push(u);
    for (let v = 0; v < n; v++) {
      if (visited[v]) continue;
      const w = weights.get(u, v);
      if (w <= 0) continue;
      const d = 1 / w;
      const newDist = dist[u] + d;
      if (newDist < dist[v] - 1e-15) {
        dist[v] = newDist;
        sigma[v] = sigma[u];
        pred[v] = [u];
      } else if (Math.abs(newDist - dist[v]) < 1e-15) {
        sigma[v] = sigma[v] + sigma[u];
        pred[v].push(u);
      }
    }
  }
  return { dist, sigma, pred, stack };
}
function closeness(weights, n) {
  const result = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const { dist } = dijkstra(weights, n, s);
    let sumDist = 0;
    let reachable = 0;
    for (let t = 0; t < n; t++) {
      if (t === s) continue;
      if (dist[t] < Infinity) {
        sumDist += dist[t];
        reachable++;
      }
    }
    result[s] = reachable > 0 && sumDist > 0 ? reachable / sumDist : 0;
  }
  return result;
}
function betweenness(weights, n, undirected = false) {
  const CB = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const { sigma, pred, stack } = dijkstra(weights, n, s);
    const delta = new Float64Array(n);
    const revStack = stack.slice().reverse();
    for (const w of revStack) {
      for (const v of pred[w]) {
        const frac = sigma[v] / sigma[w] * (1 + delta[w]);
        delta[v] = delta[v] + frac;
      }
      if (w !== s) {
        CB[w] = CB[w] + delta[w];
      }
    }
  }
  if (undirected) {
    for (let i = 0; i < n; i++) CB[i] = CB[i] / 2;
  }
  return CB;
}

// src/analysis/prune.ts
function prune(model, threshold = 0.1) {
  if (isGroupTNA(model)) {
    const result = {};
    for (const [name, m] of groupEntries(model)) {
      result[name] = prune(m, threshold);
    }
    return result;
  }
  const tnaModel = model;
  const weights = tnaModel.weights.map((v) => v < threshold ? 0 : v);
  return {
    weights,
    inits: new Float64Array(tnaModel.inits),
    labels: [...tnaModel.labels],
    data: tnaModel.data,
    type: tnaModel.type,
    scaling: [...tnaModel.scaling]
  };
}

// src/analysis/cluster.ts
var SENTINEL = "\0__NA__";
function toTokenLists(data, naSyms = ["*", "%"]) {
  const naSet = new Set(naSyms);
  return data.map(
    (row) => row.map((val) => {
      if (val === null || val === void 0 || val === "") return SENTINEL;
      if (naSet.has(val)) return SENTINEL;
      return val;
    })
  );
}
function effectiveLength(seq) {
  let last = 0;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== SENTINEL) last = i + 1;
  }
  return last;
}
function hammingDistance(a, b, weighted = false, lambda_ = 1) {
  const maxLen = Math.max(a.length, b.length);
  const aPad = [...a, ...new Array(maxLen - a.length).fill(SENTINEL)];
  const bPad = [...b, ...new Array(maxLen - b.length).fill(SENTINEL)];
  let dist = 0;
  for (let i = 0; i < maxLen; i++) {
    if (aPad[i] !== bPad[i]) {
      dist += weighted ? Math.exp(-lambda_ * i) : 1;
    }
  }
  return dist;
}
function levenshteinDistance(a, b, lenA, lenB) {
  const m = lenA ?? a.length;
  const n = lenB ?? b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
function osaDistance(a, b, lenA, lenB) {
  const m = lenA ?? a.length;
  const n = lenB ?? b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}
function lcsDistance(a, b, lenA, lenB) {
  const m = lenA ?? a.length;
  const n = lenB ?? b.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, new Array(n + 1).fill(0)];
  }
  return m + n - 2 * prev[n];
}
var DISTANCE_FUNCS = {
  hamming: (a, b) => hammingDistance(a, b),
  lv: levenshteinDistance,
  osa: osaDistance,
  lcs: lcsDistance
};
function computeDistanceMatrix(sequences, dissimilarity, weighted = false, lambda_ = 1) {
  const n = sequences.length;
  const dist = Matrix.zeros(n, n);
  if (dissimilarity === "hamming") {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = hammingDistance(sequences[i], sequences[j], weighted, lambda_);
        dist.set(i, j, d);
        dist.set(j, i, d);
      }
    }
  } else {
    const func = DISTANCE_FUNCS[dissimilarity];
    if (!func) throw new Error(`Unknown dissimilarity: ${dissimilarity}`);
    const effLens = sequences.map(effectiveLength);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = func(sequences[i], sequences[j], effLens[i], effLens[j]);
        dist.set(i, j, d);
        dist.set(j, i, d);
      }
    }
  }
  return dist;
}
function silhouetteScore(dist, labels) {
  const n = labels.length;
  const uniqueClusters = [...new Set(labels)];
  if (uniqueClusters.length < 2) return 0;
  let totalScore = 0;
  for (let i = 0; i < n; i++) {
    const ci = labels[i];
    let sumSame = 0;
    let countSame = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i && labels[j] === ci) {
        sumSame += dist.get(i, j);
        countSame++;
      }
    }
    if (countSame === 0) continue;
    const ai = sumSame / countSame;
    let bi = Infinity;
    for (const c of uniqueClusters) {
      if (c === ci) continue;
      let sumOther = 0;
      let countOther = 0;
      for (let j = 0; j < n; j++) {
        if (labels[j] === c) {
          sumOther += dist.get(i, j);
          countOther++;
        }
      }
      if (countOther > 0) {
        bi = Math.min(bi, sumOther / countOther);
      }
    }
    const maxAB = Math.max(ai, bi);
    totalScore += maxAB > 0 ? (bi - ai) / maxAB : 0;
  }
  return totalScore / n;
}
function pam(dist, k) {
  const n = dist.rows;
  const medoids = [];
  const totalDists = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) totalDists[i] = totalDists[i] + dist.get(i, j);
  }
  let bestIdx = 0;
  for (let i = 1; i < n; i++) {
    if (totalDists[i] <= totalDists[bestIdx]) bestIdx = i;
  }
  medoids.push(bestIdx);
  const nearestDist = new Float64Array(n);
  for (let i = 0; i < n; i++) nearestDist[i] = dist.get(i, medoids[0]);
  for (let m = 1; m < k; m++) {
    let bestGain = -Infinity;
    let bestCandidate = -1;
    for (let c = 0; c < n; c++) {
      if (medoids.includes(c)) continue;
      let gain = 0;
      for (let i = 0; i < n; i++) {
        gain += Math.max(0, nearestDist[i] - dist.get(i, c));
      }
      if (gain >= bestGain) {
        bestGain = gain;
        bestCandidate = c;
      }
    }
    medoids.push(bestCandidate);
    for (let i = 0; i < n; i++) {
      nearestDist[i] = Math.min(nearestDist[i], dist.get(i, bestCandidate));
    }
  }
  const medoidsArr = [...medoids];
  for (let iter = 0; iter < 100; iter++) {
    let currentCost = 0;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (const m of medoidsArr) minD = Math.min(minD, dist.get(i, m));
      currentCost += minD;
    }
    let bestChange = 0;
    let bestMIdx = -1;
    let bestSwap = -1;
    for (let mIdx = 0; mIdx < k; mIdx++) {
      for (let c = 0; c < n; c++) {
        if (medoidsArr.includes(c)) continue;
        const trial = [...medoidsArr];
        trial[mIdx] = c;
        let trialCost = 0;
        for (let i = 0; i < n; i++) {
          let minD = Infinity;
          for (const m of trial) minD = Math.min(minD, dist.get(i, m));
          trialCost += minD;
        }
        const change = trialCost - currentCost;
        if (change < bestChange) {
          bestChange = change;
          bestMIdx = mIdx;
          bestSwap = c;
        }
      }
    }
    if (bestMIdx >= 0) {
      medoidsArr[bestMIdx] = bestSwap;
    } else {
      break;
    }
  }
  const sortedMedoids = [...medoidsArr].sort((a, b) => a - b);
  return Array.from({ length: n }, (_, i) => {
    let minD = Infinity;
    let bestM = 0;
    for (let m = 0; m < k; m++) {
      const d = dist.get(i, sortedMedoids[m]);
      if (d < minD) {
        minD = d;
        bestM = m;
      }
    }
    return bestM + 1;
  });
}
function hierarchical(dist, k, method) {
  const n = dist.rows;
  const clusters = Array.from({ length: n }, (_, i) => [i]);
  const active = new Set(Array.from({ length: n }, (_, i) => i));
  const sizes = new Array(n).fill(1);
  const d = Array.from(
    { length: n },
    (_, i) => Array.from({ length: n }, (_2, j) => dist.get(i, j))
  );
  while (active.size > k) {
    let bestDist = Infinity;
    let bestI = -1;
    let bestJ = -1;
    const activeArr = [...active];
    for (let a = 0; a < activeArr.length; a++) {
      for (let b = a + 1; b < activeArr.length; b++) {
        const ci = activeArr[a];
        const cj = activeArr[b];
        if (d[ci][cj] < bestDist) {
          bestDist = d[ci][cj];
          bestI = ci;
          bestJ = cj;
        }
      }
    }
    const ni = sizes[bestI];
    const nj = sizes[bestJ];
    for (const ck of active) {
      if (ck === bestI || ck === bestJ) continue;
      const dik = d[bestI][ck];
      const djk = d[bestJ][ck];
      let newDist;
      switch (method) {
        case "single":
          newDist = Math.min(dik, djk);
          break;
        case "complete":
          newDist = Math.max(dik, djk);
          break;
        default:
          newDist = (ni * dik + nj * djk) / (ni + nj);
          break;
      }
      d[bestI][ck] = newDist;
      d[ck][bestI] = newDist;
    }
    clusters[bestI] = [...clusters[bestI], ...clusters[bestJ]];
    sizes[bestI] = ni + nj;
    active.delete(bestJ);
  }
  const assignments = new Array(n).fill(0);
  let clusterIdx = 1;
  for (const ci of active) {
    for (const point of clusters[ci]) {
      assignments[point] = clusterIdx;
    }
    clusterIdx++;
  }
  return assignments;
}
function clusterData(data, k, options) {
  const method = options?.method ?? "pam";
  let seqData;
  if (typeof data === "object" && data !== null && "sequenceData" in data) {
    seqData = data.sequenceData;
  } else {
    seqData = data;
  }
  const dissimilarity = options?.dissimilarity ?? "hamming";
  const naSyms = options?.naSyms ?? ["*", "%"];
  const weighted = options?.weighted ?? false;
  const lambda_ = options?.lambda ?? 1;
  if (k < 2) throw new Error("k must be >= 2");
  if (k > seqData.length) throw new Error(`k=${k} exceeds number of sequences (${seqData.length})`);
  const sequences = toTokenLists(seqData, naSyms);
  const dist = computeDistanceMatrix(sequences, dissimilarity, weighted, lambda_);
  let assignments;
  if (method === "pam") {
    assignments = pam(dist, k);
  } else {
    assignments = hierarchical(dist, k, method);
  }
  const sil = silhouetteScore(dist, assignments);
  const sizes = [];
  for (let c = 1; c <= k; c++) {
    sizes.push(assignments.filter((a) => a === c).length);
  }
  return {
    data: seqData,
    k,
    assignments,
    silhouette: sil,
    sizes,
    method,
    distance: dist,
    dissimilarity
  };
}

// src/analysis/frequencies.ts
function stateFrequencies(data) {
  const counts = /* @__PURE__ */ new Map();
  for (const row of data) {
    for (const val of row) {
      if (val !== null && val !== void 0 && val !== "") {
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const result = {};
  for (const [state, count] of sorted) {
    result[state] = count;
  }
  return result;
}
function statePresence(data) {
  const counts = /* @__PURE__ */ new Map();
  for (const row of data) {
    const seen = /* @__PURE__ */ new Set();
    for (const val of row) {
      if (val !== null && val !== void 0 && val !== "") {
        seen.add(val);
      }
    }
    for (const state of seen) {
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const result = {};
  for (const [state, count] of sorted) {
    result[state] = count;
  }
  return result;
}

// src/analysis/dfg.ts
function buildDFG(model, options) {
  if (isGroupTNA(model)) {
    const result = {};
    for (const [name, m] of groupEntries(model)) {
      result[name] = buildDFG(m, options);
    }
    return result;
  }
  const tna2 = model;
  if (tna2.data && tna2.data.length > 0) {
    return buildDFGFromSequences(tna2.data, tna2.labels, options?.startLabel, options?.endLabel);
  }
  const n = tna2.labels.length;
  const w = tna2.weights;
  let totalWeight = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) totalWeight += w.get(i, j);
  const rowSums = w.rowSums();
  const colSums = w.colSums();
  const totalNode = [...rowSums].reduce((a, b) => a + b, 0);
  const nodes = tna2.labels.map((id, i) => ({
    id,
    type: id === options?.startLabel ? "start" : id === options?.endLabel ? "end" : "activity",
    absoluteFreq: Math.round(rowSums[i] + colSums[i]),
    relativeFreq: totalNode > 0 ? (rowSums[i] + colSums[i]) / (2 * totalNode) : 0,
    caseFreq: 0
  }));
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = w.get(i, j);
      if (v > 0) edges.push({
        from: tna2.labels[i],
        to: tna2.labels[j],
        absoluteCount: Math.round(v),
        relativeCount: totalWeight > 0 ? v / totalWeight : 0,
        caseCount: 0
      });
    }
  }
  return { nodes, edges, totalSequences: 0, totalTransitions: Math.round(totalWeight) };
}
function buildDFGFromSequences(sequences, labels, startLabel, endLabel) {
  const totalSeq = sequences.length;
  const absFreq = /* @__PURE__ */ new Map();
  const casePresence = /* @__PURE__ */ new Map();
  for (const seq of sequences) {
    const seen = /* @__PURE__ */ new Set();
    for (const s of seq) {
      if (s === null) continue;
      absFreq.set(s, (absFreq.get(s) ?? 0) + 1);
      seen.add(s);
    }
    for (const s of seen) casePresence.set(s, (casePresence.get(s) ?? 0) + 1);
  }
  const totalOcc = [...absFreq.values()].reduce((a, b) => a + b, 0);
  const transMap = /* @__PURE__ */ new Map();
  const caseTrans = /* @__PURE__ */ new Map();
  let totalTrans = 0;
  for (const seq of sequences) {
    const seenT = /* @__PURE__ */ new Set();
    for (let i = 0; i < seq.length - 1; i++) {
      const from = seq[i], to = seq[i + 1];
      if (from === null || to === null) continue;
      const key = `${from}\0${to}`;
      transMap.set(key, (transMap.get(key) ?? 0) + 1);
      totalTrans++;
      seenT.add(key);
    }
    for (const k of seenT) caseTrans.set(k, (caseTrans.get(k) ?? 0) + 1);
  }
  const allLabels = labels ?? [...absFreq.keys()].sort();
  const nodes = allLabels.filter((id) => absFreq.has(id)).map((id) => ({
    id,
    type: id === startLabel ? "start" : id === endLabel ? "end" : "activity",
    absoluteFreq: absFreq.get(id),
    relativeFreq: totalOcc > 0 ? absFreq.get(id) / totalOcc : 0,
    caseFreq: totalSeq > 0 ? (casePresence.get(id) ?? 0) / totalSeq : 0
  }));
  const edges = [];
  for (const [key, count] of transMap) {
    const sep = key.indexOf("\0");
    edges.push({
      from: key.slice(0, sep),
      to: key.slice(sep + 1),
      absoluteCount: count,
      relativeCount: totalTrans > 0 ? count / totalTrans : 0,
      caseCount: totalSeq > 0 ? (caseTrans.get(key) ?? 0) / totalSeq : 0
    });
  }
  return { nodes, edges, totalSequences: totalSeq, totalTransitions: totalTrans };
}

// src/sna/community.ts
function communities(model, options) {
  const gamma = options?.resolution ?? 1;
  const n = model.weights.rows;
  if (n === 0) {
    return { labels: [], assignments: [], modularity: 0, nCommunities: 0 };
  }
  if (n === 1) {
    return { labels: [...model.labels], assignments: [0], modularity: 0, nCommunities: 1 };
  }
  const A = new Float64Array(n * n);
  const sOut = new Float64Array(n);
  const sIn = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const w = model.weights.get(i, j);
      if (w > 0) {
        A[i * n + j] = w;
        sOut[i] = sOut[i] + w;
        sIn[j] = sIn[j] + w;
        m += w;
      }
    }
  }
  if (m === 0) {
    return {
      labels: [...model.labels],
      assignments: Array.from({ length: n }, (_, i) => i),
      modularity: 0,
      nCommunities: n
    };
  }
  const comm = new Int32Array(n);
  for (let i = 0; i < n; i++) comm[i] = i;
  const commSIn = new Float64Array(n);
  const commSOut = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    commSIn[i] = sIn[i];
    commSOut[i] = sOut[i];
  }
  const commInternalW = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    commInternalW[i] = A[i * n + i];
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n; i++) {
      const ci = comm[i];
      const neighborComms = /* @__PURE__ */ new Map();
      for (let j = 0; j < n; j++) {
        const wij = A[i * n + j];
        const wji = A[j * n + i];
        if (wij > 0 || wji > 0) {
          const cj = comm[j];
          neighborComms.set(cj, (neighborComms.get(cj) ?? 0) + wij + wji);
        }
      }
      const wToCurrent = neighborComms.get(ci) ?? 0;
      commSOut[ci] = commSOut[ci] - sOut[i];
      commSIn[ci] = commSIn[ci] - sIn[i];
      let bestComm = ci;
      let bestGain = 0;
      for (const [cj, wToNeighbor] of neighborComms) {
        if (cj === ci) continue;
        const gain = (wToNeighbor - wToCurrent) / m - gamma * (sOut[i] * commSIn[cj] + sIn[i] * commSOut[cj] - (sOut[i] * commSIn[ci] + sIn[i] * commSOut[ci])) / (m * m);
        if (gain > bestGain) {
          bestGain = gain;
          bestComm = cj;
        }
      }
      commSOut[comm[i]] = commSOut[comm[i]] + sOut[i];
      commSIn[comm[i]] = commSIn[comm[i]] + sIn[i];
      if (bestComm !== ci) {
        commSOut[ci] = commSOut[ci] - sOut[i];
        commSIn[ci] = commSIn[ci] - sIn[i];
        commSOut[bestComm] = commSOut[bestComm] + sOut[i];
        commSIn[bestComm] = commSIn[bestComm] + sIn[i];
        comm[i] = bestComm;
        improved = true;
      }
    }
  }
  const uniqueComms = [...new Set(comm)];
  uniqueComms.sort((a, b) => a - b);
  const renumber = /* @__PURE__ */ new Map();
  uniqueComms.forEach((c, idx) => renumber.set(c, idx));
  const assignments = Array.from(comm, (c) => renumber.get(c));
  const nCommunities = uniqueComms.length;
  let Q = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (assignments[i] !== assignments[j]) continue;
      Q += A[i * n + j] - gamma * (sOut[i] * sIn[j]) / m;
    }
  }
  Q /= m;
  return {
    labels: [...model.labels],
    assignments,
    modularity: Q,
    nCommunities
  };
}

// src/sna/layout.ts
function layout(model, options) {
  const algo = options?.algorithm ?? "spring";
  const iterations = options?.iterations ?? 300;
  const width = options?.width ?? 100;
  const height = options?.height ?? 100;
  const n = model.weights.rows;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  if (n === 0) return { x, y, labels: [] };
  if (n === 1) return { x: new Float64Array([0.5]), y: new Float64Array([0.5]), labels: [...model.labels] };
  switch (algo) {
    case "circle":
      circleLayout(x, y, n);
      break;
    case "grid":
      gridLayout(x, y, n);
      break;
    case "random":
      randomLayout(x, y, n);
      break;
    case "concentric":
      concentricLayout(model, x, y, n);
      break;
    case "star":
      starLayout(model, x, y, n);
      break;
    case "hierarchical":
      hierarchicalLayout(model, x, y, n);
      break;
    case "spectral":
      spectralLayout(model, x, y, n);
      break;
    case "kamada-kawai":
      kamadaKawaiLayout(model, x, y, n, iterations, width, height);
      break;
    case "community":
      communityLayout(model, x, y, n, iterations, width, height);
      break;
    case "fr":
      initGoldenSpiral(x, y, n, width, height);
      fruchtermanReingold(model, x, y, n, iterations, width, height);
      break;
    case "spring":
    default:
      initGoldenSpiral(x, y, n, width, height);
      spring(model, x, y, n, iterations, width, height);
      break;
  }
  normalizePositions(x, y, n);
  return { x, y, labels: [...model.labels] };
}
function symWeight(model, i, j) {
  return model.weights.get(i, j) + model.weights.get(j, i);
}
function hasEdge(model, i, j) {
  return model.weights.get(i, j) > 0 || model.weights.get(j, i) > 0;
}
function degree(model, i, n) {
  let d = 0;
  for (let j = 0; j < n; j++) if (i !== j && hasEdge(model, i, j)) d++;
  return d;
}
function hubNode(model, n) {
  let best = 0, bestD = -1;
  for (let i = 0; i < n; i++) {
    const d = degree(model, i, n);
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
function initGoldenSpiral(x, y, n, width, height) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n) * Math.min(width, height) * 0.4;
    const theta = i * goldenAngle;
    x[i] = width / 2 + r * Math.cos(theta);
    y[i] = height / 2 + r * Math.sin(theta);
  }
}
function normalizePositions(x, y, n) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  for (let i = 0; i < n; i++) {
    x[i] = (x[i] - minX) / rangeX;
    y[i] = (y[i] - minY) / rangeY;
  }
}
function circleLayout(x, y, n) {
  for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    x[i] = 0.5 + 0.45 * Math.cos(angle);
    y[i] = 0.5 + 0.45 * Math.sin(angle);
  }
}
function gridLayout(x, y, n) {
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    x[i] = i % cols / Math.max(cols - 1, 1);
    y[i] = Math.floor(i / cols) / Math.max(Math.ceil(n / cols) - 1, 1);
  }
}
function randomLayout(x, y, n) {
  let seed = 12345;
  const rand = () => {
    seed = seed * 1103515245 + 12345 & 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < n; i++) {
    x[i] = rand();
    y[i] = rand();
  }
}
function concentricLayout(model, x, y, n) {
  const degrees = Array.from({ length: n }, (_, i) => ({ idx: i, deg: degree(model, i, n) })).sort((a, b) => b.deg - a.deg);
  const ring1 = Math.max(1, Math.ceil(n * 0.2));
  const ring2 = Math.max(1, Math.ceil(n * 0.4));
  const rings = [
    { items: degrees.slice(0, ring1), r: 0.1 },
    { items: degrees.slice(ring1, ring1 + ring2), r: 0.3 },
    { items: degrees.slice(ring1 + ring2), r: 0.47 }
  ];
  for (const { items, r } of rings) {
    items.forEach(({ idx }, i) => {
      if (items.length === 1) {
        x[idx] = 0.5;
        y[idx] = 0.5;
      } else {
        const angle = 2 * Math.PI * i / items.length - Math.PI / 2;
        x[idx] = 0.5 + r * Math.cos(angle);
        y[idx] = 0.5 + r * Math.sin(angle);
      }
    });
  }
}
function starLayout(model, x, y, n) {
  const hub = hubNode(model, n);
  x[hub] = 0.5;
  y[hub] = 0.5;
  const neighbors = [];
  const others = [];
  for (let i = 0; i < n; i++) {
    if (i === hub) continue;
    if (hasEdge(model, hub, i)) neighbors.push(i);
    else others.push(i);
  }
  neighbors.forEach((idx, i) => {
    const angle = 2 * Math.PI * i / neighbors.length - Math.PI / 2;
    x[idx] = 0.5 + 0.25 * Math.cos(angle);
    y[idx] = 0.5 + 0.25 * Math.sin(angle);
  });
  if (others.length > 0) {
    others.forEach((idx, i) => {
      const angle = 2 * Math.PI * i / others.length - Math.PI / 2;
      x[idx] = 0.5 + 0.46 * Math.cos(angle);
      y[idx] = 0.5 + 0.46 * Math.sin(angle);
    });
  }
}
function hierarchicalLayout(model, x, y, n) {
  const root = hubNode(model, n);
  const layerArr = new Array(n).fill(-1);
  layerArr[root] = 0;
  const queue = [root];
  let qi = 0;
  while (qi < queue.length) {
    const v = queue[qi++];
    for (let w = 0; w < n; w++) {
      if (layerArr[w] >= 0 || w === v) continue;
      if (hasEdge(model, v, w)) {
        layerArr[w] = layerArr[v] + 1;
        queue.push(w);
      }
    }
  }
  let maxLayer = 0;
  for (let i = 0; i < n; i++) {
    const li = layerArr[i];
    if (li >= 0 && li > maxLayer) maxLayer = li;
  }
  for (let i = 0; i < n; i++) if (layerArr[i] < 0) layerArr[i] = ++maxLayer;
  const layers = Array.from({ length: maxLayer + 1 }, () => []);
  for (let i = 0; i < n; i++) layers[layerArr[i]].push(i);
  const layerCount = maxLayer + 1;
  for (let l = 0; l < layerCount; l++) {
    const nodes = layers[l];
    const yPos = layerCount > 1 ? l / (layerCount - 1) : 0.5;
    for (let i = 0; i < nodes.length; i++) {
      const idx = nodes[i];
      x[idx] = nodes.length > 1 ? i / (nodes.length - 1) : 0.5;
      y[idx] = yPos;
    }
  }
}
function spectralLayout(model, x, y, n) {
  const deg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += symWeight(model, i, j);
    deg[i] = s;
  }
  const removeConst = (v) => {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += v[i];
    mean /= n;
    for (let i = 0; i < n; i++) v[i] = v[i] - mean;
  };
  const norm = (v) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += v[i] * v[i];
    const d = Math.sqrt(s) || 1;
    for (let i = 0; i < n; i++) v[i] = v[i] / d;
  };
  const deflate = (v, u) => {
    let dot = 0;
    for (let i = 0; i < n; i++) dot += v[i] * u[i];
    for (let i = 0; i < n; i++) v[i] = v[i] - dot * u[i];
  };
  const powerIterate = (init, deflectors) => {
    const v = new Float64Array(init);
    removeConst(v);
    norm(v);
    const next = new Float64Array(n);
    for (let iter = 0; iter < 150; iter++) {
      for (let i = 0; i < n; i++) {
        if (deg[i] === 0) {
          next[i] = v[i];
          continue;
        }
        let s = 0;
        for (let j = 0; j < n; j++) s += symWeight(model, i, j) * v[j];
        next[i] = s / deg[i];
      }
      removeConst(next);
      for (const d of deflectors) deflate(next, d);
      norm(next);
      for (let i = 0; i < n; i++) v[i] = next[i];
    }
    return v;
  };
  const init1 = new Float64Array(n);
  const init2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    init1[i] = Math.sin(i * 2.71828 + 0.5);
    init2[i] = Math.cos(i * 1.61803 + 0.3);
  }
  const v1 = powerIterate(init1, []);
  const v2 = powerIterate(init2, [v1]);
  for (let i = 0; i < n; i++) {
    x[i] = v1[i];
    y[i] = v2[i];
  }
}
function kamadaKawaiLayout(model, x, y, n, iterations, width, height) {
  const dist = new Float64Array(n * n).fill(Infinity);
  const dGet = (i, j) => dist[i * n + j];
  const dSet = (i, j, v) => {
    dist[i * n + j] = v;
  };
  for (let s = 0; s < n; s++) {
    dSet(s, s, 0);
    const q = [s];
    let qi = 0;
    while (qi < q.length) {
      const v = q[qi++];
      for (let w = 0; w < n; w++) {
        if (dGet(s, w) < Infinity || w === v) continue;
        if (hasEdge(model, v, w)) {
          dSet(s, w, dGet(s, v) + 1);
          q.push(w);
        }
      }
    }
  }
  let maxDist = 0;
  for (let i = 0; i < n * n; i++)
    if (dist[i] < Infinity && dist[i] > maxDist) maxDist = dist[i];
  const fallback = maxDist + 1;
  for (let i = 0; i < n * n; i++)
    if (dist[i] === Infinity) dist[i] = fallback;
  for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    x[i] = width / 2 + width * 0.3 * Math.cos(angle);
    y[i] = height / 2 + height * 0.3 * Math.sin(angle);
  }
  const L0 = Math.min(width, height) * 0.8 / Math.max(maxDist, 1);
  for (let iter = 0; iter < iterations; iter++) {
    const step = 0.1 * (1 - iter / iterations);
    for (let i = 0; i < n; i++) {
      let gx = 0, gy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = x[i] - x[j];
        const dy = y[i] - y[j];
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const dij = dGet(i, j);
        const ideal = dij * L0;
        const k = 1 / (dij * dij);
        const force = k * (d - ideal) / d;
        gx += force * dx;
        gy += force * dy;
      }
      x[i] = x[i] - step * gx;
      y[i] = y[i] - step * gy;
    }
  }
}
function spring(model, x, y, n, iterations, width, height) {
  const area = width * height;
  const k = Math.sqrt(area / n);
  const centerX = width / 2;
  const centerY = height / 2;
  for (let iter = 0; iter < iterations; iter++) {
    const temp = (1 - iter / iterations) * width / 10;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ddx = x[i] - x[j];
        const ddy = y[i] - y[j];
        const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01);
        const force = k * k / dist;
        const fx = ddx / dist * force;
        const fy = ddy / dist * force;
        dx[i] = dx[i] + fx;
        dy[i] = dy[i] + fy;
        dx[j] = dx[j] - fx;
        dy[j] = dy[j] - fy;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const w = model.weights.get(i, j);
        if (w <= 0) continue;
        const ddx = x[j] - x[i];
        const ddy = y[j] - y[i];
        const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01);
        const force = dist * dist / k * w;
        const fx = ddx / dist * force;
        const fy = ddy / dist * force;
        dx[i] = dx[i] + fx;
        dy[i] = dy[i] + fy;
      }
    }
    for (let i = 0; i < n; i++) {
      dx[i] = dx[i] + (centerX - x[i]) * 0.01;
      dy[i] = dy[i] + (centerY - y[i]) * 0.01;
    }
    for (let i = 0; i < n; i++) {
      const disp = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (disp > 0) {
        const scale = Math.min(disp, temp) / disp;
        x[i] = x[i] + dx[i] * scale;
        y[i] = y[i] + dy[i] * scale;
      }
    }
  }
}
function fruchtermanReingold(model, x, y, n, iterations, width, height) {
  const area = width * height;
  const k = Math.sqrt(area / n);
  let temp = width / 10;
  for (let iter = 0; iter < iterations; iter++) {
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ddx = x[i] - x[j];
        const ddy = y[i] - y[j];
        const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01);
        const force = k * k / dist;
        const fx = ddx / dist * force;
        const fy = ddy / dist * force;
        dx[i] = dx[i] + fx;
        dy[i] = dy[i] + fy;
        dx[j] = dx[j] - fx;
        dy[j] = dy[j] - fy;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const w = model.weights.get(i, j);
        if (w <= 0) continue;
        const ddx = x[j] - x[i];
        const ddy = y[j] - y[i];
        const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01);
        const force = dist * dist / k * w;
        const fx = ddx / dist * force;
        const fy = ddy / dist * force;
        dx[i] = dx[i] + fx;
        dy[i] = dy[i] + fy;
      }
    }
    for (let i = 0; i < n; i++) {
      const disp = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (disp > 0) {
        const scale = Math.min(disp, temp) / disp;
        x[i] = x[i] + dx[i] * scale;
        y[i] = y[i] + dy[i] * scale;
      }
    }
    temp *= 0.95;
  }
}
function communityLayout(model, x, y, n, iterations, width, height) {
  const result = communities(model);
  const { assignments, nCommunities } = result;
  const commSize = new Int32Array(nCommunities);
  for (let i = 0; i < n; i++) commSize[assignments[i]]++;
  const cx = new Float64Array(nCommunities);
  const cy = new Float64Array(nCommunities);
  const commOrder = Array.from({ length: nCommunities }, (_, i) => i).sort((a, b) => commSize[b] - commSize[a]);
  for (let idx = 0; idx < nCommunities; idx++) {
    const c = commOrder[idx];
    const angle = 2 * Math.PI * idx / nCommunities - Math.PI / 2;
    const r = nCommunities === 1 ? 0 : Math.min(width, height) * 0.3;
    cx[c] = width / 2 + r * Math.cos(angle);
    cy[c] = height / 2 + r * Math.sin(angle);
  }
  const maxSize = Math.max(...Array.from(commSize));
  const maxBubbleR = nCommunities === 1 ? Math.min(width, height) * 0.4 : Math.min(width, height) * 0.18;
  const bubbleR = new Float64Array(nCommunities);
  for (let c = 0; c < nCommunities; c++) {
    bubbleR[c] = maxBubbleR * Math.sqrt(commSize[c] / maxSize);
  }
  const commCounter = new Int32Array(nCommunities);
  for (let i = 0; i < n; i++) {
    const c = assignments[i];
    const count = commSize[c];
    const idx = commCounter[c]++;
    if (count === 1) {
      x[i] = cx[c];
      y[i] = cy[c];
    } else {
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const r = bubbleR[c] * Math.sqrt((idx + 0.5) / count) * 0.8;
      const theta = idx * goldenAngle;
      x[i] = cx[c] + r * Math.cos(theta);
      y[i] = cy[c] + r * Math.sin(theta);
    }
  }
  const area = width * height;
  const k = Math.sqrt(area / n);
  for (let iter = 0; iter < iterations; iter++) {
    const temp = (1 - iter / iterations) * width / 15;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (assignments[i] !== assignments[j]) continue;
        const ddx = x[i] - x[j];
        const ddy = y[i] - y[j];
        const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01);
        const force = k * k / dist;
        const fx = ddx / dist * force;
        const fy = ddy / dist * force;
        dx[i] = dx[i] + fx;
        dy[i] = dy[i] + fy;
        dx[j] = dx[j] - fx;
        dy[j] = dy[j] - fy;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const w = model.weights.get(i, j);
        if (w <= 0) continue;
        const sameCommunity = assignments[i] === assignments[j];
        const strength = sameCommunity ? w : w * 0.3;
        const ddx = x[j] - x[i];
        const ddy = y[j] - y[i];
        const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01);
        const force = dist * dist / k * strength;
        const fx = ddx / dist * force;
        const fy = ddy / dist * force;
        dx[i] = dx[i] + fx;
        dy[i] = dy[i] + fy;
      }
    }
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      dx[i] = dx[i] + (cx[c] - x[i]) * 0.05;
      dy[i] = dy[i] + (cy[c] - y[i]) * 0.05;
    }
    for (let i = 0; i < n; i++) {
      const disp = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (disp > 0) {
        const scale = Math.min(disp, temp) / disp;
        x[i] = x[i] + dx[i] * scale;
        y[i] = y[i] + dy[i] * scale;
      }
    }
  }
  for (let iter = 0; iter < 50; iter++) {
    for (let a = 0; a < nCommunities; a++) {
      for (let b = a + 1; b < nCommunities; b++) {
        const ddx = cx[a] - cx[b];
        const ddy = cy[a] - cy[b];
        const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01);
        const minSep = (bubbleR[a] + bubbleR[b]) * 1.3;
        if (dist < minSep) {
          const push = (minSep - dist) * 0.5 / dist;
          const px = ddx * push;
          const py = ddy * push;
          cx[a] = cx[a] + px;
          cy[a] = cy[a] + py;
          cx[b] = cx[b] - px;
          cy[b] = cy[b] - py;
          for (let i = 0; i < n; i++) {
            if (assignments[i] === a) {
              x[i] = x[i] + px;
              y[i] = y[i] + py;
            }
            if (assignments[i] === b) {
              x[i] = x[i] - px;
              y[i] = y[i] - py;
            }
          }
        }
      }
    }
  }
}

// src/sna/metrics.ts
function networkDensity(model, options) {
  const n = model.weights.rows;
  if (n <= 1) return 0;
  const loops = options?.loops ?? false;
  const isUndirected = model.type === "co-occurrence" || model.type === "attention";
  let edgeCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!loops && i === j) continue;
      if (model.weights.get(i, j) > 0) edgeCount++;
    }
  }
  const maxEdges = loops ? n * n : n * (n - 1);
  if (isUndirected) {
    return edgeCount / 2 / (maxEdges / 2);
  }
  return edgeCount / maxEdges;
}
function degreeDistribution(model, options) {
  const n = model.weights.rows;
  const loops = options?.loops ?? false;
  const inDegree = new Float64Array(n);
  const outDegree = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!loops && i === j) continue;
      if (model.weights.get(i, j) > 0) {
        outDegree[i] = outDegree[i] + 1;
        inDegree[j] = inDegree[j] + 1;
      }
    }
  }
  const totalDegree = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    totalDegree[i] = inDegree[i] + outDegree[i];
  }
  return { inDegree, outDegree, totalDegree, labels: model.labels };
}

// src/patterns/prepare.ts
function prepareSequenceData(data) {
  const stateSet = /* @__PURE__ */ new Set();
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (v != null && v !== "") {
        stateSet.add(v);
      }
    }
  }
  const alphabet = [...stateSet].sort();
  const stateToIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < alphabet.length; i++) {
    stateToIndex.set(alphabet[i], i + 1);
  }
  const sequences = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const coded = new Array(row.length);
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (v != null && v !== "") {
        coded[j] = stateToIndex.get(v);
      } else {
        coded[j] = NaN;
      }
    }
    sequences.push(coded);
  }
  return { sequences, alphabet };
}

// src/patterns/stats.ts
function lgamma(x) {
  if (x <= 0) return Infinity;
  const c = [
    0.9999999999998099,
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9984369578019572e-21,
    15056327351493116e-23
  ];
  let sum = c[0];
  for (let i = 1; i < 9; i++) {
    sum += c[i] / (x + i - 1);
  }
  const t = x + 6.5;
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(t) - t + Math.log(sum);
}
function gammaPSeries(a, x) {
  if (x === 0) return 0;
  const maxIter = 200;
  const eps = 1e-15;
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n <= maxIter; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * eps) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
}
function gammaQCF(a, x) {
  const maxIter = 200;
  const eps = 1e-15;
  const tiny = 1e-30;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= maxIter; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }
  return h * Math.exp(-x + a * Math.log(x) - lgamma(a));
}
function gammaQ(a, x) {
  if (x < 0) return 1;
  if (x === 0) return 1;
  if (a === 0) return 0;
  if (x < a + 1) {
    return 1 - gammaPSeries(a, x);
  }
  return gammaQCF(a, x);
}
function chiSqUpperTail(x, df) {
  if (x <= 0) return 1;
  if (df <= 0) return NaN;
  return gammaQ(df / 2, x / 2);
}

// src/patterns/discover.ts
function extractNgrams(sequences, alphabet, len) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const results = [];
  for (const j of len) {
    if (j > m) {
      results.push({ patterns: Array.from({ length: n }, () => []), length: j });
      continue;
    }
    const cols = m - j + 1;
    const tmp = Array.from(
      { length: n },
      () => new Array(cols).fill("")
    );
    for (let pos = 0; pos < cols; pos++) {
      for (let i = 0; i < n; i++) {
        const row = sequences[i];
        let valid = true;
        const parts = [];
        for (let d = 0; d < j; d++) {
          const v = row[pos + d];
          if (isNaN(v)) {
            valid = false;
            break;
          }
          parts.push(alphabet[v - 1]);
        }
        if (valid) {
          tmp[i][pos] = parts.join("->");
        }
      }
    }
    results.push({ patterns: tmp, length: j });
  }
  return results;
}
function extractGapped(sequences, alphabet, gap) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const results = [];
  for (const g of gap) {
    const cols = m - g;
    const tmp = Array.from(
      { length: n },
      () => new Array(cols).fill("")
    );
    const wildcards = "*".repeat(g);
    const sep = `->${wildcards}->`;
    for (let pos = 0; pos < m - g - 1; pos++) {
      for (let i = 0; i < n; i++) {
        const row = sequences[i];
        const from = row[pos];
        const to = row[pos + g + 1];
        if (!isNaN(from) && !isNaN(to)) {
          tmp[i][pos] = `${alphabet[from - 1]}${sep}${alphabet[to - 1]}`;
        }
      }
    }
    results.push({ patterns: tmp, length: g + 2 });
  }
  return results;
}
function extractRepeated(sequences, alphabet, len) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const results = [];
  for (const j of len) {
    if (j > m) {
      results.push({ patterns: Array.from({ length: n }, () => []), length: j });
      continue;
    }
    const cols = m - j + 1;
    const tmp = Array.from(
      { length: n },
      () => new Array(cols).fill("")
    );
    for (let pos = 0; pos < cols; pos++) {
      for (let i = 0; i < n; i++) {
        const row = sequences[i];
        let valid = true;
        let allSame = true;
        const first = row[pos];
        if (isNaN(first)) {
          continue;
        }
        const parts = [alphabet[first - 1]];
        for (let d = 1; d < j; d++) {
          const v = row[pos + d];
          if (isNaN(v)) {
            valid = false;
            break;
          }
          if (v !== first) {
            allSame = false;
            break;
          }
          parts.push(alphabet[v - 1]);
        }
        if (valid && allSame) {
          tmp[i][pos] = parts.join("->");
        }
      }
    }
    results.push({ patterns: tmp, length: j });
  }
  return results;
}
function searchPattern(sequences, alphabet, pattern) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const states = pattern.split("->");
  const wildcards = states.map((s) => /^\*+$/.test(s));
  let totalLen = states.length;
  const fixedPositions = [];
  const fixedStates = [];
  if (wildcards.some((w) => w)) {
    let pos = 0;
    for (let i = 0; i < states.length; i++) {
      if (wildcards[i]) {
        pos += states[i].length;
      } else {
        fixedPositions.push(pos);
        fixedStates.push(states[i]);
        pos++;
      }
    }
    totalLen = pos;
  } else {
    for (let i = 0; i < states.length; i++) {
      fixedPositions.push(i);
      fixedStates.push(states[i]);
    }
  }
  if (totalLen > m) {
    return [{ patterns: Array.from({ length: n }, () => []), length: totalLen }];
  }
  const cols = m - totalLen + 1;
  const discovered = Array.from(
    { length: n },
    () => new Array(cols).fill("")
  );
  for (let pos = 0; pos < cols; pos++) {
    for (let i = 0; i < n; i++) {
      const row = sequences[i];
      let anyNaN = false;
      for (let d = 0; d < totalLen; d++) {
        if (isNaN(row[pos + d])) {
          anyNaN = true;
          break;
        }
      }
      if (anyNaN) continue;
      let match = true;
      for (let f = 0; f < fixedPositions.length; f++) {
        if (alphabet[row[pos + fixedPositions[f]] - 1] !== fixedStates[f]) {
          match = false;
          break;
        }
      }
      if (match) {
        const parts = [];
        for (let d = 0; d < totalLen; d++) {
          parts.push(alphabet[row[pos + d] - 1]);
        }
        discovered[i][pos] = parts.join("->");
      }
    }
  }
  return [{ patterns: discovered, length: totalLen }];
}
function formatPatterns(extracted) {
  const results = [];
  for (const item of extracted) {
    const patMat = item.patterns;
    const n = patMat.length;
    const allPats = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < patMat[i].length; j++) {
        const p = patMat[i][j];
        if (p !== "") allPats.push(p);
      }
    }
    if (allPats.length === 0) {
      results.push({
        matrix: Array.from({ length: n }, () => []),
        unique: [],
        length: item.length
      });
      continue;
    }
    const unique = [...new Set(allPats)];
    const patIdx = /* @__PURE__ */ new Map();
    for (let i = 0; i < unique.length; i++) {
      patIdx.set(unique[i], i);
    }
    const matrix = Array.from(
      { length: n },
      () => new Array(unique.length).fill(0)
    );
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < patMat[i].length; j++) {
        const p = patMat[i][j];
        if (p !== "") {
          matrix[i][patIdx.get(p)]++;
        }
      }
    }
    results.push({ matrix, unique, length: item.length });
  }
  return results;
}
function stateSupport(sequences, alphabet) {
  const n = sequences.length;
  const m = sequences[0]?.length ?? 0;
  const a = alphabet.length;
  const support = /* @__PURE__ */ new Map();
  for (let s = 0; s < a; s++) {
    let count = 0;
    for (let i = 0; i < n; i++) {
      let found = false;
      for (let j = 0; j < m; j++) {
        if (sequences[i][j] === s + 1) {
          found = true;
          break;
        }
      }
      if (found) count++;
    }
    support.set(alphabet[s], count / n);
  }
  return support;
}
function chisqTest(groupCounts, totalCounts, nGroups) {
  const nPatterns = groupCounts.length;
  const prob = 1 / nGroups;
  const statistic = new Array(nPatterns);
  const pValue = new Array(nPatterns);
  const df = nGroups - 1;
  for (let i = 0; i < nPatterns; i++) {
    let chi2 = 0;
    for (let g = 0; g < nGroups; g++) {
      const expected = totalCounts[i] * prob;
      const diff = groupCounts[i][g] - expected;
      chi2 += diff * diff / expected;
    }
    statistic[i] = chi2;
    pValue[i] = chiSqUpperTail(chi2, df);
  }
  return { statistic, pValue };
}
function processPatterns(raw, n, group, stateSupp, minFreq, minSupport, start, end, contain) {
  const entries = [];
  const hasGroup = group !== null && group.length > 0;
  let groups = [];
  const groupIndices = /* @__PURE__ */ new Map();
  if (hasGroup) {
    groups = [...new Set(group)];
    for (const g of groups) {
      const indices = [];
      for (let i = 0; i < group.length; i++) {
        if (group[i] === g) indices.push(i);
      }
      groupIndices.set(g, indices);
    }
  }
  for (const r of raw) {
    if (r.unique.length === 0) continue;
    const mat = r.matrix;
    for (let p = 0; p < r.unique.length; p++) {
      let frequency = 0;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const v = mat[i][p];
        frequency += v;
        if (v > 0) count++;
      }
      const support = count / n;
      if (frequency < minFreq || support < minSupport) continue;
      const pattern = r.unique[p];
      if (start && start.length > 0) {
        if (!start.some((s) => pattern.startsWith(s))) continue;
      }
      if (end && end.length > 0) {
        if (!end.some((s) => pattern.endsWith(s))) continue;
      }
      if (contain && contain.length > 0) {
        const pat = contain.join("|");
        if (!new RegExp(pat).test(pattern)) continue;
      }
      const entry = {
        pattern,
        length: r.length,
        frequency,
        proportion: 0,
        count,
        support,
        lift: 0
      };
      const patStates = pattern.split("->").filter((s) => !/^\*+$/.test(s));
      let denom = 1;
      for (const s of patStates) {
        denom *= stateSupp.get(s) ?? 1;
      }
      entry.lift = denom > 0 ? support / denom : 0;
      if (hasGroup) {
        const gc = {};
        const countsArr = [];
        for (const g of groups) {
          const indices = groupIndices.get(g);
          let gCount = 0;
          for (const idx of indices) {
            if (mat[idx][p] > 0) gCount++;
          }
          gc[`count_${g}`] = gCount;
          countsArr.push(gCount);
        }
        entry.groupCounts = gc;
        const chisqResult = chisqTest([countsArr], [count], groups.length);
        entry.chisq = chisqResult.statistic[0];
        entry.pValue = chisqResult.pValue[0];
      }
      entries.push(entry);
    }
  }
  entries.sort((a, b) => b.frequency - a.frequency);
  const lengthTotals = /* @__PURE__ */ new Map();
  for (const e of entries) {
    lengthTotals.set(e.length, (lengthTotals.get(e.length) ?? 0) + e.frequency);
  }
  for (const e of entries) {
    const total = lengthTotals.get(e.length) ?? 1;
    e.proportion = e.frequency / total;
  }
  return entries;
}
function discoverPatterns(data, options) {
  const prepared = prepareSequenceData(data);
  const { sequences, alphabet } = prepared;
  const n = sequences.length;
  const type = options?.type ?? "ngram";
  const len = options?.len ?? [2, 3, 4, 5];
  const gap = options?.gap ?? [1, 2, 3];
  const minFreq = options?.minFreq ?? 2;
  const minSupport = options?.minSupport ?? 0.01;
  const group = options?.group ?? null;
  let extracted;
  if (options?.pattern) {
    extracted = searchPattern(sequences, alphabet, options.pattern);
  } else if (type === "ngram") {
    extracted = extractNgrams(sequences, alphabet, len);
  } else if (type === "gapped") {
    extracted = extractGapped(sequences, alphabet, gap);
  } else {
    extracted = extractRepeated(sequences, alphabet, len);
  }
  const raw = formatPatterns(extracted);
  const stateSupp = stateSupport(sequences, alphabet);
  const patterns = processPatterns(
    raw,
    n,
    group,
    stateSupp,
    minFreq,
    minSupport,
    options?.start,
    options?.end,
    options?.contain
  );
  return { patterns, _raw: raw };
}
export {
  AVAILABLE_MEASURES,
  Matrix,
  applyScaling,
  atna,
  buildDFG,
  buildDFGFromSequences,
  buildModel,
  centralities,
  clusterData,
  communities,
  computeTransitions,
  computeWeightsFromMatrix,
  createGroupTNA,
  createSeqdata,
  createTNA,
  ctna,
  degreeDistribution,
  discoverPatterns,
  ftna,
  groupApply,
  groupAtna,
  groupCtna,
  groupEntries,
  groupFtna,
  groupNames,
  groupTna,
  isGroupTNA,
  layout,
  maxScale,
  minmaxScale,
  networkDensity,
  prepareData,
  prune,
  rankScale,
  renameGroups,
  rowNormalize,
  stateFrequencies,
  statePresence,
  summary,
  tna
};
//# sourceMappingURL=index.js.map