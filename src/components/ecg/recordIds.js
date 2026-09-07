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

/**
 * FNV-1a over a string, as an unsigned 32-bit integer.
 *
 * Used wherever an identifier must be derived from text that carries meaning
 * the identifier must not carry — a case accession from a case id, an imported
 * case's id from the filename it arrived under. Deterministic, so the same
 * input keeps the same identity across sessions and a re-import does not
 * produce a second copy of the same case.
 *
 * @param {string} text source text
 * @returns {number} unsigned 32-bit hash
 */
export function fnv1a(text) {
  if (typeof text !== 'string') throw new TypeError('fnv1a(text): text must be a string');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A case id derived from source text but carrying none of its meaning.
 *
 * An imported recording arrives named by whoever published it, and upstream
 * naming conventions state the finding: MedalCare-XL's `S62_LCX_1.0_raw.csv`
 * names the occluded artery and the transmural extent. A case id is searchable
 * prose in this package — `filter_ecg_cases` searches it — so importing under
 * the supplied name would put the answer in the library's own index. Hashing
 * keeps re-import idempotent without carrying the words across.
 *
 * @param {string} text source text, typically a file name
 * @param {string} [prefix] short lower-case prefix naming the corpus
 * @returns {string} an id matching the case id contract
 * @throws {TypeError} when the prefix is not 1–8 lower-case letters or digits
 */
export function anonymous_source_id(text, prefix = 'ecg') {
  if (!/^[a-z][a-z0-9]{0,7}$/.test(String(prefix))) {
    throw new TypeError('anonymous_source_id(): prefix must be 1-8 lower-case letters or digits');
  }
  return `${prefix}-${fnv1a(text).toString(36).padStart(6, '0').slice(-6)}`;
}
