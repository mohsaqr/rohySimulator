import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

/**
 * Three-dot trigger that reveals a small popover of stacked actions.
 * The popover is rendered in a portal at document.body so it doesn't
 * get clipped by the table's `overflow-x-auto` wrapper (a non-visible
 * overflow on one axis clips both axes per CSS). Anchored with fixed
 * coords relative to the trigger; closes on outside click, scroll, or
 * resize.
 */
export const RowMenu = ({ items }) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      const t = e.target;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(t) &&
        menuRef.current &&
        !menuRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onClose = () => setOpen(false);
    document.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: coords.top,
              right: coords.right,
              zIndex: 50,
            }}
            className="min-w-[10rem] py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg"
          >
            {items.map(item => (
              <button
                key={item.key}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onClick();
                }}
                className={`flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
                  item.destructive
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};
