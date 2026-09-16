// The Voice tab: how learners speak to the patient in voice mode.
//
// Numbers come from voiceAnalytics (pure, tested). Per-turn measurements only —
// never the recording, never the words. Metrics use analysable turns; turns Oyon
// could not measure are counted and explained, not averaged in.

import React, { useMemo } from 'react';
import { Mic } from 'lucide-react';
import { voiceAnalytics } from './voiceAnalytics.js';
import { BreakdownTable, EmptyState, PauseHistogram, Scope, Section, Stat } from './SignalUi.jsx';
import { fmtDate, fmtMedianIqr, fmtNum, fmtPct, fmtSeconds } from './signalFormat.js';
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

    const measuredHint = summary.analysableTurns === summary.turns
        ? `${summary.learners} learners · ${summary.sessions} sessions`
        : `${summary.analysableTurns} measured · ${fmtPct(summary.insufficientShare)} not measurable`;

    return (
        <div className="rohy-admin-light space-y-5">
            <Scope>
                Per-turn measurements of how learners speak to the patient — speaking time, pauses, pitch and loudness.
                Never the recording and never the words. Cohort figures are the median across learners (each learner
                counts once), with the interquartile range in brackets, over turns Oyon could measure.
            </Scope>

            <div className="flex flex-wrap gap-2">
                <Stat label="Turns" value={fmtNum(summary.turns)} hint={measuredHint} />
                <Stat label="Speaking share" value={share(summary.speechRatio)} hint="of each turn spent speaking" accent />
                <Stat label="Turn length" value={seconds(summary.turnDurationMs)} />
                <Stat label="Pauses per turn" value={count(summary.internalPauses)} hint="silences of 0.5 s or more" />
                <Stat label="Pitch" value={hz(summary.pitchMedianHz)} hint="median fundamental frequency" />
            </div>

            {a.insufficientReasons.length > 0 && (
                <Section
                    title="Turns that could not be measured"
                    description="Counted here and left out of every figure above, so they cannot pull the averages toward zero."
                >
                    <ul className="space-y-1 text-sm text-gray-800">
                        {a.insufficientReasons.map((r) => (
                            <li key={r.reason} className="flex justify-between gap-4">
                                <span>{REASON_LABELS[r.reason] || r.reason}</span>
                                <span className="tabular-nums text-gray-600">{r.count}</span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            <Section
                title="Pauses while speaking"
                description="Length of silences between spoken segments, from measurable turns."
            >
                <PauseHistogram pauses={a.pauses} unit="pauses" />
            </Section>

            <VoiceSession windows={windows} />

            <Section title="By learner" description="Each learner's median per turn, with the interquartile range.">
                <BreakdownTable columns={learnerColumns} rows={a.byLearner} />
            </Section>

            <Section title="By case">
                <BreakdownTable columns={caseColumns} rows={a.byCase} />
            </Section>

            <Section title="By session" description="Most recent first.">
                <BreakdownTable columns={sessionColumns} rows={a.bySession} limit={50} />
            </Section>
        </div>
    );
}
