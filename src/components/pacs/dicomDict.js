/**
 * A minimal DICOM data dictionary.
 *
 * Only the tags a CT/MR/CR viewer actually reads are here. That is a deliberate
 * scope, not an unfinished one: a full dictionary is ~4,000 entries and about
 * 200 KB of JavaScript shipped to every learner's browser to name attributes
 * nothing in this package ever looks at.
 *
 * The dictionary has one load-bearing job beyond naming. In **Implicit VR**
 * little endian (transfer syntax 1.2.840.10008.1.2) the value representation is
 * NOT in the stream — the tag alone determines how the bytes are read. Without
 * a dictionary an implicit-VR file is undecodable, which is why a parser that
 * "only supports explicit VR" fails on a large share of real archives.
 *
 * Tags are keyed as the 8 lowercase hex digits of group+element, e.g. '00280010'.
 */

/** @type {Record<string, { vr: string, name: string }>} */
export const DICTIONARY = {
    // File meta (group 0002) — always explicit VR LE regardless of the dataset.
    '00020000': { vr: 'UL', name: 'FileMetaInformationGroupLength' },
    '00020002': { vr: 'UI', name: 'MediaStorageSOPClassUID' },
    '00020003': { vr: 'UI', name: 'MediaStorageSOPInstanceUID' },
    '00020010': { vr: 'UI', name: 'TransferSyntaxUID' },
    '00020012': { vr: 'UI', name: 'ImplementationClassUID' },
    '00020013': { vr: 'SH', name: 'ImplementationVersionName' },

    // Identification
    '00080005': { vr: 'CS', name: 'SpecificCharacterSet' },
    '00080008': { vr: 'CS', name: 'ImageType' },
    '00080016': { vr: 'UI', name: 'SOPClassUID' },
    '00080018': { vr: 'UI', name: 'SOPInstanceUID' },
    '00080020': { vr: 'DA', name: 'StudyDate' },
    '00080021': { vr: 'DA', name: 'SeriesDate' },
    '00080030': { vr: 'TM', name: 'StudyTime' },
    '00080031': { vr: 'TM', name: 'SeriesTime' },
    '00080050': { vr: 'SH', name: 'AccessionNumber' },
    '00080060': { vr: 'CS', name: 'Modality' },
    '00080070': { vr: 'LO', name: 'Manufacturer' },
    '00080080': { vr: 'LO', name: 'InstitutionName' },
    '00081030': { vr: 'LO', name: 'StudyDescription' },
    '0008103e': { vr: 'LO', name: 'SeriesDescription' },
    '00081090': { vr: 'LO', name: 'ManufacturerModelName' },

    // Patient
    '00100010': { vr: 'PN', name: 'PatientName' },
    '00100020': { vr: 'LO', name: 'PatientID' },
    '00100030': { vr: 'DA', name: 'PatientBirthDate' },
    '00100040': { vr: 'CS', name: 'PatientSex' },
    '00101010': { vr: 'AS', name: 'PatientAge' },

    // Acquisition
    '00180015': { vr: 'CS', name: 'BodyPartExamined' },
    // Cine timing. A loop played at the wrong rate is not a cosmetic problem:
    // an echo acquired at 50 fps and replayed at 12 shows a ventricle that
    // looks like it is failing. FrameTime is the authoritative one (ms between
    // frames); CineRate is the acquisition rate the device reported.
    '00180040': { vr: 'IS', name: 'CineRate' },
    '00180050': { vr: 'DS', name: 'SliceThickness' },
    '00180060': { vr: 'DS', name: 'KVP' },
    '00180081': { vr: 'DS', name: 'EchoTime' },
    '00180086': { vr: 'IS', name: 'EchoNumbers' },
    '00180088': { vr: 'DS', name: 'SpacingBetweenSlices' },
    '00181030': { vr: 'LO', name: 'ProtocolName' },
    '00181063': { vr: 'DS', name: 'FrameTime' },
    '00185100': { vr: 'CS', name: 'PatientPosition' },

    // Relationship — the tags that turn a pile of files into an ordered volume.
    '0020000d': { vr: 'UI', name: 'StudyInstanceUID' },
    '0020000e': { vr: 'UI', name: 'SeriesInstanceUID' },
    '00200010': { vr: 'SH', name: 'StudyID' },
    '00200011': { vr: 'IS', name: 'SeriesNumber' },
    '00200012': { vr: 'IS', name: 'AcquisitionNumber' },
    '00200013': { vr: 'IS', name: 'InstanceNumber' },
    '00200032': { vr: 'DS', name: 'ImagePositionPatient' },
    '00200037': { vr: 'DS', name: 'ImageOrientationPatient' },
    '00201041': { vr: 'DS', name: 'SliceLocation' },
    '00200052': { vr: 'UI', name: 'FrameOfReferenceUID' },

    // Image pixel — everything needed to turn bytes into numbers.
    '00280002': { vr: 'US', name: 'SamplesPerPixel' },
    '00280004': { vr: 'CS', name: 'PhotometricInterpretation' },
    '00280006': { vr: 'US', name: 'PlanarConfiguration' },
    '00280008': { vr: 'IS', name: 'NumberOfFrames' },
    '00280010': { vr: 'US', name: 'Rows' },
    '00280011': { vr: 'US', name: 'Columns' },
    '00280030': { vr: 'DS', name: 'PixelSpacing' },
    '00280100': { vr: 'US', name: 'BitsAllocated' },
    '00280101': { vr: 'US', name: 'BitsStored' },
    '00280102': { vr: 'US', name: 'HighBit' },
    '00280103': { vr: 'US', name: 'PixelRepresentation' },
    '00281050': { vr: 'DS', name: 'WindowCenter' },
    '00281051': { vr: 'DS', name: 'WindowWidth' },
    '00281052': { vr: 'DS', name: 'RescaleIntercept' },
    '00281053': { vr: 'DS', name: 'RescaleSlope' },
    '00281054': { vr: 'LO', name: 'RescaleType' },
    '00282110': { vr: 'CS', name: 'LossyImageCompression' },

    '7fe00010': { vr: 'OW', name: 'PixelData' },

    // Sequence delimitation. Present so the parser names them in diagnostics;
    // they are handled structurally, not via the dictionary.
    'fffee000': { vr: 'NONE', name: 'Item' },
    'fffee00d': { vr: 'NONE', name: 'ItemDelimitationItem' },
    'fffee0dd': { vr: 'NONE', name: 'SequenceDelimitationItem' },
};

/** Reverse index so callers can say `tagOf('PixelData')` instead of memorising hex. */
export const TAG_BY_NAME = Object.freeze(
    Object.fromEntries(Object.entries(DICTIONARY).map(([tag, { name }]) => [name, tag])),
);

/** `tagOf('Rows') === '00280010'`. Returns undefined for an unknown name. */
export function tagOf(name) {
    return TAG_BY_NAME[name];
}

/**
 * The VR to assume for `tag` when the stream does not carry one (implicit VR).
 *
 * Unknown tags fall back to 'UN' rather than throwing: a private attribute from
 * some vendor must not stop a study from opening. 'UN' carries a 4-byte length
 * in implicit VR just as the dictionary VRs do, so an unknown element is
 * skipped cleanly rather than desynchronising the stream.
 *
 * Group length elements (gggg,0000) are always UL and are not enumerated.
 */
export function impliedVr(tag) {
    if (/^[0-9a-f]{4}0000$/.test(tag)) return 'UL';
    return DICTIONARY[tag]?.vr ?? 'UN';
}

/** The dictionary name for `tag`, or the bracketed tag itself when unknown. */
export function nameOf(tag) {
    return DICTIONARY[tag]?.name ?? `(${tag.slice(0, 4)},${tag.slice(4)})`;
}

/**
 * VRs whose explicit-VR encoding uses the LONG form: two reserved bytes then a
 * 4-byte length, instead of a bare 2-byte length. Getting this set wrong
 * desynchronises the parse at the first such element, which is why it is stated
 * once here rather than inline at the read site.
 */
export const LONG_FORM_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);

/** VRs whose value is text and is therefore decoded, trimmed and `\`-split. */
export const STRING_VRS = new Set(['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT', 'PN', 'SH', 'ST', 'TM', 'UC', 'UI', 'UR', 'UT']);
