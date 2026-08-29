/**
 * Radoyon's public surface.
 *
 * A host imports from here and nowhere else. Everything below is either a
 * component it mounts, a pure judgement it can run on its own server, or a
 * vocabulary it registers.
 */

// Components
export { PacsScreen } from './PacsScreen.jsx';
export { CaseAuthor } from './CaseAuthor.jsx';
export { Viewport } from './Viewport.jsx';
export { SeriesRail } from './SeriesRail.jsx';
export { Worklist } from './Worklist.jsx';

// The DICOM core
export { DicomError, TRANSFER_SYNTAX, parseDicom } from './dicomParse.js';
export { isInverted, readFrame, readRealFrame, rescaleOf, toRealValues } from './pixelData.js';
export {
    WINDOW_PRESETS, applyWindow, autoWindow, defaultWindow, dragWindow,
    presetById, presetsFor, toImageData,
} from './windowLevel.js';
export {
    buildSeries, describeInstance, measureDistance, measureRegion, planeOf,
    slicePosition, sliceNormal,
} from './series.js';

// State
export {
    applyPreset, changeSeries, coverage, initialViewport, panBy, resetView,
    scrollBy, scrollTo, toCanvasPoint, toImagePoint, viewTransform, windowBy, zoomAbout,
} from './viewportState.js';
export { createFrameCache } from './frameCache.js';
export { useStudy, openingWindow } from './useStudy.js';

// The host contract — pure, total, browser-free, so a server can run it too.
export {
    REDISTRIBUTION, archiveIssues, archiveTable, attributionNotices,
    entriesForStudy, entryById, readArchive, redistributableEntries,
} from './archive.js';
export {
    SOURCE_KIND, SUBSTITUTION_SCOPE, documentIsServable, documentIssues,
    documentSummary, emptyDocument, learnerDocument, readDocument, resolveEntry,
} from './caseDocument.js';

// Vocabulary, for the host's manifest.
export {
    RADOYON_COMPONENTS, RADOYON_OBJECT_TYPES, RADOYON_ROOM,
    RADOYON_VERBS, RADOYON_VERB_METADATA,
} from './radoyonEvents.js';
export {
    RADOYON_INTERPRETATIONS, RADOYON_OBJECT_OVERRIDES, RADOYON_VERB_FALLBACKS,
} from './radoyonStates.js';
