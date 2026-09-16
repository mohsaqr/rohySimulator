// Measure the pixel width a chart has to draw in.
//
// The Text and Voice charts draw at their real size — SVG width = container
// width, viewBox in the same pixels — so a 11 px label is 11 px on a phone and
// on a wide monitor. A fixed viewBox stretched with `w-full` scales the text
// with the container instead, which is what made the voice trend labels huge
// and the narrow charts' labels tiny.
//
// A callback ref (not useEffect + ref) so the first measurement happens when
// the node attaches, and React 19 runs the returned cleanup on detach.

import { useCallback, useState } from 'react';

/**
 * @param {number} fallback  width used before the first measurement (and in
 *   environments without layout, such as jsdom)
 * @returns {[(node: Element|null) => (void|(() => void)), number]}
 */
export function useChartWidth(fallback = 640) {
    const [width, setWidth] = useState(0);
    const ref = useCallback((node) => {
        if (!node) return undefined;
        const measure = () => {
            const next = Math.floor(node.getBoundingClientRect().width);
            if (next > 0) setWidth((prev) => (prev === next ? prev : next));
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    return [ref, width > 0 ? width : fallback];
}
