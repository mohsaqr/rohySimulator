/**
 * Identity for the reader's own records.
 *
 * Notes and measurements both need ids that survive a deletion: deriving the
 * next id from the collection's length would hand a new record the identity of
 * one the reader deliberately removed. Deriving it from the highest id in use
 * cannot do that.
 *
 * The two collections validate completely differently — a note needs text, a
 * measurement needs two finite numbers and a known label — so they keep their
 * own normalizers. Only identity is shared, because only identity is the same
 * problem.
 */

/**
 * Next collision-free id for a prefixed collection.
 *
 * @param {Array<{id?: string}>} records existing records
 * @param {string} prefix id prefix, e.g. 'ecg-note'
 * @returns {string} an id not present in the collection
 */
export function next_prefixed_id(records, prefix) {
  if (!Array.isArray(records)) throw new TypeError('next_prefixed_id(records, prefix): records must be an array');
  if (typeof prefix !== 'string' || prefix === '') {
    throw new TypeError('next_prefixed_id(records, prefix): prefix must be a non-empty string');
  }
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const highest = records.reduce((carry, record) => {
    const match = pattern.exec(String(record?.id ?? ''));
    return match ? Math.max(carry, Number(match[1])) : carry;
  }, 0);
  return `${prefix}-${highest + 1}`;
}
