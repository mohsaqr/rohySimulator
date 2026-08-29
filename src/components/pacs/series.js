/**
 * Instances -> series -> an ordered, measurable volume.
 *
 * The ordering rule is the part worth being careful about. It is tempting to
 * sort by InstanceNumber (0020,0013), and it is wrong often enough to matter:
 * InstanceNumber is an acquisition counter, not a spatial one. Reformats,
 * multi-echo MR, dual-energy CT and anything that has been through a PACS
 * export can carry numbering that does not follow the patient's z-axis. Sorting
 * on it gives a stack that scrolls out of anatomical order — which a learner
 * reads as pathology.
 *
 * The spatial rule is exact: project ImagePositionPatient onto the slice
 * normal, which is the cross product of the two direction cosines in
 * ImageOrientationPatient, and sort by that scalar. That is the actual position
 * of the slice along the stack, whatever the scanner numbered it.
 * InstanceNumber is kept only as a tie-break and as the fallback for images
 * that carry no position at all (CR, DX, US).
 */

/** The unit normal of the image plane: the cross product of the row and column cosines. */
export function sliceNormal(orientation) {
    if (!orientation || orientation.length < 6) return null;
    const [rx, ry, rz, cx, cy, cz] = orientation;
    const n = [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx];
    const len = Math.hypot(n[0], n[1], n[2]);
    // A degenerate orientation (parallel cosines) has no plane; say so rather
    // than dividing by zero and producing NaN positions for every slice.
    if (!(len > 0)) return null;
    return [n[0] / len, n[1] / len, n[2] / len];
}

/** Where a slice sits along the stack, in millimetres, or null when unknowable. */
export function slicePosition(position, normal) {
    if (!position || position.length < 3 || !normal) return null;
    return position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2];
}

/**
 * Which anatomical plane an orientation describes. Determined by the dominant
 * component of the normal, which is how a PACS labels a series and how a
 * hanging protocol decides where to put it.
 */
export function planeOf(orientation) {
    const n = sliceNormal(orientation);
    if (!n) return 'unknown';
    const [x, y, z] = n.map(Math.abs);
    if (z >= x && z >= y) return 'axial';
    if (y >= x && y >= z) return 'coronal';
    return 'sagittal';
}

/**
 * The attributes that describe one instance, read without its pixels.
 * `parseDicom(bytes, { stopBeforePixelData: true })` is the intended input, so
 * indexing an archive of thousands of instances never reads a pixel.
 */
export function describeInstance(dicom, { source } = {}) {
    return {
        sopInstanceUid: dicom.string('SOPInstanceUID'),
        studyInstanceUid: dicom.string('StudyInstanceUID'),
        seriesInstanceUid: dicom.string('SeriesInstanceUID'),
        modality: dicom.string('Modality'),
        seriesNumber: dicom.number('SeriesNumber'),
        seriesDescription: dicom.string('SeriesDescription'),
        studyDescription: dicom.string('StudyDescription'),
        instanceNumber: dicom.number('InstanceNumber'),
        position: dicom.numbers('ImagePositionPatient'),
        orientation: dicom.numbers('ImageOrientationPatient'),
        pixelSpacing: dicom.numbers('PixelSpacing'),
        sliceThickness: dicom.number('SliceThickness'),
        rows: dicom.number('Rows'),
        columns: dicom.number('Columns'),
        frames: Math.max(1, Math.trunc(dicom.number('NumberOfFrames', 1))),
        windowCenter: dicom.number('WindowCenter'),
        windowWidth: dicom.number('WindowWidth'),
        source,
    };
}

/**
 * Group instance descriptions into ordered series.
 *
 * Total by construction: instances missing a series UID are collected under a
 * synthetic one rather than dropped, because a study that half-loads is more
 * useful to a learner — and far more diagnosable to an author — than a study
 * that silently loses slices.
 *
 * @returns {Array<{ seriesInstanceUid, modality, description, plane, instances,
 *   count, spacing, spacingIsUniform, geometry }>} sorted by series number.
 */
export function buildSeries(instances) {
    const groups = new Map();
    instances.forEach((instance) => {
        const key = instance.seriesInstanceUid ?? `unassigned:${instance.modality ?? 'unknown'}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(instance);
    });

    return Array.from(groups.entries())
        .map(([seriesInstanceUid, members]) => {
            const normal = sliceNormal(members[0]?.orientation);
            const positioned = members.map((m) => ({ ...m, along: slicePosition(m.position, normal) }));
            const spatial = positioned.every((m) => m.along !== null);

            const ordered = positioned.slice().sort((a, b) => {
                if (spatial && a.along !== b.along) return a.along - b.along;
                return (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0);
            });

            return {
                seriesInstanceUid,
                modality: members[0]?.modality,
                seriesNumber: members[0]?.seriesNumber,
                description: members[0]?.seriesDescription,
                plane: planeOf(members[0]?.orientation),
                orderedBy: spatial ? 'position' : 'instance_number',
                instances: ordered,
                count: ordered.length,
                ...spacingOf(ordered, spatial),
                geometry: {
                    rows: members[0]?.rows,
                    columns: members[0]?.columns,
                    pixelSpacing: members[0]?.pixelSpacing,
                    sliceThickness: members[0]?.sliceThickness,
                },
            };
        })
        .sort((a, b) => (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0));
}

/**
 * Slice spacing measured from the positions themselves, not from
 * SliceThickness — thickness is what was acquired, spacing is what was
 * reconstructed, and they differ whenever slices overlap or a gap was
 * prescribed. Only measured spacing gives a correct distance in a reformat or a
 * craniocaudal measurement.
 *
 * `spacingIsUniform` is reported rather than assumed: a series with a gap is
 * still perfectly viewable, but any measurement along z across that gap is not
 * trustworthy, and the viewer should be able to say so.
 */
function spacingOf(ordered, spatial) {
    if (!spatial || ordered.length < 2) {
        return { spacing: null, spacingIsUniform: null, spacingRange: null };
    }
    const gaps = ordered.slice(1).map((m, i) => m.along - ordered[i].along);
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);
    const median = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
    // 1 micron of float noise is not a gap; 0.01 mm is a tolerance no scanner
    // meaningfully violates while still catching a genuine missing slice.
    return {
        spacing: median,
        spacingIsUniform: max - min < 0.01,
        spacingRange: [min, max],
    };
}

/**
 * Distance in millimetres between two points in the image plane, using
 * PixelSpacing (which is [rowSpacing, columnSpacing] — row first, the opposite
 * of the (x, y) order almost everyone assumes).
 *
 * @returns {{ mm: number|null, unit: 'mm'|'px' }} `px` when the series declares
 *   no pixel spacing, so a caller can label the measurement honestly instead of
 *   presenting pixels as millimetres.
 */
export function measureDistance(a, b, pixelSpacing) {
    const dCol = b.x - a.x;
    const dRow = b.y - a.y;
    if (!pixelSpacing || pixelSpacing.length < 2) {
        return { mm: null, px: Math.hypot(dCol, dRow), unit: 'px' };
    }
    const [rowSpacing, columnSpacing] = pixelSpacing;
    return {
        mm: Math.hypot(dCol * columnSpacing, dRow * rowSpacing),
        px: Math.hypot(dCol, dRow),
        unit: 'mm',
    };
}

/**
 * Mean, min, max and standard deviation of the real-world values inside a
 * circular region — the "what is the density of this lesion" measurement, which
 * on CT is a diagnostic act: a renal cyst is < 20 HU, a solid mass is not.
 *
 * Requires real-world values (post modality LUT), never stored values.
 */
export function measureRegion(values, { rows, columns }, { centerX, centerY, radius }) {
    const samples = [];
    const r2 = radius * radius;
    const yMin = Math.max(0, Math.floor(centerY - radius));
    const yMax = Math.min(rows - 1, Math.ceil(centerY + radius));
    const xMin = Math.max(0, Math.floor(centerX - radius));
    const xMax = Math.min(columns - 1, Math.ceil(centerX + radius));

    for (let y = yMin; y <= yMax; y++) {
        for (let x = xMin; x <= xMax; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            if (dx * dx + dy * dy <= r2) samples.push(values[y * columns + x]);
        }
    }
    if (samples.length === 0) return { count: 0, mean: null, min: null, max: null, sd: null };

    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    // Sample standard deviation (n-1): an ROI is a sample of a region, not the
    // whole population, and n-1 is what every PACS reports.
    const variance = samples.length > 1
        ? samples.reduce((s, v) => s + (v - mean) ** 2, 0) / (samples.length - 1)
        : 0;
    return {
        count: samples.length,
        mean,
        min: Math.min(...samples),
        max: Math.max(...samples),
        sd: Math.sqrt(variance),
    };
}
