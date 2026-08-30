/**
 * Reading notes.
 *
 * A note is what the reader wrote down while looking at the tracing, optionally
 * anchored to the lead they were looking at and to the caliper measurement that
 * prompted it. Notes are the reader's own record; nothing here scores them and
 * nothing here decides what they mean.
 *
 * Time is passed in, never read from the clock. The engine's determinism rule
 * applies to the whole package: a module that calls `Date.now()` cannot be
 * replayed, and a note trail that cannot be replayed is not evidence.
 */

import { next_prefixed_id } from './recordIds.js';

export const MAX_NOTE_LENGTH = 2000;

const NOTE_PREFIX = 'ecg-note';

const clean_text = (value) => String(value ?? '').replace(/\s+$/u, '');

/**
 * Next collision-free note id for a collection.
 *
 * @param {Array<object>} notes existing notes
 * @returns {string} unused note id
 */
export function next_note_id(notes) {
  return next_prefixed_id(notes, NOTE_PREFIX);
}

/**
 * Normalize stored note material into the canonical note shape.
 *
 * Unreadable entries are dropped rather than repaired: a note whose text did
 * not survive storage is not a note, and silently inventing one would put words
 * in the reader's mouth.
 *
 * @param {unknown} raw stored value of unknown provenance
 * @returns {Array<{id:string,text:string,lead:string|null,measurement:object|null,created_at:string|null}>}
 */
export function normalize_notes(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const text = clean_text(entry.text);
    if (text === '') return [];
    const id = String(entry.id ?? '');
    if (id === '' || seen.has(id)) return [];
    seen.add(id);
    const measurement = entry.measurement && typeof entry.measurement === 'object'
      ? {
        duration_ms: Number(entry.measurement.duration_ms),
        amplitude_mv: Number(entry.measurement.amplitude_mv),
        lead: entry.measurement.lead ? String(entry.measurement.lead) : null,
      }
      : null;
    return [{
      id,
      text: text.slice(0, MAX_NOTE_LENGTH),
      lead: entry.lead ? String(entry.lead) : null,
      measurement: measurement && Number.isFinite(measurement.duration_ms)
        && Number.isFinite(measurement.amplitude_mv) ? measurement : null,
      created_at: entry.created_at ? String(entry.created_at) : null,
    }];
  });
}

/**
 * Append a note.
 *
 * @param {Array<object>} notes existing notes
 * @param {{text:string,lead?:string|null,measurement?:object|null,created_at?:string|null}} draft note content
 * @returns {Array<object>} new collection; the input is not mutated
 */
export function add_note(notes, draft) {
  const existing = normalize_notes(notes);
  const text = clean_text(draft?.text);
  if (text === '') throw new RangeError('add_note(notes, draft): a note needs text');
  return [...existing, ...normalize_notes([{
    id: next_note_id(existing),
    text,
    lead: draft?.lead ?? null,
    measurement: draft?.measurement ?? null,
    created_at: draft?.created_at ?? null,
  }])];
}

/**
 * Replace the text of one note, keeping its anchor and its place in the trail.
 *
 * @param {Array<object>} notes existing notes
 * @param {string} note_id note to edit
 * @param {string} text replacement text
 * @returns {Array<object>} new collection; the input is not mutated
 */
export function update_note(notes, note_id, text) {
  const cleaned = clean_text(text);
  if (cleaned === '') throw new RangeError('update_note(): replacement text must not be empty');
  return normalize_notes(notes).map((note) => note.id === String(note_id)
    ? { ...note, text: cleaned.slice(0, MAX_NOTE_LENGTH) }
    : note);
}

/**
 * Remove one note.
 *
 * @param {Array<object>} notes existing notes
 * @param {string} note_id note to remove
 * @returns {Array<object>} new collection; the input is not mutated
 */
export function remove_note(notes, note_id) {
  return normalize_notes(notes).filter((note) => note.id !== String(note_id));
}

/**
 * Notes anchored to one lead.
 *
 * @param {Array<object>} notes existing notes
 * @param {string} lead lead name
 * @returns {Array<object>} matching notes in trail order
 */
export function notes_for_lead(notes, lead) {
  const wanted = String(lead ?? '');
  return normalize_notes(notes).filter((note) => note.lead === wanted);
}

/**
 * Count notes per lead, for the anchors shown on the lead selector.
 *
 * @param {Array<object>} notes existing notes
 * @returns {Record<string, number>} lead name to note count, omitting zero
 */
export function note_counts_by_lead(notes) {
  // Tally in place. Spreading the accumulator would allocate a fresh object per
  // note, which is quadratic in a collection that only grows through a session.
  return normalize_notes(notes).reduce((counts, note) => {
    if (note.lead) counts[note.lead] = (counts[note.lead] ?? 0) + 1;
    return counts;
  }, {});
}
