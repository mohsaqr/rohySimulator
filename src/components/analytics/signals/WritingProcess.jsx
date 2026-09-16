// Writing process for ONE message: pick a learner, then a message, and see
// Oyon's four per-episode charts for it. The cohort figures above it pool; this
// section deliberately does not — a progression graph averaged over messages
// describes no message anyone wrote.

import React, { useMemo, useState } from 'react';
import { caseLabel, learnerKey, learnerName, payloadOf } from './signalStats.js';
import { hasEditSeries, typingEpisodes } from './textAnalytics.js';
import { fmtDate } from './signalFormat.js';
import { Picker, Pickers, Section } from './SignalUi.jsx';
import { ChartCard } from './ChartKit.jsx';
import {
    TypingBurstStrip, TypingIkiDistribution, TypingProductionCurve, TypingProgressionChart,
} from './TypingCharts.jsx';

const episodeKey = (w) => String(w.record_id ?? w.id ?? `${w.session_id}|${w.window_start}`);

function messageLabel(w) {
    const t = payloadOf(w);
    const outcome = t?.submitted ? 'sent' : t?.abandoned ? 'abandoned' : 'open';
    const length = Number.isFinite(t?.committed_graphemes) ? `${t.committed_graphemes} characters` : 'length not recorded';
    const series = hasEditSeries(w) ? '' : ' · summary only';
    return `${fmtDate(w.window_start)} · ${caseLabel(w)} · ${length} · ${outcome}${series}`;
}

const newestFirst = (a, b) => String(b.window_start ?? '').localeCompare(String(a.window_start ?? '')) || episodeKey(a).localeCompare(episodeKey(b));

export default function WritingProcess({ windows }) {
    const episodes = useMemo(() => typingEpisodes(windows).sort(newestFirst), [windows]);
    const learners = useMemo(() => {
        const seen = new Map();
        for (const w of episodes) if (!seen.has(learnerKey(w))) seen.set(learnerKey(w), learnerName(w));
        return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    }, [episodes]);

    // Default: the most recent message that can be drawn (else the most recent
    // overall), and its learner; within a learner, their newest drawable one.
    const [learnerChoice, setLearnerChoice] = useState(null);
    const [messageChoice, setMessageChoice] = useState(null);
    const opening = episodes.find(hasEditSeries) ?? episodes[0];
    const learner = learners.some((l) => l.key === learnerChoice) ? learnerChoice : (opening ? learnerKey(opening) : null);
    const messages = episodes.filter((w) => learnerKey(w) === learner);
    const selected = messages.find((w) => episodeKey(w) === messageChoice)
        ?? messages.find(hasEditSeries) ?? messages[0] ?? null;

    if (episodes.length === 0) return null;
    const typing = selected ? payloadOf(selected) : null;
    const quality = selected?.quality ?? null;

    return (
        <Section
            title="Writing process"
            description="One message at a time: how it was written, edit by edit. Pick a learner and one of their messages."
        >
            <Pickers>
                <Picker label="Learner" value={learner ?? ''} onChange={(e) => { setLearnerChoice(e.target.value); setMessageChoice(null); }}>
                    {learners.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
                </Picker>
                <Picker label="Message" grow value={selected ? episodeKey(selected) : ''} onChange={(e) => setMessageChoice(e.target.value)}>
                    {messages.map((w) => <option key={episodeKey(w)} value={episodeKey(w)}>{messageLabel(w)}</option>)}
                </Picker>
            </Pickers>

            {typing && !hasEditSeries(selected) && (
                <p className="rounded-md bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
                    This message was stored as a summary only — its edit-by-edit series was not kept, so there is no
                    writing process to draw. It still counts in every figure above.
                    {messages.some(hasEditSeries) ? ' Pick another message to see one.' : ''}
                </p>
            )}

            {typing && hasEditSeries(selected) && (
                <div className="space-y-3">
                    {!quality && (
                        <p className="text-xs text-gray-500">
                            This message was stored before its capture settings were kept, so pauses are marked at
                            Oyon&apos;s default 2 s threshold.
                        </p>
                    )}
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        <ChartCard title="Progression" hint="Where each edit happened in the message over time. A drop below the leading edge is the writer going back to revise earlier text.">
                            <TypingProgressionChart typing={typing} quality={quality} />
                        </ChartCard>
                        <ChartCard title="Production curve" hint="Message length after every edit. Flat stretches are pauses, steps down are deletions; compare the slope with the dashed mean rate.">
                            <TypingProductionCurve typing={typing} quality={quality} />
                        </ChartCard>
                        <ChartCard title="Pause-length distribution" hint="Intervals between keystrokes on a log scale. Fluent typing sits left; the long tail is planning or hesitation.">
                            <TypingIkiDistribution typing={typing} quality={quality} />
                        </ChartCard>
                        <ChartCard title="Burst strip" hint="Runs of typing. Long P-bursts mean fluent writing; frequent R-bursts mean writing kept stopping to fix text.">
                            <TypingBurstStrip typing={typing} quality={quality} />
                        </ChartCard>
                    </div>
                </div>
            )}
        </Section>
    );
}
