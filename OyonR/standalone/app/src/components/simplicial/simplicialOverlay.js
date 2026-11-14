/* Simplicial-complex pathway overlay — the shipping renderer from carm-tna
 * (notebook-render/simplicial-overlay.js + the sim* helpers/constants from the
 * notebook template). Copied verbatim; the only adaptation is sourcing d3 from
 * the two installed submodules instead of a page global. Draws each (over/under)
 * -represented pathway as a smooth convex-hull "blob" simplex over its states.
 */
/* eslint-disable no-var, vars-on-top */
import { select } from 'd3-selection';
import { polygonHull } from 'd3-polygon';

const d3 = { select, polygonHull };
function fmt(v, dgt) {
  return v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(dgt == null ? 2 : dgt);
}

// Okabe-Ito only (colour-blind safe). HYPA anomaly is never shown by colour
// alone: an under-represented blob is dashed, and each blob carries its
// verdict in words (caption + tooltip).
var SIM_NODE_COLOR   = '#0072B2';
var SIM_TARGET_COLOR = '#D55E00';
var SIM_RING_COLOR   = '#E69F00';
var SIM_RING_BORDER  = '#b37b00';
var SIM_OTHER_NODE   = '#999999';
var SIM_ANOMALY_COLOR = { over: '#D55E00', under: '#0072B2', normal: '#999999' };
var SIM_ANOMALY_WORD = { over: 'over-represented', under: 'under-represented', normal: 'as expected' };
var SIM_BLOB_NODE_R  = 18;
var SIM_BLOB_RING_R  = Math.round(SIM_BLOB_NODE_R * 1.27);
var SIM_BLOB_PALETTE = [
  '#E69F00', '#56B4E9', '#009E73', '#F0E442',
  '#0072B2', '#D55E00', '#CC79A7', '#999999',
];

function simDarkenHex(hex, amount) {
  var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  var r = Math.max(0, Math.round(parseInt(m[1], 16) * (1 - amount)));
  var g = Math.max(0, Math.round(parseInt(m[2], 16) * (1 - amount)));
  var b = Math.max(0, Math.round(parseInt(m[3], 16) * (1 - amount)));
  var toHex = function (v) { return v.toString(16).padStart(2, '0'); };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Smooth blob: padded convex hull + Laplacian smoothing (cograph .smooth_blob).
function simSmoothBlob(pts, pad, nCircle, nUpsample, nIter) {
  nCircle = nCircle || 60;
  nUpsample = nUpsample || 800;
  nIter = nIter || 80;
  if (pts.length === 0) return [];
  var cloud = [];
  for (var i = 0; i < pts.length; i++) {
    for (var j = 0; j < nCircle; j++) {
      var a = (2 * Math.PI * j) / nCircle;
      cloud.push([pts[i].x + pad * Math.cos(a), pts[i].y + pad * Math.sin(a)]);
    }
  }
  var hull = d3.polygonHull(cloud);
  if (!hull) hull = cloud;
  var nHull = hull.length;
  if (nHull < 3) return hull;

  var upsampled = [];
  for (var k = 0; k < nHull; k++) {
    var pA = hull[k], pB = hull[(k + 1) % nHull];
    var segN = Math.max(2, Math.round(nUpsample / nHull));
    for (var t = 0; t < segN; t++) {
      var u = t / segN;
      upsampled.push([pA[0] + u * (pB[0] - pA[0]), pA[1] + u * (pB[1] - pA[1])]);
    }
  }
  var n = upsampled.length, curr = upsampled, next = new Array(n);
  for (var it = 0; it < nIter; it++) {
    for (var p = 0; p < n; p++) {
      var jp = p === 0 ? n - 1 : p - 1;
      var jn = p === n - 1 ? 0 : p + 1;
      var pa = curr[jp], pc = curr[p], pe = curr[jn];
      next[p] = [(pa[0] + pc[0] + pe[0]) / 3, (pa[1] + pc[1] + pe[1]) / 3];
    }
    var tmp = curr; curr = next; next = tmp;
  }
  return curr;
}

// Expand repeated states within a pathway (cograph .expand_repeated_nodes).
function simExpandRepeated(pathways, states) {
  var newStates = states.slice();
  var displayLabel = {};
  for (var i = 0; i < states.length; i++) displayLabel[states[i]] = states[i];
  var expanded = pathways.map(function (pw) {
    var ids = [], seen = {};
    for (var j = 0; j < pw.parts.length; j++) {
      var s = pw.parts[j];
      var c = (seen[s] || 0) + 1;
      seen[s] = c;
      if (c === 1) {
        ids.push(s);
      } else {
        var dup = s + '\x02' + c;
        ids.push(dup);
        if (newStates.indexOf(dup) < 0) {
          newStates.push(dup);
          displayLabel[dup] = s;
        }
      }
    }
    return { parts: pw.parts, ids: ids, count: pw.count, order: pw.order };
  });
  return { states: newStates, pathways: expanded, displayLabel: displayLabel };
}

// Draw a single state node (gold ring + colored core + halo label).
function simDrawNode(parent, x, y, fill, label, fontSize, ringR, coreR) {
  parent.append('circle').attr('cx', x).attr('cy', y).attr('r', ringR)
    .attr('fill', SIM_RING_COLOR).attr('stroke', SIM_RING_BORDER).attr('stroke-width', 1.5);
  parent.append('circle').attr('cx', x).attr('cy', y).attr('r', coreR)
    .attr('fill', fill).attr('stroke', fill).attr('stroke-width', 0.5);
  parent.append('text').attr('x', x).attr('y', y)
    .attr('text-anchor', 'middle').attr('dy', '0.35em')
    .attr('font-size', fontSize + 'px').attr('font-weight', '700').attr('fill', '#fff')
    .style('paint-order', 'stroke').style('stroke', '#1a1a1a')
    .style('stroke-width', '2.5px').style('stroke-linejoin', 'round')
    .style('pointer-events', 'none').text(label);
}

export function drawSimplicialOverlay(host, pathways, opts) {
  opts = opts || {};
  var baseStates = opts.baseStates || [];
  var colorBy = opts.colorBy || 'palette';
  var showLabels = opts.showLabels !== false;
  var blobPad = SIM_BLOB_RING_R + (isFinite(opts.blobPad) ? opts.blobPad : 18);
  var smoothIters = isFinite(opts.smoothIters) ? opts.smoothIters : 80;
  var H = isFinite(opts.height) ? opts.height : 560;
  var W = Math.round(H * (820 / 560));

  if (!pathways || !pathways.length) {
    host.innerHTML = '<div style="font-size:11px;color:#888;padding:8px">No pathways to plot.</div>';
    return;
  }

  var stateSet = {};
  baseStates.forEach(function (s) { stateSet[s] = true; });
  pathways.forEach(function (pw) { pw.ids.forEach(function (id) { if (!stateSet[id]) { stateSet[id] = true; baseStates.push(id); } }); });

  var expansion = simExpandRepeated(pathways, baseStates);
  var layoutStates = expansion.states;
  var expanded = expansion.pathways;
  var displayLabel = expansion.displayLabel;

  var hypaByParts = {};
  pathways.forEach(function (pw) { if (pw.hypa) hypaByParts[pw.parts.join('\x01')] = pw.hypa; });
  expanded.forEach(function (pw) {
    var key = pw.parts.join('\x01');
    if (!pw.hypa && hypaByParts[key]) pw.hypa = hypaByParts[key];
  });

  var cx = W / 2, cy = H / 2;
  var layoutR = Math.min(cx, cy) - 100;
  var pos = {};
  for (var si = 0; si < layoutStates.length; si++) {
    var angle = Math.PI / 2 - (2 * Math.PI * si) / layoutStates.length;
    pos[layoutStates[si]] = { x: cx + layoutR * Math.cos(angle), y: cy + layoutR * Math.sin(angle) };
  }
  var targetIds = {};
  expanded.forEach(function (pw) { targetIds[pw.ids[pw.ids.length - 1]] = true; });

  host.innerHTML = '';
  // The caption names each anomaly verdict in words, so colour is never the
  // only cue. textContent: state names are data, never markup.
  var verdicts = colorBy === 'anomaly'
    ? expanded.filter(function (pw) { return pw.hypa; })
        .map(function (pw) { return pw.parts.join(' → ') + ': ' + (SIM_ANOMALY_WORD[pw.hypa.anomaly] || pw.hypa.anomaly); })
    : [];
  var caption = [opts.label].concat(verdicts).filter(Boolean).join(' · ');
  if (caption) {
    var cap = document.createElement('div');
    cap.style.cssText = 'font-size:11px;color:var(--ink-2, #555);margin-bottom:4px';
    cap.textContent = caption;
    host.appendChild(cap);
  }
  host.style.cssText = (host.style.cssText || '') + ';width:100%;max-width:100%;overflow:hidden';
  var svg = d3.select(host).append('svg')
    .attr('viewBox', '0 0 ' + W + ' ' + H)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('width', '100%')
    .style('height', 'auto')
    .style('max-height', '70vh')
    .style('display', 'block');
  var hullGroup = svg.append('g').attr('class', 'hulls');
  var nodeGroup = svg.append('g').attr('class', 'nodes');

  var drawOrder = expanded.map(function (pw, idx) { return { pw: pw, idx: idx }; })
    .sort(function (a, b) { return b.pw.ids.length - a.pw.ids.length; });

  drawOrder.forEach(function (entry) {
    var pw = entry.pw, idx = entry.idx;
    var pts = pw.ids.map(function (id) { return pos[id]; }).filter(function (p) { return p; });
    if (!pts.length) return;
    var paletteFill = SIM_BLOB_PALETTE[idx % SIM_BLOB_PALETTE.length];
    var isAnom = pw.hypa && pw.hypa.anomaly !== 'normal';
    var fill;
    if (colorBy === 'anomaly') {
      fill = SIM_ANOMALY_COLOR[pw.hypa ? pw.hypa.anomaly : 'normal'] || SIM_ANOMALY_COLOR.normal;
    } else {
      fill = paletteFill;
    }
    var border = simDarkenHex(fill, 0.2);
    var stroke = isAnom ? SIM_ANOMALY_COLOR[pw.hypa.anomaly] : border;
    var sw = isAnom ? 2.4 : 1.5;
    var blob = simSmoothBlob(pts, blobPad, 60, 800, smoothIters);
    if (blob.length < 3) return;
    var dStr = 'M' + blob.map(function (p) { return p[0] + ',' + p[1]; }).join(' L') + ' Z';
    var srcLabel = pw.parts.slice(0, -1).join(', ');
    var tgtLabel = pw.parts[pw.parts.length - 1];
    var titleStr = srcLabel + ' → ' + tgtLabel;
    var sigStr = pw.hypa
      ? '\nHYPA: obs=' + pw.hypa.observed + ' exp=' + fmt(pw.hypa.expected, 1) + ' · ' + pw.hypa.anomaly + ' (p̂ under=' + fmt(pw.hypa.pAdjustedUnder, 3) + ', over=' + fmt(pw.hypa.pAdjustedOver, 3) + ')'
      : '';
    var path = hullGroup.append('path').attr('d', dStr)
      .attr('fill', fill).attr('fill-opacity', 0.28)
      .attr('stroke', stroke).attr('stroke-opacity', 0.85).attr('stroke-width', sw)
      .attr('stroke-dasharray', pw.hypa && pw.hypa.anomaly === 'under' ? '6 4' : null)
      .style('cursor', 'pointer');
    path.append('title').text(titleStr + '\nCount: ' + pw.count + ' · order ' + pw.order + sigStr);
    var baseSw = sw;
    path.on('mouseover', function () { d3.select(this).attr('fill-opacity', 0.5).attr('stroke-width', baseSw + 0.7); })
        .on('mouseout', function () { d3.select(this).attr('fill-opacity', 0.28).attr('stroke-width', baseSw); });
  });

  var usedIds = {};
  expanded.forEach(function (pw) { pw.ids.forEach(function (id) { usedIds[id] = true; }); });
  layoutStates.forEach(function (sid) {
    var pp = pos[sid];
    if (!pp) return;
    if (usedIds[sid]) {
      var nf = targetIds[sid] ? SIM_TARGET_COLOR : SIM_NODE_COLOR;
      var lbl = showLabels ? (displayLabel[sid] || sid) : '';
      simDrawNode(nodeGroup, pp.x, pp.y, nf, lbl, 10, SIM_BLOB_RING_R, SIM_BLOB_NODE_R);
    } else {
      var lbl2 = showLabels ? (displayLabel[sid] || sid) : '';
      simDrawNode(nodeGroup, pp.x, pp.y, SIM_OTHER_NODE, lbl2, 10, SIM_BLOB_RING_R, SIM_BLOB_NODE_R);
    }
  });
}
