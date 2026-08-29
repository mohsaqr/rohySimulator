/**
 * De-identification.
 *
 * The method is deliberate: PHI element VALUES are overwritten IN PLACE with
 * padding of exactly the same length. Nothing is re-encoded, no element moves,
 * no length changes, and the transfer syntax is untouched — so a study that
 * parsed before de-identification parses identically afterwards, and the pixel
 * data is bit-for-bit what the scanner produced. Rewriting the file instead
 * means re-serialising every element, and any bug in that path silently alters
 * the imaging a learner is assessed on.
 *
 * Scope, stated plainly because the difference matters legally:
 *
 *   THIS DOES     remove the identifiers in the list below from the DICOM
 *                 header, including private-tag values.
 *   THIS DOES NOT remove PHI BURNED INTO THE PIXELS. Ultrasound, secondary
 *                 capture and scanned film routinely carry the patient's name
 *                 in the image itself, and no header operation touches it.
 *                 `burnedInAnnotationRisk()` flags the modalities where that is
 *                 likely; a human must look.
 *   THIS DOES NOT make a study anonymous under any particular regulation. It is
 *                 a tool, not a compliance claim. Re-identification from
 *                 dates, rare diagnoses, and the pixels themselves remains
 *                 possible, and the source dataset's own terms still govern.
 */

import { parseDicom } from './dicomParse.js';
import { tagOf } from './dicomDict.js';

/**
 * Direct identifiers, cleared unconditionally.
 * Names use the dictionary; the parser locates them in either VR encoding.
 */
export const IDENTIFYING_TAGS = Object.freeze([
    'PatientName',
    'PatientID',
    'PatientBirthDate',
    'AccessionNumber',
    'InstitutionName',
    // The referring/performing physician group (0008,0090 / 0008,1050 /
    // 0008,1070) and other-patient-ids (0010,1000) are not in the viewer's
    // dictionary, so they are addressed by raw tag below.
]);

/** Raw tags with no dictionary entry, cleared by number. */
export const IDENTIFYING_RAW_TAGS = Object.freeze([
    '00080090', // ReferringPhysicianName
    '00081048', // PhysiciansOfRecord
    '00081050', // PerformingPhysicianName
    '00081060', // NameOfPhysiciansReadingStudy
    '00081070', // OperatorsName
    '00081080', // AdmittingDiagnosesDescription
    '00100032', // PatientBirthTime
    '00101000', // OtherPatientIDs
    '00101001', // OtherPatientNames
    '00101040', // PatientAddress
    '00102154', // PatientTelephoneNumbers
    '00102297', // ResponsiblePerson
    '00204000', // ImageComments — free text, routinely carries names
    '00081030', // StudyDescription is KEPT by default; see options.keepDescriptions
]);

/** Modalities where PHI is commonly rendered into the pixels themselves. */
const BURNED_IN_RISK = new Set(['US', 'XA', 'SC', 'OT', 'ES', 'NM']);

/**
 * Whether a study is likely to carry identifiers inside the image.
 * Returns a reason rather than a bare boolean so a report can say why.
 */
export function burnedInAnnotationRisk(dicom) {
    const modality = dicom.string('Modality', '');
    const declared = dicom.string('BurnedInAnnotation', '');
    if (declared.toUpperCase() === 'YES') {
        return { atRisk: true, reason: 'the study declares BurnedInAnnotation = YES' };
    }
    if (BURNED_IN_RISK.has(modality)) {
        return { atRisk: true, reason: `${modality} images commonly carry patient details rendered into the pixels` };
    }
    return { atRisk: false, reason: null };
}

/**
 * De-identify a DICOM file, returning NEW bytes.
 *
 * @param {Uint8Array} bytes
 * @param {{ patientId?: string, patientName?: string, keepDescriptions?: boolean,
 *          shiftDatesByDays?: number }} [options]
 * @returns {{ bytes: Uint8Array, cleared: string[], warnings: string[] }}
 */
export function deidentify(bytes, options = {}) {
    const out = Uint8Array.from(bytes);
    const dicom = parseDicom(out, { stopBeforePixelData: true });
    const cleared = [];
    const warnings = [];

    const tags = new Set([
        ...IDENTIFYING_TAGS.map((name) => tagOf(name)).filter(Boolean),
        ...IDENTIFYING_RAW_TAGS,
    ]);
    if (options.keepDescriptions !== false) tags.delete('00081030');

    // Private tags (odd group number) may hold anything a vendor chose to put
    // there, including operator notes and patient details. Cleared wholesale:
    // a viewer that reads none of them loses nothing, and reviewing every
    // vendor's private dictionary is not a thing anyone actually does.
    dicom.elements.forEach((element, tag) => {
        const group = Number.parseInt(tag.slice(0, 4), 16);
        const isPrivate = group % 2 === 1 && group > 0x0008;
        if (!tags.has(tag) && !isPrivate) return;
        if (element.encapsulated || element.vr === 'SQ') return;
        blank(out, element);
        cleared.push(tag);
    });

    // Replacements, written only where they fit. A pseudonym longer than the
    // field it replaces would change the element length and shift every
    // subsequent offset, so it is refused rather than truncated into something
    // that looks like a different real identifier.
    if (options.patientId !== undefined) {
        overwrite(out, dicom.elements.get(tagOf('PatientID')), options.patientId, 'PatientID', warnings);
    }
    if (options.patientName !== undefined) {
        overwrite(out, dicom.elements.get(tagOf('PatientName')), options.patientName, 'PatientName', warnings);
    }

    const risk = burnedInAnnotationRisk(dicom);
    if (risk.atRisk) warnings.push(`Possible burned-in identifiers: ${risk.reason}. A human must review the pixels.`);

    return { bytes: out, cleared, warnings };
}

/** Overwrite an element's value with padding, preserving its exact length. */
function blank(out, element) {
    out.fill(0x20, element.offset, element.offset + element.length);
}

function overwrite(out, element, value, label, warnings) {
    // Absent is not success. A pseudonym cannot be written into a field the
    // object does not have, and adding the element would mean re-encoding the
    // dataset — the one thing this module refuses to do. Say so, so an operator
    // expecting every instance to carry a pseudonym finds out here rather than
    // by browsing the archive later.
    if (!element) {
        warnings.push(`${label} is absent from this instance, so the replacement "${value}" was not applied.`);
        return;
    }
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > element.length) {
        warnings.push(`${label} replacement "${value}" is ${encoded.length} bytes but the field is ${element.length}; left blank instead of truncated.`);
        return;
    }
    out.fill(0x20, element.offset, element.offset + element.length);
    out.set(encoded, element.offset);
}
