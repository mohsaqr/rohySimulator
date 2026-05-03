import React, { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, VolumeX, Volume2, Eye, EyeOff, AlertTriangle, RotateCcw } from 'lucide-react';
import { useNotifications } from '../../notifications/useNotifications';
import { SOURCES, SEVERITIES } from '../../notifications/types';
import { DEFAULT_PREFS } from '../../notifications/defaults';
import HistorySurface from '../../notifications/surfaces/HistorySurface';

// User-facing settings tab. Every toggle here writes through setPrefs to
// localStorage immediately and to the backend (best-effort, debounced inside
// the provider). No save button needed — changes are live.
export default function NotificationsSettingsTab() {
    const { prefs, setPrefs, history, snoozed, acked, ackAll } = useNotifications();

    const toggleSource = (src) => {
        const muted = new Set(prefs.mutedSources);
        if (muted.has(src)) muted.delete(src); else muted.add(src);
        setPrefs({ mutedSources: Array.from(muted) });
    };

    // Live "now" snapshot — bumps every 30s so the pause countdown updates
    // without running Date.now() inline during render (which the React purity
    // lint rule prohibits).
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(t);
    }, []);

    const isPaused = prefs.dnd || (prefs.pausedUntil && now < prefs.pausedUntil);
    const pauseRemainingMin = prefs.pausedUntil > now
        ? Math.ceil((prefs.pausedUntil - now) / 60000)
        : 0;

    const counts = useMemo(() => {
        const out = { total: history.length, bySource: {}, bySeverity: {} };
        history.forEach(n => {
            out.bySource[n.source] = (out.bySource[n.source] || 0) + 1;
            out.bySeverity[n.severity] = (out.bySeverity[n.severity] || 0) + 1;
        });
        return out;
    }, [history]);

    return (
        <div className="space-y-6 p-6 max-w-4xl">
            <div className="flex items-center gap-2 mb-2">
                <Bell className="w-6 h-6 text-purple-500" />
                <h2 className="text-xl font-bold">Notifications & Alarms</h2>
            </div>
            <p className="text-sm text-neutral-400 -mt-3">
                Central control for every notification surface in the app — toasts, monitor alarms, audio,
                analytics. Settings persist to your account and apply to every machine you log in from.
            </p>

            {/* DND / Pause */}
            <Section title="Do Not Disturb">
                <Row
                    label="Do Not Disturb"
                    hint="Silences every notification except clinical critical alarms."
                    right={
                        <Toggle
                            on={prefs.dnd}
                            onChange={(v) => setPrefs({ dnd: v })}
                            onIcon={BellOff}
                            offIcon={Bell}
                        />
                    }
                />
                <Row
                    label={isPaused && pauseRemainingMin > 0 ? `Paused (${pauseRemainingMin}m left)` : 'Pause for…'}
                    hint="Time-bounded silence; auto-resumes. Clinical critical still escapes."
                    right={
                        <div className="flex gap-1">
                            {[5, 15, 30, 60].map(min => (
                                <button
                                    key={min}
                                    onClick={() => setPrefs({ pausedUntil: Date.now() + min * 60000 })}
                                    className="text-xs px-2 py-1 rounded bg-yellow-700/40 hover:bg-yellow-600/50 text-yellow-100"
                                >
                                    {min}m
                                </button>
                            ))}
                            {prefs.pausedUntil > now && (
                                <button
                                    onClick={() => setPrefs({ pausedUntil: 0 })}
                                    className="text-xs px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-white"
                                >
                                    Resume
                                </button>
                            )}
                        </div>
                    }
                />
            </Section>

            {/* Severity */}
            <Section title="Minimum severity">
                <Row
                    label="Hide notifications below"
                    hint="Below this severity, no surface fires (except clinical critical)."
                    right={
                        <select
                            value={prefs.minSeverity}
                            onChange={(e) => setPrefs({ minSeverity: e.target.value })}
                            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                        >
                            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    }
                />
            </Section>

            {/* Source mutes */}
            <Section title="Source channels">
                {Object.values(SOURCES).map(src => (
                    <Row
                        key={src}
                        label={SRC_LABEL[src]}
                        hint={SRC_HINT[src]}
                        right={
                            <Toggle
                                on={!prefs.mutedSources.includes(src)}
                                onChange={() => toggleSource(src)}
                                onIcon={Eye}
                                offIcon={EyeOff}
                            />
                        }
                    />
                ))}
            </Section>

            {/* Surface mutes */}
            <Section title="Surface mutes">
                <Row
                    label="Audio"
                    hint="Mutes alarm beeps. Banner & history still appear."
                    right={
                        <Toggle
                            on={!prefs.audioMuted}
                            onChange={(v) => setPrefs({ audioMuted: !v })}
                            onIcon={Volume2}
                            offIcon={VolumeX}
                        />
                    }
                />
                <Row
                    label="Top banner"
                    hint="Hides the top alarm banner. Critical alarms still beep + record to history."
                    right={
                        <Toggle on={!prefs.bannerMuted} onChange={(v) => setPrefs({ bannerMuted: !v })} />
                    }
                />
                <Row
                    label="Console (dev)"
                    hint="Console logs from telemetry events. Disable to quiet the dev console."
                    right={
                        <Toggle on={!prefs.consoleMuted} onChange={(v) => setPrefs({ consoleMuted: !v })} />
                    }
                />
            </Section>

            {/* Audio tuning */}
            <Section title="Audio tuning">
                <Row
                    label="Volume"
                    hint={`${Math.round(prefs.audioVolume * 100)}%`}
                    right={
                        <input
                            type="range" min="0" max="0.5" step="0.01"
                            value={prefs.audioVolume}
                            onChange={(e) => setPrefs({ audioVolume: parseFloat(e.target.value) })}
                            className="w-32 accent-purple-500"
                        />
                    }
                />
                {['urgent', 'beep', 'chime'].map(pat => (
                    <Row
                        key={pat}
                        label={`${pat} frequency`}
                        hint={`${prefs.audioFrequencies[pat] || ''} Hz`}
                        right={
                            <input
                                type="range" min="200" max="1500" step="50"
                                value={prefs.audioFrequencies[pat] || 800}
                                onChange={(e) => setPrefs({
                                    audioFrequencies: { ...prefs.audioFrequencies, [pat]: parseInt(e.target.value, 10) }
                                })}
                                className="w-32 accent-purple-500"
                            />
                        }
                    />
                ))}
            </Section>

            {/* Snooze duration */}
            <Section title="Snooze">
                <Row
                    label="Default duration"
                    hint="Used by Snooze buttons across the app."
                    right={
                        <select
                            value={prefs.snoozeDuration}
                            onChange={(e) => setPrefs({ snoozeDuration: parseInt(e.target.value, 10) })}
                            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                        >
                            {[1, 2, 3, 5, 10, 15, 30].map(m => <option key={m} value={m}>{m} min</option>)}
                        </select>
                    }
                />
            </Section>

            {/* Live state */}
            <Section title="Live state">
                <div className="grid grid-cols-3 gap-2 text-xs">
                    <Stat label="Acked" value={acked.length} />
                    <Stat label="Snoozed" value={snoozed.length} />
                    <Stat label="History" value={counts.total} />
                </div>
                {acked.length > 0 && (
                    <button
                        onClick={ackAll}
                        className="mt-3 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-sm rounded inline-flex items-center gap-2"
                    >
                        <RotateCcw className="w-4 h-4" /> Clear all ACKs
                    </button>
                )}
            </Section>

            {/* Reset */}
            <Section title="Reset">
                <button
                    onClick={() => {
                        if (confirm('Reset all notification preferences to defaults? Your snoozed and ack states are kept.')) {
                            setPrefs({ ...DEFAULT_PREFS });
                        }
                    }}
                    className="px-3 py-1.5 bg-red-900/40 hover:bg-red-800/50 text-red-100 text-sm rounded inline-flex items-center gap-2"
                >
                    <AlertTriangle className="w-4 h-4" /> Reset to defaults
                </button>
            </Section>

            {/* History */}
            <Section title="Recent activity">
                <HistorySurface limit={50} />
            </Section>
        </div>
    );
}

const SRC_LABEL = {
    [SOURCES.CLINICAL]: 'Clinical alarms',
    [SOURCES.SYSTEM]: 'System errors',
    [SOURCES.USER]: 'User feedback (success/info)',
    [SOURCES.TELEMETRY]: 'Analytics telemetry',
};
const SRC_HINT = {
    [SOURCES.CLINICAL]: 'Vital alarms, contraindication warnings. Critical clinical alarms cannot be fully muted.',
    [SOURCES.SYSTEM]: 'API failures, TTS errors, validation problems.',
    [SOURCES.USER]: 'Order confirmations, save success, light info toasts.',
    [SOURCES.TELEMETRY]: 'xAPI learning events. Mute to stop sending events to the backend (your view only).',
};

function Section({ title, children }) {
    return (
        <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg p-4">
            <h3 className="text-sm font-bold text-neutral-300 uppercase tracking-wide mb-3">{title}</h3>
            <div className="space-y-3">{children}</div>
        </div>
    );
}

function Row({ label, hint, right }) {
    return (
        <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
                <div className="text-sm text-white">{label}</div>
                {hint && <div className="text-xs text-neutral-500 mt-0.5">{hint}</div>}
            </div>
            <div className="flex-shrink-0">{right}</div>
        </div>
    );
}

function Toggle({ on, onChange, onIcon, offIcon }) {
    const Icon = on ? (onIcon || Eye) : (offIcon || EyeOff);
    return (
        <button
            onClick={() => onChange(!on)}
            className={`px-3 py-1.5 rounded inline-flex items-center gap-2 text-sm font-medium transition-colors ${on ? 'bg-green-700/40 text-green-200 hover:bg-green-700/50' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
        >
            <Icon className="w-4 h-4" />
            {on ? 'On' : 'Off'}
        </button>
    );
}

function Stat({ label, value }) {
    return (
        <div className="bg-neutral-900 border border-neutral-800 rounded p-3 text-center">
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
        </div>
    );
}
