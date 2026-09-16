// One session's voice turns in order: pick a learner and a session to see the
// across-turn trends and where each turn's time went. Scoped to a session on
// purpose — a trend across turns from different sessions is not a trajectory.

import React, { useMemo, useState } from 'react';
import { caseLabel, groupBy, learnerKey, learnerName, payloadOf } from './signalStats.js';
import { voiceTurns } from './voiceAnalytics.js';
import { fmtDate } from './signalFormat.js';
import { Picker, Pickers, Section } from './SignalUi.jsx';
import { ChartCard } from './ChartKit.jsx';
import { VoiceTurnComposition, VoiceTurnTrends } from './VoiceCharts.jsx';

const byStart = (a, b) => String(a.window_start ?? '').localeCompare(String(b.window_start ?? ''))
    || String(a.record_id ?? a.id ?? '').localeCompare(String(b.record_id ?? b.id ?? ''));

export default function VoiceSession({ windows }) {
    const turns = useMemo(() => voiceTurns(windows).sort(byStart), [windows]);

    // learner -> sessions (newest first) -> turns (in order)
    const learners = useMemo(() => [...groupBy(turns, learnerKey).values()]
        .map((group) => ({
            key: learnerKey(group[0]),
            name: learnerName(group[0]),
            sessions: [...groupBy(group, (w) => String(w.session_id)).values()]
                .map((s) => ({ key: String(s[0].session_id), first: s[0], turns: s }))
                .sort((a, b) => byStart(b.first, a.first)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)), [turns]);

    const [learnerChoice, setLearnerChoice] = useState(null);
    const [sessionChoice, setSessionChoice] = useState(null);
    if (learners.length === 0) return null;

    const learner = learners.find((l) => l.key === learnerChoice) ?? learners[0];
    const session = learner.sessions.find((s) => s.key === sessionChoice) ?? learner.sessions[0];
    const shaped = session.turns.map((w) => ({ voice: payloadOf(w), window_start: w.window_start }));

    return (
        <Section
            title="Turns in one session"
            description="How a learner's speaking changed from turn to turn, and where each turn's time went."
        >
            <Pickers>
                <Picker label="Learner" value={learner.key} onChange={(e) => { setLearnerChoice(e.target.value); setSessionChoice(null); }}>
                    {learners.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
                </Picker>
                <Picker label="Session" grow value={session.key} onChange={(e) => setSessionChoice(e.target.value)}>
                    {learner.sessions.map((s) => (
                        <option key={s.key} value={s.key}>{`${fmtDate(s.first.window_start)} · ${caseLabel(s.first)} · ${s.turns.length} turns`}</option>
                    ))}
                </Picker>
            </Pickers>
            <div className="space-y-3">
                <ChartCard title="Across turns" hint="One panel per measure, turn by turn. Is the learner warming up, trailing off, or starting to hesitate?">
                    <VoiceTurnTrends turns={shaped} />
                </ChartCard>
                <ChartCard title="Where each turn's time went" hint="Each bar is one turn, drawn to its real length.">
                    <VoiceTurnComposition turns={shaped} />
                </ChartCard>
            </div>
        </Section>
    );
}
