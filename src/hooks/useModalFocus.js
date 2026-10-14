// Keyboard contract for a modal dialog (WAI-ARIA dialog pattern):
//   - focus moves INTO the dialog when it opens — to the element marked
//     `data-autofocus`, else the first focusable one, else the dialog itself;
//   - Tab and Shift+Tab cycle inside it and never reach the page behind;
//   - Escape calls `onEscape` (the dialog decides what Escape means);
//   - focus returns to whatever had it before, when the dialog closes.
//
// Rohy had this only inside the vendored lessons module
// (src/components/lessons/hooks/useFocusTrap.js), which the house code does
// not import. Give the dialog element `tabIndex={-1}` so it can hold focus
// itself when it has nothing focusable.

import { useEffect, useRef } from 'react';

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The elements Tab can reach inside `container`, in document order. */
export function focusableIn(container) {
    return [...container.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden], [inert]'));
}

/**
 * @param {object} [options]
 * @param {Function} [options.onEscape]  called on Escape; omit to ignore Escape
 * @returns {import('react').RefObject<HTMLElement>} attach to the dialog element
 */
export default function useModalFocus({ onEscape } = {}) {
    const ref = useRef(null);
    const escape = useRef(onEscape);
    useEffect(() => { escape.current = onEscape; }, [onEscape]);

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return undefined;
        const previous = document.activeElement;
        const initial = dialog.querySelector('[data-autofocus]') ?? focusableIn(dialog)[0] ?? dialog;
        initial.focus();

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (!escape.current) return;
                event.preventDefault();
                event.stopPropagation();
                escape.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusableIn(dialog);
            if (items.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (!dialog.contains(active)) {
                // Focus was lost (the element holding it went away): back in.
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            } else if (event.shiftKey && (active === first || active === dialog)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };
        // Capture: the dialog answers Escape before anything behind it
        // (a settings panel that also closes on Escape) can.
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
        };
    }, []);

    return ref;
}
