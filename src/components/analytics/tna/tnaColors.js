/**
 * Shared color palette for TNA visualizations.
 * 9-color colorblind-friendly palette with good contrast on both light and dark backgrounds.
 */

export const NODE_COLORS = [
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

export const EDGE_COLOR = '#4a7fba';
export const ARROW_COLOR = '#3a6a9f';

/**
 * Get color for a label index, cycling through palette for > 9 items.
 * @param {number} index
 * @returns {string}
 */
export function getNodeColor(index) {
  return NODE_COLORS[index % NODE_COLORS.length];
}
