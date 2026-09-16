// The Text tab: how learners compose their messages to the patient.
//
// Numbers come from textAnalytics (pure, tested). This file only lays them out.
// Behavioural estimates of composition from keystroke timing — never the words.

import React, { useMemo } from 'react';
import { Keyboard } from 'lucide-react';
import { textAnalytics } from './textAnalytics.js';
import { BreakdownTable, EmptyState, PauseHistogram, Scope, Section, Stat } from './SignalUi.jsx';
import { fmtDate, fmtMedianIqr, fmtNum, fmtPct, fmtSeconds } from './signalFormat.js';
import WritingProcess from './WritingProcess.jsx';

const cpm = (s) => fmtMedianIqr(s, (v) => fmtNum(v));
const ratio = (s) => fmtMedianIqr(s, (v) => fmtNum(v, 2));
const latency = (s) => fmtMedianIqr(s, (v) => fmtSeconds(v));
const pct = (s) => fmtMedianIqr(s, (v) => fmtPct(v));

export default function OyonTextView({ windows, loading }) {
    const a = useMemo(() => textAnalytics(windows), [windows]);
    const { summary } = a;

    if (!loading && summary.episodes === 0) {
        return (
            <EmptyState icon={Keyboard} title="No typing episodes for this selection">
                Typing is measured only when the tenant has <strong>Typing dynamics</strong> on in Settings → Oyon
                and the learner has accepted the consent contract that covers it. Nothing is recorded for learners
                who declined, and nothing is recorded before they are asked.
            </EmptyState>
        );
    }

    const learnerColumns = [
        { key: 'learner', label: 'Learner', render: (r) => r.learner },
        { key: 'episodes', label: 'Messages', align: 'right', render: (r) => r.episodes },
        { key: 'sessions', label: 'Sessions', align: 'right', render: (r) => r.sessions },
        { key: 'cpm', label: 'Speed (chars/min)', align: 'right', render: (r) => cpm(r.cpm) },
        { key: 'revision', label: 'Revision ratio', align: 'right', render: (r) => ratio(r.revisionRatio) },
        { key: 'latency', label: 'Time to first key', align: 'right', render: (r) => latency(r.firstInputLatencyMs) },
        { key: 'abandoned', label: 'Abandoned', align: 'right', render: (r) => fmtPct(r.abandonedShare) },
        { key: 'paste', label: 'With paste', align: 'right', render: (r) => fmtPct(r.pasteShare) },
    ];

    const caseColumns = [
        { key: 'case', label: 'Case', render: (r) => r.case },
        { key: 'learners', label: 'Learners', align: 'right', render: (r) => r.learners },
        { key: 'episodes', label: 'Messages', align: 'right', render: (r) => r.episodes },
        { key: 'cpm', label: 'Speed (chars/min)', align: 'right', render: (r) => cpm(r.cpm) },
        { key: 'revision', label: 'Revision ratio', align: 'right', render: (r) => ratio(r.revisionRatio) },
        { key: 'abandoned', label: 'Abandoned', align: 'right', render: (r) => fmtPct(r.abandonedShare) },
    ];

    const sessionColumns = [
        { key: 'started', label: 'Started', render: (r) => fmtDate(r.startedAt) },
        { key: 'learner', label: 'Learner', render: (r) => r.learner },
        { key: 'case', label: 'Case', render: (r) => r.case },
        { key: 'episodes', label: 'Messages', align: 'right', render: (r) => r.episodes },
        { key: 'cpm', label: 'Speed (chars/min)', align: 'right', render: (r) => cpm(r.cpm) },
        { key: 'revision', label: 'Revision ratio', align: 'right', render: (r) => ratio(r.revisionRatio) },
    ];

    return (
        <div className="rohy-admin-light space-y-5">
            <Scope>
                Behavioural estimates of how messages are composed, from keystroke timing and edit structure — never the
                words typed. Cohort figures are the median across learners (each learner counts once), with the
                interquartile range in brackets.
            </Scope>

            <div className="flex flex-wrap gap-2">
                <Stat label="Messages" value={fmtNum(summary.episodes)} hint={`${summary.learners} learners · ${summary.sessions} sessions`} />
                <Stat label="Typing speed" value={cpm(summary.cpm)} hint="characters per active minute" accent />
                <Stat label="Revision ratio" value={ratio(summary.revisionRatio)} hint="deleted ÷ inserted" />
                <Stat label="Time to first key" value={latency(summary.firstInputLatencyMs)} />
                <Stat label="Sent" value={fmtPct(summary.submittedShare)} hint={`abandoned ${fmtPct(summary.abandonedShare)}`} />
                <Stat label="With paste" value={fmtPct(summary.pasteShare)} hint="not typed composition" />
                <Stat label="Kept" value={pct(summary.productRatio)} hint="of typed text left in the message" />
                <Stat label="Bursts ended by revising" value={pct(summary.revisionBurstShare)} hint="R-bursts ÷ all bursts" />
            </div>

            <Section
                title="Where learners pause"
                description="The caret's position when a pause began. Mid-word pauses suggest difficulty getting words down; pauses between words and sentences suggest planning."
            >
                {a.pauseLocations.measured === 0 ? (
                    <p className="text-sm text-gray-500">Not measured for these messages — they were captured without caret context.</p>
                ) : (
                    <PauseHistogram
                        pauses={a.pauseLocations}
                        ariaLabel={`Pause locations across ${a.pauseLocations.total} pauses`}
                        labelWidth={140}
                        caption={`${a.pauseLocations.total} pauses from ${a.pauseLocations.measured} messages`
                            + (a.pauseLocations.unmeasured > 0 ? ` · ${a.pauseLocations.unmeasured} messages did not record where pauses fell` : '')}
                    />
                )}
            </Section>

            <Section
                title="Pauses between keystrokes"
                description="How long learners pause while composing. Long pauses mid-message often mark planning or hesitation."
            >
                <PauseHistogram pauses={a.pauses} unit="pauses" />
            </Section>

            <WritingProcess windows={windows} />

            <Section title="By learner" description="Each learner's median per message, with the interquartile range.">
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
