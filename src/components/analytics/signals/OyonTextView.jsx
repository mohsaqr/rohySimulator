// The Text tab: how learners compose their messages to the patient.
//
// Numbers come from textAnalytics (pure, tested). This file only lays them out,
// in the dashboard's own cards and panels (ui/DashboardCards.jsx).
// Behavioural estimates of composition from keystroke timing — never the words.

import React, { useMemo } from 'react';
import {
    ClipboardPaste, Eraser, FileCheck2, Gauge, Keyboard, MessageSquareText, RotateCcw, Send, Timer,
} from 'lucide-react';
import { textAnalytics } from './textAnalytics.js';
import { BreakdownTable, EmptyState, PauseHistogram, Scope, Section } from './SignalUi.jsx';
import { SignalStat } from './SignalStat.jsx';
import { MetricGrid } from '../ui/DashboardCards.jsx';
import { fmtDate, fmtIqr, fmtMedian, fmtMedianIqr, fmtNum, fmtPct, fmtSeconds } from './signalFormat.js';
import WritingProcess from './WritingProcess.jsx';

const cpm = (s) => fmtMedianIqr(s, (v) => fmtNum(v));
const ratio = (s) => fmtMedianIqr(s, (v) => fmtNum(v, 2));
const latency = (s) => fmtMedianIqr(s, (v) => fmtSeconds(v));
const toNum = (v) => fmtNum(v);
const toRatio = (v) => fmtNum(v, 2);
const toSeconds = (v) => fmtSeconds(v);
const toPct = (v) => fmtPct(v);

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
        <div className="rohy-admin-light space-y-4">
            <Scope>
                Behavioural estimates of how messages are composed, from keystroke timing and edit structure — never the
                words typed. Cohort figures are the median across learners (each learner counts once); the interquartile
                range (IQR) sits under each figure.
            </Scope>

            <MetricGrid base="sm:grid-cols-2" cols="xl:grid-cols-4">
                <SignalStat icon={MessageSquareText} label="Messages" value={fmtNum(summary.episodes)} accent="cyan"
                    detail={[`${summary.learners} learners`, `${summary.sessions} sessions`]} />
                <SignalStat icon={Gauge} label="Typing speed" value={fmtMedian(summary.cpm, toNum)} unit="chars/min" accent="green"
                    detail={[fmtIqr(summary.cpm, toNum), 'active typing time']} />
                <SignalStat icon={Eraser} label="Revision ratio" value={fmtMedian(summary.revisionRatio, toRatio)} accent="amber"
                    detail={[fmtIqr(summary.revisionRatio, toRatio), 'deleted ÷ inserted']} />
                <SignalStat icon={Timer} label="Time to first key" value={fmtMedian(summary.firstInputLatencyMs, toSeconds)} accent="teal"
                    detail={[fmtIqr(summary.firstInputLatencyMs, toSeconds), 'before typing']} />
                <SignalStat icon={Send} label="Sent" value={fmtPct(summary.submittedShare)} accent="cyan"
                    detail={[`abandoned ${fmtPct(summary.abandonedShare)}`]} />
                <SignalStat icon={ClipboardPaste} label="With paste" value={fmtPct(summary.pasteShare)} accent="rose"
                    detail={['messages with pasted text']} />
                <SignalStat icon={FileCheck2} label="Kept" value={fmtMedian(summary.productRatio, toPct)} accent="green"
                    detail={[fmtIqr(summary.productRatio, toPct), 'of typed text kept']} />
                <SignalStat icon={RotateCcw} label="Bursts ended by revising" value={fmtMedian(summary.revisionBurstShare, toPct)} accent="amber"
                    detail={[fmtIqr(summary.revisionBurstShare, toPct), 'R-bursts ÷ all bursts']} />
            </MetricGrid>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Section
                    title="Pauses between keystrokes"
                    description="How long learners pause while composing. Long pauses mid-message often mark planning or hesitation."
                >
                    <PauseHistogram pauses={a.pauses} unit="pauses" />
                </Section>
                <Section
                    title="Where learners pause"
                    description="Where the caret was when a pause began. Mid-word pauses suggest trouble getting words down; pauses between words and sentences suggest planning."
                >
                    {a.pauseLocations.measured === 0 ? (
                        <p className="py-6 text-center text-sm text-gray-500">Not measured for these messages — they were captured without caret context.</p>
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
            </div>

            <WritingProcess windows={windows} />

            <Section title="By learner" description="Each learner's median per message, with the interquartile range in brackets.">
                <BreakdownTable columns={learnerColumns} rows={a.byLearner} />
            </Section>

            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <Section title="By case" description="Messages pooled within each case.">
                    <BreakdownTable columns={caseColumns} rows={a.byCase} />
                </Section>
                <Section title="By session" description="Most recent first.">
                    <BreakdownTable columns={sessionColumns} rows={a.bySession} limit={50} />
                </Section>
            </div>
        </div>
    );
}
