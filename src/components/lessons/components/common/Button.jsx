import { Loader2 } from 'lucide-react';

export const Button = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-200';

  const variantClasses = {
    primary: 'bg-gradient-to-r from-primary-500 to-secondary-600 text-white hover:from-primary-600 hover:to-secondary-700 shadow-md hover:shadow-lg disabled:opacity-50',
    secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600',
    outline: 'border-2 border-primary-500 text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-400 dark:hover:bg-primary-900/30',
    danger: 'bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : icon ? (
        icon
      ) : null}
      {children}
    </button>
  );
};
