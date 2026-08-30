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
    // `+ 0` normalises negative zero. A cross product routinely produces -0
    // (0 * -1), which is mathematically identical to 0 but not `Object.is`
    // identical — so it survives into deepStrictEqual comparisons, snapshot
    // fixtures and cache keys as a value that looks equal and compares unequal.
    return [n[0] / len + 0, n[1] / len + 0, n[2] / len + 0];
}

/** Where a slice sits along the stack, in millimetres, or null when unknowable. */
export function slicePosition(position, normal) {
    if (!position || position.length < 3 || !normal) return null;
    return position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2];
}

/**
 * The patient-direction letters for the image's row and column axes — the
 * L/R/A/P/H/F markers a workstation prints at the edges of the viewport.
 *
 * DICOM's patient coordinate system (PS3.3 C.7.6.2.1.1): +x toward the
 * patient's Left, +y toward Posterior, +z toward Head. The letter for an axis
 * is the dominant component of its direction cosine; ties are broken by axis
 * order, which cannot matter clinically because a genuinely diagonal
 * acquisition has no single honest letter anyway.
 *
 * Returns null when the orientation is absent or degenerate, so a caller shows
 * no marker rather than a wrong one.
 */
export function orientationLabels(orientation) {
    if (!Array.isArray(orientation) || orientation.length < 6 || !orientation.slice(0, 6).every(Number.isFinite)) {
        return null;
    }
    const letter = (v) => {
        const ax = Math.abs(v[0]);
        const ay = Math.abs(v[1]);
        const az = Math.abs(v[2]);
        if (ax === 0 && ay === 0 && az === 0) return null;
        if (ax >= ay && ax >= az) return v[0] >= 0 ? 'L' : 'R';
        if (ay >= ax && ay >= az) return v[1] >= 0 ? 'P' : 'A';
        return v[2] >= 0 ? 'H' : 'F';
    };
    const opposite = { L: 'R', R: 'L', A: 'P', P: 'A', H: 'F', F: 'H' };
    const right = letter(orientation.slice(0, 3));
    const down = letter(orientation.slice(3, 6));
    if (!right || !down) return null;
    return { right, left: opposite[right], down, up: opposite[down] };
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
        // Discriminators for images that share a slice position — see
        // splitCoincident() below.
        echoNumber: dicom.number('EchoNumbers', null),
        echoTime: dicom.number('EchoTime', null),
        acquisitionNumber: dicom.number('AcquisitionNumber', null),
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
        .flatMap(([seriesInstanceUid, members]) => buildStacks(seriesInstanceUid, members))
        .sort((a, b) => (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0) || a.stackId.localeCompare(b.stackId));
}

/**
 * One SeriesInstanceUID can hold several STACKS.
 *
 * A dual-echo MR puts two images at every slice position (proton-density at
 * TE 17 ms and T2 at TE 102 ms); a multi-phase liver CT puts three or four
 * (arterial, portal-venous, delayed). They legitimately share one series UID.
 * Presented as a single stack the contrast flips on every slice as the reader
 * scrolls, and the measured spacing collapses to zero because half the gaps
 * between sorted positions are zero.
 *
 * So: if any slice position holds more than one image, the series is split into
 * one stack per discriminator. `EchoNumbers` is the standard one, then
 * `AcquisitionNumber`; failing both, the nth image at each position, which at
 * least yields coherent stacks rather than an interleaved one.
 *
 * Found on real data — the Visible Human Male's T2 CORONAL CHEST — which no
 * synthetic fixture had exercised, because a phantom writes one image per
 * position by construction.
 */
function buildStacks(seriesInstanceUid, members) {
    const normal = sliceNormal(members[0]?.orientation);
    const positioned = members.map((m) => ({ ...m, along: slicePosition(m.position, normal) }));
    const spatial = positioned.every((m) => m.along !== null);

    const groups = spatial ? splitCoincident(positioned) : [{ key: null, label: null, members: positioned }];

    return groups.map(({ key, label, members: stackMembers }) => {
        const ordered = stackMembers.slice().sort((a, b) => {
            if (spatial && a.along !== b.along) return a.along - b.along;
            return (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0);
        });
        const description = members[0]?.seriesDescription;
        return {
            seriesInstanceUid,
            // Unique per STACK. The frame cache and the UI key on this: two
            // stacks sharing a series UID would otherwise collide in the cache
            // and serve each other's pixels.
            stackId: key === null ? seriesInstanceUid : `${seriesInstanceUid}#${key}`,
            modality: members[0]?.modality,
            seriesNumber: members[0]?.seriesNumber,
            description: label ? `${description ?? 'Series'} ${label}` : description,
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
    });
}

/**
 * Split images that share a slice position into separate stacks.
 *
 * Two conditions, both learned from real data rather than reasoned about:
 *
 * 1. **The duplication must be SYSTEMATIC.** A dual-echo MR has exactly two
 *    images at every position; a multi-phase CT has three or four at every
 *    position. By contrast the Visible Human CT was acquired in overlapping
 *    segments, so a handful of positions carry two images and the rest carry
 *    one — incidental overlap, not a second stack. Splitting that produces one
 *    full stack and one three-slice orphan. So a split needs the modal
 *    multiplicity to be greater than one AND to hold across most positions.
 *
 * 2. **The discriminator must actually RESOLVE the coincidence.** The same
 *    Visible Human CT numbers every slice with its own AcquisitionNumber, so
 *    grouping on it shattered a 499-slice series into 499 single-image stacks.
 *    A candidate is therefore accepted only if it yields exactly as many groups
 *    as there are images at a position, and no group still holds two images at
 *    the same position.
 *
 * Failing both candidates, images are assigned by their nth occurrence at each
 * position: arbitrary, but coherent stacks beat one interleaved stack whose
 * contrast flips on every slice.
 */
function splitCoincident(positioned) {
    const perPosition = new Map();
    positioned.forEach((m) => perPosition.set(m.along, (perPosition.get(m.along) ?? 0) + 1));

    // The modal multiplicity, and how much of the series it accounts for.
    const tally = new Map();
    perPosition.forEach((n) => tally.set(n, (tally.get(n) ?? 0) + 1));
    let modal = 1;
    let modalPositions = 0;
    tally.forEach((positions, multiplicity) => {
        if (positions > modalPositions || (positions === modalPositions && multiplicity > modal)) {
            modal = multiplicity;
            modalPositions = positions;
        }
    });
    const systematic = modal > 1 && modalPositions / perPosition.size >= 0.8;
    if (!systematic) return [{ key: null, label: null, members: positioned }];

    const single = [{ key: null, label: null, members: positioned }];

    /** Group by `valueOf`, and accept only if the split truly resolves it. */
    const tryCandidate = (valueOf, keyOf, labelOf) => {
        if (!positioned.every((m) => Number.isFinite(valueOf(m)))) return null;
        const groups = new Map();
        positioned.forEach((m) => {
            const v = valueOf(m);
            if (!groups.has(v)) groups.set(v, []);
            groups.get(v).push(m);
        });
        if (groups.size !== modal) return null;
        for (const members of groups.values()) {
            const seen = new Set();
            for (const m of members) {
                if (seen.has(m.along)) return null;
                seen.add(m.along);
            }
        }
        return Array.from(groups.entries())
            .map(([v, members]) => ({ key: keyOf(v), label: labelOf(members[0]), members }))
            .sort((a, b) => a.key.localeCompare(b.key));
    };

    const byEcho = tryCandidate(
        (m) => m.echoNumber,
        (v) => `e${v}`,
        // TE is what a reader recognises; the echo index is not.
        (m) => (Number.isFinite(m.echoTime) ? `(TE ${m.echoTime})` : `(echo ${m.echoNumber})`),
    );
    if (byEcho) return byEcho;

    const byAcquisition = tryCandidate(
        (m) => m.acquisitionNumber,
        (v) => `a${v}`,
        (m) => `(acq ${m.acquisitionNumber})`,
    );
    if (byAcquisition) return byAcquisition;

    // Last resort: the nth image at each position.
    const seenAtPosition = new Map();
    const groups = new Map();
    positioned.forEach((m) => {
        const nth = (seenAtPosition.get(m.along) ?? 0) + 1;
        seenAtPosition.set(m.along, nth);
        const key = `s${nth}`;
        if (!groups.has(key)) groups.set(key, { key, label: `(stack ${nth})`, members: [] });
        groups.get(key).members.push(m);
    });
    return groups.size > 1 ? Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key)) : single;
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
