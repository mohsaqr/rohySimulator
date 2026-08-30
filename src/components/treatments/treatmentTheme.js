// Literal Tailwind class strings for the treatment surfaces.
//
// WHY THIS FILE EXISTS. Tailwind's JIT compiler builds the stylesheet by
// scanning source files for complete class names it can see written out. A
// template literal like
//
//     `bg-${cat.color}-600`            // ← never emitted
//
// produces a class that appears nowhere in the source, so Tailwind never
// generates a rule for it and the element renders with NO background at all.
// There is no error and no warning: the markup is valid, the class attribute
// looks right in devtools, and the rule simply does not exist.
//
// That is what a pilot reported against v2.9.82 — in the Treatments room the
// selected medication became unreadable, because the row lost its background
// while the label kept `text-white`. It affected only the Medications tab
// because only that tab colours rows by category. The repo already warned about
// this trap twice (src/components/common/RoomNavigator.jsx and
// examination/AuscultationPanel.jsx); TreatmentPanel predated both notes.
//
// Every string below is complete and literal so the scanner can find it. Add a
// colour by adding a row here, never by interpolating at the call site.

/** Fallback used when a category has no colour, matching getCategoryColor(). */
export const DEFAULT_CATEGORY_COLOR = 'neutral';

// One entry per colour used by TreatmentPanel's `categories` array, plus the
// neutral fallback. `tab` is the selected category button, `action` the order
// button, `row` the selected treatment row.
const CATEGORY_THEME = {
    pink: {
        tab: 'bg-pink-600 text-white',
        action: 'bg-pink-600 hover:bg-pink-500',
        row: 'bg-pink-900/30 border-pink-600',
    },
    blue: {
        tab: 'bg-blue-600 text-white',
        action: 'bg-blue-600 hover:bg-blue-500',
        row: 'bg-blue-900/30 border-blue-600',
    },
    cyan: {
        tab: 'bg-cyan-600 text-white',
        action: 'bg-cyan-600 hover:bg-cyan-500',
        row: 'bg-cyan-900/30 border-cyan-600',
    },
    green: {
        tab: 'bg-green-600 text-white',
        action: 'bg-green-600 hover:bg-green-500',
        row: 'bg-green-900/30 border-green-600',
    },
    neutral: {
        tab: 'bg-neutral-600 text-white',
        action: 'bg-neutral-600 hover:bg-neutral-500',
        row: 'bg-neutral-900/30 border-neutral-600',
    },
};

/**
 * Class string for one part of a treatment category's styling.
 *
 * @param {string} color  A key of CATEGORY_THEME ('pink', 'blue', …).
 * @param {'tab'|'action'|'row'} part  Which surface is being styled.
 * @returns {string} A complete literal class string. An unknown colour falls
 *   back to neutral rather than returning '' — a category the palette has not
 *   met should look plain, not invisible, which is the failure this file exists
 *   to prevent.
 */
export function categoryClass(color, part) {
    const theme = CATEGORY_THEME[color] || CATEGORY_THEME[DEFAULT_CATEGORY_COLOR];
    return theme[part] || '';
}

// Configuration status in the case authoring editor. A different vocabulary
// from the category colours above — this one encodes expected /
// contraindicated / neither, not a treatment class.
const STATUS_CHIP = {
    green: 'bg-green-900/30 border border-green-600/50 text-green-300',
    red: 'bg-red-900/30 border border-red-600/50 text-red-300',
    yellow: 'bg-yellow-900/30 border border-yellow-600/50 text-yellow-300',
};

/**
 * Chip classes for a configured treatment's status.
 *
 * @param {'green'|'red'|'yellow'} color
 * @returns {string} A complete literal class string; unknown values fall back
 *   to the neutral-ish yellow chip rather than to nothing.
 */
export function statusChipClass(color) {
    return STATUS_CHIP[color] || STATUS_CHIP.yellow;
}

/** Exported for the test that pins every colour the call sites can produce. */
export const CATEGORY_COLORS = Object.freeze(Object.keys(CATEGORY_THEME));
export const STATUS_COLORS = Object.freeze(Object.keys(STATUS_CHIP));
