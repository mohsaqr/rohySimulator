// Hierarchical edge bundling (Holten 2006) — React SVG port of
// carmdash's edge-bundling.ts (moodle-tna). Leaves sit on a circle, edges
// are cubic B-spline paths routed through the LCA path in the hierarchy
// (beta-straightened), coloured by the source node's group. Hover a node
// to highlight its edges; click to lock, click background to unlock.

import { useMemo, useState } from 'react';
import { CARM_PALETTE, bundlePath, clusterLayout, lcaPath } from './chartMath';

const LABEL_PAD = 90;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * @param {object} props
 * @param {{id:string,parent:string,label?:string,group?:string}[]} props.nodes
 *   flat hierarchy; exactly one root with parent === ''
 * @param {{source:string,target:string,weight?:number}[]} props.edges leaf→leaf
 * @param {number} [props.beta=0.85] bundling strength 0–1
 * @param {number} [props.nodeRadius=5]
 * @param {number} [props.height=600] SVG is square: width = height
 * @param {number} [props.labelPad=90] radial padding reserved for labels
 * @param {(groupKey:string) => string} [props.colorFor] group colour override
 * @param {string} [props.title]
 * @param {string} [props.subtitle]
 * @param {string} [props.labelColor='#1a1a2e'] title + node-label text colour
 *   (override for dark backgrounds; default keeps the light look)
 * @param {string} [props.mutedColor='#6c757d'] subtitle text colour
 */
export default function EdgeBundling({
    nodes,
    edges,
    beta = 0.85,
    nodeRadius = 5,
    height = 600,
    labelPad = LABEL_PAD,
    colorFor,
    title,
    subtitle,
    labelColor = '#1a1a2e',
    mutedColor = '#6c757d',
}) {
    const [hoverId, setHoverId] = useState(null);
    const [lockedId, setLockedId] = useState(null);

    const size = height;
    const radius = size / 2 - labelPad;

    // Colour mapping: group if provided, otherwise parent id (carmdash).
    const colorOf = useMemo(() => {
        const colorKey = (n) => n.group ?? n.parent ?? '';
        const uniqueKeys = [...new Set(nodes.map(colorKey))];
        const map = new Map(uniqueKeys.map((k, i) => [k, CARM_PALETTE[i % CARM_PALETTE.length]]));
        return (n) => {
            const key = colorKey(n);
            return (colorFor && colorFor(key)) || map.get(key) || CARM_PALETTE[0];
        };
    }, [nodes, colorFor]);

    const layout = useMemo(() => clusterLayout(nodes, radius), [nodes, radius]);

    const edgePaths = useMemo(() => {
        // Normalize optional edge weights into a 1..3.5px width ramp so heavy
        // co-occurrence edges read at a glance; unweighted edges stay at 1.
        const maxWeight = edges.reduce((m, e) => Math.max(m, e.weight ?? 0), 0);
        return edges.flatMap((e) => {
            const src = layout.byId.get(e.source);
            const tgt = layout.byId.get(e.target);
            if (!src || !tgt) return [];
            const path = lcaPath(layout.byId, e.source, e.target).map((id) => layout.byId.get(id));
            return [{
                srcId: e.source,
                tgtId: e.target,
                d: bundlePath(path, beta),
                color: colorOf(src),
                weight: e.weight,
                baseWidth: maxWeight > 0 && e.weight ? 1 + 2.5 * (e.weight / maxWeight) : 1,
            }];
        });
    }, [edges, layout, beta, colorOf]);

    const connectionCount = useMemo(() => {
        const counts = new Map();
        edges.forEach((e) => {
            counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
            counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
        });
        return counts;
    }, [edges]);

    const activeId = lockedId ?? hoverId;

    return (
        <div data-testid="edge-bundling" style={{ fontFamily: FONT, color: labelColor }}>
            {title && <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>}
            {subtitle && <div style={{ fontSize: 11, color: mutedColor }}>{subtitle}</div>}
            <svg
                width="100%"
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                role="img"
                aria-label={title ?? 'Edge bundling'}
                onClick={() => setLockedId(null)}
            >
                <g transform={`translate(${size / 2},${size / 2})`}>
                    <g data-testid="edge-bundling-edges">
                        {edgePaths.map((ep, i) => {
                            const connected = activeId !== null && (ep.srcId === activeId || ep.tgtId === activeId);
                            const opacity = activeId === null ? 0.45 : connected ? 0.9 : 0.05;
                            const width = activeId === null ? ep.baseWidth
                                : connected ? Math.max(2, ep.baseWidth) : 0.8;
                            return (
                                <path
                                    key={`${ep.srcId}→${ep.tgtId}:${i}`}
                                    d={ep.d}
                                    fill="none"
                                    stroke={ep.color}
                                    strokeWidth={width}
                                    opacity={opacity}
                                >
                                    {ep.weight != null && (
                                        <title>{`${ep.srcId} ↔ ${ep.tgtId} · ${ep.weight} window${ep.weight === 1 ? '' : 's'}`}</title>
                                    )}
                                </path>
                            );
                        })}
                    </g>
                    <g data-testid="edge-bundling-nodes">
                        {layout.leaves.map((leaf) => {
                            const node = layout.byId.get(leaf.id);
                            const a = (leaf.angleDeg * Math.PI) / 180;
                            const nx = Math.sin(a) * leaf.radius;
                            const ny = -Math.cos(a) * leaf.radius;
                            const flipped = leaf.angleDeg > 180;
                            const labelR = leaf.radius + nodeRadius + 5;
                            const lx = Math.sin(a) * labelR;
                            const ly = -Math.cos(a) * labelR;
                            const rot = leaf.angleDeg - 90 + (flipped ? 180 : 0);
                            const label = node.label ?? leaf.id;
                            return (
                                <g key={leaf.id}>
                                    <circle
                                        data-testid={`bundle-node-${leaf.id}`}
                                        cx={nx}
                                        cy={ny}
                                        r={nodeRadius}
                                        fill={colorOf(node)}
                                        stroke="#ffffff"
                                        strokeWidth={1.5}
                                        cursor="pointer"
                                        onMouseEnter={() => setHoverId(leaf.id)}
                                        onMouseLeave={() => setHoverId(null)}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setLockedId((prev) => (prev === leaf.id ? null : leaf.id));
                                        }}
                                    >
                                        <title>
                                            {`${label}\n${node.group ?? node.parent ?? '—'}\n${connectionCount.get(leaf.id) ?? 0} connections`}
                                        </title>
                                    </circle>
                                    <text
                                        x={lx}
                                        y={ly}
                                        dy="0.35em"
                                        textAnchor={flipped ? 'end' : 'start'}
                                        transform={`rotate(${rot},${lx.toFixed(2)},${ly.toFixed(2)})`}
                                        fontSize={10}
                                        fill={labelColor}
                                        pointerEvents="none"
                                    >
                                        {label}
                                    </text>
                                </g>
                            );
                        })}
                    </g>
                </g>
            </svg>
        </div>
    );
}
