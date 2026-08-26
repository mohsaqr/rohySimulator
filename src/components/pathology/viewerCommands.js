/**
 * Every viewport action the UI can perform, in one place.
 *
 * WHY a command table instead of handlers on buttons: the toolbar, the
 * keyboard map and (later) any external caller must all drive the SAME
 * implementation. When "go to 10x" exists twice — once on a button and once in
 * a key handler — they drift, and the drift shows up as a button and a hotkey
 * landing on subtly different zooms.
 *
 * This module deliberately does NOT import OpenSeadragon. Everything is
 * expressed through the viewport methods OSD already exposes on the live
 * viewer, and bookmarks are stored as plain {center, zoom, rotation} rather
 * than as OSD Rect objects. That keeps the module free of the module graph it
 * controls, so a caller can hand it a stub viewer and assert what was called.
 */

import { objectiveForZoom, steppedObjective, zoomForObjective } from './magnification.js';
import { hasOpticalProfile } from './slideGeometry.js';

/** How far a plain arrow-key press pans, as a fraction of the visible field. */
const PAN_STEP = 0.25;
/** How far Shift+arrow pans: a whole field, the systematic-screening step. */
const PAN_STEP_FAST = 0.9;

/**
 * Build the command set for a live viewer.
 *
 * `getViewer` and `getSlide` are FUNCTIONS, not values: the viewer is rebuilt
 * whenever the slide changes, and a command set that captured the instance
 * would go on driving a destroyed viewer after the first slide switch.
 *
 * @param {object} p
 * @param {() => object|null} p.getViewer  returns the live OSD viewer, or null
 * @param {() => object|null} p.getSlide   returns the active slide descriptor
 * @param {(state:object) => void} [p.onBookmark]  called with a captured field
 * @returns {object} command set
 */
export function createViewerCommands({ getViewer, getSlide, onBookmark }) {
    if (typeof getViewer !== 'function' || typeof getSlide !== 'function') {
        throw new TypeError('createViewerCommands(): getViewer and getSlide must both be functions');
    }

    // Every command starts here. A command fired before the tile source has
    // opened — a keystroke during load, a toolbar click on an empty room — must
    // be a no-op, not a crash, so this returns null and each command bails.
    //
    // An UNCALIBRATED slide is the same class of situation. In the case editor
    // an author is looking at the tissue while still typing its scanner
    // metadata, and every magnification helper rightly throws on an incomplete
    // profile. Asking here means the viewer simply stops reporting a power
    // instead of throwing on every animation frame.
    const context = () => {
        const viewer = getViewer();
        const slide = getSlide();
        if (!viewer || !slide || !hasOpticalProfile(slide)) return null;
        const item = viewer.world?.getItemAt?.(0);
        if (!item) return null;
        return {
            viewer,
            slide,
            imageWidthPx: item.getContentSize().x,
            containerWidthPx: viewer.container.clientWidth,
        };
    };

    const commands = {
        /**
         * Jump to an exact objective power, keeping the current centre.
         *
         * @param {number} objective
         * @returns {number|null} the objective applied, or null if not ready
         */
        goToObjective(objective) {
            const ctx = context();
            if (!ctx) return null;
            ctx.viewer.viewport.zoomTo(zoomForObjective({
                slide: ctx.slide,
                objective,
                imageWidthPx: ctx.imageWidthPx,
                containerWidthPx: ctx.containerWidthPx,
            }));
            ctx.viewer.viewport.applyConstraints();
            return objective;
        },

        /**
         * The objective currently on screen.
         *
         * Reads the spring TARGET rather than its mid-animation value, so a
         * command issued during a zoom animation steps from where the viewer is
         * going rather than from wherever it happens to be this frame.
         *
         * @returns {number|null}
         */
        currentObjective() {
            const ctx = context();
            if (!ctx) return null;
            return objectiveForZoom({
                slide: ctx.slide,
                zoom: ctx.viewer.viewport.getZoom(false),
                imageWidthPx: ctx.imageWidthPx,
                containerWidthPx: ctx.containerWidthPx,
            });
        },

        /**
         * Step one rung up or down the objective ladder.
         *
         * @param {1|-1} direction
         * @returns {number|null} the objective applied, null at the end of the ladder
         */
        stepObjective(direction) {
            const current = commands.currentObjective();
            if (current === null) return null;
            const next = steppedObjective(current, direction);
            return next === null ? null : commands.goToObjective(next);
        },

        /**
         * Pan by a fraction of the visible field.
         *
         * Expressed as a FRACTION rather than in pixels so one arrow press
         * moves a comparable amount of tissue at 1x and at 40x. A fixed pixel
         * step would be a twitch at low power and a page-jump at high.
         *
         * @param {number} dxFields  +1 is one field to the right
         * @param {number} dyFields  +1 is one field down
         * @param {boolean} [fast=false]  use the whole-field step
         */
        pan(dxFields, dyFields, fast = false) {
            const ctx = context();
            if (!ctx) return;
            const step = fast ? PAN_STEP_FAST : PAN_STEP;
            const bounds = ctx.viewer.viewport.getBounds();
            const centre = ctx.viewer.viewport.getCenter();
            ctx.viewer.viewport.panTo(centre.plus({
                x: dxFields * step * bounds.width,
                y: dyFields * step * bounds.height,
            }));
            ctx.viewer.viewport.applyConstraints();
        },

        /** Fit the whole slide in the viewport. */
        fit() {
            const ctx = context();
            if (!ctx) return;
            ctx.viewer.viewport.goHome();
        },

        /**
         * Rotate the view.
         *
         * Rotation is a real diagnostic act, not decoration: a core biopsy
         * scanned diagonally is read by turning it upright, exactly as a
         * pathologist turns the glass on the stage.
         *
         * @param {number} deltaDegrees  e.g. 90 or -90
         */
        rotate(deltaDegrees) {
            const ctx = context();
            if (!ctx) return;
            // Normalise into [0, 360) so the readout never says "-90°" or
            // climbs to 1,080° after a dozen presses.
            const next = (((ctx.viewer.viewport.getRotation() + deltaDegrees) % 360) + 360) % 360;
            ctx.viewer.viewport.setRotation(next);
        },

        /** @returns {number} current rotation in degrees, 0-359 */
        rotation() {
            const ctx = context();
            return ctx ? ctx.viewer.viewport.getRotation() : 0;
        },

        /** Mirror the view horizontally. */
        flip() {
            const ctx = context();
            if (!ctx) return;
            ctx.viewer.viewport.setFlip(!ctx.viewer.viewport.getFlip());
        },

        /** @returns {boolean} */
        flipped() {
            const ctx = context();
            return ctx ? ctx.viewer.viewport.getFlip() : false;
        },

        /**
         * Capture the current field as a restorable bookmark.
         *
         * Stored as plain numbers rather than an OSD Rect so a bookmark can be
         * serialised, handed to Rohy, and restored in a session that rebuilt
         * the viewer from scratch.
         *
         * @returns {object|null} {center, zoom, rotation, flipped, objective}
         */
        bookmark() {
            const ctx = context();
            if (!ctx) return null;
            const centre = ctx.viewer.viewport.getCenter(false);
            const state = {
                center: { x: centre.x, y: centre.y },
                zoom: ctx.viewer.viewport.getZoom(false),
                rotation: ctx.viewer.viewport.getRotation(),
                flipped: ctx.viewer.viewport.getFlip(),
                objective: commands.currentObjective(),
            };
            onBookmark?.(state);
            return state;
        },

        /**
         * Return to a bookmarked field.
         *
         * @param {object} state  a bookmark() result
         */
        restore(state) {
            const ctx = context();
            if (!ctx || !state) return;
            ctx.viewer.viewport.setRotation(state.rotation ?? 0);
            ctx.viewer.viewport.setFlip(!!state.flipped);
            ctx.viewer.viewport.panTo(state.center);
            ctx.viewer.viewport.zoomTo(state.zoom);
            ctx.viewer.viewport.applyConstraints();
        },

        /**
         * Centre the view on a point given in SLIDE (level-0) coordinates.
         *
         * This is how "jump to this annotation" and "jump to this ROI" work,
         * and it is the seam an external caller would drive to say "show me
         * x = 48,000, y = 39,000 at 20x".
         *
         * @param {{x:number, y:number}} slidePoint
         * @param {number} [objective]  optional power to arrive at
         */
        goToSlidePoint(slidePoint, objective) {
            const ctx = context();
            if (!ctx) return;
            const { downsample } = ctx.slide;
            // slide px -> archive px -> OSD's normalised viewport, where the
            // image spans 1.0 horizontally and y uses the SAME scale factor.
            const viewportPoint = {
                x: slidePoint.x / downsample / ctx.imageWidthPx,
                y: slidePoint.y / downsample / ctx.imageWidthPx,
            };
            if (typeof objective === 'number') commands.goToObjective(objective);
            ctx.viewer.viewport.panTo(viewportPoint);
            ctx.viewer.viewport.applyConstraints();
        },

        /**
         * Fit a slide-space rectangle into the view, with a little margin.
         *
         * @param {{x:number,y:number,w:number,h:number}} rect  slide px
         * @param {number} [padding=0.15]  fraction of the rect added around it
         */
        goToSlideRect(rect, padding = 0.15) {
            const ctx = context();
            if (!ctx || !rect || !(rect.w > 0)) return;
            const { downsample } = ctx.slide;
            const widthInViewport = (rect.w / downsample / ctx.imageWidthPx) * (1 + padding * 2);
            commands.goToSlidePoint({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
            // bounds.width = 1 / zoom, so the zoom that makes the viewport
            // exactly `widthInViewport` wide is its reciprocal.
            ctx.viewer.viewport.zoomTo(1 / widthInViewport);
            ctx.viewer.viewport.applyConstraints();
        },
    };

    return commands;
}

/**
 * Map a command name from the keymap onto the command set.
 *
 * Kept as a pure lookup so the keyboard layer contains no viewer logic at all,
 * and so an unrecognised command is a visible `false` rather than a silent
 * nothing.
 *
 * @param {string} command  e.g. 'objective.10'
 * @param {object} commands a createViewerCommands() result
 * @returns {boolean} whether the command was handled here
 */
export function runViewerCommand(command, commands) {
    const objective = /^objective\.(\d+)$/.exec(command);
    if (objective) {
        commands.goToObjective(Number(objective[1]));
        return true;
    }
    switch (command) {
        case 'objective.up': commands.stepObjective(1); return true;
        case 'objective.down': commands.stepObjective(-1); return true;
        case 'pan.left': commands.pan(-1, 0); return true;
        case 'pan.right': commands.pan(1, 0); return true;
        case 'pan.up': commands.pan(0, -1); return true;
        case 'pan.down': commands.pan(0, 1); return true;
        case 'pan.left.fast': commands.pan(-1, 0, true); return true;
        case 'pan.right.fast': commands.pan(1, 0, true); return true;
        case 'pan.up.fast': commands.pan(0, -1, true); return true;
        case 'pan.down.fast': commands.pan(0, 1, true); return true;
        case 'view.fit': commands.fit(); return true;
        case 'view.rotateLeft': commands.rotate(-90); return true;
        case 'view.rotateRight': commands.rotate(90); return true;
        case 'view.flip': commands.flip(); return true;
        case 'view.bookmark': commands.bookmark(); return true;
        default: return false;
    }
}
