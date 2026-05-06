const PALETTES = {
  default: [
    "#5ab4ac",
    "#e6ab02",
    "#a985ca",
    "#e15759",
    "#5a9bd4",
    "#ed8c3b",
    "#8bc34a",
    "#e78ac3",
    "#a8786a",
    "#9580c4",
    "#66c2a5",
    "#d4a03b"
  ],
  tableau: [
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
    "#edc948",
    "#b07aa1",
    "#ff9da7",
    "#9c755f",
    "#bab0ac",
    "#af7aa1",
    "#86bcb6"
  ],
  pastel: [
    "#a6cee3",
    "#b2df8a",
    "#fb9a99",
    "#fdbf6f",
    "#cab2d6",
    "#ffff99",
    "#b3cde3",
    "#ccebc5",
    "#decbe4",
    "#fed9a6",
    "#e5d8bd",
    "#fddaec"
  ],
  vivid: [
    "#e41a1c",
    "#377eb8",
    "#4daf4a",
    "#984ea3",
    "#ff7f00",
    "#a65628",
    "#f781bf",
    "#999999",
    "#66c2a5",
    "#fc8d62",
    "#8da0cb",
    "#e78ac3"
  ],
  colorblind: [
    "#0072B2",
    "#E69F00",
    "#009E73",
    "#CC79A7",
    "#56B4E9",
    "#D55E00",
    "#F0E442",
    "#999999",
    "#0072B2",
    "#E69F00",
    "#009E73",
    "#CC79A7"
  ]
};
function generateHclPalette(n) {
  const colors = [];
  for (let i = 0; i < n; i++) {
    const h = (15 + i * 360 / n) % 360;
    const hNorm = h / 360;
    const s = 0.5;
    const l = 0.55;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (p2, q2, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
      if (t < 1 / 2) return q2;
      if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
      return p2;
    };
    const r = Math.round(Math.max(0, Math.min(1, hue2rgb(p, q, hNorm + 1 / 3))) * 255);
    const g = Math.round(Math.max(0, Math.min(1, hue2rgb(p, q, hNorm))) * 255);
    const b = Math.round(Math.max(0, Math.min(1, hue2rgb(p, q, hNorm - 1 / 3))) * 255);
    colors.push(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`);
  }
  return colors;
}
function colorPalette(nStates, variant) {
  if (nStates <= 0) return [];
  const base = PALETTES[variant ?? "default"];
  if (nStates <= base.length) return base.slice(0, nStates);
  return [...base, ...generateHclPalette(nStates - base.length)];
}
function createColorMap(labels, variant) {
  const pal = colorPalette(labels.length, variant);
  const map = {};
  for (let i = 0; i < labels.length; i++) {
    map[labels[i]] = pal[i % pal.length];
  }
  return map;
}
const PALETTE_NAMES = ["default", "tableau", "pastel", "vivid", "colorblind"];
export {
  PALETTE_NAMES,
  colorPalette,
  createColorMap
};
