import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export const Modal = ({ isOpen, onClose, title, subtitle, children, size = 'md' }) => {
  const { t } = useTranslation(['common']);
  const titleId = useId();
  const focusTrapRef = useFocusTrap(isOpen);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          ref={focusTrapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          className={`relative w-full ${sizeClasses[size]} bg-white dark:bg-slate-800 transform transition-all ${
            subtitle ? 'rounded-2xl shadow-2xl' : 'rounded-xl shadow-xl'
          }`}
        >
          {title && (
            <div className={`flex items-start justify-between border-b border-slate-100 dark:border-slate-700 ${
              subtitle ? 'px-6 pt-5 pb-4' : 'p-4'
            }`}>
              <div className="min-w-0">
                {subtitle && (
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                    {subtitle}
                  </p>
                )}
                <h3
                  id={titleId}
                  className={`text-lg text-slate-900 dark:text-slate-100 ${subtitle ? 'font-bold mt-0.5' : 'font-semibold'}`}
                >
                  {title}
                </h3>
              </div>
              <button
                onClick={onClose}
                aria-label={t('close')}
                className="p-1.5 -mr-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
          <div className="p-4 text-slate-900 dark:text-slate-100">{children}</div>
        </div>
      </div>
    </div>
  );
};
