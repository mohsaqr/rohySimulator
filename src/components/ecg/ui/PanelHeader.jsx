/**
 * The heading a record panel puts above its list.
 *
 * Shared because the notes and measurements panels are the same shape — a name
 * and a live count over a list that may be empty — and a third rail panel
 * should plug in here rather than copy the markup a third time. The systematic
 * read deliberately does not use this: it is a form, not a list, and its
 * heading carries method guidance instead of a count.
 *
 * @param {object} props component props
 * @param {string} props.title panel name
 * @param {number} props.count number of records held
 * @returns {JSX.Element} the header
 */
export function PanelHeader({ title, count }) {
  return (
    <header className="ecg-notes-head">
      <h3>{title}</h3>
      <span className="ecg-notes-count">{count}</span>
    </header>
  );
}

export default PanelHeader;
