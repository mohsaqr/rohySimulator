/**
 * Accessible publish/draft style switch. Laila green when on, gray when off.
 * Pass on/offLabel to show the current state as text (e.g. Published / Draft).
 */
export const Toggle = ({ checked, onChange, onLabel, offLabel, label, disabled, className = '' }) => {
  const text = label ?? (checked ? onLabel : offLabel);

  return (
    <label className={`inline-flex items-center gap-2.5 ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 ${
          checked ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
      {text && (
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 select-none">{text}</span>
      )}
    </label>
  );
};
