// Regression locks for the three pure helpers behind the chat's agent tabs.
// All from the 2026-08-30 UI review:
//
//   #17  the tab badge said "Away" for a nurse who was in the room and for an
//        on-call consultant, because it badged the raw paging status and
//        ignored availability_type.
//   #35a "Call Dr." — name.split(' ')[0] on "Dr. James Chen".
//   #35b the nurse was captioned "male" from an avatar-routing name guess.
//   #35c participant ids read literally "agent:undefined".
//
// Sibling of visibleAgentTabs.test.js: pure functions imported from
// ChatInterface.jsx, no rendering.

import { describe, it, expect } from 'vitest';
import { agentBadgeStatus, agentShortName, deriveActiveParticipant } from './ChatInterface.jsx';

describe('agentShortName', () => {
    // Regression lock: an honorific is not a first name.
    it('keeps the honorific with the family name', () => {
        expect(agentShortName('Dr. James Chen')).toBe('Dr. Chen');
        expect(agentShortName('Dr James Chen')).toBe('Dr Chen');
        expect(agentShortName('Prof. Maria Alvarez Ruiz')).toBe('Prof. Ruiz');
        // Never the bare honorific — that was the bug ("Call Dr.").
        expect(agentShortName('Dr. James Chen')).not.toBe('Dr.');
    });

    it('uses the first name when there is no honorific', () => {
        expect(agentShortName('Nancy Alvarez')).toBe('Nancy');
        expect(agentShortName('Nancy')).toBe('Nancy');
    });

    it('survives empty, blank and missing names', () => {
        expect(agentShortName('')).toBe('');
        expect(agentShortName('   ')).toBe('');
        expect(agentShortName(null)).toBe('');
        expect(agentShortName(undefined)).toBe('');
        expect(agentShortName('Dr.')).toBe('Dr.');
    });
});

describe('agentBadgeStatus', () => {
    const nurse = (over = {}) => ({
        agent_type: 'nurse',
        name: 'Nancy',
        enabled: true,
        status: 'absent',
        availability_type: 'present',
        available_from_minute: 0,
        depart_at_minute: null,
        ...over,
    });

    // Regression lock: a nurse configured as present badges "present", not
    // the raw paging status she has never left.
    it('badges an always-present agent as present even while status says absent', () => {
        expect(agentBadgeStatus(nurse(), 5)).toBe('present');
    });

    // Regression lock: an on-call consultant is on-call, not away.
    it('badges an on-call agent as on-call', () => {
        expect(agentBadgeStatus(nurse({ agent_type: 'consultant', availability_type: 'on-call' }), 5))
            .toBe('on-call');
    });

    it('lets the live paging state win over the configuration', () => {
        expect(agentBadgeStatus(nurse({ status: 'paged', availability_type: 'on-call' }), 5)).toBe('paged');
        expect(agentBadgeStatus(nurse({ status: 'present', availability_type: 'on-call' }), 5)).toBe('present');
    });

    it('respects an availability window that has not opened yet', () => {
        expect(agentBadgeStatus(nurse({ available_from_minute: 10 }), 2)).toBe('not-yet');
        expect(agentBadgeStatus(nurse({ available_from_minute: 10 }), 12)).toBe('present');
    });

    it('reports an absent or departed agent honestly', () => {
        expect(agentBadgeStatus(nurse({ availability_type: 'absent' }), 5)).toBe('absent');
        expect(agentBadgeStatus(nurse({ depart_at_minute: 3 }), 9)).toBe('departed');
    });

    // Defensive: older server builds omitted availability_type from the
    // session-agents payload — fall back to the raw status rather than
    // inventing one.
    it('falls back to the raw status when availability_type is absent from the row', () => {
        expect(agentBadgeStatus({ agent_type: 'nurse', status: 'paged' })).toBe('paged');
        expect(agentBadgeStatus({ agent_type: 'nurse' })).toBe('absent');
        expect(agentBadgeStatus(null)).toBe('absent');
        expect(agentBadgeStatus(undefined)).toBe('absent');
    });
});

describe('deriveActiveParticipant', () => {
    const agents = [{
        id: 11,
        agent_template_id: 'tpl-nurse',
        agent_type: 'nurse',
        name: 'Nancy',
        role_title: 'Floor Nurse',
        avatar_url: null,
        config: JSON.stringify({}),
    }];

    // Regression lock: never the string "agent:undefined".
    it('builds the participant id from the agent id', () => {
        expect(deriveActiveParticipant('nurse', null, agents).id).toBe('agent:11');
    });

    it('falls back to the template id, then the type, when no id is served', () => {
        const noId = [{ ...agents[0], id: undefined }];
        expect(deriveActiveParticipant('nurse', null, noId).id).toBe('agent:tpl-nurse');

        const bare = [{ ...agents[0], id: undefined, agent_template_id: undefined }];
        expect(deriveActiveParticipant('nurse', null, bare).id).toBe('agent:nurse');

        for (const list of [noId, bare, agents]) {
            expect(deriveActiveParticipant('nurse', null, list).id).not.toContain('undefined');
        }
    });

    // Regression lock: the name/role gender guess is marked as a guess, so
    // the caption can refuse to print it (the seeded nurse read "male").
    it('marks a guessed gender as guessed and a configured one as declared', () => {
        const guessed = deriveActiveParticipant('nurse', null, agents);
        expect(guessed.gender).toBe('male');          // still routes an avatar
        expect(guessed.genderSource).toBe('guessed'); // but is not for reading

        const declared = deriveActiveParticipant('nurse', null, [{
            ...agents[0], config: JSON.stringify({ gender: 'female' }),
        }]);
        expect(declared.gender).toBe('female');
        expect(declared.genderSource).toBe('declared');
    });

    it('treats the case-authored patient demographics as declared', () => {
        const p = deriveActiveParticipant('patient', {
            id: 42,
            config: { patient_name: 'Alice', demographics: { age: 61, gender: 'female' } },
        }, agents);
        expect(p).toMatchObject({
            id: 'case:42', name: 'Alice', age: 61, gender: 'female', genderSource: 'declared',
        });
    });
});
