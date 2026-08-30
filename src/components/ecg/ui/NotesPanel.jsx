import { useState } from 'react';
import { PanelHeader } from './PanelHeader.jsx';
import { MAX_NOTE_LENGTH } from '../notes.js';

const format_stamp = (iso) => {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? null
    : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

function NoteCard({ note, on_edit, on_remove }) {
  const [draft, set_draft] = useState(null);
  const stamp = format_stamp(note.created_at);

  if (draft !== null) {
    return (
      <li className="ecg-note is-editing">
        <textarea
          value={draft}
          rows="3"
          maxLength={MAX_NOTE_LENGTH}
          aria-label={`Edit note ${note.id}`}
          onChange={(event) => set_draft(event.target.value)}
        />
        <div className="ecg-note-actions">
          <button type="button" className="ecg-chip-button" onClick={() => set_draft(null)}>Cancel</button>
          <button
            type="button"
            className="ecg-chip-button is-primary"
            disabled={draft.trim() === ''}
            onClick={() => { on_edit(note.id, draft); set_draft(null); }}
          >
            Save note
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="ecg-note">
      <div className="ecg-note-head">
        {note.lead && <span className="ecg-note-lead">{note.lead}</span>}
        {note.measurement && (
          <span className="ecg-note-measurement">
            {Math.round(note.measurement.duration_ms)} ms · {note.measurement.amplitude_mv.toFixed(2)} mV
          </span>
        )}
        {stamp && <time className="ecg-note-time">{stamp}</time>}
      </div>
      <p className="ecg-note-text">{note.text}</p>
      <div className="ecg-note-actions">
        <button type="button" className="ecg-chip-button" onClick={() => set_draft(note.text)}>Edit</button>
        <button type="button" className="ecg-chip-button is-quiet" onClick={() => on_remove(note.id)}>Delete</button>
      </div>
    </li>
  );
}

/**
 * The reader's own running record.
 *
 * Notes are anchored, not free-floating: a note written while looking at V1 can
 * carry V1, and a note prompted by a caliper reading can carry that reading.
 * That is what makes the trail re-readable later — "rSR′ 132 ms in V1" survives
 * the session, "looks wide" does not.
 *
 * Nothing here judges a note. This panel writes to the case record; the case
 * decides what it is worth.
 *
 * @param {object} props component props
 * @param {Array<object>} props.notes current notes
 * @param {(draft: object) => void} props.on_add append handler
 * @param {(id: string, text: string) => void} props.on_edit edit handler
 * @param {(id: string) => void} props.on_remove removal handler
 * @param {string|null} [props.current_lead] lead offered as the anchor
 * @param {object|null} [props.last_measurement] caliper reading offered for attachment
 * @returns {JSX.Element} the notes panel
 */
export function NotesPanel({
  notes = [],
  on_add,
  on_edit,
  on_remove,
  current_lead = null,
  last_measurement = null,
}) {
  if (typeof on_add !== 'function') throw new TypeError('NotesPanel: on_add must be a function');
  const [text, set_text] = useState('');
  const [anchor_lead, set_anchor_lead] = useState(true);
  const [attach_measurement, set_attach_measurement] = useState(true);

  const submit = () => {
    if (text.trim() === '') return;
    on_add({
      text,
      lead: anchor_lead && current_lead ? current_lead : null,
      measurement: attach_measurement && last_measurement ? last_measurement : null,
      created_at: new Date().toISOString(),
    });
    set_text('');
  };

  return (
    <section className="ecg-notes" aria-label="Reading notes">
      <PanelHeader title="Notes" count={notes.length} />

      <div className="ecg-note-composer">
        <textarea
          value={text}
          rows="3"
          maxLength={MAX_NOTE_LENGTH}
          placeholder="What do you see, and where?"
          aria-label="New note"
          onChange={(event) => set_text(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
          }}
        />
        <div className="ecg-note-anchors">
          {current_lead && (
            <label className="ecg-anchor-toggle">
              <input type="checkbox" checked={anchor_lead} onChange={() => set_anchor_lead((on) => !on)} />
              <span>Anchor to {current_lead}</span>
            </label>
          )}
          {last_measurement && (
            <label className="ecg-anchor-toggle">
              <input
                type="checkbox"
                checked={attach_measurement}
                onChange={() => set_attach_measurement((on) => !on)}
              />
              <span>
                Attach {Math.round(last_measurement.duration_ms)} ms · {last_measurement.amplitude_mv.toFixed(2)} mV
              </span>
            </label>
          )}
          <button
            type="button"
            className="ecg-button ecg-button-primary ecg-button-compact"
            disabled={text.trim() === ''}
            onClick={submit}
          >
            Add note
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="ecg-notes-empty">
          No notes yet. Measure something, or point at a lead, and write down what it shows.
        </p>
      ) : (
        <ul className="ecg-note-list">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} on_edit={on_edit} on_remove={on_remove} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default NotesPanel;
