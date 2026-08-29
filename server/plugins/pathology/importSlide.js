/**
 * Import one whole-slide image from a link.
 *
 * The five states an educator sees map to the phases announced here:
 *
 *   QUEUED       the host has the job row                     (host)
 *   DOWNLOADING  ctx.download → library/<assetId>/source/…
 *   PROBING      vipsheader → optics, dimensions, levels
 *   TILING       vips dzsave → library/<assetId>/slide.dzi + slide_files/
 *   READY | NEEDS CALIBRATION
 *
 * IDEMPOTENT OVER ITS OWN DIRECTORY, because the host requires it: a job whose
 * process died is requeued FROM THE START, so a second run must be able to
 * finish rather than trip over its own leftovers. `assetId` is derived from the
 * source URL, so a retry reuses the same directory; each phase clears what it
 * is about to rewrite; and the source is re-used when its digest still matches
 * rather than downloaded again.
 *
 * ONE-STAGE TILING, MEASURED
 *
 * The archival recipe (`convert_10x.sh`) is two stages: read the pyramid level
 * into an intermediate BigTIFF, then dzsave that. Tiling straight from the
 * level is one stage and was measured against it on 2026-08-29 (vips 8.18.6,
 * 2.1 GB NDPI, 40x → 10x):
 *
 *   two-stage  5.06 s, 299 MB peak, 137 MB tiles + 124 MB intermediate
 *   one-stage  4.44 s, 373 MB peak, 137 MB tiles
 *
 * Identical DZI descriptors, identical 3065 tiles. One stage is faster, writes
 * half the bytes and has one fewer artefact to clean up after a crash; 373 MB
 * is ~12% of the 3 GB the target server is budgeted at. The intermediate
 * archive exists in the archival script because ARCHIVING is its purpose — it
 * is not a step tiling needs.
 *
 * This module imports nothing from a host. Everything it can do arrives as
 * `ctx` (RPS-1 §11b.2).
 */
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseVipsHeader, hasCalibration, chooseLevel, tilingIsAffordable } from './probe.js';
import { stableAssetId, safeFileName, extensionOf } from './identity.js';

/** A refusal the host can turn into a state and a message on the card. */
export class ImportRefused extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'ImportRefused';
        this.code = code;
    }
}

/**
 * libvips loaders that produce something worth tiling.
 *
 * `openslideload` is every vendor WSI. `tiffload` is the generic pyramidal TIFF
 * — OpenSlide's own "Generic-TIFF" case, and what most conversion tools emit.
 * A file that opens with neither is not a slide.
 */
const SLIDE_LOADERS = ['openslideload', 'tiffload'];

/** `vips dzsave` writes `<stem>.dzi` and `<stem>_files/`. */
const SLIDE_STEM = 'slide';

/**
 * Where every artefact for one asset lives. One function so the layout is
 * stated once and every phase agrees about it.
 *
 * @param {string} libraryDir
 * @param {string} assetId
 * @returns {{root: string, sourceDir: string, dziPath: string, tileDir: string, previewPath: string, stem: string}}
 */
export function assetPaths(libraryDir, assetId) {
    const root = join(libraryDir, assetId);
    return {
        root,
        sourceDir: join(root, 'source'),
        stem: join(root, SLIDE_STEM),
        dziPath: join(root, `${SLIDE_STEM}.dzi`),
        tileDir: join(root, `${SLIDE_STEM}_files`),
        previewPath: join(root, 'preview.jpg'),
    };
}

/**
 * The libvips input spec for a pyramid level.
 *
 * `path[level=N]` is libvips' load-option syntax. Level 0 is written WITHOUT
 * the suffix because some loaders reject a level option they consider a no-op,
 * and a bare path is what every loader accepts.
 *
 * @param {string} path
 * @param {number} level
 * @returns {string}
 */
export function vipsInputSpec(path, level) {
    return level === 0 ? path : `${path}[level=${level}]`;
}

/**
 * Run the import.
 *
 * @param {object} job    the host's job row; `payload` carries `{url, label}`
 * @param {object} api    `{ setPhase, setProgress, cancelled, log }`
 * @param {object} ctx    the RPS-1 server context
 * @returns {Promise<object>} the asset record the host stores
 */
export async function importSlide(job, api, ctx) {
    const { url, label } = job.payload ?? {};
    if (!url) throw new ImportRefused('no source URL', 'plugin_import_no_url');
    if (!ctx.libraryDir) {
        throw new ImportRefused('this deployment has no slide library directory', 'plugin_import_no_library');
    }

    const settings = await ctx.settings(job.tenant_id);
    if (settings['imports.enabled'] !== true) {
        // Re-checked here and not only at the route: a job can sit in the queue
        // across an admin turning imports off, and the setting means "do not
        // import", not "do not accept new requests".
        throw new ImportRefused('slide imports are disabled for this tenant', 'plugin_imports_disabled');
    }

    const assetId = stableAssetId('import', url);
    const paths = assetPaths(ctx.libraryDir, assetId);
    const fileName = safeFileName(new URL(url).pathname, 'slide');
    const accepted = settings['imports.acceptedFormats'] ?? [];
    const ext = extensionOf(fileName);
    if (ext && accepted.length > 0 && !accepted.includes(ext)) {
        throw new ImportRefused(
            `'${ext}' is not an accepted format here (${accepted.join(', ')})`,
            'plugin_import_format_rejected'
        );
    }

    // ---- DOWNLOADING -----------------------------------------------------
    await api.setPhase('downloading');
    await mkdir(paths.sourceDir, { recursive: true });
    const sourcePath = join(paths.sourceDir, fileName);
    const download = await ctx.download({
        tenantId: job.tenant_id,
        url,
        destPath: sourcePath,
        maxBytes: settings['imports.maxBytes'],
        timeoutMs: (settings['tiling.timeoutMinutes'] ?? 120) * 60_000,
        onProgress: (bytes, total) => {
            // Downloading is the long, visible half of an import, so it owns
            // the first 40% of the bar. Without a total there is no honest
            // percentage, and the phase name is the progress.
            if (total) void api.setProgress(Math.min(40, (bytes / total) * 40));
        },
    });
    await api.setProgress(40);

    // ---- PROBING ---------------------------------------------------------
    await api.setPhase('probing');
    const header = await ctx.runBinary('vipsheader', ['-a', sourcePath], { timeoutMs: 120_000 });
    const metadata = parseVipsHeader(header.stdout);
    // DELIBERATE DIVERGENCE from the Python reference, which required
    // `openslideload` outright. Measured 2026-08-29: a tiled pyramidal TIFF is
    // opened by `vips openslideload` successfully, yet `vipsheader` reports
    // `tiffload` because it names the BEST loader, not the only one that works.
    // Under the strict rule an author who exported a perfectly good pyramidal
    // TIFF is told it "is not a supported whole-slide image" — while
    // `imports.acceptedFormats` ships with `tif` and `tiff` in it. Two parts of
    // the same feature would be contradicting each other.
    //
    // So the gate is what TILING actually needs: a loader that reads slide-like
    // images. Anything else (a JPEG, a PDF, an HTML error page saved with a
    // .svs name) is refused here rather than discovered by dzsave.
    if (!SLIDE_LOADERS.includes(metadata.loader)) {
        throw new ImportRefused(
            `libvips opened this with ${metadata.loader ?? 'an unknown loader'} — it is not a whole-slide image`,
            'plugin_import_not_a_slide'
        );
    }
    const affordable = tilingIsAffordable(metadata);
    if (!affordable.ok) {
        throw new ImportRefused(affordable.reason, 'plugin_import_no_pyramid');
    }

    const targetSetting = settings['tiling.targetObjective'] ?? '10';
    const targetObjective = targetSetting === 'native' ? null : Number(targetSetting);
    // A target needs a native objective to be relative to. Without one the
    // honest action is to tile the native level and let the author calibrate,
    // rather than refuse a slide that is perfectly readable.
    const level = metadata.nativeObjective === null
        ? chooseLevel(metadata, null)
        : chooseLevel(metadata, targetObjective);
    await api.setProgress(45);

    // ---- TILING ----------------------------------------------------------
    await api.setPhase('tiling');
    // Idempotence: a requeued job must not dzsave into a half-written pyramid
    // from its own previous attempt. Removing is safe — everything here is
    // derived from `source/`, which is kept.
    await rm(paths.tileDir, { recursive: true, force: true });
    await rm(paths.dziPath, { force: true });
    await ctx.runBinary('vips', [
        'dzsave', vipsInputSpec(sourcePath, level.index), paths.stem,
        '--tile-size', String(settings['tiling.tileSize'] ?? 512),
        '--overlap', String(settings['tiling.overlap'] ?? 1),
        '--suffix', `.jpg[Q=${settings['tiling.jpegQuality'] ?? 85},optimize-coding]`,
        '--region-shrink', String(settings['tiling.regionShrink'] ?? 'mean'),
    ], { timeoutMs: (settings['tiling.timeoutMinutes'] ?? 120) * 60_000 });
    await api.setProgress(85);

    // ---- PREVIEW ---------------------------------------------------------
    await api.setPhase('previewing');
    await rm(paths.previewPath, { force: true });
    await ctx.runBinary('vips', [
        'thumbnail', vipsInputSpec(sourcePath, metadata.levels.length > 0
            ? metadata.levels[metadata.levels.length - 1].index : 0),
        paths.previewPath, String(settings['tiling.previewLongestEdge'] ?? 1024),
    ], { timeoutMs: 120_000 });
    await api.setProgress(95);

    // ---- READY or NEEDS CALIBRATION --------------------------------------
    const calibrated = hasCalibration(metadata);
    const state = calibrated || settings['imports.requireCalibration'] !== true
        ? 'ready'
        : 'needs_calibration';

    if (settings['imports.keepOriginal'] !== true) {
        // Only after everything derived from it exists. The order matters: a
        // crash between tiling and here leaves a re-tileable asset, whereas
        // deleting first would leave one that can never be re-tiled.
        await rm(paths.sourceDir, { recursive: true, force: true });
    }

    const tiledObjective = metadata.nativeObjective === null
        ? null
        : metadata.nativeObjective / level.downsample;

    ctx.log.info('slide imported', {
        assetId, level: level.index, tiledObjective, calibrated, bytes: download.bytes,
    });

    return {
        assetId,
        label: label || fileName,
        state,
        sourceUrl: url,
        sourceSha256: download.sha256,
        sourceBytes: download.bytes,
        nativeObjective: metadata.nativeObjective,
        nativeMppX: metadata.nativeMppX,
        nativeMppY: metadata.nativeMppY,
        tiledObjective,
        width: level.width,
        height: level.height,
        vendor: metadata.vendor,
        diskBytes: await directoryBytes(paths.root),
        // Host-agnostic, exactly as a bundled slide is: the case stores a
        // reference, never an address (RPS-1 §7a).
        dzi: `remote:library/${assetId}/${SLIDE_STEM}.dzi`,
        preview: `remote:library/${assetId}/preview.jpg`,
    };
}

/**
 * Bytes on disk under a directory. Walked rather than tracked, because tiling
 * writes thousands of files whose total nothing else knows.
 *
 * @param {string} dir
 * @returns {Promise<number>}
 */
export async function directoryBytes(dir) {
    let total = 0;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) total += await directoryBytes(path);
        else total += (await stat(path).catch(() => ({ size: 0 }))).size;
    }
    return total;
}
