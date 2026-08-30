import { apiGet } from '../../services/apiClient';

/**
 * rohy's radiology catalogue, in the shape Radoyon's editor reads.
 *
 * THIS IS THE JOIN THE WHOLE AUTHORING MODEL RESTS ON. Since 0.3.1 a case is
 * "the catalogue, minus what changed" — `caseCatalogue()` walks the host's list
 * of orderable studies and asks the document what it says about each one. Hand
 * it nothing and the editor is correct and useless: zero rows, every filter
 * chip reading 0, and "No study in the catalogue matches" where 74 studies
 * should be. That was the reported bug, and it was a missing prop, not a
 * missing feature.
 *
 * The catalogue that matters is the one a learner can actually ORDER, which in
 * rohy is `server/data/radiology_database.json` served by
 * `GET /api/radiology-database`. Anything else — a list shipped inside the
 * package, a list the author types — would let a case be authored against a
 * study nobody can order, or leave an orderable study with no way to say
 * anything about it.
 *
 * The mapping is deliberately thin. `caseCatalogue()` already accepts either
 * spelling of the region field (`bodyRegion ?? body_region`), so this normalises
 * rather than translates, and it drops the fields the editor has no use for
 * (indications, the normal report prose) instead of passing the whole row —
 * a study row is ~1 KB of text and 74 of them would ride into every render.
 */

/**
 * @returns {Promise<Array<{id, name, modality, bodyRegion, turnaroundMinutes}>>}
 *   one row per orderable study, in catalogue order.
 */
export async function fetchStudyCatalogue() {
    const body = await apiGet('/radiology-database');
    const studies = Array.isArray(body?.studies) ? body.studies : [];
    return studies
        .filter((study) => study && typeof study === 'object' && study.id)
        .map((study) => ({
            id: String(study.id),
            name: study.name ?? String(study.id),
            modality: study.modality ?? null,
            bodyRegion: study.body_region ?? study.bodyRegion ?? null,
            turnaroundMinutes: Number.isFinite(Number(study.turnaround_minutes))
                ? Number(study.turnaround_minutes)
                : null,
        }));
}

export default fetchStudyCatalogue;
