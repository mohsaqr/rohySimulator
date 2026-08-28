/**
 * One name for a specimen part, used by every surface.
 *
 * The editor called a nameless part "Untitled part" and the learner room called
 * the same one "Part " — each had invented its own fallback, so the two screens
 * disagreed about what the author was looking at. This is the single rule both
 * import. It has no dependencies so the viewer adapter and the studio model can
 * both use it without a cycle.
 */

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/** An author's own label wins, then the accession letter, then the truth. */
export function specimenDisplayName(specimen) {
    const label = trimmed(specimen?.label);
    if (label !== '') return label;
    const part = trimmed(specimen?.part);
    return part === '' ? 'Unnamed part' : `Part ${part}`;
}

/**
 * The next free accession letter: A, then B, then C.
 *
 * Past Z it keeps going deterministically rather than colliding, and a letter
 * freed by a deletion is reused rather than skipped.
 */
export function nextSpecimenPart(specimens) {
    const used = new Set((specimens ?? []).map((entry) => trimmed(entry?.part)).filter((part) => part !== ''));
    const letter = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))
        .find((candidate) => !used.has(candidate));
    if (letter) return letter;
    return Array.from({ length: used.size + 1 }, (_, index) => `A${index + 1}`)
        .find((candidate) => !used.has(candidate));
}
