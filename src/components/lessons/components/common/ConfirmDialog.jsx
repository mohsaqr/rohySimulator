import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'danger',
  loading = false,
  requireSecondConfirm = false,
}) => {
  const { t } = useTranslation(['common']);
  // Tracks whether the first confirm click has happened (two-step mode).
  const [confirmed, setConfirmed] = useState(false);

  // Reset the two-step state whenever the dialog closes so a reopened
  // dialog always starts at the first step.
  useEffect(() => {
    if (!isOpen) setConfirmed(false);
  }, [isOpen]);

  const iconColors = {
    danger: 'text-red-500 bg-red-100',
    warning: 'text-yellow-500 bg-yellow-100',
  };

  const handleClose = () => {
    setConfirmed(false);
    onClose();
  };

  const handleConfirm = () => {
    if (requireSecondConfirm && !confirmed) {
      setConfirmed(true);
      return;
    }
    onConfirm();
  };

  const showFinal = requireSecondConfirm && confirmed;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="sm">
      <div className="text-center">
        <div
          className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center ${iconColors[variant]}`}
        >
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-slate-600">{message}</p>
        {showFinal && (
          <p className="mt-2 text-sm font-semibold text-red-600">
            {t('confirm_permanent_warning')}
          </p>
        )}
        <div className="mt-6 flex gap-3 justify-center">
          <Button variant="secondary" onClick={handleClose} disabled={loading}>
            {cancelText || t('cancel')}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={loading}
          >
            {showFinal ? t('confirm_final_delete') : confirmText || t('confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
