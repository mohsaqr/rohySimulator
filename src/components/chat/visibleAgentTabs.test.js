// Regression lock for Bug 10 (16.5.2026 report): a "Default Patient"
// persona (agent_type:'patient') showed up as a second chat tab mapped
// to the actual patient. The patient owns its own dedicated tab; no
// agent_type==='patient' template may render a duplicate.

import { describe, it, expect } from 'vitest';
import { visibleAgentTabs } from './ChatInterface.jsx';

describe('visibleAgentTabs (Bug 10)', () => {
    const agents = [
        { agent_type: 'patient', name: 'Default Patient', enabled: true },
        { agent_type: 'discussant', name: 'Default Discussant', enabled: true },
        { agent_type: 'nurse', name: 'Sarah Mitchell', enabled: true },
        { agent_type: 'consultant', name: 'Dr. James Chen', enabled: false },
    ];

    it('excludes any agent_type==="patient" (no duplicate patient tab)', () => {
        const types = visibleAgentTabs(agents).map(a => a.agent_type);
        expect(types).not.toContain('patient');
        expect(types).toEqual(['discussant', 'nurse']); // consultant disabled
    });

    it('still excludes a renamed patient template (gate is on type, not name)', () => {
        const renamed = [{ agent_type: 'patient', name: 'Acme Patient', enabled: true }];
        expect(visibleAgentTabs(renamed)).toEqual([]);
    });

    it('keeps non-patient agents and honours enabled:false', () => {
        expect(visibleAgentTabs(agents).every(a => a.enabled !== false)).toBe(true);
    });

    it('is null-safe', () => {
        expect(visibleAgentTabs(null)).toEqual([]);
        expect(visibleAgentTabs(undefined)).toEqual([]);
    });
});

// Specialists live in the on-call phone (src/components/oncall), so they must
// not also get a team-agent tab.
describe('visibleAgentTabs — on-call specialists', () => {
    it('drops every specialist type and keeps the rest of the team', () => {
        const agents = [
            { agent_type: 'nurse', name: 'Sarah', enabled: true },
            { agent_type: 'pathologist', name: 'Dr. P', enabled: true },
            { agent_type: 'cardiologist', name: 'Dr. C', enabled: true },
            { agent_type: 'radiologist', name: 'Dr. R', enabled: true },
        ];
        expect(visibleAgentTabs(agents).map(a => a.agent_type)).toEqual(['nurse']);
    });
});
