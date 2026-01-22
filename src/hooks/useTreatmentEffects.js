import { useState, useEffect, useCallback, useRef } from 'react';
import treatmentEffectsEngine from '../services/TreatmentEffects/TreatmentEffectsEngine';
import { apiUrl } from '../config/api';

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
    const [effects, setEffects] = useState({
        treatments: [],
        aggregate: {
            hr: 0,
            bp_sys: 0,
            bp_dia: 0,
            rr: 0,
            spo2: 0,
            temp: 0
        },
        count: 0
    });

    const lastFetchRef = useRef(null);
    const updateIntervalRef = useRef(null);

    // Fetch active treatments from API
    const fetchTreatments = useCallback(async () => {
        if (!sessionId || !enabled) return;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(apiUrl(`/api/sessions/${sessionId}/active-effects`), {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                treatmentEffectsEngine.setActiveTreatments(data.active_treatments || []);
                lastFetchRef.current = new Date();
                setError(null);
            } else {
                const errData = await response.json();
                setError(errData.error || 'Failed to fetch treatment effects');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [sessionId, enabled]);

    // Recalculate effects locally (more frequent than API calls)
    const updateEffects = useCallback(() => {
        const calculated = treatmentEffectsEngine.calculateAggregateEffects();
        setEffects(calculated);
    }, []);

    // Initial fetch and polling
    useEffect(() => {
        if (!sessionId || !enabled) {
            treatmentEffectsEngine.setActiveTreatments([]);
            setEffects({
                treatments: [],
                aggregate: { hr: 0, bp_sys: 0, bp_dia: 0, rr: 0, spo2: 0, temp: 0 },
                count: 0
            });
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
