/*
 * What `import('webgazer')` resolves to inside the <oyon-app> element bundle.
 *
 * WebGazer is an optional, separately licensed (GPL-3.0-or-later) peer and is
 * never compiled into the element. This module stands in for it at build time
 * and deliberately exposes no WebGazer API: WebGazerAdapter sees that the
 * import gave it nothing usable and loads WebGazer from its script URL
 * instead, and only when that gaze engine is actually chosen.
 *
 * It must not throw. The element build inlines dynamic imports, so this
 * module is evaluated when the element loads, in every host page.
 *
 * It is a real module rather than a rollup `external` because a bare
 * `import("webgazer")` left in the published bundle makes every host that
 * runs the bundle through its own bundler or dev server (Vite, webpack)
 * fail to resolve a package it never asked for.
 */

/** Marker the release check looks for (scripts/check-element-bundle.mjs). */
export const OYON_WEBGAZER_NOT_BUNDLED = 'oyon:webgazer-not-bundled';

export default null;
