import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAnnotationStore } from './annotationStore.js';
import { ANNOTATION_KINDS, measureAnnotation } from './annotationModel.js';
import { fromGeoJSON, toGeoJSON } from './geojson.js';

/**
 * React binding for the annotation store.
 *
 * ONE STORE PER SLIDE. The store is keyed on `slideId`, so switching from A1
 * to A2 and back finds A1's annotations exactly where they were, each with its
 * own undo history — undoing on A2 must never reach back and delete something
 * drawn on A1.
 *
 * Callbacks are held in refs and never appear in a dependency array. This
 * package has been bitten by that before: an `opts` object literal at the call
 * site made a returned callback new on every render, which tore down and
 * rebuilt the OpenSeadragon viewer continuously. Anything a caller passes
 * inline goes in a ref.
 *
 * @param {object} p
 * @param {object|null} p.slide      the active slide, for measurement units
 * @param {Array<object>} [p.initial] annotations to seed this slide with
 * @param {object} [p.logger]        a createPathologyLogger() instance
 * @param {(slideId:string, annotations:Array<object>) => void} [p.onChange]
 *        called after every change, so the host (Rohy) can persist. This
 *        package stores nothing itself — persistence is Rohy's job.
 */
export function useAnnotations({ slide, initial, logger, onChange }) {
    const slideId = slide?.id ?? null;

    // Per-slide stores, kept across slide switches for the life of the room.
    const storesRef = useRef(new Map());
    const store = useMemo(() => {
        if (!slideId) return null;
        if (!storesRef.current.has(slideId)) {
            storesRef.current.set(slideId, createAnnotationStore({
                idPrefix: slideId,
                initial: initial ?? [],
            }));
        }
        return storesRef.current.get(slideId);
        // `initial` is deliberately not a dependency: it seeds the store once.
        // Re-seeding on a new array identity would discard the reader's work
        // every time the parent re-rendered.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slideId]);

    const [annotations, setAnnotations] = useState(() => store?.list() ?? []);
    const [selectedId, setSelectedId] = useState(null);
    const [history, setHistory] = useState({ canUndo: false, canRedo: false });

    const onChangeRef = useRef(onChange);
    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    const loggerRef = useRef(logger);
    useEffect(() => { loggerRef.current = logger; }, [logger]);
    const slideRef = useRef(slide);
    useEffect(() => { slideRef.current = slide; }, [slide]);

    // Re-subscribe when the slide changes; the previous store keeps its state
    // but stops driving this component.
    useEffect(() => {
        if (!store) {
            setAnnotations([]);
            setHistory({ canUndo: false, canRedo: false });
            return undefined;
        }
        setAnnotations(store.list());
        setHistory({ canUndo: store.canUndo(), canRedo: store.canRedo() });
        setSelectedId(null);
        return store.subscribe((change, list) => {
            setAnnotations(list);
            setHistory({ canUndo: store.canUndo(), canRedo: store.canRedo() });
            onChangeRef.current?.(slideId, list, change);
        });
    }, [store, slideId]);

    /**
     * Add an annotation and emit the matching structured-log row.
     *
     * The verb depends on what was drawn, not on how it was drawn: a ruler is
     * MEASURED_SLIDE, a counting frame is COUNTED_FEATURE, everything else is
     * ANNOTATED_SLIDE. That is what makes the analytics layer able to
     * distinguish "the reader measured something" from "the reader outlined
     * something" without parsing a context blob.
     */
    const add = useCallback((spec) => {
        if (!store) return null;
        const { annotation } = store.add({ ...spec, slideId, now: Date.now() });
        const currentSlide = slideRef.current;
        if (loggerRef.current && currentSlide) {
            loggerRef.current.annotationDrawn(
                annotation,
                measureAnnotation(annotation, currentSlide),
                currentSlide,
            );
        }
        setSelectedId(annotation.id);
        return annotation;
    }, [store, slideId]);

    const update = useCallback((id, patch) => {
        if (!store) return null;
        return store.update(id, patch, Date.now()).annotation;
    }, [store]);

    const remove = useCallback((id) => {
        if (!store) return;
        store.remove(id);
        setSelectedId((current) => (current === id ? null : current));
    }, [store]);

    const clear = useCallback(() => {
        if (!store) return;
        store.clear();
        setSelectedId(null);
    }, [store]);

    const undo = useCallback(() => { store?.undo(); setSelectedId(null); }, [store]);
    const redo = useCallback(() => { store?.redo(); setSelectedId(null); }, [store]);

    /**
     * Adjust a counting frame's tally.
     *
     * Clamped at zero: a negative mitotic count is not a thing, and letting it
     * go negative would produce a negative per-mm² rate downstream.
     */
    const adjustTally = useCallback((id, delta) => {
        if (!store) return;
        const annotation = store.get(id);
        if (!annotation || annotation.kind !== ANNOTATION_KINDS.COUNTING_FRAME) return;
        const tally = Math.max(0, (annotation.tally ?? 0) + delta);
        const { annotation: updated } = store.update(id, { tally }, Date.now());
        const currentSlide = slideRef.current;
        if (loggerRef.current && currentSlide) {
            loggerRef.current.featureCounted(updated, measureAnnotation(updated, currentSlide), currentSlide);
        }
    }, [store]);

    /**
     * The whole slide's annotations as a QuPath-readable FeatureCollection.
     *
     * @returns {object|null}
     */
    const exportGeoJSON = useCallback(() => {
        const currentSlide = slideRef.current;
        if (!store || !currentSlide) return null;
        const collection = toGeoJSON(store.list(), {
            slideId: currentSlide.id,
            slideLabel: currentSlide.label,
            nativeMpp: currentSlide.nativeMpp,
            nativeObjective: currentSlide.nativeObjective,
        });
        loggerRef.current?.annotationsExported(currentSlide, store.size());
        return collection;
    }, [store]);

    /**
     * Replace this slide's annotations from a FeatureCollection.
     *
     * Errors are NOT swallowed. A file that will not parse is reported to the
     * caller so the UI can say which feature was bad; quietly importing four
     * of a reader's eleven regions would be far worse than refusing the file.
     *
     * @param {object} collection
     * @returns {number} how many annotations were imported
     */
    const importGeoJSON = useCallback((collection) => {
        if (!store || !slideId) return 0;
        const imported = fromGeoJSON(collection, { slideId, idPrefix: `${slideId}-import` });
        store.replaceAll(imported);
        setSelectedId(null);
        return imported.length;
    }, [store, slideId]);

    const selected = useMemo(
        () => annotations.find((a) => a.id === selectedId) ?? null,
        [annotations, selectedId],
    );

    return {
        annotations,
        selected,
        selectedId,
        select: setSelectedId,
        add,
        update,
        remove,
        clear,
        undo,
        redo,
        adjustTally,
        exportGeoJSON,
        importGeoJSON,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
    };
}
