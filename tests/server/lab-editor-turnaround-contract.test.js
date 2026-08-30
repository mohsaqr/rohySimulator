// Source-contract tests for the authoring lab editor's turnaround handling.
//
// Regression lock: adding a lab stores turnaround_minutes null, not an eager
// concrete default (bug report 2.9.15 #4).
//
// Every add path in LabInvestigationEditor.jsx (single add, add-group-as-
// panel, template apply) used to stamp `turnaround_minutes:
// DEFAULT_TURNAROUND_MINUTES` (3) onto the new lab. Because the server
// resolver gives a per-test value priority over the case-level default,
// that eager stamp made the case's "Default wait time" a no-op for every
// configured test. The contract is now: null = "follow the case default,
// resolved at order time"; a number is persisted only when the teacher
// actually picks one, and the Custom input shows the effective default as
// a docs/design/i18n-plan.md (derived display), never as a stored value.
//
// These are source contracts, not render tests, because the add paths are
// closures inside the component (fed by fetch-backed search flows) and the
// defect is precisely a literal in the created object — the same pattern
// the compose/route-allowlist contract tests pin.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(__filename), '..', '..');
const EDITOR = path.join(REPO, 'src', 'components', 'settings', 'LabInvestigationEditor.jsx');

const editorSrc = fs.readFileSync(EDITOR, 'utf8');

describe('LabInvestigationEditor turnaround source contract (bug report 2.9.15 #4)', () => {
    it('never stamps a concrete default turnaround onto an added lab', () => {
        // The literal that caused the bug. If any add path reintroduces an
        // eager `turnaround_minutes: DEFAULT_TURNAROUND_MINUTES` (or a bare
        // number), the case-level default silently stops applying again.
        expect(editorSrc).not.toMatch(/turnaround_minutes:\s*DEFAULT_TURNAROUND_MINUTES/);
        expect(editorSrc).not.toMatch(/turnaround_minutes:\s*\d/);
    });

    it('stores null ("follow the case default") on every add path', () => {
        // Three add paths: addLab, addGroupAsPanel, applyTemplate.
        const nullStamps = editorSrc.match(/turnaround_minutes:\s*null/g) || [];
        expect(nullStamps.length).toBeGreaterThanOrEqual(3);
    });

    it('renders an unset turnaround as empty input + placeholder, not a stored value', () => {
        // The Custom input must not resurrect the eager default by rendering
        // it as its value — `?? ''` keeps null unset while a placeholder
        // shows the effective (case default) wait.
        expect(editorSrc).toMatch(/value=\{lab\.turnaround_minutes\s*\?\?\s*''\}/);
        expect(editorSrc).toMatch(/placeholder=\{String\(caseDefaultTurnaround/);
    });
});
