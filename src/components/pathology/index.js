/**
 * The package's public surface.
 *
 * One entry point, for three ways of consuming this package:
 *
 *   1. STANDALONE — `app/` imports from here and mounts `StandaloneApp`.
 *   2. AS A DEPENDENCY — `vite build --mode plugin` bundles this file into
 *      dist/pathoyon.js with react, openseadragon and lucide-react left
 *      external, so a host imports `pathoyon` like any other package.
 *   3. VENDORED — a host copies `src/` wholesale and imports the files
 *      directly, which is what Rohy does today and what RPS-1 §4 describes.
 *
 * All three see the same modules. There is no "standalone build" of the
 * package itself: `app/` is a HOST that lives outside `src/`, exactly as Rohy
 * is a host that lives outside it. That is the property worth protecting —
 * `tests/portability.test.js` fails the build if anything under `src/` grows
 * an import that only a particular host could satisfy.
 */

// --- React surface ---------------------------------------------------------
export { PathologyScreen } from './PathologyScreen.jsx';   // room + chrome
export { PathologyRoom } from './PathologyRoom.jsx';       // room, chrome-free (embeds)
export { CaseAuthor } from './CaseAuthor.jsx';             // the authoring surface
export { CaseStudio } from './CaseStudio.jsx';             // controlled authoring surface
export { SlideAssetCard } from './SlideAssetCard.jsx';     // catalog preview/add card
export { SlideCanvas } from './SlideCanvas.jsx';
export { SpecimenTray } from './SpecimenTray.jsx';
export { AnnotationCanvas } from './AnnotationCanvas.jsx';
export { AnnotationPanel } from './AnnotationPanel.jsx';
export { ReportPanel } from './ReportPanel.jsx';
export { ViewerToolbar } from './ViewerToolbar.jsx';
export { KeyboardHelp } from './KeyboardHelp.jsx';
export { useAnnotations } from './useAnnotations.js';
export { useReadRecorder } from './useReadRecorder.js';

// --- headless core ---------------------------------------------------------
// Every one of these runs under `node --test` with no browser, which is why
// the suite is 247 assertions rather than a screenshot diff.
export * from './annotationGeometry.js';
export * from './annotationModel.js';
export * from './annotationStore.js';
export * from './assetCatalog.js';
export * from './caseAuthoring.js';
export * from './caseCore/index.js';
export * from './caseStudioModel.js';
export * from './formatAdapters.js';
export * from './geojson.js';
export * from './grading.js';
export * from './hostDocument.js';
export * from './imageAdjustments.js';
export * from './imageEmbed.js';
export * from './keymap.js';
export * from './magnification.js';
export * from './pathologyEvents.js';
export * from './pathologyStates.js';
export * from './readAssessment.js';
export * from './remoteRef.js';
export * from './readRecorder.js';
export * from './report.js';
export * from './slideGeometry.js';
export * from './slideSource.js';
export * from './specimenNaming.js';
export * from './slideThumbnail.js';
export { SlidePreview } from './SlidePreview.jsx';
export * from './snapshot.js';
export * from './specimenGeometry.js';
export * from './viewerCommands.js';
