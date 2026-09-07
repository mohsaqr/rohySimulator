/**
 * Keyboard bindings, as DATA rather than a switch statement.
 *
 * WHY a table: the usability study of input devices for whole-slide navigation
 * found that most pathologists want an alternative to click-and-drag, and
 * specifically asked for programmable shortcuts and hotkeys bound to
 * magnification levels. A table can be rendered as a help sheet, tested
 * without a DOM, and rebound by a deployment without touching the handler —
 * a `switch (event.key)` can do none of those.
 *
 * `Mod` means Cmd on macOS and Ctrl elsewhere. It is matched against either,
 * so one table serves both platforms and no binding needs duplicating.
 *
 * NOTE ON WHAT IS DELIBERATELY NOT BOUND: nothing here binds a bare letter
 * that a text field would want. Every handler must still refuse to act when
 * the event target is an input or textarea — see `isTypingTarget`.
 */

/**
 * The default bindings.
 *
 * `group` exists so the help overlay can present them the way a reader thinks
 * about them — move, magnify, draw, edit — rather than alphabetically.
 */
export const DEFAULT_KEYMAP = [
    // --- Moving around the slide -----------------------------------------
    { binding: 'ArrowLeft', command: 'pan.left', group: 'Navigate', description: 'Pan left' },
    { binding: 'ArrowRight', command: 'pan.right', group: 'Navigate', description: 'Pan right' },
    { binding: 'ArrowUp', command: 'pan.up', group: 'Navigate', description: 'Pan up' },
    { binding: 'ArrowDown', command: 'pan.down', group: 'Navigate', description: 'Pan down' },
    { binding: 'Shift+ArrowLeft', command: 'pan.left.fast', group: 'Navigate', description: 'Pan left, a whole field' },
    { binding: 'Shift+ArrowRight', command: 'pan.right.fast', group: 'Navigate', description: 'Pan right, a whole field' },
    { binding: 'Shift+ArrowUp', command: 'pan.up.fast', group: 'Navigate', description: 'Pan up, a whole field' },
    { binding: 'Shift+ArrowDown', command: 'pan.down.fast', group: 'Navigate', description: 'Pan down, a whole field' },
    { binding: '0', command: 'view.fit', group: 'Navigate', description: 'Fit the whole slide' },
    { binding: '[', command: 'view.rotateLeft', group: 'Navigate', description: 'Rotate 90° left' },
    { binding: ']', command: 'view.rotateRight', group: 'Navigate', description: 'Rotate 90° right' },
    { binding: 'h', command: 'view.flip', group: 'Navigate', description: 'Flip horizontally' },
    { binding: 'n', command: 'view.toggleNavigator', group: 'Navigate', description: 'Show/hide the navigator' },
    { binding: 'b', command: 'view.bookmark', group: 'Navigate', description: 'Bookmark this field' },

    // --- Magnification ----------------------------------------------------
    // The digits map to the objective ladder, not to 1..6 as ordinals: '4'
    // gives 4x. Muscle memory should match the label on the button.
    { binding: '1', command: 'objective.1', group: 'Magnify', description: 'Go to 1x' },
    { binding: '2', command: 'objective.2', group: 'Magnify', description: 'Go to 2x' },
    { binding: '3', command: 'objective.4', group: 'Magnify', description: 'Go to 4x' },
    { binding: '4', command: 'objective.10', group: 'Magnify', description: 'Go to 10x' },
    { binding: '5', command: 'objective.20', group: 'Magnify', description: 'Go to 20x' },
    { binding: '6', command: 'objective.40', group: 'Magnify', description: 'Go to 40x' },
    { binding: '=', command: 'objective.up', group: 'Magnify', description: 'Next objective up' },
    { binding: '-', command: 'objective.down', group: 'Magnify', description: 'Next objective down' },

    // --- Choosing a tool ---------------------------------------------------
    { binding: 'v', command: 'tool.navigate', group: 'Draw', description: 'Navigate (no drawing)' },
    { binding: 's', command: 'tool.select', group: 'Draw', description: 'Select and edit' },
    { binding: 'm', command: 'tool.line', group: 'Draw', description: 'Measure a distance' },
    { binding: 'a', command: 'tool.arrow', group: 'Draw', description: 'Point something out' },
    { binding: 'r', command: 'tool.rectangle', group: 'Draw', description: 'Rectangle' },
    { binding: 'e', command: 'tool.ellipse', group: 'Draw', description: 'Ellipse' },
    { binding: 'p', command: 'tool.polygon', group: 'Draw', description: 'Polygon' },
    { binding: 'd', command: 'tool.freehand', group: 'Draw', description: 'Freehand outline' },
    { binding: 'f', command: 'tool.polyline', group: 'Draw', description: 'Free-form path along a curve' },
    { binding: 't', command: 'tool.point', group: 'Draw', description: 'Drop a marker' },
    { binding: 'c', command: 'tool.countingFrame', group: 'Draw', description: 'Place a counting frame' },

    // --- Editing what is there --------------------------------------------
    { binding: 'Mod+z', command: 'edit.undo', group: 'Edit', description: 'Undo' },
    { binding: 'Mod+Shift+z', command: 'edit.redo', group: 'Edit', description: 'Redo' },
    { binding: 'Mod+y', command: 'edit.redo', group: 'Edit', description: 'Redo' },
    { binding: 'Delete', command: 'edit.delete', group: 'Edit', description: 'Delete the selection' },
    { binding: 'Backspace', command: 'edit.delete', group: 'Edit', description: 'Delete the selection' },
    { binding: 'Escape', command: 'edit.cancel', group: 'Edit', description: 'Cancel drawing / deselect' },
    { binding: 'Enter', command: 'edit.finish', group: 'Edit', description: 'Finish a polygon' },
    { binding: ' ', command: 'count.increment', group: 'Edit', description: 'Add one to the selected count' },
    { binding: 'Shift+ ', command: 'count.decrement', group: 'Edit', description: 'Take one off the count' },
    { binding: '?', command: 'help.toggle', group: 'Edit', description: 'Show this list' },
];

/**
 * The translation key for every group and every description in the table
 * above, written out LITERALLY so extraction tooling can see them.
 *
 * A module-scope data table cannot take a `t` prop, so its English stays here
 * as the fallback and the CONSUMER translates at render time from the stable
 * id — `KEYMAP_GROUP_KEYS[row.group]`, `KEYMAP_DESCRIPTION_KEYS[row.command]`.
 * `t(variable)` is invisible to a key extractor, which is exactly why the keys
 * appear here as literal strings rather than being built from the ids.
 */
export const KEYMAP_GROUP_KEYS = {
    Navigate: 'keymap_group_navigate',
    Magnify: 'keymap_group_magnify',
    Draw: 'keymap_group_draw',
    Edit: 'keymap_group_edit',
};

/** One key per COMMAND — two bindings of the same command share a row. */
export const KEYMAP_DESCRIPTION_KEYS = {
    'pan.left': 'keymap_pan_left',
    'pan.right': 'keymap_pan_right',
    'pan.up': 'keymap_pan_up',
    'pan.down': 'keymap_pan_down',
    'pan.left.fast': 'keymap_pan_left_fast',
    'pan.right.fast': 'keymap_pan_right_fast',
    'pan.up.fast': 'keymap_pan_up_fast',
    'pan.down.fast': 'keymap_pan_down_fast',
    'view.fit': 'keymap_view_fit',
    'view.rotateLeft': 'keymap_view_rotate_left',
    'view.rotateRight': 'keymap_view_rotate_right',
    'view.flip': 'keymap_view_flip',
    'view.toggleNavigator': 'keymap_view_toggle_navigator',
    'view.bookmark': 'keymap_view_bookmark',
    'objective.1': 'keymap_objective_1',
    'objective.2': 'keymap_objective_2',
    'objective.4': 'keymap_objective_4',
    'objective.10': 'keymap_objective_10',
    'objective.20': 'keymap_objective_20',
    'objective.40': 'keymap_objective_40',
    'objective.up': 'keymap_objective_up',
    'objective.down': 'keymap_objective_down',
    'tool.navigate': 'keymap_tool_navigate',
    'tool.select': 'keymap_tool_select',
    'tool.line': 'keymap_tool_line',
    'tool.arrow': 'keymap_tool_arrow',
    'tool.rectangle': 'keymap_tool_rectangle',
    'tool.ellipse': 'keymap_tool_ellipse',
    'tool.polygon': 'keymap_tool_polygon',
    'tool.freehand': 'keymap_tool_freehand',
    'tool.polyline': 'keymap_tool_polyline',
    'tool.point': 'keymap_tool_point',
    'tool.countingFrame': 'keymap_tool_counting_frame',
    'edit.undo': 'keymap_edit_undo',
    'edit.redo': 'keymap_edit_redo',
    'edit.delete': 'keymap_edit_delete',
    'edit.cancel': 'keymap_edit_cancel',
    'edit.finish': 'keymap_edit_finish',
    'count.increment': 'keymap_count_increment',
    'count.decrement': 'keymap_count_decrement',
    'help.toggle': 'keymap_help_toggle',
};

/**
 * Split a binding string into its modifier flags and its key.
 *
 * @param {string} binding  e.g. "Mod+Shift+z"
 * @returns {{mod:boolean, shift:boolean, alt:boolean, key:string}}
 */
export function parseBinding(binding) {
    if (typeof binding !== 'string' || binding.length === 0) {
        throw new TypeError(`parseBinding(): expected a non-empty string, received ${JSON.stringify(binding)}`);
    }
    // Split on '+' but never on a trailing one, so the space binding written
    // as "Shift+ " keeps its literal space as the key.
    const parts = binding.split('+');
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
    const unknown = mods.find((m) => !['mod', 'shift', 'alt'].includes(m));
    if (unknown !== undefined) {
        throw new RangeError(`parseBinding(${JSON.stringify(binding)}): unknown modifier ${JSON.stringify(unknown)}`);
    }
    return {
        mod: mods.includes('mod'),
        shift: mods.includes('shift'),
        alt: mods.includes('alt'),
        key,
    };
}

/**
 * Find the command a keyboard event triggers.
 *
 * Modifier matching is EXACT, not "at least": Mod+Z must not also fire the
 * bare 'z' tool binding, or every undo would silently switch the active tool.
 *
 * @param {{key:string, shiftKey?:boolean, ctrlKey?:boolean, metaKey?:boolean, altKey?:boolean}} event
 * @param {Array<object>} [keymap=DEFAULT_KEYMAP]
 * @returns {string|null} the command name, or null if nothing is bound
 */
export function resolveCommand(event, keymap = DEFAULT_KEYMAP) {
    if (!event || typeof event.key !== 'string') {
        throw new TypeError(`resolveCommand(): expected an event with a string key, received ${JSON.stringify(event?.key)}`);
    }
    const mod = !!(event.ctrlKey || event.metaKey);
    const shift = !!event.shiftKey;
    const alt = !!event.altKey;

    const hit = keymap.find((entry) => {
        const b = parseBinding(entry.binding);
        // Letters are compared case-insensitively: Shift+z arrives as 'Z' and
        // must still match a binding written 'Mod+Shift+z'.
        const keyMatches = b.key.length === 1
            ? b.key.toLowerCase() === event.key.toLowerCase()
            : b.key === event.key;
        // For a printable SYMBOL key the shift state is already baked into the
        // character the browser reports — '?' simply cannot arrive without
        // shift held, and '=' cannot arrive with it. Demanding an exact shift
        // match there would make '?' unreachable on every keyboard. Letters
        // and Space are excluded because for them shift is a real distinction
        // (Space adds to a count, Shift+Space subtracts).
        const shiftIsIntrinsic = b.key.length === 1 && !/[a-z ]/i.test(b.key);
        return keyMatches
            && b.mod === mod
            && (shiftIsIntrinsic || b.shift === shift)
            && b.alt === alt;
    });
    return hit ? hit.command : null;
}

/**
 * Should a key event be ignored because the reader is typing?
 *
 * Without this, typing "recurrent" into the diagnosis box would fire the
 * rectangle tool, the ellipse tool and a 90° rotation on the way through.
 *
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
export function isTypingTarget(target) {
    const tag = target?.tagName;
    if (typeof tag !== 'string') return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag.toUpperCase())
        || target?.isContentEditable === true;
}

/**
 * The keymap arranged for a help sheet.
 *
 * Bindings sharing a command are merged so the sheet reads "Delete / Backspace"
 * on one line rather than listing the same action twice.
 *
 * @param {Array<object>} [keymap=DEFAULT_KEYMAP]
 * @returns {Array<{group:string, rows:Array<{command:string, bindings:Array<string>, description:string}>}>}
 */
export function keymapByGroup(keymap = DEFAULT_KEYMAP) {
    const groups = [];
    keymap.forEach((entry) => {
        let group = groups.find((g) => g.group === entry.group);
        if (!group) {
            group = { group: entry.group, rows: [] };
            groups.push(group);
        }
        const row = group.rows.find((r) => r.description === entry.description);
        if (row) row.bindings.push(entry.binding);
        else group.rows.push({ command: entry.command, bindings: [entry.binding], description: entry.description });
    });
    return groups;
}
