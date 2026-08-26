/**
 * Annotation store — CRUD plus undo/redo, with no React and no DOM in it.
 *
 * WHY undo matters more here than in an ordinary form: annotating a slide is a
 * manual-dexterity task performed at 20x on a moving viewport. Mis-drops are
 * routine, and a reader who cannot take one back learns to annotate timidly,
 * which is exactly the behaviour a teaching viewer should not produce.
 *
 * HISTORY MODEL — snapshots, not inverse commands. Each mutation pushes a copy
 * of the previous list onto an undo stack. Inverse commands would use less
 * memory, but every command needs a hand-written inverse and a wrong one
 * corrupts the document silently. A slide carries tens to low hundreds of
 * annotations, each a handful of vertices, so a bounded stack of snapshots
 * costs little and cannot be subtly wrong. The bound is `historyLimit`;
 * without one, a long freehand session grows without limit.
 *
 * Records are treated as immutable: `update` replaces a record rather than
 * mutating it, so a snapshot taken before the edit still describes the old
 * state. Mutating in place would make every entry in the undo stack point at
 * the same live object and silently break undo.
 */

import { createAnnotation } from './annotationModel.js';

/**
 * @param {object} [p]
 * @param {string} [p.idPrefix='ann']  id namespace, e.g. the slide id
 * @param {Array<object>} [p.initial=[]]  annotations to start from
 * @param {number} [p.historyLimit=100]   how many undo steps to keep
 * @returns {object} store handle
 */
export function createAnnotationStore({ idPrefix = 'ann', initial = [], historyLimit = 100 } = {}) {
    if (typeof idPrefix !== 'string' || idPrefix.length === 0) {
        throw new TypeError(`createAnnotationStore(): idPrefix must be a non-empty string, received ${JSON.stringify(idPrefix)}`);
    }
    if (!Array.isArray(initial)) {
        throw new TypeError(`createAnnotationStore(): initial must be an array, received ${typeof initial}`);
    }
    if (!(Number.isInteger(historyLimit) && historyLimit >= 1)) {
        throw new RangeError(`createAnnotationStore(): historyLimit must be an integer >= 1, received ${historyLimit}`);
    }

    let items = [...initial];
    let undoStack = [];
    let redoStack = [];
    const subscribers = new Set();

    // Seed the counter past anything already present. Importing a GeoJSON file
    // whose ids are 'ann-1'..'ann-9' and then starting a fresh counter at 1
    // would mint duplicate ids, and every lookup by id would then return the
    // wrong record.
    let seq = initial.reduce((max, a) => {
        const m = typeof a?.id === 'string' ? a.id.match(/-(\d+)$/) : null;
        return m ? Math.max(max, Number(m[1])) : max;
    }, 0);

    const notify = (change) => {
        const snapshot = [...items];
        subscribers.forEach((fn) => fn(change, snapshot));
    };

    // Every mutation goes through here, so history and notification can never
    // be forgotten at one call site and remembered at another.
    const commit = (next, change) => {
        undoStack.push(items);
        if (undoStack.length > historyLimit) undoStack.shift();
        // Any new edit invalidates the redo branch, the standard linear-history
        // rule: you cannot redo into a future you have just diverged from.
        redoStack = [];
        items = next;
        notify(change);
        return change;
    };

    return {
        /** @returns {Array<object>} a copy — callers cannot mutate the store by reference */
        list: () => [...items],

        /** @param {string} id @returns {object|null} */
        get: (id) => items.find((a) => a.id === id) ?? null,

        /** @returns {number} */
        size: () => items.length,

        /**
         * Mint and store a new annotation.
         *
         * @param {object} spec  createAnnotation() input, minus `id`
         * @returns {{type:'add', annotation:object}}
         */
        add(spec) {
            seq += 1;
            const annotation = createAnnotation({ ...spec, id: `${idPrefix}-${seq}` });
            return commit([...items, annotation], { type: 'add', annotation });
        },

        /**
         * Replace fields on one annotation.
         *
         * Re-runs createAnnotation so an edited geometry is validated and
         * re-normalised exactly as a new one would be — an editor that skips
         * validation on the edit path is an editor that accepts NaN.
         *
         * @param {string} id
         * @param {object} patch  any createAnnotation field
         * @param {number} [now]  update timestamp, ms
         * @returns {{type:'update', annotation:object, previous:object}}
         */
        update(id, patch, now = 0) {
            const previous = items.find((a) => a.id === id);
            if (!previous) {
                throw new RangeError(`annotationStore.update(): no annotation with id ${JSON.stringify(id)}`);
            }
            const annotation = {
                ...createAnnotation({ ...previous, ...patch, id }),
                createdAtMs: previous.createdAtMs,
                updatedAtMs: now,
            };
            return commit(
                items.map((a) => (a.id === id ? annotation : a)),
                { type: 'update', annotation, previous },
            );
        },

        /**
         * @param {string} id
         * @returns {{type:'remove', annotation:object}}
         */
        remove(id) {
            const annotation = items.find((a) => a.id === id);
            if (!annotation) {
                throw new RangeError(`annotationStore.remove(): no annotation with id ${JSON.stringify(id)}`);
            }
            return commit(items.filter((a) => a.id !== id), { type: 'remove', annotation });
        },

        /**
         * Drop every annotation, in one undoable step.
         *
         * @returns {{type:'clear', removed:Array<object>}}
         */
        clear() {
            return commit([], { type: 'clear', removed: [...items] });
        },

        /**
         * Replace the whole document — the import path.
         *
         * @param {Array<object>} next  already-validated annotation records
         * @returns {{type:'replace', count:number}}
         */
        replaceAll(next) {
            if (!Array.isArray(next)) {
                throw new TypeError(`annotationStore.replaceAll(): expected an array, received ${typeof next}`);
            }
            seq = next.reduce((max, a) => {
                const m = typeof a?.id === 'string' ? a.id.match(/-(\d+)$/) : null;
                return m ? Math.max(max, Number(m[1])) : max;
            }, seq);
            return commit([...next], { type: 'replace', count: next.length });
        },

        /** @returns {boolean} */
        canUndo: () => undoStack.length > 0,
        /** @returns {boolean} */
        canRedo: () => redoStack.length > 0,

        /**
         * Step back one edit.
         *
         * @returns {{type:'undo'}|null} null when there is nothing to undo
         */
        undo() {
            if (undoStack.length === 0) return null;
            redoStack.push(items);
            items = undoStack.pop();
            const change = { type: 'undo' };
            notify(change);
            return change;
        },

        /**
         * Step forward one undone edit.
         *
         * @returns {{type:'redo'}|null} null when there is nothing to redo
         */
        redo() {
            if (redoStack.length === 0) return null;
            undoStack.push(items);
            items = redoStack.pop();
            const change = { type: 'redo' };
            notify(change);
            return change;
        },

        /**
         * Observe every change.
         *
         * @param {(change:object, annotations:Array<object>) => void} fn
         * @returns {() => void} unsubscribe
         */
        subscribe(fn) {
            if (typeof fn !== 'function') {
                throw new TypeError(`annotationStore.subscribe(): expected a function, received ${typeof fn}`);
            }
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        },
    };
}
