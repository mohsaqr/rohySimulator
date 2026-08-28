/**
 * Interchange adapters for common digital-pathology metadata and annotations.
 *
 * The Pathoyon case manifest is the canonical teaching-case model. These
 * helpers deliberately translate only facts represented by the source format;
 * they never invent scanner calibration or clinical hierarchy.
 */

import {
    ANNOTATION_KINDS,
    annotationVertices,
    createAnnotation,
} from './annotationModel.js';

const finitePositive = (value) => typeof value === 'number'
    && Number.isFinite(value)
    && value > 0;

const xmlDecode = (value) => String(value)
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

const xmlEncode = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

function attributes(fragment) {
    const result = {};
    const pattern = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    Array.from(fragment.matchAll(pattern)).forEach((match) => {
        result[match[1]] = xmlDecode(match[2] ?? match[3] ?? '');
    });
    return result;
}

function firstTag(xml, localName) {
    const pattern = new RegExp(`<\\s*(?:[\\w.-]+:)?${localName}\\b([^>]*)>`, 'i');
    const match = pattern.exec(xml);
    return match ? attributes(match[1]) : null;
}

function numericAttribute(record, key) {
    if (!record || record[key] === undefined) return null;
    const value = Number(record[key]);
    return Number.isFinite(value) ? value : null;
}

/**
 * Read the slide-scale facts needed by the viewer from OME-XML.
 *
 * @param {string} xml complete OME-XML document
 * @returns {object} normalized image metadata
 */
export function parseOmeXmlMetadata(xml) {
    if (typeof xml !== 'string' || !/<(?:[\w.-]+:)?OME\b/i.test(xml)) {
        throw new TypeError('parseOmeXmlMetadata(): expected an OME-XML document');
    }
    const image = firstTag(xml, 'Image');
    const pixels = firstTag(xml, 'Pixels');
    if (!pixels) throw new TypeError('parseOmeXmlMetadata(): OME-XML has no Pixels element');

    const widthPx = numericAttribute(pixels, 'SizeX');
    const heightPx = numericAttribute(pixels, 'SizeY');
    if (!finitePositive(widthPx) || !finitePositive(heightPx)) {
        throw new TypeError('parseOmeXmlMetadata(): Pixels SizeX and SizeY must be positive numbers');
    }

    const objective = firstTag(xml, 'Objective');
    const physicalSizeX = numericAttribute(pixels, 'PhysicalSizeX');
    const physicalSizeY = numericAttribute(pixels, 'PhysicalSizeY');
    const unitX = pixels.PhysicalSizeXUnit ?? 'µm';
    const unitY = pixels.PhysicalSizeYUnit ?? unitX;

    return {
        standard: 'OME-XML',
        imageId: image?.ID ?? null,
        imageName: image?.Name ?? null,
        widthPx,
        heightPx,
        pixelType: pixels.Type ?? null,
        dimensionOrder: pixels.DimensionOrder ?? null,
        sizeC: numericAttribute(pixels, 'SizeC'),
        sizeZ: numericAttribute(pixels, 'SizeZ'),
        sizeT: numericAttribute(pixels, 'SizeT'),
        nativeMppX: physicalSizeToMicrons(physicalSizeX, unitX),
        nativeMppY: physicalSizeToMicrons(physicalSizeY, unitY),
        nativeObjective: numericAttribute(objective, 'NominalMagnification'),
    };
}

function physicalSizeToMicrons(value, unit) {
    if (value === null) return null;
    const normalized = String(unit).trim().toLowerCase().replace('μ', 'µ');
    const factor = {
        'µm': 1,
        um: 1,
        micrometer: 1,
        micrometre: 1,
        nm: 0.001,
        mm: 1000,
        cm: 10000,
        m: 1e6,
    }[normalized];
    if (factor === undefined) {
        throw new RangeError(`parseOmeXmlMetadata(): unsupported physical-size unit ${JSON.stringify(unit)}`);
    }
    return value * factor;
}

function dicomValue(dataset, tag) {
    const item = dataset?.[tag];
    const value = item?.Value;
    return Array.isArray(value) && value.length > 0 ? value[0] : null;
}

/**
 * Normalize DICOM JSON metadata for a VL Whole Slide Microscopy Image.
 * DICOM Pixel Spacing is in millimetres, while Pathoyon stores µm/px.
 *
 * @param {object} dataset DICOMweb JSON dataset
 * @returns {object} normalized image metadata
 */
export function parseDicomWsiMetadata(dataset) {
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
        throw new TypeError('parseDicomWsiMetadata(): expected a DICOM JSON object');
    }
    const widthPx = Number(dicomValue(dataset, '00480006'));
    const heightPx = Number(dicomValue(dataset, '00480007'));
    if (!finitePositive(widthPx) || !finitePositive(heightPx)) {
        throw new TypeError(
            'parseDicomWsiMetadata(): Total Pixel Matrix Columns (00480006) and Rows (00480007) are required',
        );
    }

    const pixelSpacing = dataset?.['00280030']?.Value;
    const rowSpacingMm = Array.isArray(pixelSpacing) ? Number(pixelSpacing[0]) : null;
    const columnSpacingMm = Array.isArray(pixelSpacing) ? Number(pixelSpacing[1]) : null;

    return {
        standard: 'DICOM-VL-WSI',
        studyInstanceUid: dicomValue(dataset, '0020000D'),
        seriesInstanceUid: dicomValue(dataset, '0020000E'),
        sopInstanceUid: dicomValue(dataset, '00080018'),
        modality: dicomValue(dataset, '00080060'),
        imageType: dataset?.['00080008']?.Value ?? [],
        widthPx,
        heightPx,
        nativeMppX: finitePositive(columnSpacingMm) ? columnSpacingMm * 1000 : null,
        nativeMppY: finitePositive(rowSpacingMm) ? rowSpacingMm * 1000 : null,
        containerIdentifier: dicomValue(dataset, '00400512'),
    };
}

/**
 * Convert an IIIF Image API info document into a catalog rendition.
 *
 * @param {object} info parsed info.json
 * @param {string} [infoUrl] URL used to fetch the document
 * @returns {object} normalized rendition
 */
export function iiifInfoToRendition(info, infoUrl = null) {
    if (!info || typeof info !== 'object' || !finitePositive(info.width) || !finitePositive(info.height)) {
        throw new TypeError('iiifInfoToRendition(): info.width and info.height must be positive numbers');
    }
    const serviceId = info.id ?? info['@id'] ?? (infoUrl ? infoUrl.replace(/\/info\.json(?:\?.*)?$/, '') : null);
    if (typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new TypeError('iiifInfoToRendition(): the IIIF service id is missing');
    }
    return {
        kind: 'iiif-image',
        uri: serviceId,
        infoUri: infoUrl ?? `${serviceId.replace(/\/$/, '')}/info.json`,
        widthPx: info.width,
        heightPx: info.height,
        profile: info.profile ?? null,
    };
}

const ASAP_TYPE = {
    [ANNOTATION_KINDS.POINT]: 'Dot',
    [ANNOTATION_KINDS.LINE]: 'Spline',
    [ANNOTATION_KINDS.ARROW]: 'Spline',
    [ANNOTATION_KINDS.RECTANGLE]: 'Rectangle',
    [ANNOTATION_KINDS.ELLIPSE]: 'Polygon',
    [ANNOTATION_KINDS.POLYGON]: 'Polygon',
    [ANNOTATION_KINDS.FREEHAND]: 'Polygon',
    [ANNOTATION_KINDS.POLYLINE]: 'Spline',
    [ANNOTATION_KINDS.COUNTING_FRAME]: 'Rectangle',
};

/**
 * Export level-0 annotations to ASAP XML.
 *
 * ASAP has no portable ellipse/arrow/counting-frame semantics. `PathoyonKind`
 * preserves those on a round trip while other readers can ignore the extra
 * attribute and consume the ordinary geometry.
 *
 * @param {Array<object>} annotations Pathoyon annotations
 * @returns {string} ASAP_Annotations XML
 */
export function annotationsToAsapXml(annotations) {
    if (!Array.isArray(annotations)) {
        throw new TypeError('annotationsToAsapXml(): expected an annotation array');
    }
    const body = annotations.map((annotation) => {
        const type = ASAP_TYPE[annotation?.kind];
        if (!type) throw new RangeError(`annotationsToAsapXml(): unsupported kind ${JSON.stringify(annotation?.kind)}`);
        const points = annotationVertices(annotation);
        const group = annotation.classification?.name ?? 'None';
        const color = annotation.classification?.color ?? '#F1F5F9';
        const coordinates = points.map((point, index) => (
            `        <Coordinate Order="${index}" X="${point.x}" Y="${point.y}"/>`
        )).join('\n');
        return `    <Annotation Name="${xmlEncode(annotation.text || annotation.id)}" `
            + `Type="${type}" PartOfGroup="${xmlEncode(group)}" Color="${xmlEncode(color)}" `
            + `PathoyonId="${xmlEncode(annotation.id)}" PathoyonKind="${xmlEncode(annotation.kind)}"`
            + `${annotation.slideId ? ` PathoyonSlideId="${xmlEncode(annotation.slideId)}"` : ''}>\n`
            + `      <Coordinates>\n${coordinates}\n      </Coordinates>\n`
            + '    </Annotation>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<ASAP_Annotations>\n  <Annotations>\n'
        + `${body}${body ? '\n' : ''}`
        + '  </Annotations>\n  <AnnotationGroups/>\n</ASAP_Annotations>\n';
}

/**
 * Import ASAP XML annotations in level-0 pixel coordinates.
 *
 * @param {string} xml ASAP_Annotations XML
 * @param {object} [options]
 * @param {string|null} [options.slideId]
 * @param {string} [options.idPrefix]
 * @returns {Array<object>} Pathoyon annotations
 */
export function annotationsFromAsapXml(xml, { slideId = null, idPrefix = 'asap' } = {}) {
    if (typeof xml !== 'string' || !/<ASAP_Annotations\b/i.test(xml)) {
        throw new TypeError('annotationsFromAsapXml(): expected ASAP_Annotations XML');
    }
    const annotationPattern = /<Annotation\b([^>]*)>([\s\S]*?)<\/Annotation>/gi;
    return Array.from(xml.matchAll(annotationPattern)).map((match, index) => {
        const meta = attributes(match[1]);
        const coordinatePattern = /<Coordinate\b([^>]*)\/?\s*>/gi;
        const coordinates = Array.from(match[2].matchAll(coordinatePattern))
            .map((coordinate) => attributes(coordinate[1]))
            .map((coordinate, coordinateIndex) => ({
                order: Number(coordinate.Order ?? coordinateIndex),
                x: Number(coordinate.X),
                y: Number(coordinate.Y),
            }))
            .sort((left, right) => left.order - right.order);
        if (coordinates.length === 0 || coordinates.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
            throw new TypeError(`annotationsFromAsapXml(): annotation ${index} has invalid coordinates`);
        }
        const kind = asapKind(meta.Type, meta.PathoyonKind, coordinates.length, index);
        const points = pointsForKind(kind, coordinates, index);
        const group = meta.PartOfGroup;
        return createAnnotation({
            id: meta.PathoyonId || `${idPrefix}-${index + 1}`,
            kind,
            points,
            slideId: meta.PathoyonSlideId || slideId,
            classification: group && group !== 'None'
                ? { name: group, color: meta.Color || '#F1F5F9' }
                : null,
            text: meta.Name ?? '',
            now: 0,
        });
    });
}

function asapKind(type, preservedKind, coordinateCount, index) {
    if (Object.values(ANNOTATION_KINDS).includes(preservedKind)) return preservedKind;
    switch (String(type).toLowerCase()) {
        case 'dot': return ANNOTATION_KINDS.POINT;
        case 'rectangle': return ANNOTATION_KINDS.RECTANGLE;
        case 'polygon': return ANNOTATION_KINDS.POLYGON;
        case 'spline': return coordinateCount === 2 ? ANNOTATION_KINDS.LINE : ANNOTATION_KINDS.POLYLINE;
        default:
            throw new RangeError(`annotationsFromAsapXml(): annotation ${index} has unsupported type ${JSON.stringify(type)}`);
    }
}

function pointsForKind(kind, coordinates, index) {
    const points = coordinates.map(({ x, y }) => ({ x, y }));
    if ([ANNOTATION_KINDS.RECTANGLE, ANNOTATION_KINDS.ELLIPSE, ANNOTATION_KINDS.COUNTING_FRAME].includes(kind)) {
        if (points.length < 2) {
            throw new TypeError(`annotationsFromAsapXml(): annotation ${index} needs at least two coordinates`);
        }
        const x = points.map((point) => point.x);
        const y = points.map((point) => point.y);
        return [{ x: Math.min(...x), y: Math.min(...y) }, { x: Math.max(...x), y: Math.max(...y) }];
    }
    return points;
}

/**
 * Classify a companion file by extension for import routing.
 *
 * @param {string} name filename or URL path
 * @returns {string|null} adapter identifier
 */
export function pathologyCompanionFormat(name) {
    if (typeof name !== 'string') return null;
    const path = name.split(/[?#]/)[0].toLowerCase();
    if (path.endsWith('.ome.xml')) return 'ome-xml';
    if (path.endsWith('.geojson') || path.endsWith('.json.geojson')) return 'qupath-geojson';
    if (path.endsWith('.asap.xml') || path.endsWith('.annotations.xml')) return 'asap-xml';
    if (path.endsWith('info.json')) return 'iiif-info';
    if (path.endsWith('.dcm.json') || path.endsWith('.dicom.json')) return 'dicom-json';
    return null;
}
