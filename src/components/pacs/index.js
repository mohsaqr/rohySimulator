/**
 * Radoyon's public surface.
 *
 * A host imports from here and nowhere else. Everything below is either a
 * component it mounts, a pure judgement it can run on its own server, or a
 * vocabulary it registers.
 */

// Components
export { PacsScreen } from './PacsScreen.jsx';
export { CaseEditor, CaseAuthor } from './CaseEditor.jsx';
export { StudyLibrary } from './StudyLibrary.jsx';
export { StudyInspector } from './StudyInspector.jsx';
export { Viewport } from './Viewport.jsx';
export { ReadingPane } from './ReadingPane.jsx';
export { SeriesRail } from './SeriesRail.jsx';
export { Worklist } from './Worklist.jsx';
export { Toolbar, TOOLS, LAYOUTS } from './Toolbar.jsx';

// The DICOM core
export { DicomError, TRANSFER_SYNTAX, parseDicom } from './dicomParse.js';
export { isInverted, readFrame, readRealFrame, rescaleOf, toRealValues } from './pixelData.js';
export {
    WINDOW_PRESETS, applyWindow, autoWindow, defaultWindow, dragWindow,
    presetById, presetsFor, toImageData,
} from './windowLevel.js';
export {
    buildSeries, describeInstance, measureDistance, measureRegion,
    orientationLabels, planeOf, slicePosition, sliceNormal,
} from './series.js';

// State
export {
    applyPreset, changeSeries, cineStep, coverage, displayedOrientation,
    flipHorizontal, flipVertical, initialViewport, panBy, resetView,
    rotateQuarter, scrollBy, scrollTo, toCanvasPoint, toImagePoint,
    toggleInvert, viewTransform, windowBy, zoomAbout,
} from './viewportState.js';
export { createFrameCache } from './frameCache.js';
export { useStudy, openingWindow } from './useStudy.js';
export { useThumbnails } from './useThumbnails.js';

// The host contract — pure, total, browser-free, so a server can run it too.
export {
    LIBRARY, REDISTRIBUTION, abnormalEntries, archiveIssues, archiveTable,
    attributionNotices, confirmedEntries, entriesForStudy, entryById, entryStats,
    libraryOf,
    normalEntries, pathologySources, primaryEntries, readArchive,
    readingEntries, redistributableEntries,
} from './archive.js';
export {
    SOURCE_KIND, SUBSTITUTION_SCOPE, caseCatalogue, documentIsServable,
    documentIssues, documentSummary, emptyDocument, entryForStudy,
    learnerDocument, readDocument, resolveEntry, studyForOrder,
} from './caseDocument.js';
export {
    ACTION, addFinding, changeStudy, entryOf, patchFinding, patchStudy,
    removeFinding, revertStudy, undoLabelFor, unwireBaseline, wireBaseline,
} from './caseActions.js';
export { defaultResolveRef, pictureOf, previewSeries, studyActions } from './caseView.js';

// Vocabulary, for the host's manifest.
export {
    RADOYON_COMPONENTS, RADOYON_COMPONENT_PREFIX, RADOYON_OBJECT_TYPES, RADOYON_ROOM,
    RADOYON_VERBS, RADOYON_VERB_METADATA, RADOYON_VOCABULARY_VERSION, REVIEWED_COVERAGE,
    createRadoyonLogger, reportShape,
} from './radoyonEvents.js';
export {
    RADOYON_INTERPRETATIONS, RADOYON_OBJECT_OVERRIDES, RADOYON_VERB_FALLBACKS,
} from './radoyonStates.js';
