/**
 * The VOI LUT — window/level — applied to real-world values.
 *
 * The transfer function is the one in DICOM PS3.3 C.11.2.1.2, written out
 * rather than approximated. The usual shortcut, `(x - (c - w/2)) / w`, is off
 * by half a level and by one unit of width; on a 40/400 mediastinal window that
 * is invisible, but on a narrow stroke window (W 8) it shifts the entire grey
 * ramp by more than 6% of its range. Windows that narrow are exactly the ones
 * radiologists use to find early infarcts, so the standard formula is not
 * pedantry here.
 *
 *   LINEAR         y = ((x - (c - 0.5)) / (w - 1) + 0.5) * (ymax - ymin) + ymin
 *   LINEAR_EXACT   y = ((x - c) / w + 0.5) * (ymax - ymin) + ymin
 */

/**
 * Window presets, in real-world units. CT presets are in Hounsfield units and
 * are therefore absolute — "lung" means the same thing on every CT ever made,
 * which is the whole reason HU exist. MR has no absolute scale, so its entry is
 * deliberately empty and the viewer falls back to per-series auto-windowing.
 *
 * Values follow common radiological practice; `note` says what each is for so
 * the UI can teach rather than just list.
 */
export const WINDOW_PRESETS = Object.freeze({
    CT: [
        { id: 'lung', label: 'Lung', center: -600, width: 1500, note: 'Parenchyma, nodules, emphysema' },
        { id: 'mediastinum', label: 'Mediastinum', center: 40, width: 400, note: 'Soft tissue, nodes, vessels' },
        { id: 'abdomen', label: 'Abdomen', center: 50, width: 350, note: 'Solid organs, bowel' },
        { id: 'liver', label: 'Liver', center: 30, width: 150, note: 'Narrow — subtle focal lesions' },
        { id: 'bone', label: 'Bone', center: 400, width: 1800, note: 'Cortex, trabeculae, fractures' },
        { id: 'brain', label: 'Brain', center: 40, width: 80, note: 'Grey/white differentiation' },
        { id: 'stroke', label: 'Stroke', center: 32, width: 8, note: 'Very narrow — early ischaemia' },
        { id: 'subdural', label: 'Subdural', center: 75, width: 215, note: 'Extra-axial collections' },
        { id: 'angio', label: 'Angio', center: 300, width: 600, note: 'Contrast-filled vessels' },
    ],
    // CR, DX, MR, US and the rest have NO absolute scale, so no fixed table can
    // be right for them — see RELATIVE_PRESETS below.
});

/**
 * Presets for modalities whose pixel values carry no absolute meaning.
 *
 * This distinction is the whole reason the two kinds exist. A Hounsfield unit
 * is physics: -600 is lung on every CT ever built, so a CT preset can be a
 * pair of numbers. A radiograph's values are detector counts, scaled by the
 * vendor's own processing — a 15-bit Philips CR runs 0..32767 where a 12-bit
 * plate runs 0..4095, and the same anatomy sits at completely different
 * numbers. This table used to hold a fixed `center: 2048, width: 4096` for CR,
 * which on a 15-bit image maps the darkest eighth of the range onto the whole
 * grey ramp and washes the film out — and there was no way back to the window
 * the study opened with.
 *
 * So these are expressed against the image's OWN window: a multiplier on its
 * width, and a shift measured in widths. `scale < 1` is more contrast,
 * `shift > 0` moves the ramp toward the dense (bright) end, which is what
 * "penetrated" means on a plain film.
 */
const RELATIVE_PRESETS = Object.freeze([
    { id: 'acquired', label: 'As acquired', scale: 1, shift: 0, note: 'The window the study was stored with' },
    { id: 'soft', label: 'Soft tissue', scale: 1.6, shift: 0, note: 'Wider — flatter, shows the whole range' },
    { id: 'contrast', label: 'High contrast', scale: 0.6, shift: 0, note: 'Narrower — separates similar densities' },
    { id: 'bone', label: 'Bone', scale: 0.45, shift: 0.22, note: 'Narrow and bright — cortex and trabeculae' },
    { id: 'penetrated', label: 'Penetrated', scale: 0.8, shift: 0.42, note: 'Through the mediastinum and diaphragm' },
]);

/**
 * The presets that apply to a modality.
 *
 * @param {string} modality
 * @param {{center:number,width:number}} [base] the window the image opened
 *   with. Required for modalities with no absolute scale; without it they have
 *   nothing to be relative TO, and get no presets rather than wrong ones.
 */
export function presetsFor(modality, base) {
    const absolute = WINDOW_PRESETS[String(modality ?? '').toUpperCase()];
    if (absolute) return absolute;
    if (!(base?.width > 0) || !Number.isFinite(base?.center)) return [];
    return RELATIVE_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        note: p.note,
        center: Math.round(base.center + p.shift * base.width),
        width: Math.max(1, Math.round(base.width * p.scale)),
    }));
}

/** Look one preset up by id within a modality. */
export function presetById(modality, id, base) {
    return presetsFor(modality, base).find((p) => p.id === id);
}

/**
 * Which preset the current window corresponds to, or null when the reader has
 * dragged away from all of them. The control can then say "Custom" instead of
 * going on claiming whichever preset was picked three adjustments ago.
 */
export function activePreset(presets, window) {
    if (!window) return null;
    return presets.find((p) => Math.round(p.center) === Math.round(window.center)
        && Math.round(p.width) === Math.round(window.width)) ?? null;
}

/**
 * The window a study asks for: its own WindowCenter/WindowWidth when present,
 * otherwise an auto-window over the actual value range.
 *
 * Multi-valued WindowCenter is legal (a study may ship several suggested
 * windows); the first is the primary and is what is taken.
 */
export function defaultWindow(dicom, frame) {
    const centers = dicom.numbers('WindowCenter');
    const widths = dicom.numbers('WindowWidth');
    if (centers.length > 0 && widths.length > 0 && widths[0] > 0) {
        return { center: centers[0], width: widths[0], source: 'study' };
    }
    return { ...autoWindow(frame), source: 'auto' };
}

/**
 * A window covering the data, ignoring outliers.
 *
 * Plain min/max is a poor default: one metal artefact at +3000 HU or a single
 * dead detector pixel flattens the entire greyscale. Clipping to a percentile
 * band gives the window a human would have dialled in. The histogram is built
 * over the actual range in a fixed number of bins, so cost does not depend on
 * the data's magnitude.
 */
export function autoWindow({ values, min, max }, { lowPercentile = 0.5, highPercentile = 99.5, bins = 1024 } = {}) {
    if (!(max > min)) return { center: min ?? 0, width: 1 };

    const histogram = new Uint32Array(bins);
    const scale = (bins - 1) / (max - min);
    for (let i = 0; i < values.length; i++) {
        histogram[Math.round((values[i] - min) * scale)]++;
    }

    const total = values.length;
    const lowTarget = (lowPercentile / 100) * total;
    const highTarget = (highPercentile / 100) * total;
    let cumulative = 0;
    let lo = min;
    let hi = max;
    let haveLo = false;
    for (let b = 0; b < bins; b++) {
        cumulative += histogram[b];
        if (!haveLo && cumulative >= lowTarget) { lo = min + b / scale; haveLo = true; }
        if (cumulative >= highTarget) { hi = min + b / scale; break; }
    }

    const width = Math.max(1, hi - lo);
    return { center: lo + width / 2, width };
}

/**
 * Apply a window to real-world values, producing 8-bit greyscale.
 *
 * @param {Float32Array} values real-world values (HU for CT)
 * @param {{center:number, width:number, invert?:boolean, fn?:'LINEAR'|'LINEAR_EXACT'}} window
 * @returns {Uint8ClampedArray} one byte per pixel
 */
export function applyWindow(values, { center, width, invert = false, fn = 'LINEAR', gamma = 1 }) {
    const out = new Uint8ClampedArray(values.length);

    // SIGMOID is the other VOI LUT function the standard defines
    // (PS3.3 C.11.2.1.3.1). It has no hard clip: instead of two corners where
    // the ramp meets black and white, contrast rolls off smoothly, which is why
    // it suits projection radiography — a chest film windowed linearly clips
    // the lung apices to black and the abdomen to white at the same time.
    //
    //   y = (ymax - ymin) / (1 + exp(-4 (x - c) / w)) + ymin
    if (fn === 'SIGMOID') {
        const w = Math.max(width, 1e-6);
        for (let i = 0; i < values.length; i++) {
            const y = 255 / (1 + Math.exp((-4 * (values[i] - center)) / w));
            out[i] = invert ? 255 - applyGamma(y, gamma) : applyGamma(y, gamma);
        }
        return out;
    }

    // Width 0 is legal input from a UI drag and would divide by zero; the
    // standard's own guidance is that width < 1 is not meaningful for LINEAR.
    const w = fn === 'LINEAR_EXACT' ? Math.max(width, 1e-6) : Math.max(width, 1);
    const c = fn === 'LINEAR_EXACT' ? center : center - 0.5;
    const denominator = fn === 'LINEAR_EXACT' ? w : w - 1;
    const lo = fn === 'LINEAR_EXACT' ? center - w / 2 : c - denominator / 2;
    const hi = fn === 'LINEAR_EXACT' ? center + w / 2 : c + denominator / 2;

    for (let i = 0; i < values.length; i++) {
        const x = values[i];
        let y;
        if (x <= lo) y = 0;
        else if (x > hi) y = 255;
        else y = ((x - c) / denominator + 0.5) * 255;
        if (gamma !== 1) y = applyGamma(y, gamma);
        out[i] = invert ? 255 - y : y;
    }
    return out;
}

/**
 * Gamma on the DISPLAY value, after windowing — the knob a workstation calls
 * "gamma" and not part of the DICOM VOI pipeline. Above 1 lifts the midtones
 * (detail out of the dark half of a film), below 1 deepens them. It is applied
 * to the 0..255 output rather than to real-world values on purpose: it is a
 * presentation adjustment, and applying it before the window would silently
 * change what a stated Hounsfield window means.
 */
function applyGamma(y, gamma) {
    if (gamma === 1) return y;
    return 255 * ((y / 255) ** (1 / gamma));
}

/**
 * The same window as RGBA, ready for `ImageData`/`putImageData`.
 *
 * Writing straight into an RGBA buffer avoids a second pass over a
 * quarter-million pixels per rendered frame, which matters when a scroll wheel
 * is producing 60 of them a second.
 */
export function toImageData(values, window, { rows, columns }) {
    const grey = applyWindow(values, window);
    const rgba = new Uint8ClampedArray(grey.length * 4);
    for (let i = 0, j = 0; i < grey.length; i++, j += 4) {
        rgba[j] = grey[i];
        rgba[j + 1] = grey[i];
        rgba[j + 2] = grey[i];
        rgba[j + 3] = 255;
    }
    return { data: rgba, width: columns, height: rows };
}

/**
 * Mouse-drag windowing, as every PACS binds it: horizontal changes width,
 * vertical changes level. Width is clamped above zero so a fast drag cannot
 * invert or annihilate the window.
 */
export function dragWindow({ center, width }, dx, dy, sensitivity = 1) {
    return {
        center: center + dy * sensitivity,
        width: Math.max(1, width + dx * sensitivity),
    };
}
