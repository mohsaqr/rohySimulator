import { X } from 'lucide-react';
import { keymapByGroup } from './keymap.js';

/**
 * The shortcut sheet.
 *
 * Rendered FROM the keymap rather than hand-written, so a binding cannot be
 * changed in the table and left stale on the help screen — the single most
 * common way keyboard documentation goes wrong.
 *
 * `Mod` is displayed as the symbol the reader's own platform uses. Showing
 * "Ctrl+Z" to a Mac user is a small thing that makes the whole sheet feel like
 * it was written for someone else's computer.
 */
export function KeyboardHelp({ open, onClose }) {
    if (!open) return null;
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

    return (
        <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={onClose}
        >
            <div
                className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-900 p-5 shadow-2xl shadow-black/50"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-4 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold text-slate-100">Keyboard shortcuts</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">Close</span>
                    </button>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                    {keymapByGroup().map((group) => (
                        <section key={group.group}>
                            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-300">
                                {group.group}
                            </h3>
                            <dl className="space-y-1">
                                {group.rows.map((row) => (
                                    <div key={row.description} className="flex items-baseline gap-3 text-[12px]">
                                        <dt className="flex shrink-0 gap-1">
                                            {row.bindings.map((b) => (
                                                <kbd
                                                    key={b}
                                                    className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-200"
                                                >
                                                    {prettyBinding(b, isMac)}
                                                </kbd>
                                            ))}
                                        </dt>
                                        <dd className="min-w-0 flex-1 text-slate-400">{row.description}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>

                <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-500">
                    Shortcuts are ignored while you are typing in a text box, so a diagnosis can
                    contain the letter <strong className="text-slate-400">r</strong> without drawing a rectangle.
                </p>
            </div>
        </div>
    );
}

const KEY_SYMBOLS = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    ' ': 'Space', Escape: 'Esc', Backspace: '⌫', Delete: 'Del', Enter: '⏎',
};

function prettyBinding(binding, isMac) {
    return binding
        .split('+')
        .map((part, i, all) => {
            // The final segment is the key; everything before it is a modifier.
            if (i < all.length - 1) {
                if (part === 'Mod') return isMac ? '⌘' : 'Ctrl';
                if (part === 'Shift') return isMac ? '⇧' : 'Shift';
                return part;
            }
            return KEY_SYMBOLS[part] ?? (part.length === 1 ? part.toUpperCase() : part);
        })
        .join(isMac ? '' : '+');
}
