// The Voice tab: how learners speak to the patient in voice mode.
//
// Numbers come from voiceAnalytics (pure, tested). Per-turn measurements only —
// never the recording, never the words. Metrics use analysable turns; turns Oyon
// could not measure are counted and explained, not averaged in. Laid out in the
// dashboard's own cards and panels (ui/DashboardCards.jsx).

import React, { useMemo } from 'react';
import { AudioLines, AudioWaveform, Mic, Pause, Timer } from 'lucide-react';
import { voiceAnalytics } from './voiceAnalytics.js';
import { BreakdownTable, EmptyState, PauseHistogram, Scope, Section } from './SignalUi.jsx';
import { SignalStat } from './SignalStat.jsx';
import { MetricGrid } from '../ui/DashboardCards.jsx';
import { fmtDate, fmtIqr, fmtMedian, fmtMedianIqr, fmtNum, fmtPct, fmtSeconds } from './signalFormat.js';
import VoiceSession from './VoiceSession.jsx';

/** Oyon's machine-readable reasons, in words an educator can act on. */
const REASON_LABELS = {
    insufficient_analyzable_speech: 'Too little speech to measure (a very short turn, or mostly silence)',
    excessive_clipping: 'Microphone clipping — input too loud or distorted',
    poor_vad_coverage: 'The speech detector could not cover the turn',
    unspecified: 'No reason recorded',
};

const share = (s) => fmtMedianIqr(s, (v) => fmtPct(v));
const seconds = (s) => fmtMedianIqr(s, (v) => fmtSeconds(v));
const hz = (s) => fmtMedianIqr(s, (v) => `${fmtNum(v)} Hz`);
const count = (s) => fmtMedianIqr(s, (v) => fmtNum(v, 1));
const toPct = (v) => fmtPct(v);
const toSeconds = (v) => fmtSeconds(v);
const toHz = (v) => fmtNum(v);
const toCount = (v) => fmtNum(v, 1);

/** Measured vs not measurable, as a labelled bar: the share never rests on colour. */
function Coverage({ measured, total }) {
    const missing = total - measured;
    const pct = total > 0 ? (measured / total) * 100 : 0;
    return (
        <div>
            <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-semibold text-gray-900">{`${measured} of ${total} turns measured`}</span>
                <span className="tabular-nums text-gray-500">{`${missing} not measurable`}</span>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-gray-100" role="img"
                aria-label={`${measured} of ${total} turns measured, ${missing} not measurable`}>
                <div className="h-full" style={{ width: `${pct}%`, background: '#0072B2' }} />
                <div className="h-full flex-1"
                    style={{ backgroundImage: 'repeating-linear-gradient(45deg, #d1d5db 0 2px, transparent 2px 5px)' }} />
            </div>
        </div>
    );
}

export default function OyonVoiceView({ windows, loading }) {
    const a = useMemo(() => voiceAnalytics(windows), [windows]);
    const { summary } = a;

    if (!loading && summary.turns === 0) {
        return (
            <EmptyState icon={Mic} title="No voice turns for this selection">
                Voice is measured only when the tenant has <strong>Voice</strong> on in Settings → Oyon, the learner
                has accepted the consent contract that names the microphone, and the learner speaks to the patient in
                voice mode. Voice is off by default.
            </EmptyState>
        );
    }

    const turnsCell = (r) => (r.analysableTurns === r.turns ? r.turns : `${r.analysableTurns} / ${r.turns}`);

    const learnerColumns = [
        { key: 'learner', label: 'Learner', render: (r) => r.learner },
        { key: 'turns', label: 'Turns (measured / all)', align: 'right', render: turnsCell },
        { key: 'sessions', label: 'Sessions', align: 'right', render: (r) => r.sessions },
        { key: 'speech', label: 'Speaking share', align: 'right', render: (r) => share(r.speechRatio) },
        { key: 'duration', label: 'Turn length', align: 'right', render: (r) => seconds(r.turnDurationMs) },
        { key: 'pitch', label: 'Pitch', align: 'right', render: (r) => hz(r.pitchMedianHz) },
        { key: 'pauses', label: 'Pauses / turn', align: 'right', render: (r) => count(r.internalPauses) },
    ];

    const caseColumns = [
        { key: 'case', label: 'Case', render: (r) => r.case },
        { key: 'learners', label: 'Learners', align: 'right', render: (r) => r.learners },
        { key: 'turns', label: 'Turns (measured / all)', align: 'right', render: turnsCell },
        { key: 'speech', label: 'Speaking share', align: 'right', render: (r) => share(r.speechRatio) },
        { key: 'duration', label: 'Turn length', align: 'right', render: (r) => seconds(r.turnDurationMs) },
        { key: 'pauses', label: 'Pauses / turn', align: 'right', render: (r) => count(r.internalPauses) },
    ];

    const sessionColumns = [
        { key: 'started', label: 'Started', render: (r) => fmtDate(r.startedAt) },
        { key: 'learner', label: 'Learner', render: (r) => r.learner },
        { key: 'case', label: 'Case', render: (r) => r.case },
        { key: 'turns', label: 'Turns (measured / all)', align: 'right', render: turnsCell },
        { key: 'speech', label: 'Speaking share', align: 'right', render: (r) => share(r.speechRatio) },
        { key: 'duration', label: 'Turn length', align: 'right', render: (r) => seconds(r.turnDurationMs) },
    ];

    const measuredDetail = summary.analysableTurns === summary.turns
        ? [`${summary.learners} learners`, `${summary.sessions} sessions`]
        : [`${summary.analysableTurns} measured`, `${fmtPct(summary.insufficientShare)} not measurable`];
    const hasReasons = a.insufficientReasons.length > 0;

    return (
        <div className="rohy-admin-light space-y-4">
            <Scope>
                Per-turn measurements of how learners speak to the patient — speaking time, pauses, pitch and loudness.
                Never the recording and never the words. Cohort figures are the median across learners (each learner
                counts once) over turns Oyon could measure; the interquartile range (IQR) sits under each figure.
            </Scope>

            <MetricGrid base="sm:grid-cols-2 lg:grid-cols-3" cols="xl:grid-cols-5">
                <SignalStat icon={Mic} label="Turns" value={fmtNum(summary.turns)} accent="cyan" detail={measuredDetail} />
                <SignalStat icon={AudioLines} label="Speaking share" value={fmtMedian(summary.speechRatio, toPct)} accent="green"
                    detail={[fmtIqr(summary.speechRatio, toPct), 'of each turn']} />
                <SignalStat icon={Timer} label="Turn length" value={fmtMedian(summary.turnDurationMs, toSeconds)} accent="amber"
                    detail={[fmtIqr(summary.turnDurationMs, toSeconds), 'start to end']} />
                <SignalStat icon={Pause} label="Pauses per turn" value={fmtMedian(summary.internalPauses, toCount)} accent="teal"
                    detail={[fmtIqr(summary.internalPauses, toCount), 'silences ≥ 0.5 s']} />
                <SignalStat icon={AudioWaveform} label="Pitch" value={fmtMedian(summary.pitchMedianHz, toHz)} unit="Hz" accent="rose"
                    detail={[fmtIqr(summary.pitchMedianHz, toHz), 'median voice pitch']} />
            </MetricGrid>

            <div className={`grid grid-cols-1 gap-4 ${hasReasons ? 'xl:grid-cols-5' : ''}`}>
                <Section
                    className={hasReasons ? 'xl:col-span-3' : ''}
                    title="Pauses while speaking"
                    description="Length of silences between spoken segments, from measurable turns."
                >
                    <PauseHistogram pauses={a.pauses} unit="pauses" />
                </Section>
                {hasReasons && (
                    <Section
                        className="xl:col-span-2"
                        title="Turns that could not be measured"
                        description="Counted here and left out of every figure above, so they cannot pull the averages toward zero."
                    >
                        <Coverage measured={summary.analysableTurns} total={summary.turns} />
                        <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100 text-sm">
                            {a.insufficientReasons.map((r) => (
                                <li key={r.reason} className="flex items-baseline justify-between gap-4 py-2 last:pb-0">
                                    <span className="text-gray-800">{REASON_LABELS[r.reason] || r.reason}</span>
                                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-700">
                                        {`${r.count} ${r.count === 1 ? 'turn' : 'turns'}`}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Section>
                )}
            </div>

            <VoiceSession windows={windows} />

            <Section title="By learner" description="Each learner's median per turn, with the interquartile range in brackets.">
                <BreakdownTable columns={learnerColumns} rows={a.byLearner} />
            </Section>

            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <Section title="By case" description="Turns pooled within each case.">
                    <BreakdownTable columns={caseColumns} rows={a.byCase} />
                </Section>
                <Section title="By session" description="Most recent first.">
                    <BreakdownTable columns={sessionColumns} rows={a.bySession} limit={50} />
                </Section>
            </div>
        </div>
    );
}
