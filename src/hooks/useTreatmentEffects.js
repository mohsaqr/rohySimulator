import { useState, useEffect, useCallback, useRef } from 'react';
import treatmentEffectsEngine from '../services/TreatmentEffects/TreatmentEffectsEngine';
import { ApiError, apiFetch } from '../services/apiClient';
import EventLogger, { COMPONENTS } from '../services/eventLogger';

// The six numeric channels the engine aggregates. Kept as one list so the
// zero-effect constant, the identity check and the reset path can never
// drift apart.
const AGGREGATE_KEYS = ['hr', 'bp_sys', 'bp_dia', 'rr', 'spo2', 'temp'];
const ZERO_AGGREGATE = Object.freeze({
    hr: 0, bp_sys: 0, bp_dia: 0, rr: 0, spo2: 0, temp: 0
});
const EMPTY_TREATMENTS = Object.freeze([]);
const IDLE_EFFECTS = Object.freeze({
    treatments: EMPTY_TREATMENTS,
    aggregate: ZERO_AGGREGATE,
    count: 0
});

// Value-equality on the aggregate. `Object.is` is used deliberately: this is
// a memoisation check on two outputs of the *same* summation, not a numeric
// tolerance comparison — any real change in a channel must produce a new
// object identity, and only a bit-identical result may reuse the old one.
const sameAggregate = (a, b) =>
    !!a && !!b && AGGREGATE_KEYS.every(key => Object.is(a[key], b[key]));

// Two treatment lists are "the same" when every observable field matches.
// `strength` and `elapsed_minutes` are included so a live pharmacokinetic
// curve keeps ticking for any consumer that renders it.
const sameTreatments = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((t, i) => {
        const p = b[i];
        return !!p
            && p.id === t.id
            && p.phase === t.phase
            && Object.is(p.strength, t.strength)
            && Object.is(p.elapsed_minutes, t.elapsed_minutes)
            && sameAggregate(p.effects, t.effects);
    });

/**
 * useTreatmentEffects Hook
 *
 * Provides real-time treatment effects for a session.
 * Polls the API and calculates current effects using the TreatmentEffectsEngine.
 *
 * @param {number} sessionId - The session ID to fetch effects for
 * @param {Object} options - Configuration options
 * @param {number} options.pollInterval - How often to fetch from API (ms), default 5000
 * @param {number} options.updateInterval - How often to recalculate effects (ms), default 1000
 * @param {boolean} options.enabled - Whether the hook is active, default true
 *
 * @returns {Object} - { effects, aggregate, loading, error, refresh }
 */
export function useTreatmentEffects(sessionId, options = {}) {
    const {
        pollInterval = 5000,
        updateInterval = 1000,
        enabled = true
    } = options;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [effects, setEffects] = useState(IDLE_EFFECTS);

    const lastFetchRef = useRef(null);
    const updateIntervalRef = useRef(null);

    // Fetch active treatments from API
    const fetchTreatments = useCallback(async () => {
        if (!sessionId || !enabled) return;

        try {
            const data = await apiFetch(`/sessions/${sessionId}/active-effects`);
            treatmentEffectsEngine.setActiveTreatments(data?.active_treatments || []);
            lastFetchRef.current = new Date();
            setError(null);
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message || 'Failed to fetch treatment effects');
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    }, [sessionId, enabled]);

    // Recalculate effects locally (more frequent than API calls).
    //
    // UI review 2.9.108 #19: this used to `setEffects(calculated)` every
    // `updateInterval` (1 s in PatientMonitor) unconditionally. Even with
    // ZERO active treatments the engine hands back a brand-new
    // `{hr:0, bp_sys:0, …}` object each tick, so `aggregate` got a new
    // identity every second. PatientMonitor syncs displayVitals in an
    // effect keyed on `[params, treatmentEffects.aggregate]`, so that
    // 1 Hz identity churn re-ran the sync and overwrote the 2 s vitals
    // jitter — 98.9 % of monitor samples were pinned to the flat baseline
    // and the digits looked frozen. Nothing changed ⇒ nothing re-renders:
    // we hand back the previous state object (and, when only the treatment
    // list moved, the previous `aggregate` identity) so the sync effect
    // fires on real treatment changes only.
    // A treatment moving between pharmacokinetic phases (onset → peak →
    // offset) is a system act the learner did not click: one
    // OBSERVED_TREATMENT_EFFECT row per transition, per order.
    const phasesRef = useRef(new Map());
    const logPhaseTransitions = (treatments) => {
        const seen = new Set();
        (treatments || []).forEach((t) => {
            if (t?.id == null) return;
            seen.add(t.id);
            const prevPhase = phasesRef.current.get(t.id);
            phasesRef.current.set(t.id, t.phase);
            // First sight of an order records its phase without a row; only a
            // CHANGE while we are watching is an observed transition.
            if (prevPhase === undefined || prevPhase === t.phase || !t.phase) return;
            EventLogger.treatmentEffectObserved(
                t.id, t.name ?? t.treatment_item ?? t.treatment_name ?? String(t.id), String(t.phase),
                { from: prevPhase, strength: t.strength ?? null, elapsed_minutes: t.elapsed_minutes ?? null },
                COMPONENTS.TREATMENT_PANEL,
            );
        });
        for (const id of [...phasesRef.current.keys()]) if (!seen.has(id)) phasesRef.current.delete(id);
    };

    const updateEffects = useCallback(() => {
        const calculated = treatmentEffectsEngine.calculateAggregateEffects();
        logPhaseTransitions(calculated.treatments);
        setEffects(prev => {
            const aggregate = sameAggregate(prev.aggregate, calculated.aggregate)
                ? prev.aggregate
                : calculated.aggregate;
            if (aggregate === prev.aggregate
                && prev.count === calculated.count
                && sameTreatments(prev.treatments, calculated.treatments)) {
                return prev;
            }
            return {
                treatments: calculated.count === 0 ? EMPTY_TREATMENTS : calculated.treatments,
                aggregate,
                count: calculated.count
            };
        });
    }, []);

    // Initial fetch and polling
    useEffect(() => {
        if (!sessionId || !enabled) {
            treatmentEffectsEngine.setActiveTreatments([]);
            // IDLE_EFFECTS is a shared frozen constant, so a disabled hook
            // keeps one stable aggregate identity instead of minting a new
            // zero object on every re-run of this effect.
            setEffects(IDLE_EFFECTS);
            setLoading(false);
            return;
        }

        fetchTreatments();
        const pollTimer = setInterval(fetchTreatments, pollInterval);

        return () => clearInterval(pollTimer);
    }, [sessionId, enabled, pollInterval, fetchTreatments]);

    // Local effect recalculation (more frequent)
    useEffect(() => {
        if (!enabled) return;

        updateEffects();
        updateIntervalRef.current = setInterval(updateEffects, updateInterval);

        return () => {
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
            }
        };
    }, [enabled, updateInterval, updateEffects]);

    // Manual refresh function
    const refresh = useCallback(() => {
        setLoading(true);
        fetchTreatments();
    }, [fetchTreatments]);

    // Apply effects to base vitals
    const applyToVitals = useCallback((baseVitals) => {
        return treatmentEffectsEngine.applyEffectsToVitals(baseVitals);
    }, []);

    // Get summary info
    const getSummary = useCallback(() => {
        return treatmentEffectsEngine.getSummary();
    }, []);

    // Check for significant effects
    const hasSignificantEffects = useCallback((threshold = 5) => {
        return treatmentEffectsEngine.hasSignificantEffects(threshold);
    }, []);

    return {
        // Current calculated effects
        effects: effects.treatments,
        aggregate: effects.aggregate,
        count: effects.count,

        // Status
        loading,
        error,

        // Actions
        refresh,
        applyToVitals,
        getSummary,
        hasSignificantEffects,

        // Raw engine access
        engine: treatmentEffectsEngine
    };
}

export default useTreatmentEffects;
