import path from 'node:path';

/*
 * Shared module aliases for both build targets:
 *   - vite.config.ts          (standalone app — unchanged behavior)
 *   - vite.element.config.ts  (<oyon-app> embeddable element)
 *
 * Array form gives explicit ordering. The longest-prefix matches must come
 * first or Vite will treat `oyon/react/gaze-calibration` as a subpath inside
 * the file at `src/index.js` (it can't be, that's a file).
 */
export function makeAliases(appDir: string, repoRoot: string) {
  return [
    { find: '@/', replacement: path.resolve(appDir, './src') + '/' },
    {
      find: 'oyon/react/gaze-calibration',
      replacement: path.resolve(repoRoot, 'src/react/GazeCalibrationPanel.js'),
    },
    {
      find: 'oyon/ui/gaze-calibration',
      replacement: path.resolve(repoRoot, 'src/ui/GazeCalibrationOverlay.js'),
    },
    // Pure analytics modules. The app cannot reach `oyon/...` through node
    // resolution — it lives inside the very package it would be importing —
    // so every exports-map subpath it uses needs a matching alias here.
    {
      find: 'oyon/analytics/aoi-transition-matrix',
      replacement: path.resolve(repoRoot, 'src/analytics/AoiTransitionMatrix.js'),
    },
    {
      find: 'oyon/analytics/affect-dynamics',
      replacement: path.resolve(repoRoot, 'src/analytics/AffectDynamics.js'),
    },
    {
      find: 'oyon/analytics/gaze-dynamics',
      replacement: path.resolve(repoRoot, 'src/analytics/GazeDynamics.js'),
    },
    // Group data out (groupTimeline, channel catalogue) for the group
    // synchrony dashboard. The analysis itself comes from `ladyna/synchrony`.
    {
      find: 'oyon/group',
      replacement: path.resolve(repoRoot, 'src/group/index.js'),
    },
    // Legacy vendor modules used unmodified by the ported logs-dashboard
    // renderers under src/legacy/.
    {
      find: 'legacy-dynajs',
      replacement: path.resolve(repoRoot, 'standalone/vendor/dynajs/index.js'),
    },
    {
      find: 'legacy-tnaj',
      replacement: path.resolve(repoRoot, 'standalone/vendor/tnaj/index.js'),
    },
    {
      find: /^legacy-tna\/(.*)$/,
      replacement: path.resolve(repoRoot, 'standalone/vendor/rohy-tna') + '/$1',
    },
    // Exact match for the bare specifier — RegExp anchors prevent prefix
    // matches against `oyon/<anything>`.
    {
      find: /^oyon$/,
      replacement: path.resolve(repoRoot, 'src/index.js'),
    },
  ];
}
