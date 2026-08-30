// Regression lock for the invisible-class bug reported against v2.9.82: the
// selected medication in the Treatments room had no background, so its
// `text-white` label sat on whatever was behind it. The class name was built by
// interpolation, Tailwind's JIT never saw it, and no rule was ever generated —
// silently, because the markup is valid and devtools shows the class.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    categoryClass, statusChipClass,
    CATEGORY_COLORS, STATUS_COLORS, DEFAULT_CATEGORY_COLOR,
} from './treatmentTheme';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('treatmentTheme returns literal, complete class strings', () => {
    it('never emits an interpolation marker', () => {
        for (const color of CATEGORY_COLORS) {
            for (const part of ['tab', 'action', 'row']) {
                const cls = categoryClass(color, part);
                expect(cls, `${color}.${part}`).toBeTruthy();
                expect(cls).not.toContain('${');
                expect(cls).not.toContain('undefined');
            }
        }
        for (const color of STATUS_COLORS) {
            expect(statusChipClass(color)).not.toContain('${');
        }
    });

    it('every category part carries a background', () => {
        // The reported symptom was specifically a MISSING background under
        // white text, so this is the assertion that maps to the bug.
        for (const color of CATEGORY_COLORS) {
            for (const part of ['tab', 'action', 'row']) {
                expect(categoryClass(color, part), `${color}.${part}`).toMatch(/\bbg-/);
            }
        }
    });

    it('covers every colour the call sites can actually produce', () => {
        // TreatmentPanel's `categories` array, plus getCategoryColor's fallback.
        for (const color of ['pink', 'blue', 'cyan', 'green', DEFAULT_CATEGORY_COLOR]) {
            expect(CATEGORY_COLORS).toContain(color);
        }
        // CaseTreatmentConfig: expected / contraindicated / neither.
        for (const color of ['green', 'red', 'yellow']) {
            expect(STATUS_COLORS).toContain(color);
        }
    });

    it('an unknown colour renders plain, never invisible', () => {
        // Falling back to '' would reproduce the original bug for any category
        // the palette has not met.
        expect(categoryClass('chartreuse', 'row')).toBe(categoryClass(DEFAULT_CATEGORY_COLOR, 'row'));
        expect(categoryClass(undefined, 'tab')).toMatch(/\bbg-/);
        expect(statusChipClass('mauve')).toMatch(/\bbg-/);
    });

    it('an unknown part returns empty rather than a broken class', () => {
        expect(categoryClass('pink', 'nonsense')).toBe('');
    });
});

describe('no component builds a Tailwind class by interpolation', () => {
    function sourceFiles(dir) {
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Vendored packages own their own lint posture.
                if (['pathology', 'pacs', 'lessons', 'OyonR'].includes(entry.name)) continue;
                out.push(...sourceFiles(full));
            } else if (/\.jsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
                out.push(full);
            }
        }
        return out;
    }

    // Regression lock. Tailwind cannot warn about this and neither can ESLint —
    // only a scan of the source can. RoomNavigator.jsx and AuscultationPanel.jsx
    // both carry comments warning about the trap; TreatmentPanel predated them
    // and violated it in three places.
    it('no template literal anywhere interpolates into a colour utility', () => {
        // Deliberately NOT anchored to `className=`. The original bug lived on
        // a bare ternary branch, with the className= two lines above:
        //
        //     className={`... ${
        //         isSelected
        //             ? `bg-${color}-900/30 border-${color}-600`   // ← here
        //
        // A scanner anchored to className= reports zero offenders on that file,
        // which is how this lock was first written and why it is worth saying:
        // an assertion that cannot fail on the original defect is decoration.
        const UTILITY = /`[^`]*\b(bg|text|border|ring|from|via|to)-\$\{/;
        const offenders = [];
        for (const file of sourceFiles(SRC)) {
            for (const [i, raw] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
                // Comments documenting the trap are not the trap.
                const line = raw.trim();
                if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
                if (UTILITY.test(raw)) offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
            }
        }
        expect(offenders, 'use a literal class map; Tailwind JIT cannot see interpolated names').toEqual([]);
    });
});
