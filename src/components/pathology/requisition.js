/**
 * The request a pathologist reads before the slides: accession, what was sent
 * and the clinician's history.
 *
 * Every field is authored as public context in the studio's "Clinical
 * metadata" card, so nothing here is protected. Returns null when the case
 * carries none of the three, so a room never draws an empty request.
 *
 * @param {object|null|undefined} viewerCase  {accession, specimen, history}
 * @returns {{accession: string, specimen: string, history: string}|null}
 */
export function caseRequest(viewerCase) {
    const text = (value) => (typeof value === 'string' ? value.trim() : '');
    const request = {
        accession: text(viewerCase?.accession),
        specimen: text(viewerCase?.specimen),
        history: text(viewerCase?.history),
    };
    return request.accession || request.specimen || request.history ? request : null;
}
